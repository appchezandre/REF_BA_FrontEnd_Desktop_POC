import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthUser } from '../../../core/auth/auth-session';
import { WindowSyncService } from '../../../core/electron/window-sync.service';
import { UserDto } from './user.dto';
import { UsersService } from './users.service';

const BASE = environment.apiBaseUrl;

/** Doublure d'AuthService : pilote l'utilisateur actif sans HTTP ni bus. */
class AuthServiceStub {
  readonly user = signal<AuthUser | null>({
    id: 'u-1',
    email: 'user1@test.fr',
    displayName: 'Utilisateur 1'
  });
}

/** Bus inter-fenêtres factice : enregistre les publications. */
class FakeWindowSync {
  readonly published: Array<{ topic: string; data: unknown }> = [];

  getState(): Promise<unknown> {
    return Promise.resolve(null);
  }
  publish(topic: string, data: unknown): void {
    this.published.push({ topic, data });
  }
  onTopic(): () => void {
    return () => {};
  }
}

function makeUserDto(id: number): UserDto {
  return {
    id,
    name: `Utilisateur ${id}`,
    email: `user${id}@test.fr`,
    isDeleted: false,
    rowVersion: 'AAAA',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z'
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('UsersService — purge à la bascule d’utilisateur', () => {
  let service: UsersService;
  let auth: AuthServiceStub;
  let sync: FakeWindowSync;
  let http: HttpTestingController;

  async function loadInitialUsers(): Promise<void> {
    service.ensureLoaded();
    http.expectOne(`${BASE}/api/users`).flush([makeUserDto(1)]);
    await flushMicrotasks();
    expect(service.users()).toHaveLength(1);
  }

  beforeEach(() => {
    auth = new AuthServiceStub();
    sync = new FakeWindowSync();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: WindowSyncService, useValue: sync }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(UsersService);
  });

  afterEach(() => {
    http.verify();
  });

  it('conserve la liste au changement d’utilisateur (les écrans gardent leurs données)', async () => {
    await loadInitialUsers();

    auth.user.set({ id: 'u-2', email: 'user2@test.fr', displayName: 'Utilisateur 2' });
    TestBed.tick(); // laisse l'effect s'exécuter

    expect(service.users()).toHaveLength(1);
    // Toujours chargé : ensureLoaded ne redéclenche aucun appel (verify).
    service.ensureLoaded();
  });

  it('conserve la liste au dépilement (retour à l’utilisateur précédent)', async () => {
    auth.user.set({ id: 'u-2', email: 'user2@test.fr', displayName: 'Utilisateur 2' });
    TestBed.tick();
    await loadInitialUsers();

    auth.user.set({ id: 'u-1', email: 'user1@test.fr', displayName: 'Utilisateur 1' });
    TestBed.tick();
    expect(service.users()).toHaveLength(1);
  });

  it('purge à la déconnexion complète, sans publier l’état vidé', async () => {
    await loadInitialUsers();

    auth.user.set(null);
    TestBed.tick();

    expect(service.users()).toEqual([]);
    expect(service.error()).toBeNull();
    // Chaque fenêtre purge d'elle-même : l'état vidé ne part pas sur le bus.
    expect(sync.published.some((p) => Array.isArray(p.data) && p.data.length === 0)).toBe(
      false
    );
  });

  it('réarme le chargement paresseux après une déconnexion complète', async () => {
    await loadInitialUsers();

    auth.user.set(null);
    TestBed.tick();

    service.ensureLoaded();
    http.expectOne(`${BASE}/api/users`).flush([makeUserDto(2), makeUserDto(3)]);
    await flushMicrotasks();
    expect(service.users()).toHaveLength(2);
  });

  it('ne purge ni au premier run ni sur rotation de token (même id)', async () => {
    await loadInitialUsers();
    TestBed.tick(); // premier run de l'effect : pas de purge
    expect(service.users()).toHaveLength(1);

    // Rotation de token : nouvelle référence d'objet, même identité.
    auth.user.set({ id: 'u-1', email: 'user1@test.fr', displayName: 'Utilisateur 1' });
    TestBed.tick();
    expect(service.users()).toHaveLength(1);

    // Toujours chargé : ensureLoaded ne redéclenche aucun appel (verify).
    service.ensureLoaded();
  });
});
