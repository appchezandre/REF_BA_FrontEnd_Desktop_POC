import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { extractApiErrorMessage } from '../../../core/api/problem-details';
import { WindowSyncService } from '../../../core/electron/window-sync.service';
import { User, UserAccess, UserDraft, UserPermission, UserRole } from '../models/user';
import {
  mapPermissionDtoToUserPermission,
  mapRoleDtoToUserRole,
  mapUserAccessDtoToUserAccess,
  mapUserDtoToUser,
  parseSyncedUsers
} from '../mappers/user.mapper';
import { PermissionDto, RoleDto, UserAccessDto, UserDto, UserUpdateDto } from './user.dto';

/** Sujet du bus inter-fenêtres portant l'état complet des utilisateurs. */
const USERS_SYNC_TOPIC = 'users/state';

/** Données de création d'un utilisateur (le mot de passe est haché côté API). */
export interface UserCreationInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/**
 * Accès aux données Utilisateurs : appels REST vers `api/users` de Ref.Api
 * (Bearer ajouté par l'intercepteur d'auth ; erreurs RFC 7807 normalisées par
 * `extractApiErrorMessage` chez les appelants). L'API reste l'autorité : les
 * mutations renvoient l'état serveur (RowVersion inclus) qui est réappliqué
 * localement.
 *
 * Synchronisation inter-fenêtres : chaque chargement/mutation publie l'état
 * complet sur le bus ; les autres fenêtres l'appliquent après validation
 * (payload non fiable). Stratégie dernier-écrit-gagnant, suffisante car
 * chaque fenêtre peut recharger depuis l'API à tout moment.
 */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly sync = inject(WindowSyncService);
  private readonly baseUrl = environment.apiBaseUrl;

  private readonly usersSignal = signal<readonly User[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private loadRequested = false;

  readonly users = this.usersSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  /** Message d'échec du dernier chargement (null si OK). */
  readonly error = this.errorSignal.asReadonly();

  // Cache de consultation des accès (rôles/permissions), invalidé à chaque
  // mutation d'accès. Hors signal : lu à la demande par la fiche.
  private readonly accessCache = new Map<number, UserAccess>();

  constructor() {
    // Rattrapage : état publié par une autre fenêtre avant l'ouverture de
    // celle-ci (cas typique : fenêtre détachée avant la fin du chargement).
    void this.sync
      .getState(USERS_SYNC_TOPIC)
      .then((data) => this.applySyncedState(data));

    const unsubscribe = this.sync.onTopic(USERS_SYNC_TOPIC, (data) =>
      this.applySyncedState(data)
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /** Déclenche le premier chargement (idempotent) — appelé par l'écran. */
  ensureLoaded(): void {
    if (!this.loadRequested) {
      void this.reload();
    }
  }

  /** (Re)charge la liste complète depuis l'API. */
  async reload(): Promise<void> {
    this.loadRequested = true;
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    try {
      const dtos = await firstValueFrom(
        this.http.get<readonly UserDto[]>(`${this.baseUrl}/api/users`)
      );
      this.usersSignal.set(dtos.map(mapUserDtoToUser));
      this.publishState();
    } catch (error) {
      this.errorSignal.set(
        extractApiErrorMessage(error, 'Échec du chargement des utilisateurs.')
      );
    } finally {
      this.loadingSignal.set(false);
    }
  }

  getUser(id: number): User | undefined {
    return this.usersSignal().find((u) => u.id === id);
  }

  /** Résolution par clé d'écran (chaîne) — cf. `userKey`. */
  getUserByKey(key: string): User | undefined {
    const id = Number(key);
    return Number.isInteger(id) ? this.getUser(id) : undefined;
  }

  /** Crée un utilisateur (POST) et l'ajoute à la liste locale. */
  async createUser(input: UserCreationInput): Promise<User> {
    const dto = await firstValueFrom(
      this.http.post<UserDto>(`${this.baseUrl}/api/users`, input)
    );
    const user = mapUserDtoToUser(dto);
    this.usersSignal.update((users) => [...users, user]);
    this.publishState();
    return user;
  }

  /**
   * Enregistre un brouillon (PUT, concurrence optimiste par RowVersion). Le
   * mot de passe vide n'est pas transmis (inchangé côté backend).
   */
  async updateUser(user: User, draft: UserDraft): Promise<User> {
    const body: UserUpdateDto = {
      id: user.id,
      name: draft.name,
      password: draft.password === '' ? null : draft.password,
      rowVersion: user.rowVersion
    };
    const dto = await firstValueFrom(
      this.http.put<UserDto>(`${this.baseUrl}/api/users`, body)
    );
    const updated = mapUserDtoToUser(dto);
    this.usersSignal.update((users) =>
      users.map((u) => (u.id === updated.id ? updated : u))
    );
    this.publishState();
    return updated;
  }

  /** Suppression logique (DELETE avec corps) puis rechargement (état serveur). */
  async deleteUser(user: User): Promise<void> {
    const body: UserUpdateDto = {
      id: user.id,
      name: user.name,
      password: null,
      rowVersion: user.rowVersion
    };
    await firstValueFrom(this.http.delete<void>(`${this.baseUrl}/api/users`, { body }));
    await this.reload();
  }

  // --- Accès : rôles et permissions ----------------------------------------

  /** Vue des accès d'un utilisateur (profils, directes, effectives). */
  async getAccess(userId: number, options?: { readonly refresh?: boolean }): Promise<UserAccess> {
    if (!options?.refresh) {
      const cached = this.accessCache.get(userId);
      if (cached) {
        return cached;
      }
    }
    const dto = await firstValueFrom(
      this.http.get<UserAccessDto>(`${this.baseUrl}/api/users/${userId}/access`)
    );
    const access = mapUserAccessDtoToUserAccess(dto);
    this.accessCache.set(userId, access);
    return access;
  }

  /** Catalogue des profils (nécessite la permission `Role.Manage`). */
  async getRolesCatalog(): Promise<readonly UserRole[]> {
    const dtos = await firstValueFrom(
      this.http.get<readonly RoleDto[]>(`${this.baseUrl}/api/roles`)
    );
    return dtos.map(mapRoleDtoToUserRole);
  }

  /** Catalogue des permissions (nécessite la permission `Permission.Manage`). */
  async getPermissionsCatalog(): Promise<readonly UserPermission[]> {
    const dtos = await firstValueFrom(
      this.http.get<readonly PermissionDto[]>(`${this.baseUrl}/api/permissions`)
    );
    return dtos.map(mapPermissionDtoToUserPermission);
  }

  async assignRole(userId: number, roleId: number): Promise<void> {
    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/api/users/${userId}/roles/${roleId}`, null)
    );
    this.accessCache.delete(userId);
  }

  async removeRole(userId: number, roleId: number): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${this.baseUrl}/api/users/${userId}/roles/${roleId}`)
    );
    this.accessCache.delete(userId);
  }

  async grantPermission(userId: number, permissionId: number): Promise<void> {
    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/api/users/${userId}/permissions/${permissionId}`, null)
    );
    this.accessCache.delete(userId);
  }

  async revokePermission(userId: number, permissionId: number): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${this.baseUrl}/api/users/${userId}/permissions/${permissionId}`)
    );
    this.accessCache.delete(userId);
  }

  private publishState(): void {
    this.sync.publish(USERS_SYNC_TOPIC, this.usersSignal());
  }

  /** Applique un état reçu du bus après validation (donnée non fiable). */
  private applySyncedState(data: unknown): void {
    if (data === null) {
      return;
    }
    const users = parseSyncedUsers(data);
    if (users) {
      this.usersSignal.set(users);
    }
  }
}
