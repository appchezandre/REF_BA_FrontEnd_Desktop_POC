import { describe, it, expect } from 'vitest';
import {
  mapUserAccessDtoToUserAccess,
  mapUserDtoToUser,
  parseSyncedUsers
} from './user.mapper';
import { User } from '../models/user';

describe('mapUserDtoToUser', () => {
  it('convertit les champs DTO backend vers le modèle de domaine', () => {
    const user = mapUserDtoToUser({
      id: 7,
      name: 'Jane Doe',
      email: 'jane@test.fr',
      isDeleted: false,
      rowVersion: 'AAAAAAAAB9E=',
      createdAt: '2026-07-01T08:30:00',
      updatedAt: '2026-07-02T09:00:00',
      createdByUserName: 'admin'
    });
    expect(user).toEqual({
      id: 7,
      name: 'Jane Doe',
      email: 'jane@test.fr',
      deleted: false,
      createdAt: '2026-07-01T08:30:00',
      updatedAt: '2026-07-02T09:00:00',
      rowVersion: 'AAAAAAAAB9E='
    });
  });
});

describe('mapUserAccessDtoToUserAccess', () => {
  it('convertit profils, permissions directes et effectives', () => {
    const access = mapUserAccessDtoToUserAccess({
      userId: 7,
      roles: [{ id: 2, name: 'Gestionnaire', description: null, permissions: ['User.Read'] }],
      directPermissions: [{ id: 10, code: 'User.Write', description: null, source: 'System' }],
      effectivePermissions: ['User.Read', 'User.Write']
    });
    expect(access.userId).toBe(7);
    expect(access.roles).toEqual([
      { id: 2, name: 'Gestionnaire', description: '', permissions: ['User.Read'] }
    ]);
    expect(access.directPermissions).toEqual([
      { id: 10, code: 'User.Write', description: '', source: 'System' }
    ]);
    expect(access.effectivePermissions).toEqual(['User.Read', 'User.Write']);
  });
});

describe('parseSyncedUsers', () => {
  const valid: User = {
    id: 1,
    name: 'Jane',
    email: 'jane@test.fr',
    deleted: false,
    createdAt: '2026-07-01T08:30:00',
    updatedAt: '2026-07-01T08:30:00',
    rowVersion: 'AAAAAAAAB9E='
  };

  it('accepte un état valide à l’identique', () => {
    expect(parseSyncedUsers([valid])).toEqual([valid]);
  });

  it('rejette l’état entier si un seul élément est invalide (donnée IPC hostile)', () => {
    const cases: unknown[] = [
      'texte',
      { not: 'array' },
      [{ ...valid, id: 'un' }],
      [{ ...valid, id: 1.5 }],
      [{ ...valid, email: '' }],
      [{ ...valid, deleted: 'non' }],
      [{ ...valid, rowVersion: 42 }],
      [valid, null]
    ];
    for (const raw of cases) {
      expect(parseSyncedUsers(raw)).toBeNull();
    }
  });

  it('accepte un tableau vide', () => {
    expect(parseSyncedUsers([])).toEqual([]);
  });
});
