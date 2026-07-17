import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DesktopApi, SyncEvent } from '../electron/desktop-api';
import { AuthSession } from './auth-session';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const BASE = environment.apiBaseUrl;

interface DesktopApiMock {
  readonly api: DesktopApi;
  emitSyncEvent(event: SyncEvent): void;
}

/** Simule l'API preload (bus de sync) pour piloter la session dans les tests. */
function installDesktopApiMock(): DesktopApiMock {
  const syncListeners: Array<(event: SyncEvent) => void> = [];
  const mock: DesktopApiMock = {
    emitSyncEvent: (event) => syncListeners.forEach((listener) => listener(event)),
    api: {
      app: {
        getVersion: () => Promise.resolve('0.0.0-test'),
        getPlatform: () => Promise.resolve('win32')
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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeSession(accessToken: string, refreshToken: string): AuthSession {
  return {
    accessToken,
    accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
    refreshToken,
    refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z',
    user: { id: 'u-1', email: 'user@test.fr', displayName: 'Utilisateur Test' }
  };
}

describe('authInterceptor', () => {
  let mock: DesktopApiMock;
  let http: HttpTestingController;
  let httpClient: HttpClient;
  let auth: AuthService;

  /** Injecte une session dans AuthService via le bus (comme une autre fenêtre). */
  function seedSession(accessToken: string, refreshToken: string): void {
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { authenticated: true, session: makeSession(accessToken, refreshToken) },
      sourceWindowId: 'win-b'
    });
  }

  beforeEach(() => {
    mock = installDesktopApiMock();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    http.verify();
    delete window.desktopAPI;
  });

  it('n’ajoute pas d’en-tête sans session établie', () => {
    void firstValueFrom(httpClient.get(`${BASE}/api/orders`));
    const req = http.expectOne(`${BASE}/api/orders`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('ajoute le Bearer sur les appels API métier', () => {
    seedSession('access-1', 'refresh-1');
    void firstValueFrom(httpClient.get(`${BASE}/api/orders`));
    const req = http.expectOne(`${BASE}/api/orders`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    req.flush([]);
  });

  it('n’intercepte ni les endpoints d’auth ni les URLs hors API', () => {
    seedSession('access-1', 'refresh-1');

    void firstValueFrom(httpClient.post(`${BASE}/api/auth/login`, {}));
    const loginReq = http.expectOne(`${BASE}/api/auth/login`);
    expect(loginReq.request.headers.has('Authorization')).toBe(false);
    loginReq.flush({});

    void firstValueFrom(httpClient.get('https://exemple.fr/data'));
    const externalReq = http.expectOne('https://exemple.fr/data');
    expect(externalReq.request.headers.has('Authorization')).toBe(false);
    externalReq.flush({});
  });

  it('renouvelle la session sur 401 puis rejoue la requête', async () => {
    seedSession('access-1', 'refresh-1');
    const resultPromise = firstValueFrom(httpClient.get(`${BASE}/api/orders`));

    http
      .expectOne(`${BASE}/api/orders`)
      .flush(
        { status: 401, title: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );
    await flushMicrotasks();

    const refreshReq = http.expectOne(`${BASE}/api/auth/refresh`);
    expect(refreshReq.request.body).toEqual({ refreshToken: 'refresh-1' });
    refreshReq.flush({
      accessToken: 'access-2',
      accessTokenExpiresAtUtc: '2026-07-17T14:00:00Z',
      refreshToken: 'refresh-2',
      refreshTokenExpiresAtUtc: '2026-07-24T13:00:00Z'
    });
    await flushMicrotasks();

    const replay = http.expectOne(`${BASE}/api/orders`);
    expect(replay.request.headers.get('Authorization')).toBe('Bearer access-2');
    replay.flush({ value: 42 });

    await expect(resultPromise).resolves.toEqual({ value: 42 });
    // Rotation appliquée : le nouveau refresh token remplace l'ancien.
    expect(auth.session()?.refreshToken).toBe('refresh-2');
  });

  it('propage l’erreur d’origine et purge la session si le refresh est rejeté', async () => {
    seedSession('access-1', 'refresh-1');
    const resultPromise = firstValueFrom(httpClient.get(`${BASE}/api/orders`));

    http
      .expectOne(`${BASE}/api/orders`)
      .flush(
        { status: 401, title: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );
    await flushMicrotasks();

    http
      .expectOne(`${BASE}/api/auth/refresh`)
      .flush(
        { status: 401, title: 'Session expirée.' },
        { status: 401, statusText: 'Unauthorized' }
      );

    await expect(resultPromise).rejects.toMatchObject({ status: 401 });
    expect(auth.isAuthenticated()).toBe(false);
  });
});
