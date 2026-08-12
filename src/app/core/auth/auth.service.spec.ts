import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { DesktopApi, SyncEvent } from '../electron/desktop-api';
import { AuthResponseDto } from './auth.dto';
import { AuthSession } from './auth-session';
import { AuthService } from './auth.service';

const BASE = environment.apiBaseUrl;

interface DesktopApiMock {
  readonly api: DesktopApi;
  readonly published: Array<{ topic: string; data: unknown }>;
  emitSyncEvent(event: SyncEvent): void;
  retained: unknown;
}

/** Simule l'API preload pour tester la frontière Electron sans Electron. */
function installDesktopApiMock(): DesktopApiMock {
  const published: Array<{ topic: string; data: unknown }> = [];
  const syncListeners: Array<(event: SyncEvent) => void> = [];
  const mock: DesktopApiMock = {
    published,
    retained: null,
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
        publish: (topic, data) => {
          published.push({ topic, data });
          return Promise.resolve({ ok: true });
        },
        getState: () => Promise.resolve(mock.retained),
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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeAuthResponse(accessToken: string, refreshToken: string): AuthResponseDto {
  return {
    accessToken,
    accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
    refreshToken,
    refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z'
  };
}

function makeSession(): AuthSession {
  return {
    accessToken: 'access-1',
    accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
    refreshToken: 'refresh-1',
    refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z',
    user: { id: 'u-1', email: 'user@test.fr', displayName: 'Utilisateur Test' }
  };
}

describe('AuthService', () => {
  let mock: DesktopApiMock;
  let http: HttpTestingController;

  beforeEach(() => {
    mock = installDesktopApiMock();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    delete window.desktopAPI;
  });

  it('établit la session au login et la publie sur le bus', async () => {
    const service = TestBed.inject(AuthService);
    const promise = service.login('user@test.fr', 'secret');

    const req = http.expectOne(`${BASE}/api/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'user@test.fr', password: 'secret' });
    req.flush(makeAuthResponse('access-1', 'refresh-1'));

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(service.isAuthenticated()).toBe(true);
    expect(service.session()?.refreshToken).toBe('refresh-1');

    expect(mock.published).toHaveLength(1);
    expect(mock.published[0].topic).toBe('auth/state');
    expect(mock.published[0].data).toMatchObject({ authenticated: true });
  });

  it('remonte le message ProblemDetails sur identifiants invalides', async () => {
    const service = TestBed.inject(AuthService);
    const promise = service.login('user@test.fr', 'mauvais');

    http
      .expectOne(`${BASE}/api/auth/login`)
      .flush(
        { status: 401, title: 'Identifiants invalides.' },
        { status: 401, statusText: 'Unauthorized' }
      );

    const result = await promise;
    expect(result).toEqual({ ok: false, error: 'Identifiants invalides.' });
    expect(service.isAuthenticated()).toBe(false);
    expect(mock.published).toHaveLength(0);
  });

  it('applique une session valide reçue d’une autre fenêtre sans republier', () => {
    const service = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { authenticated: true, session: makeSession() },
      sourceWindowId: 'win-b'
    });
    expect(service.isAuthenticated()).toBe(true);
    expect(service.user()?.email).toBe('user@test.fr');
    expect(mock.published).toHaveLength(0);
  });

  it('ignore un payload hostile reçu du bus', () => {
    const service = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { authenticated: true, session: { accessToken: '', hostile: true } },
      sourceWindowId: 'win-b'
    });
    expect(service.isAuthenticated()).toBe(false);
  });

  it('rattrape la session retenue par le main à l’ouverture de la fenêtre', async () => {
    mock.retained = { authenticated: true, session: makeSession() };
    const service = TestBed.inject(AuthService);
    await flushMicrotasks();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('déconnecte localement, publie la déconnexion et révoque le refresh token', async () => {
    const service = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { authenticated: true, session: makeSession() },
      sourceWindowId: 'win-b'
    });

    const promise = service.logout();
    // Purge locale immédiate, sans attendre la révocation serveur.
    expect(service.isAuthenticated()).toBe(false);
    expect(mock.published).toHaveLength(1);
    expect(mock.published[0].data).toEqual({ authenticated: false });

    const req = http.expectOne(`${BASE}/api/auth/revoke`);
    expect(req.request.body).toEqual({ refreshToken: 'refresh-1' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('applique une déconnexion décidée par une autre fenêtre', () => {
    const service = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { authenticated: true, session: makeSession() },
      sourceWindowId: 'win-b'
    });
    expect(service.isAuthenticated()).toBe(true);

    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { authenticated: false },
      sourceWindowId: 'win-b'
    });
    expect(service.isAuthenticated()).toBe(false);
  });
});
