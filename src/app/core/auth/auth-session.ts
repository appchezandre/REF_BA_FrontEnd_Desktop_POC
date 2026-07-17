/** Identité applicative extraite des claims du JWT (`sub`, `email`, `name`). */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

/**
 * Session d'authentification d'une fenêtre. Conservée UNIQUEMENT en mémoire
 * (jamais dans localStorage) et partagée entre fenêtres via le bus IPC ;
 * l'utilisateur se reconnecte à chaque lancement de l'application.
 */
export interface AuthSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAtUtc: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAtUtc: string;
  readonly user: AuthUser;
}

/**
 * État publié sur le bus inter-fenêtres (`auth/state`). La forme enveloppée
 * distingue une déconnexion explicite (`authenticated: false`) de l'absence
 * d'état retenu (null renvoyé par le bus).
 */
export type SyncedAuthState =
  | { readonly authenticated: true; readonly session: AuthSession }
  | { readonly authenticated: false };
