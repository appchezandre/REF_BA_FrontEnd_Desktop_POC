import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAX_RECENT_RECORDS, RecentRecord, RecentRecordsService } from './recent-records.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth-session';
import { WindowSyncService } from '../electron/window-sync.service';

function record(recordId: string, title = `Commande ${recordId}`): RecentRecord {
  return {
    key: `order-list::${recordId}`,
    title,
    icon: 'orders',
    containerType: 'order-list',
    recordId
  };
}

/** Doublure d'AuthService : évite tout HTTP, pilote l'utilisateur actif. */
class AuthServiceStub {
  readonly user = signal<AuthUser | null>({
    id: 'u-1',
    email: 'user1@test.fr',
    displayName: 'Utilisateur 1'
  });
}

describe('RecentRecordsService', () => {
  let service: RecentRecordsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: new AuthServiceStub() }]
    });
    service = TestBed.inject(RecentRecordsService);
  });

  it('démarre avec une liste vide', () => {
    expect(service.records()).toEqual([]);
  });

  it('ajoute une fiche en tête de liste', () => {
    service.add(record('A'));
    service.add(record('B'));
    expect(service.records().map((r) => r.recordId)).toEqual(['B', 'A']);
  });

  it('dédoublonne par clé et remonte la fiche réouverte en tête', () => {
    service.add(record('A'));
    service.add(record('B'));
    service.add(record('A'));
    expect(service.records().map((r) => r.recordId)).toEqual(['A', 'B']);
    expect(service.records()).toHaveLength(2);
  });

  it('borne la liste à MAX_RECENT_RECORDS', () => {
    for (let i = 0; i < MAX_RECENT_RECORDS + 5; i++) {
      service.add(record(`CMD-${i}`));
    }
    expect(service.records()).toHaveLength(MAX_RECENT_RECORDS);
    // La plus récemment ajoutée est en tête, les plus anciennes évincées.
    expect(service.records()[0].recordId).toBe(`CMD-${MAX_RECENT_RECORDS + 4}`);
    expect(service.records().some((r) => r.recordId === 'CMD-0')).toBe(false);
  });

  it('clear vide la liste', () => {
    service.add(record('A'));
    service.clear();
    expect(service.records()).toEqual([]);
  });

  it('open délègue à l’ouvreur enregistré pour le type de conteneur', () => {
    const opened: string[] = [];
    service.registerOpener('order-list', (id) => opened.push(id));
    service.open(record('CMD-42'));
    expect(opened).toEqual(['CMD-42']);
  });

  it('open est sans effet si aucun ouvreur n’est enregistré', () => {
    expect(() => service.open(record('CMD-1'))).not.toThrow();
  });
});

describe('RecentRecordsService — synchronisation globale (bus inter-fenêtres)', () => {
  class FakeWindowSync {
    readonly published: Array<{ topic: string; data: unknown }> = [];
    private listener: ((data: unknown) => void) | null = null;

    getState(): Promise<unknown> {
      return Promise.resolve(null);
    }
    publish(topic: string, data: unknown): void {
      this.published.push({ topic, data });
    }
    onTopic(_topic: string, listener: (data: unknown) => void): () => void {
      this.listener = listener;
      return () => {
        this.listener = null;
      };
    }
    /** Simule une publication reçue d'une autre fenêtre. */
    emit(data: unknown): void {
      this.listener?.(data);
    }
  }

  let service: RecentRecordsService;
  let sync: FakeWindowSync;
  let auth: AuthServiceStub;

  beforeEach(() => {
    sync = new FakeWindowSync();
    auth = new AuthServiceStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: WindowSyncService, useValue: sync },
        { provide: AuthService, useValue: auth }
      ]
    });
    service = TestBed.inject(RecentRecordsService);
  });

  it('publie la liste complète à chaque ajout', () => {
    service.add(record('A'));
    service.add(record('B'));
    const last = sync.published.at(-1);
    expect(last?.topic).toBe('recent-records/state');
    expect((last?.data as readonly RecentRecord[]).map((r) => r.recordId)).toEqual(['B', 'A']);
  });

  it('applique un historique reçu d’une autre fenêtre (entrées validées, dédoublonnées)', () => {
    sync.emit([
      record('X'),
      { bogus: true }, // malformé -> ignoré
      record('X'), // doublon de clé -> ignoré
      record('Y')
    ]);
    expect(service.records().map((r) => r.recordId)).toEqual(['X', 'Y']);
  });

  it('ignore un payload qui n’est pas un tableau', () => {
    service.add(record('A'));
    sync.emit('n’importe quoi');
    expect(service.records().map((r) => r.recordId)).toEqual(['A']);
  });

  it('conserve l’historique au changement d’utilisateur actif', () => {
    service.add(record('A'));
    auth.user.set({ id: 'u-2', email: 'user2@test.fr', displayName: 'Utilisateur 2' });
    TestBed.tick(); // laisse l'effect s'exécuter

    expect(service.records()).toHaveLength(1);
  });

  it('vide l’historique (et le publie) à la déconnexion complète', () => {
    service.add(record('A'));
    auth.user.set(null);
    TestBed.tick();

    expect(service.records()).toEqual([]);
    const last = sync.published.at(-1);
    expect(last?.topic).toBe('recent-records/state');
    expect(last?.data).toEqual([]);
  });

  it('ne purge ni au premier run ni sur rotation de token (même id)', () => {
    service.add(record('A'));
    TestBed.tick(); // premier run de l'effect : pas de purge
    expect(service.records()).toHaveLength(1);

    // Rotation de token : nouvelle référence d'objet, même identité.
    auth.user.set({ id: 'u-1', email: 'user1@test.fr', displayName: 'Utilisateur 1' });
    TestBed.tick();
    expect(service.records()).toHaveLength(1);
  });
});
