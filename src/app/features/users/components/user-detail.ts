import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import { extractApiErrorMessage } from '../../../core/api/problem-details';
import { UsersService } from '../data-access/users.service';
import {
  USER_STATUS_LABELS,
  UserAccess,
  UserDraft,
  UserPermission,
  UserRole,
  userStatus
} from '../models/user';
import { UsersScreenStore } from '../store/users-screen.store';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

/**
 * Onglet Détail de la fenêtre Utilisateurs : fiche d'un utilisateur (clé =
 * id backend). Lecture seule par défaut (bouton « Modifier ») ; en édition,
 * nom et mot de passe sont modifiables et le brouillon vit dans
 * l'`UsersScreenStore` de l'instance hôte pour survivre aux changements
 * d'onglet.
 *
 * La fiche affiche aussi les **accès** (profils avec leurs permissions,
 * permissions directes, permissions effectives) chargés depuis
 * `api/users/{id}/access`, et permet de les gérer (affectation/retrait de
 * profil, octroi/révocation de permission directe) si l'utilisateur connecté
 * porte les permissions requises — sinon les catalogues renvoient 403 et les
 * contrôles d'ajout sont masqués avec une explication.
 */
@Component({
  selector: 'app-user-detail',
  templateUrl: './user-detail.html',
  styleUrl: './user-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserDetail {
  private readonly usersService = inject(UsersService);

  /** État de l'instance d'écran hôte (fourni par la page). */
  readonly screen = input.required<UsersScreenStore>();
  readonly userKey = input.required<string>();

  protected readonly statusLabels = USER_STATUS_LABELS;

  protected readonly user = computed(() =>
    this.usersService.getUserByKey(this.userKey())
  );

  protected readonly draft = computed(() => this.screen().drafts().get(this.userKey()));

  protected readonly editing = computed(() =>
    this.screen().editing().has(this.userKey())
  );

  protected readonly dirty = computed(() =>
    this.screen().dirtyKeys().has(this.userKey())
  );

  /** Message d'échec du dernier enregistrement (conflit, validation…). */
  protected readonly saveError = signal<string | null>(null);
  protected readonly saving = signal(false);

  // --- Accès (rôles et permissions) ----------------------------------------
  protected readonly access = signal<UserAccess | null>(null);
  protected readonly accessLoading = signal(false);
  protected readonly accessError = signal<string | null>(null);

  /** Mode gestion des accès (charge les catalogues à l'activation). */
  protected readonly manageAccess = signal(false);
  protected readonly rolesCatalog = signal<readonly UserRole[] | null>(null);
  protected readonly rolesCatalogError = signal<string | null>(null);
  protected readonly permissionsCatalog = signal<readonly UserPermission[] | null>(null);
  protected readonly permissionsCatalogError = signal<string | null>(null);
  protected readonly selectedRoleId = signal<number | null>(null);
  protected readonly selectedPermissionId = signal<number | null>(null);
  /** Message d'échec de la dernière action d'accès (403, 422…). */
  protected readonly accessActionError = signal<string | null>(null);
  protected readonly accessBusy = signal(false);

  /** Profils du catalogue non encore affectés à l'utilisateur. */
  protected readonly assignableRoles = computed<readonly UserRole[]>(() => {
    const catalog = this.rolesCatalog();
    const current = this.access();
    if (!catalog) {
      return [];
    }
    const owned = new Set((current?.roles ?? []).map((r) => r.id));
    return catalog.filter((r) => !owned.has(r.id));
  });

  /** Permissions du catalogue non encore accordées directement. */
  protected readonly grantablePermissions = computed<readonly UserPermission[]>(() => {
    const catalog = this.permissionsCatalog();
    const current = this.access();
    if (!catalog) {
      return [];
    }
    const owned = new Set((current?.directPermissions ?? []).map((p) => p.id));
    return catalog.filter((p) => !owned.has(p.id));
  });

  constructor() {
    // Charge les accès à l'affichage de la fiche (et si l'id change).
    effect(() => {
      const id = this.user()?.id;
      if (id !== undefined) {
        untracked(() => void this.loadAccess(id));
      }
    });
  }

  private async loadAccess(userId: number, refresh = false): Promise<void> {
    this.accessLoading.set(true);
    this.accessError.set(null);
    try {
      this.access.set(await this.usersService.getAccess(userId, { refresh }));
    } catch (error) {
      this.access.set(null);
      this.accessError.set(
        extractApiErrorMessage(error, 'Échec du chargement des rôles et permissions.')
      );
    } finally {
      this.accessLoading.set(false);
    }
  }

  protected beginEdit(): void {
    this.saveError.set(null);
    this.screen().beginEdit(this.userKey());
  }

  protected updateField(field: keyof UserDraft, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.screen().updateDraft(this.userKey(), { [field]: value });
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      this.saveError.set(await this.screen().saveDraft(this.userKey()));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    this.saveError.set(null);
    this.screen().cancelEdit(this.userKey());
  }

  // --- Gestion des accès -----------------------------------------------------

  protected toggleManageAccess(): void {
    const next = !this.manageAccess();
    this.manageAccess.set(next);
    this.accessActionError.set(null);
    if (next) {
      void this.loadCatalogs();
    }
  }

  private async loadCatalogs(): Promise<void> {
    if (this.rolesCatalog() === null && this.rolesCatalogError() === null) {
      try {
        this.rolesCatalog.set(await this.usersService.getRolesCatalog());
      } catch (error) {
        this.rolesCatalogError.set(
          extractApiErrorMessage(
            error,
            'Catalogue des profils indisponible (permission Role.Manage requise).'
          )
        );
      }
    }
    if (this.permissionsCatalog() === null && this.permissionsCatalogError() === null) {
      try {
        this.permissionsCatalog.set(await this.usersService.getPermissionsCatalog());
      } catch (error) {
        this.permissionsCatalogError.set(
          extractApiErrorMessage(
            error,
            'Catalogue des permissions indisponible (permission Permission.Manage requise).'
          )
        );
      }
    }
  }

  protected onRoleSelect(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedRoleId.set(Number.isInteger(value) && value > 0 ? value : null);
  }

  protected onPermissionSelect(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedPermissionId.set(Number.isInteger(value) && value > 0 ? value : null);
  }

  protected assignRole(): void {
    const roleId = this.selectedRoleId();
    if (roleId !== null) {
      void this.runAccessAction((userId) => this.usersService.assignRole(userId, roleId));
      this.selectedRoleId.set(null);
    }
  }

  protected removeRole(roleId: number): void {
    void this.runAccessAction((userId) => this.usersService.removeRole(userId, roleId));
  }

  protected grantPermission(): void {
    const permissionId = this.selectedPermissionId();
    if (permissionId !== null) {
      void this.runAccessAction((userId) =>
        this.usersService.grantPermission(userId, permissionId)
      );
      this.selectedPermissionId.set(null);
    }
  }

  protected revokePermission(permissionId: number): void {
    void this.runAccessAction((userId) =>
      this.usersService.revokePermission(userId, permissionId)
    );
  }

  /** Exécute une mutation d'accès puis recharge la vue des accès. */
  private async runAccessAction(action: (userId: number) => Promise<void>): Promise<void> {
    const user = this.user();
    if (!user || this.accessBusy()) {
      return;
    }
    this.accessBusy.set(true);
    this.accessActionError.set(null);
    try {
      await action(user.id);
      await this.loadAccess(user.id, true);
    } catch (error) {
      this.accessActionError.set(
        extractApiErrorMessage(error, "Échec de la modification des accès.")
      );
    } finally {
      this.accessBusy.set(false);
    }
  }

  /** Chargement de la liste en cours (fiche pas encore résolue). */
  protected usersLoading(): boolean {
    return this.usersService.loading();
  }

  protected statusLabel(): string {
    const user = this.user();
    return user ? USER_STATUS_LABELS[userStatus(user)] : '';
  }

  protected isDeleted(): boolean {
    return this.user()?.deleted === true;
  }

  protected formatDateTime(iso: string): string {
    if (!iso) {
      return '—';
    }
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMAT.format(date);
  }
}
