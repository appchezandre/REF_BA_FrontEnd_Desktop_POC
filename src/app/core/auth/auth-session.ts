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
 * État publié sur le bus inter-fenêtres (`auth/state`) : la pile de sessions
 * entière, sommet en dernière position = session active. Un tableau vide
 * signifie « déconnecté » ; la forme enveloppée distingue une déconnexion
 * explicite de l'absence d'état retenu (null renvoyé par le bus).
 */
export interface SyncedAuthState {
  readonly sessions: readonly AuthSession[];
}
