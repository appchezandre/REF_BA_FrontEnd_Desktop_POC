import { User, UserAccess, UserPermission, UserRole } from '../models/user';
import { PermissionDto, RoleDto, UserAccessDto, UserDto } from '../data-access/user.dto';

/** Conversion explicite DTO backend -> modèle de domaine front. */
export function mapUserDtoToUser(dto: UserDto): User {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    deleted: dto.isDeleted,
    createdAt: dto.createdAt ?? '',
    updatedAt: dto.updatedAt ?? '',
    rowVersion: dto.rowVersion ?? ''
  };
}

export function mapRoleDtoToUserRole(dto: RoleDto): UserRole {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? '',
    permissions: [...(dto.permissions ?? [])]
  };
}

export function mapPermissionDtoToUserPermission(dto: PermissionDto): UserPermission {
  return {
    id: dto.id,
    code: dto.code,
    description: dto.description ?? '',
    source: dto.source ?? ''
  };
}

export function mapUserAccessDtoToUserAccess(dto: UserAccessDto): UserAccess {
  return {
    userId: dto.userId,
    roles: (dto.roles ?? []).map(mapRoleDtoToUserRole),
    directPermissions: (dto.directPermissions ?? []).map(mapPermissionDtoToUserPermission),
    effectivePermissions: [...(dto.effectivePermissions ?? [])]
  };
}

/** Garde de type : utilisateur reçu du bus inter-fenêtres (non fiable). */
export function parseSyncedUser(raw: unknown): User | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value['id'] !== 'number' || !Number.isInteger(value['id'])) {
    return null;
  }
  if (typeof value['name'] !== 'string') {
    return null;
  }
  if (typeof value['email'] !== 'string' || value['email'].length === 0) {
    return null;
  }
  if (typeof value['deleted'] !== 'boolean') {
    return null;
  }
  if (typeof value['createdAt'] !== 'string' || typeof value['updatedAt'] !== 'string') {
    return null;
  }
  if (typeof value['rowVersion'] !== 'string') {
    return null;
  }
  return {
    id: value['id'],
    name: value['name'],
    email: value['email'],
    deleted: value['deleted'],
    createdAt: value['createdAt'],
    updatedAt: value['updatedAt'],
    rowVersion: value['rowVersion']
  };
}

/** Valide un état complet reçu du bus ; null si un seul élément est invalide. */
export function parseSyncedUsers(raw: unknown): readonly User[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const users: User[] = [];
  for (const item of raw) {
    const user = parseSyncedUser(item);
    if (!user) {
      return null;
    }
    users.push(user);
  }
  return users;
}
