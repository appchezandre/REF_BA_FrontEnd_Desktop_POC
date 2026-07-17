/** Modèle de domaine front de la feature Utilisateurs. */

/** Statut dérivé de la suppression logique côté backend (`IsDeleted`). */
export type UserStatus = 'active' | 'deleted';

export const USER_STATUSES: readonly UserStatus[] = ['active', 'deleted'];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Actif',
  deleted: 'Supprimé'
};

export interface User {
  /** Identifiant backend (clé de la fiche, stable). */
  readonly id: number;
  readonly name: string;
  /** Identifiant de connexion — non modifiable après création. */
  readonly email: string;
  /** Suppression logique (l'utilisateur reste référencé par l'audit). */
  readonly deleted: boolean;
  /** Date ISO 8601. */
  readonly createdAt: string;
  /** Date ISO 8601. */
  readonly updatedAt: string;
  /** Jeton de concurrence optimiste (base64, opaque) exigé par PUT/DELETE. */
  readonly rowVersion: string;
}

/** Clé d'onglet/détail d'un utilisateur (les clés d'écran sont des chaînes). */
export function userKey(user: User): string {
  return String(user.id);
}

export function userStatus(user: User): UserStatus {
  return user.deleted ? 'deleted' : 'active';
}

/**
 * Champs modifiables d'un utilisateur (brouillon d'édition d'une fiche).
 * L'e-mail n'est pas modifiable (identifiant de connexion) ; le mot de passe
 * laissé vide reste inchangé côté backend.
 */
export interface UserDraft {
  readonly name: string;
  readonly password: string;
}

export function draftFromUser(user: User): UserDraft {
  return { name: user.name, password: '' };
}

export function isDraftEqual(user: User, draft: UserDraft): boolean {
  return user.name === draft.name && draft.password === '';
}

// --- Accès (rôles et permissions) ------------------------------------------

/** Profil (rôle) avec les codes des permissions qui le composent. */
export interface UserRole {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** Codes des permissions composant le profil (ex. `User.Read`). */
  readonly permissions: readonly string[];
}

/** Permission du catalogue (ou accordée directement à un utilisateur). */
export interface UserPermission {
  readonly id: number;
  readonly code: string;
  readonly description: string;
  /** Origine : `System` (déclarée par le code) ou `Custom`. */
  readonly source: string;
}

/** Vue des accès d'un utilisateur : profils, permissions directes, effectives. */
export interface UserAccess {
  readonly userId: number;
  readonly roles: readonly UserRole[];
  readonly directPermissions: readonly UserPermission[];
  /** Union dédoublonnée : permissions des profils + permissions directes. */
  readonly effectivePermissions: readonly string[];
}
