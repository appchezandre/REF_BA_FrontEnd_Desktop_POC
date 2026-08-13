import { AuthResponseDto } from './auth.dto';
import { AuthSession, AuthUser, SyncedAuthState } from './auth-session';

/**
 * Décode le payload d'un JWT sans vérifier la signature : côté client le
 * contenu sert uniquement à l'affichage (identité), l'API reste seule
 * autorité. Retourne null si le token est malformé.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts.length === 3 ? parts[1] : undefined;
  if (!payload) {
    return null;
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Conversion réponse d'auth -> session de domaine. L'identité vient des
 * claims du JWT (`sub`, `email`, `name`) ; champs vides si indécodables
 * (la session reste utilisable, seul l'affichage est dégradé).
 */
export function mapAuthResponseToSession(dto: AuthResponseDto): AuthSession {
  const claims = decodeJwtPayload(dto.accessToken) ?? {};
  const user: AuthUser = {
    id: typeof claims['sub'] === 'string' ? claims['sub'] : '',
    email: typeof claims['email'] === 'string' ? claims['email'] : '',
    displayName: typeof claims['name'] === 'string' ? claims['name'] : ''
  };
  return {
    accessToken: dto.accessToken,
    accessTokenExpiresAtUtc: dto.accessTokenExpiresAtUtc,
    refreshToken: dto.refreshToken,
    refreshTokenExpiresAtUtc: dto.refreshTokenExpiresAtUtc,
    user
  };
}

/** Garde de type : session reçue du bus inter-fenêtres (non fiable). */
function parseSyncedSession(raw: unknown): AuthSession | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value['accessToken'] !== 'string' || value['accessToken'].length === 0) {
    return null;
  }
  if (typeof value['accessTokenExpiresAtUtc'] !== 'string') {
    return null;
  }
  if (typeof value['refreshToken'] !== 'string' || value['refreshToken'].length === 0) {
    return null;
  }
  if (typeof value['refreshTokenExpiresAtUtc'] !== 'string') {
    return null;
  }
  const rawUser = value['user'];
  if (typeof rawUser !== 'object' || rawUser === null) {
    return null;
  }
  const user = rawUser as Record<string, unknown>;
  if (
    typeof user['id'] !== 'string' ||
    typeof user['email'] !== 'string' ||
    typeof user['displayName'] !== 'string'
  ) {
    return null;
  }
  return {
    accessToken: value['accessToken'],
    accessTokenExpiresAtUtc: value['accessTokenExpiresAtUtc'],
    refreshToken: value['refreshToken'],
    refreshTokenExpiresAtUtc: value['refreshTokenExpiresAtUtc'],
    user: { id: user['id'], email: user['email'], displayName: user['displayName'] }
  };
}

/**
 * Valide un état d'auth complet reçu du bus ; null si le payload est invalide.
 * Le payload IPC n'est pas fiable : une seule entrée invalide dans la pile
 * rejette l'état entier plutôt que d'appliquer une pile partielle.
 */
export function parseSyncedAuthState(raw: unknown): SyncedAuthState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value['sessions'])) {
    return null;
  }
  const sessions: AuthSession[] = [];
  for (const entry of value['sessions']) {
    const session = parseSyncedSession(entry);
    if (!session) {
      return null;
    }
    sessions.push(session);
  }
  return { sessions };
}
