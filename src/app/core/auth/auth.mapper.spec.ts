import { describe, it, expect } from 'vitest';
import { AuthResponseDto } from './auth.dto';
import { AuthSession } from './auth-session';
import {
  decodeJwtPayload,
  mapAuthResponseToSession,
  parseSyncedAuthState
} from './auth.mapper';

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

function makeAuthResponse(accessToken: string): AuthResponseDto {
  return {
    accessToken,
    accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
    refreshToken: 'refresh-opaque-1',
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

describe('decodeJwtPayload', () => {
  it('décode les claims, y compris les caractères accentués (UTF-8)', () => {
    const token = makeJwt({ sub: 'u-1', name: 'Pierre-Yves Février' });
    const claims = decodeJwtPayload(token);
    expect(claims?.['sub']).toBe('u-1');
    expect(claims?.['name']).toBe('Pierre-Yves Février');
  });

  it('retourne null pour un token malformé', () => {
    expect(decodeJwtPayload('pas-un-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
  });

  it('retourne null si le payload n’est pas un objet JSON', () => {
    const token = `x.${encodeBase64Url(JSON.stringify(['tableau']))}.y`;
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe('mapAuthResponseToSession', () => {
  it('reprend les tokens et extrait l’identité des claims', () => {
    const token = makeJwt({ sub: 'u-42', email: 'user@test.fr', name: 'Utilisateur Test' });
    const session = mapAuthResponseToSession(makeAuthResponse(token));
    expect(session.accessToken).toBe(token);
    expect(session.refreshToken).toBe('refresh-opaque-1');
    expect(session.user).toEqual({
      id: 'u-42',
      email: 'user@test.fr',
      displayName: 'Utilisateur Test'
    });
  });

  it('dégrade en identité vide si le token est indécodable (session utilisable)', () => {
    const session = mapAuthResponseToSession(makeAuthResponse('token-opaque'));
    expect(session.accessToken).toBe('token-opaque');
    expect(session.user).toEqual({ id: '', email: '', displayName: '' });
  });
});

describe('parseSyncedAuthState', () => {
  it('accepte une pile vide (déconnexion explicite)', () => {
    expect(parseSyncedAuthState({ sessions: [] })).toEqual({ sessions: [] });
  });

  it('accepte une pile de sessions valides', () => {
    const first = makeSession();
    const second = { ...makeSession(), refreshToken: 'refresh-2' };
    expect(parseSyncedAuthState({ sessions: [first, second] })).toEqual({
      sessions: [first, second]
    });
  });

  it('rejette les payloads hostiles ou incomplets', () => {
    expect(parseSyncedAuthState(null)).toBeNull();
    expect(parseSyncedAuthState('texte')).toBeNull();
    expect(parseSyncedAuthState({})).toBeNull();
    expect(parseSyncedAuthState({ sessions: 'pas-un-tableau' })).toBeNull();
    expect(
      parseSyncedAuthState({
        sessions: [{ ...makeSession(), user: { id: 1, email: 2, displayName: 3 } }]
      })
    ).toBeNull();
  });

  it('rejette la pile entière si une seule entrée est invalide', () => {
    expect(
      parseSyncedAuthState({ sessions: [makeSession(), { accessToken: '' }] })
    ).toBeNull();
  });
});
