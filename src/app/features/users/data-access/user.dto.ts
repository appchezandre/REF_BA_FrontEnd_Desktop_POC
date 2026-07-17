/**
 * Contrats HTTP de la ressource `api/users` de Ref.Api (et des catalogues
 * `api/roles` / `api/permissions` utilisés pour la gestion des accès).
 * Casing JSON : camelCase (sérialisation ASP.NET Core par défaut) ;
 * `RowVersion` (byte[]) transite en chaîne base64 opaque.
 */

/** `UserDTO` backend (lecture). N'expose jamais l'empreinte du mot de passe. */
export interface UserDto {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly isDeleted: boolean;
  readonly rowVersion: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByUserId?: number;
  readonly createdByUserName?: string | null;
  readonly updatedByUserId?: number;
  readonly updatedByUserName?: string | null;
}

/** `UserCreationDTO` backend (POST). */
export interface UserCreationDto {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/** `UserUpdateDTO` backend (PUT, et corps du DELETE — suppression logique). */
export interface UserUpdateDto {
  readonly id: number;
  readonly name: string;
  /** Optionnel : laissé null/vide, le mot de passe reste inchangé. */
  readonly password: string | null;
  readonly rowVersion: string;
}

/** `RoleDTO` backend (profil, avec les codes de ses permissions). */
export interface RoleDto {
  readonly id: number;
  readonly name: string;
  readonly description?: string | null;
  readonly permissions: readonly string[];
}

/** `PermissionDTO` backend (catalogue). */
export interface PermissionDto {
  readonly id: number;
  readonly code: string;
  readonly description?: string | null;
  readonly source: string;
}

/** `UserAccessDTO` backend (GET `api/users/{id}/access`). */
export interface UserAccessDto {
  readonly userId: number;
  readonly roles: readonly RoleDto[];
  readonly directPermissions: readonly PermissionDto[];
  readonly effectivePermissions: readonly string[];
}
