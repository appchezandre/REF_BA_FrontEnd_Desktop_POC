import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { DesktopApi, SyncEvent } from './core/electron/desktop-api';
import { MaintenanceApi } from './core/maintenance/maintenance-api';
import { MaintenanceHubClient } from './core/maintenance/maintenance-hub.client';
import { MaintenanceService } from './core/maintenance/maintenance.service';

interface DesktopApiMock {
  readonly api: DesktopApi;
  emitSyncEvent(event: SyncEvent): void;
}

/** Simule l'API preload pour piloter la session sans Electron. */
function installDesktopApiMock(): DesktopApiMock {
  const syncListeners: Array<(event: SyncEvent) => void> = [];
  const mock: DesktopApiMock = {
    emitSyncEvent: (event) => syncListeners.forEach((listener) => listener(event)),
    api: {
      app: {
        getVersion: () => Promise.resolve('0.0.0-test'),
        getPlatform: () => Promise.resolve('win32'),
        quit: () => Promise.resolve()
      },
      windows: {
        getContext: () => Promise.resolve(null),
        minimize: () => Promise.resolve(),
        toggleMaximize: () => Promise.resolve(false),
        isMaximized: () => Promise.resolve(false),
        close: () => Promise.resolve(),
        detachTab: () => Promise.resolve({ ok: false, error: 'test' }),
        onMaximizedChanged: () => () => {}
      },
      sync: {
        publish: () => Promise.resolve({ ok: true }),
        getState: () => Promise.resolve(null),
        onEvent: (listener) => {
          syncListeners.push(listener);
          return () => {};
        }
      }
    }
  };
  window.desktopAPI = mock.api;
  return mock;
}

/** État hors maintenance renvoyé par l'API simulée. */
const OPERATIONAL_NOTIFICATION = {
  isUnderMaintenance: false,
  delayMinutes: 0,
  message: '',
  timestampUtc: '2026-08-12T09:00:00Z'
};

/** Laisse l'amorçage différé de MaintenanceService se terminer. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

describe('App', () => {
  let mock: DesktopApiMock;
  /** État que l'API de maintenance simulée renvoie à l'amorçage. */
  let maintenanceNotification: unknown;

  beforeEach(async () => {
    mock = installDesktopApiMock();
    maintenanceNotification = OPERATIONAL_NOTIFICATION;
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Le voile de maintenance est branché sur la racine : on neutralise
        // l'accès réseau du service (API + hub SignalR) sans le remplacer.
        {
          provide: MaintenanceApi,
          useValue: {
            getState: () => Promise.resolve(maintenanceNotification),
            start: () => Promise.resolve(maintenanceNotification),
            stop: () => Promise.resolve(OPERATIONAL_NOTIFICATION)
          }
        },
        {
          provide: MaintenanceHubClient,
          useValue: {
            isConnected: true,
            start: () => Promise.resolve(true),
            stop: () => Promise.resolve()
          }
        }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    delete window.desktopAPI;
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('affiche l’écran de connexion tant qu’aucune session n’est établie', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-login-page')).toBeTruthy();
    expect(compiled.querySelector('app-shell')).toBeNull();
  });

  it('affiche le shell une fois la session établie (ex. via une autre fenêtre)', async () => {
    TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: {
        authenticated: true,
        session: {
          accessToken: 'access-1',
          accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
          refreshToken: 'refresh-1',
          refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z',
          user: { id: 'u-1', email: 'user@test.fr', displayName: 'Utilisateur Test' }
        }
      },
      sourceWindowId: 'win-b'
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-shell')).toBeTruthy();
    expect(compiled.querySelector('app-title-bar')).toBeTruthy();
    expect(compiled.querySelector('app-status-bar')).toBeTruthy();
    expect(compiled.querySelector('app-login-page')).toBeNull();
  });

  it('recouvre l’écran de connexion quand l’API est en maintenance', async () => {
    // L'amorçage lit l'état auprès de l'API : c'est la source autoritaire au
    // démarrage, y compris quand la maintenance est déjà active.
    maintenanceNotification = {
      isUnderMaintenance: true,
      delayMinutes: 10,
      message: 'Migration de la base en cours.',
      timestampUtc: '2026-08-12T09:00:00Z'
    };

    const fixture = TestBed.createComponent(App);
    await flushMicrotasks();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Le voile est rendu HORS de la garde d'auth : il couvre aussi la
    // connexion, qui doit rester impossible pendant la maintenance.
    expect(compiled.querySelector('app-maintenance-overlay')).toBeTruthy();
    expect(compiled.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(compiled.textContent).toContain('Migration de la base en cours.');
    expect(compiled.querySelector('app-login-page')).toBeTruthy();
  });

  it('ferme la session ouverte quand la maintenance s’active', async () => {
    const auth = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: {
        authenticated: true,
        session: {
          accessToken: 'access-1',
          accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
          refreshToken: 'refresh-1',
          refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z',
          user: { id: 'u-1', email: 'user@test.fr', displayName: 'Utilisateur Test' }
        }
      },
      sourceWindowId: 'win-b'
    });
    expect(auth.isAuthenticated()).toBe(true);

    maintenanceNotification = {
      isUnderMaintenance: true,
      delayMinutes: 0,
      message: 'Maintenance immédiate.',
      timestampUtc: '2026-08-12T09:00:00Z'
    };
    TestBed.inject(MaintenanceService);

    const fixture = TestBed.createComponent(App);
    await flushMicrotasks();
    await fixture.whenStable();

    // Déconnexion forcée : le shell (et tous les écrans métier) a disparu, le
    // voile reste au-dessus de l'écran de connexion.
    expect(auth.isAuthenticated()).toBe(false);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-maintenance-overlay')).toBeTruthy();
    expect(compiled.querySelector('app-shell')).toBeNull();
  });

  it('affiche le bandeau de sursis sans figer l’application', async () => {
    const auth = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: {
        authenticated: true,
        session: {
          accessToken: 'access-1',
          accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
          refreshToken: 'refresh-1',
          refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z',
          user: { id: 'u-1', email: 'user@test.fr', displayName: 'Utilisateur Test' }
        }
      },
      sourceWindowId: 'win-b'
    });

    const fixture = TestBed.createComponent(App);
    await flushMicrotasks();
    await fixture.whenStable();

    // Sursis annoncé par une fenêtre voisine, après l'amorçage.
    mock.emitSyncEvent({
      topic: 'maintenance/state',
      data: {
        phase: 'grace',
        delayMinutes: 5,
        message: 'Maintenance dans 2 minutes.',
        changedAtUtc: '2026-08-12T09:00:00Z',
        graceDeadlineMs: Date.now() + 120_000
      },
      sourceWindowId: 'win-b'
    });
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-maintenance-banner')).toBeTruthy();
    expect(compiled.textContent).toContain('Maintenance dans 2 minutes.');
    // L'application reste utilisable : pas de voile, session et shell intacts.
    expect(compiled.querySelector('app-maintenance-overlay')).toBeNull();
    expect(compiled.querySelector('app-shell')).toBeTruthy();
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('n’affiche aucun voile hors maintenance', async () => {
    const fixture = TestBed.createComponent(App);
    await flushMicrotasks();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-maintenance-overlay')).toBeNull();
    expect(compiled.querySelector('app-maintenance-banner')).toBeNull();
  });
});
