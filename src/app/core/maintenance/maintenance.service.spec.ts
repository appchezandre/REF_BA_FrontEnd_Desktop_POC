import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { WindowSyncService } from '../electron/window-sync.service';
import { MaintenanceApi } from './maintenance-api';
import {
  MaintenanceHubClient,
  MaintenanceHubHandlers
} from './maintenance-hub.client';
import { MaintenanceNotificationDto } from './maintenance.dto';
import { GRACE_PERIOD_MS } from './maintenance-state';
import { MAINTENANCE_SYNC_TOPIC, MaintenanceService } from './maintenance.service';

function notification(
  isUnderMaintenance: boolean,
  overrides: Partial<MaintenanceNotificationDto> = {}
): MaintenanceNotificationDto {
  return {
    isUnderMaintenance,
    delayMinutes: isUnderMaintenance ? 5 : 0,
    message: isUnderMaintenance ? 'Application en maintenance.' : 'Fin de la maintenance.',
    timestampUtc: '2026-08-12T09:00:00Z',
    ...overrides
  };
}

/**
 * Vide la file de microtâches sans passer par un timer : l'amorçage du service
 * est différé d'une microtâche et les tests utilisent des timers simulés.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

describe('MaintenanceService', () => {
  let api: {
    getState: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let publish: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let hubStart: ReturnType<typeof vi.fn>;
  let hubConnected: boolean;
  let isAuthenticated: WritableSignal<boolean>;
  /** Écouteur du bus inter-fenêtres enregistré par le service. */
  let busListener: ((data: unknown) => void) | null;
  /** Gestionnaires transmis au hub, pour simuler ses notifications. */
  let hubHandlers: MaintenanceHubHandlers | null;

  /** Instancie le service et laisse son amorçage (différé) se terminer. */
  async function createService(): Promise<MaintenanceService> {
    const service = TestBed.inject(MaintenanceService);
    await flushMicrotasks();
    return service;
  }

  /** Amorce le service hors maintenance, puis annonce une maintenance. */
  async function enterGrace(): Promise<MaintenanceService> {
    const service = await createService();
    hubHandlers?.onNotification(notification(true));
    await flushMicrotasks();
    return service;
  }

  beforeEach(() => {
    // Timers simulés partout : le sursis et son décompte reposent dessus.
    vi.useFakeTimers();
    busListener = null;
    hubHandlers = null;
    hubConnected = true;
    isAuthenticated = signal(true);

    api = {
      getState: vi.fn(() => Promise.resolve(notification(false))),
      start: vi.fn(() => Promise.resolve(notification(true))),
      stop: vi.fn(() => Promise.resolve(notification(false)))
    };
    publish = vi.fn();
    logout = vi.fn(() => Promise.resolve());
    hubStart = vi.fn((handlers?: MaintenanceHubHandlers) => {
      if (handlers) {
        hubHandlers = handlers;
      }
      return Promise.resolve(hubConnected);
    });

    TestBed.configureTestingModule({
      providers: [
        MaintenanceService,
        { provide: MaintenanceApi, useValue: api },
        {
          provide: MaintenanceHubClient,
          useValue: {
            get isConnected() {
              return hubConnected;
            },
            start: hubStart,
            stop: vi.fn(() => Promise.resolve())
          }
        },
        {
          provide: WindowSyncService,
          useValue: {
            publish,
            getState: () => Promise.resolve(null),
            onTopic: (_topic: string, listener: (data: unknown) => void) => {
              busListener = listener;
              return () => {
                busListener = null;
              };
            }
          }
        },
        { provide: AuthService, useValue: { isAuthenticated, logout } }
      ]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('démarre hors maintenance et interroge l’API à l’amorçage', async () => {
    const service = await createService();

    expect(api.getState).toHaveBeenCalledTimes(1);
    expect(service.phase()).toBe('operational');
    expect(service.underMaintenance()).toBe(false);
    expect(service.initiatedLocally()).toBe(false);
  });

  it('gèle immédiatement si la maintenance est déjà active au démarrage', async () => {
    // Rien à enregistrer : l'utilisateur vient d'ouvrir l'application.
    api.getState.mockResolvedValue(notification(true, { message: 'Migration.' }));

    const service = await createService();

    expect(service.phase()).toBe('frozen');
    expect(service.message()).toBe('Migration.');
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('ne publie rien à l’amorçage : elle apprend l’état, ne l’annonce pas', async () => {
    api.getState.mockResolvedValue(notification(true));

    await createService();

    // Publier ici écraserait le sursis d'une fenêtre voisine si la réponse
    // HTTP devançait le rattrapage du bus.
    expect(publish).not.toHaveBeenCalled();
  });

  describe('sursis', () => {
    it('ouvre un sursis de deux minutes sans figer ni déconnecter', async () => {
      const service = await enterGrace();

      expect(service.phase()).toBe('grace');
      expect(service.inGrace()).toBe(true);
      expect(service.frozen()).toBe(false);
      expect(service.underMaintenance()).toBe(true);
      // L'utilisateur doit pouvoir enregistrer : la session reste ouverte.
      expect(logout).not.toHaveBeenCalled();
      expect(service.remainingSeconds()).toBe(GRACE_PERIOD_MS / 1000);
    });

    it('décompte le temps restant', async () => {
      const service = await enterGrace();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(service.remainingSeconds()).toBe(119);

      await vi.advanceTimersByTimeAsync(59_000);
      expect(service.remainingSeconds()).toBe(60);
      expect(service.phase()).toBe('grace');
    });

    it('gèle et ferme la session à l’échéance', async () => {
      const service = await enterGrace();

      await vi.advanceTimersByTimeAsync(GRACE_PERIOD_MS);

      expect(service.phase()).toBe('frozen');
      expect(service.remainingSeconds()).toBe(0);
      expect(logout).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        MAINTENANCE_SYNC_TOPIC,
        expect.objectContaining({ phase: 'frozen', graceDeadlineMs: null })
      );
    });

    it('ne déconnecte qu’une fois, même après l’échéance', async () => {
      await enterGrace();

      await vi.advanceTimersByTimeAsync(GRACE_PERIOD_MS + 60_000);

      expect(logout).toHaveBeenCalledTimes(1);
    });

    it('ne redémarre pas le sursis quand le message est mis à jour', async () => {
      const service = await enterGrace();
      await vi.advanceTimersByTimeAsync(60_000);

      hubHandlers?.onNotification(notification(true, { message: 'Encore un instant.' }));
      await flushMicrotasks();

      expect(service.message()).toBe('Encore un instant.');
      expect(service.phase()).toBe('grace');
      // Le décompte poursuit sur l'échéance initiale.
      expect(service.remainingSeconds()).toBe(60);
    });

    it('annule le sursis si la maintenance est levée avant l’échéance', async () => {
      const service = await enterGrace();
      await vi.advanceTimersByTimeAsync(30_000);

      hubHandlers?.onNotification(notification(false));
      await flushMicrotasks();

      expect(service.phase()).toBe('operational');
      expect(service.remainingSeconds()).toBe(0);

      // Le minuteur est bien désarmé : aucun gel tardif.
      await vi.advanceTimersByTimeAsync(GRACE_PERIOD_MS);
      expect(service.phase()).toBe('operational');
      expect(logout).not.toHaveBeenCalled();
    });

    it('partage l’échéance avec les autres fenêtres', async () => {
      await enterGrace();

      const published = publish.mock.calls.find(
        ([topic]) => topic === MAINTENANCE_SYNC_TOPIC
      );
      expect(published?.[1]).toMatchObject({ phase: 'grace' });
      expect(typeof published?.[1].graceDeadlineMs).toBe('number');
    });

    it('adopte l’échéance reçue du bus au lieu d’en ouvrir une nouvelle', async () => {
      const service = await createService();
      publish.mockClear();

      // Fenêtre voisine à 30 s du gel.
      busListener?.({
        phase: 'grace',
        delayMinutes: 5,
        message: 'Application en maintenance.',
        changedAtUtc: '2026-08-12T09:00:00Z',
        graceDeadlineMs: Date.now() + 30_000
      });

      expect(service.phase()).toBe('grace');
      expect(service.remainingSeconds()).toBe(30);
      expect(publish).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(service.phase()).toBe('frozen');
    });

    it('gèle d’emblée si l’échéance reçue est déjà passée', async () => {
      const service = await createService();

      // Fenêtre ouverte après la fin du sursis.
      busListener?.({
        phase: 'grace',
        delayMinutes: 5,
        message: 'Application en maintenance.',
        changedAtUtc: '',
        graceDeadlineMs: Date.now() - 1_000
      });

      expect(service.phase()).toBe('frozen');
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });

  it('ne tente pas de déconnexion sans session établie', async () => {
    isAuthenticated.set(false);
    await enterGrace();

    await vi.advanceTimersByTimeAsync(GRACE_PERIOD_MS);

    expect(logout).not.toHaveBeenCalled();
  });

  it('ignore un payload de bus invalide', async () => {
    const service = await createService();

    busListener?.(null);
    busListener?.('en maintenance');
    busListener?.({ phase: 'inconnue' });

    expect(service.phase()).toBe('operational');
  });

  it('gèle sans sursis la fenêtre qui déclenche la maintenance', async () => {
    const service = await createService();

    await service.startMaintenance(10, 'Migration en cours.');

    // L'opérateur choisit l'instant : rien à enregistrer, gel immédiat.
    expect(service.phase()).toBe('frozen');
    expect(service.initiatedLocally()).toBe(true);
    expect(api.start).toHaveBeenCalledWith({
      delayMinutes: 10,
      message: 'Migration en cours.'
    });
  });

  it('conserve la session de la fenêtre qui déclenche la maintenance', async () => {
    const service = await createService();

    await service.startMaintenance(5, null);

    // `stop` exige la permission `Maintenance.Manage` : la déconnecter la
    // priverait du seul moyen de lever la maintenance.
    expect(logout).not.toHaveBeenCalled();
    expect(service.phase()).toBe('frozen');
  });

  it('gèle l’initiatrice même si la notification du hub double la réponse HTTP', async () => {
    const service = await createService();

    // Le serveur diffuse au hub AVANT de répondre au POST : ce chemin ne porte
    // pas le marqueur `immediate` et ouvrait un sursis à tort.
    const pending = service.startMaintenance(5, null);
    hubHandlers?.onNotification(notification(true));

    expect(service.phase()).toBe('frozen');
    expect(service.inGrace()).toBe(false);

    await pending;

    expect(service.phase()).toBe('frozen');
    expect(logout).not.toHaveBeenCalled();
    // Les autres fenêtres reçoivent malgré tout le sursis.
    const published = publish.mock.calls.find(
      ([topic]) => topic === MAINTENANCE_SYNC_TOPIC
    );
    expect(published?.[1]).toMatchObject({ phase: 'grace' });
  });

  it('gèle l’initiatrice même si une voisine rediffuse le sursis par le bus', async () => {
    const service = await createService();
    let resolveStart!: (dto: MaintenanceNotificationDto) => void;
    api.start.mockImplementation(
      () => new Promise<MaintenanceNotificationDto>((resolve) => (resolveStart = resolve))
    );

    const pending = service.startMaintenance(5, null);
    busListener?.({
      phase: 'grace',
      delayMinutes: 5,
      message: 'Application en maintenance.',
      changedAtUtc: '2026-08-12T09:00:00Z',
      graceDeadlineMs: Date.now() + 120_000
    });

    expect(service.phase()).toBe('frozen');

    resolveStart(notification(true));
    await pending;

    expect(service.phase()).toBe('frozen');
    expect(logout).not.toHaveBeenCalled();
  });

  it('diffuse malgré tout le sursis aux autres fenêtres', async () => {
    const service = await createService();
    publish.mockClear();

    await service.startMaintenance(5, null);

    // Le seul cas où l'état publié diffère de l'état local : les autres
    // fenêtres ont du travail à protéger.
    const published = publish.mock.calls.find(
      ([topic]) => topic === MAINTENANCE_SYNC_TOPIC
    );
    expect(published?.[1]).toMatchObject({ phase: 'grace' });
    expect(typeof published?.[1].graceDeadlineMs).toBe('number');
    expect(service.phase()).toBe('frozen');
  });

  it('lève la maintenance et réinitialise l’indicateur d’initiateur', async () => {
    const service = await createService();
    await service.startMaintenance(10, 'Migration en cours.');
    expect(service.initiatedLocally()).toBe(true);

    const result = await service.stopMaintenance();

    expect(result.ok).toBe(true);
    expect(service.phase()).toBe('operational');
    expect(service.initiatedLocally()).toBe(false);
  });

  it('omet les champs vides de la requête de démarrage', async () => {
    const service = await createService();

    await service.startMaintenance(null, '   ');

    expect(api.start).toHaveBeenCalledWith({});
  });

  it('n’endosse pas le rôle d’initiateur si le démarrage échoue', async () => {
    const service = await createService();
    api.start.mockRejectedValue(
      new HttpErrorResponse({
        status: 500,
        error: { status: 500, title: 'Erreur serveur.' }
      })
    );

    const result = await service.startMaintenance(5, null);

    expect(result).toEqual({ ok: false, error: 'Erreur serveur.' });
    expect(service.initiatedLocally()).toBe(false);
    expect(service.phase()).toBe('operational');
  });

  it('conserve l’état connu si l’API est injoignable', async () => {
    api.getState.mockRejectedValue(new HttpErrorResponse({ status: 0 }));

    const service = await createService();

    // Une erreur réseau ne doit jamais être interprétée comme une maintenance.
    expect(service.phase()).toBe('operational');
  });

  it('arme le sondage de repli quand le hub ne se connecte pas', async () => {
    hubConnected = false;
    const service = await createService();
    expect(api.getState).toHaveBeenCalledTimes(1);

    // Le sondage prend le relais et découvre la maintenance sans le hub.
    api.getState.mockResolvedValue(notification(true));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(service.phase()).toBe('grace');
  });

  it('arrête le sondage dès que le hub est reconnecté', async () => {
    hubConnected = false;
    await createService();
    const callsBefore = api.getState.mock.calls.length;

    hubConnected = true;
    hubHandlers?.onStatusChange('connected');
    await vi.advanceTimersByTimeAsync(90_000);

    // Une seule relecture (celle déclenchée par la reconnexion), pas de sondage.
    expect(api.getState).toHaveBeenCalledTimes(callsBefore + 1);
  });
});
