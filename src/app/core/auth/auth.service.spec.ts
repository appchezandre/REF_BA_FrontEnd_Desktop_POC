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

/** Access token encore valide (loin dans le futur, marge de 30 s comprise). */
const FUTURE_EXPIRY = '2030-01-01T00:00:00Z';
/** Access token expiré (session inactive restée trop longtemps empilée). */
const PAST_EXPIRY = '2026-01-01T00:00:00Z';

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

/** Encode base64url (RFC 7515) une chaîne UTF-8, comme un émetteur de JWT. */
function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** JWT de test (signature factice : elle n'est jamais vérifiée côté client). */
function makeJwt(claims: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  return `${header}.${encodeBase64Url(JSON.stringify(claims))}.signature`;
}

/** JWT portant l'identité de l'utilisateur `suffix` (u-1, u-2…). */
function makeUserJwt(suffix: string): string {
  return makeJwt({
    sub: `u-${suffix}`,
    email: `user${suffix}@test.fr`,
    name: `Utilisateur ${suffix}`
  });
}

function makeAuthResponse(accessToken: string, refreshToken: string): AuthResponseDto {
  return {
    accessToken,
    accessTokenExpiresAtUtc: FUTURE_EXPIRY,
    refreshToken,
    refreshTokenExpiresAtUtc: FUTURE_EXPIRY
  };
}

/** Session de l'utilisateur `suffix`, tokens dérivés du même suffixe. */
function makeSession(suffix = '1', accessTokenExpiresAtUtc = FUTURE_EXPIRY): AuthSession {
  return {
    accessToken: `access-${suffix}`,
    accessTokenExpiresAtUtc,
    refreshToken: `refresh-${suffix}`,
    refreshTokenExpiresAtUtc: FUTURE_EXPIRY,
    user: {
      id: `u-${suffix}`,
      email: `user${suffix}@test.fr`,
      displayName: `Utilisateur ${suffix}`
    }
  };
}

describe('AuthService', () => {
  let mock: DesktopApiMock;
  let http: HttpTestingController;

  /** Injecte une pile dans AuthService via le bus (comme une autre fenêtre). */
  function seedStack(sessions: readonly AuthSession[]): void {
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { sessions },
      sourceWindowId: 'win-b'
    });
  }

  /** Dernière pile publiée sur le bus (assertion sur le format `{sessions}`). */
  function lastPublishedSessions(): readonly AuthSession[] {
    const last = mock.published.at(-1);
    expect(last?.topic).toBe('auth/state');
    return (last?.data as { sessions: readonly AuthSession[] }).sessions;
  }

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

  it('établit la pile au login et la publie sur le bus', async () => {
    const service = TestBed.inject(AuthService);
    const promise = service.login('user1@test.fr', 'secret');

    const req = http.expectOne(`${BASE}/api/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'user1@test.fr', password: 'secret' });
    req.flush(makeAuthResponse(makeUserJwt('1'), 'refresh-1'));

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(service.isAuthenticated()).toBe(true);
    expect(service.sessionCount()).toBe(1);
    expect(service.session()?.refreshToken).toBe('refresh-1');
    expect(service.previousUser()).toBeNull();

    expect(mock.published).toHaveLength(1);
    expect(lastPublishedSessions()).toHaveLength(1);
  });

  it('remonte le message ProblemDetails sur identifiants invalides', async () => {
    const service = TestBed.inject(AuthService);
    const promise = service.login('user1@test.fr', 'mauvais');

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

  it('applique une pile valide reçue d’une autre fenêtre sans republier', () => {
    const service = TestBed.inject(AuthService);
    seedStack([makeSession('1'), makeSession('2')]);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.user()?.email).toBe('user2@test.fr');
    expect(service.previousUser()?.email).toBe('user1@test.fr');
    expect(mock.published).toHaveLength(0);
  });

  it('ignore un payload hostile reçu du bus (pile partielle rejetée en bloc)', () => {
    const service = TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: { sessions: [makeSession('1'), { accessToken: '', hostile: true }] },
      sourceWindowId: 'win-b'
    });
    expect(service.isAuthenticated()).toBe(false);
  });

  it('rattrape la pile retenue par le main à l’ouverture de la fenêtre', async () => {
    mock.retained = { sessions: [makeSession('1')] };
    const service = TestBed.inject(AuthService);
    await flushMicrotasks();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('applique une déconnexion décidée par une autre fenêtre (pile vide)', () => {
    const service = TestBed.inject(AuthService);
    seedStack([makeSession('1')]);
    expect(service.isAuthenticated()).toBe(true);

    seedStack([]);
    expect(service.isAuthenticated()).toBe(false);
  });

  describe('switchUser', () => {
    it('empile la nouvelle session, l’utilisateur précédent reste connecté', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1')]);

      const promise = service.switchUser('user2@test.fr', 'secret');
      http
        .expectOne(`${BASE}/api/auth/login`)
        .flush(makeAuthResponse(makeUserJwt('2'), 'refresh-2'));

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(service.sessionCount()).toBe(2);
      expect(service.user()?.id).toBe('u-2');
      expect(service.previousUser()?.id).toBe('u-1');
      expect(lastPublishedSessions().map((s) => s.refreshToken)).toEqual([
        'refresh-1',
        'refresh-2'
      ]);
    });

    it('laisse la pile intacte si la connexion échoue', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1')]);

      const promise = service.switchUser('user2@test.fr', 'mauvais');
      http
        .expectOne(`${BASE}/api/auth/login`)
        .flush(
          { status: 401, title: 'Identifiants invalides.' },
          { status: 401, statusText: 'Unauthorized' }
        );

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(service.sessionCount()).toBe(1);
      expect(service.user()?.id).toBe('u-1');
      expect(mock.published).toHaveLength(0);
    });

    it('remplace la session existante du même utilisateur (jamais de doublon)', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1'), makeSession('2')]);

      // u-1, déjà au fond de la pile, se reconnecte : son ancienne session est
      // retirée (et révoquée), la nouvelle prend le sommet.
      const promise = service.switchUser('user1@test.fr', 'secret');
      http
        .expectOne(`${BASE}/api/auth/login`)
        .flush(makeAuthResponse(makeUserJwt('1'), 'refresh-1b'));
      const result = await promise;
      expect(result).toEqual({ ok: true });

      expect(service.sessionCount()).toBe(2);
      expect(service.user()?.id).toBe('u-1');
      expect(service.previousUser()?.id).toBe('u-2');
      expect(lastPublishedSessions().map((s) => s.refreshToken)).toEqual([
        'refresh-2',
        'refresh-1b'
      ]);

      await flushMicrotasks();
      const revoke = http.expectOne(`${BASE}/api/auth/revoke`);
      expect(revoke.request.body).toEqual({ refreshToken: 'refresh-1' });
      revoke.flush(null, { status: 204, statusText: 'No Content' });
    });
  });

  describe('logout (dépilement)', () => {
    it('dépile le sommet, ne révoque que son token et rend la main au précédent', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1'), makeSession('2')]);

      const promise = service.logout();
      // Dépilement local immédiat, sans attendre la révocation serveur.
      expect(service.sessionCount()).toBe(1);
      expect(service.user()?.id).toBe('u-1');
      expect(lastPublishedSessions().map((s) => s.refreshToken)).toEqual(['refresh-1']);

      const revoke = http.expectOne(`${BASE}/api/auth/revoke`);
      expect(revoke.request.body).toEqual({ refreshToken: 'refresh-2' });
      revoke.flush(null, { status: 204, statusText: 'No Content' });
      await promise;

      // Session reprise valide : aucun appel de refresh.
      expect(service.isAuthenticated()).toBe(true);
    });

    it('vide la pile et repasse déconnecté quand la dernière session part', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1')]);

      const promise = service.logout();
      expect(service.isAuthenticated()).toBe(false);
      expect(lastPublishedSessions()).toEqual([]);

      http
        .expectOne(`${BASE}/api/auth/revoke`)
        .flush(null, { status: 204, statusText: 'No Content' });
      await promise;
    });

    it('renouvelle la session reprise si son access token a expiré', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1', PAST_EXPIRY), makeSession('2')]);

      const promise = service.logout();
      await flushMicrotasks();

      http
        .expectOne(`${BASE}/api/auth/revoke`)
        .flush(null, { status: 204, statusText: 'No Content' });

      const refresh = http.expectOne(`${BASE}/api/auth/refresh`);
      expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });
      refresh.flush(makeAuthResponse(makeUserJwt('1'), 'refresh-1b'));
      await promise;

      expect(service.sessionCount()).toBe(1);
      expect(service.session()?.refreshToken).toBe('refresh-1b');
      expect(service.user()?.id).toBe('u-1');
    });

    it('dépile en boucle les sessions dont le refresh est rejeté', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1', PAST_EXPIRY), makeSession('2')]);

      const promise = service.logout();
      await flushMicrotasks();

      http
        .expectOne(`${BASE}/api/auth/revoke`)
        .flush(null, { status: 204, statusText: 'No Content' });

      // Le serveur rejette le refresh de u-1 : sa session est retirée à son
      // tour et, la pile étant vide, l'application repasse déconnectée.
      http
        .expectOne(`${BASE}/api/auth/refresh`)
        .flush(
          { status: 401, title: 'Session expirée.' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await promise;

      expect(service.isAuthenticated()).toBe(false);
      expect(lastPublishedSessions()).toEqual([]);
    });

    it('conserve la session reprise sur erreur réseau du refresh', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1', PAST_EXPIRY), makeSession('2')]);

      const promise = service.logout();
      await flushMicrotasks();

      http
        .expectOne(`${BASE}/api/auth/revoke`)
        .flush(null, { status: 204, statusText: 'No Content' });

      http.expectOne(`${BASE}/api/auth/refresh`).error(new ProgressEvent('error'));
      await promise;

      // Pas de purge sur panne réseau : l'intercepteur retentera au premier 401.
      expect(service.isAuthenticated()).toBe(true);
      expect(service.session()?.refreshToken).toBe('refresh-1');
    });
  });

  describe('logoutAll', () => {
    it('vide la pile, publie la déconnexion et révoque chaque session', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1'), makeSession('2')]);

      const promise = service.logoutAll();
      expect(service.isAuthenticated()).toBe(false);
      expect(lastPublishedSessions()).toEqual([]);

      const revokes = http.match(`${BASE}/api/auth/revoke`);
      expect(revokes.map((r) => r.request.body)).toEqual([
        { refreshToken: 'refresh-1' },
        { refreshToken: 'refresh-2' }
      ]);
      // Échec de révocation absorbé (best-effort) : logoutAll aboutit quand même.
      revokes[0].flush({ status: 500 }, { status: 500, statusText: 'Server Error' });
      revokes[1].flush(null, { status: 204, statusText: 'No Content' });
      await promise;

      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('refreshSession', () => {
    it('remplace la session capturée même si un switchUser s’est intercalé', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1')]);

      const promise = service.refreshSession();
      const refresh = http.expectOne(`${BASE}/api/auth/refresh`);
      expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });

      // Une autre fenêtre empile u-2 pendant que le refresh est en vol : le
      // résultat doit s'appliquer à la session de u-1, pas au nouveau sommet.
      seedStack([makeSession('1'), makeSession('2')]);

      refresh.flush(makeAuthResponse(makeUserJwt('1'), 'refresh-1b'));
      await expect(promise).resolves.toBe(true);

      expect(service.user()?.id).toBe('u-2');
      expect(lastPublishedSessions().map((s) => s.refreshToken)).toEqual([
        'refresh-1b',
        'refresh-2'
      ]);
    });

    it('ne retire que la session rejetée, les autres survivent', async () => {
      const service = TestBed.inject(AuthService);
      seedStack([makeSession('1')]);

      const promise = service.refreshSession();
      const refresh = http.expectOne(`${BASE}/api/auth/refresh`);

      seedStack([makeSession('1'), makeSession('2')]);

      refresh.flush(
        { status: 401, title: 'Session expirée.' },
        { status: 401, statusText: 'Unauthorized' }
      );
      await expect(promise).resolves.toBe(false);

      expect(service.sessionCount()).toBe(1);
      expect(service.user()?.id).toBe('u-2');
    });
  });
});
