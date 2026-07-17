import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { extractApiErrorMessage } from '../../../core/api/problem-details';
import { ShellUiService } from '../../../core/shell/shell-ui.service';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { UsersService } from '../data-access/users.service';
import { UserColumnId } from '../models/user-column';
import { USER_STATUS_LABELS, User, userKey, userStatus } from '../models/user';
import {
  UsersScreenStore,
  PAGE_SIZE_OPTIONS,
  PageSize,
  SortDirection
} from '../store/users-screen.store';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR');

/** Largeurs fixes des colonnes structurelles (indicateur d'état, actions), en
 *  px — doivent correspondre aux règles `.cg-indicator` / `.cg-actions` du CSS. */
const INDICATOR_WIDTH = 28;
const ACTIONS_WIDTH = 72;

/** Suivi d'un redimensionnement de colonne en cours. */
interface ResizeState {
  readonly columnId: UserColumnId;
  readonly startX: number;
  readonly startWidth: number;
}

/** Onglet Liste de la fenêtre Utilisateurs : table à colonnes déplaçables et
 *  masquables, triable (multi-colonnes), paginée, avec ouverture du détail,
 *  création (dialogue) et suppression logique (confirmation). */
@Component({
  selector: 'app-user-list',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, ConfirmDialog],
  templateUrl: './user-list.html',
  styleUrl: './user-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserList {
  protected readonly usersService = inject(UsersService);
  private readonly shellUi = inject(ShellUiService);

  /** État de l'instance d'écran hôte (fourni par la page). */
  readonly screen = input.required<UsersScreenStore>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  /** Colonne dont le menu contextuel d'en-tête est ouvert (une seule à la fois). */
  protected readonly openMenuColumn = signal<UserColumnId | null>(null);

  /** Colonne en cours de redimensionnement (pour le style ; null au repos). */
  protected readonly resizingColumn = signal<UserColumnId | null>(null);
  private resize: ResizeState | null = null;

  /** Clés des utilisateurs actuellement ouverts en fiche (surbrillance). */
  protected readonly openKeys = computed(() => new Set(this.screen().detailKeys()));

  // --- Création (dialogue local) -------------------------------------------
  protected readonly createOpen = signal(false);
  protected readonly createName = signal('');
  protected readonly createEmail = signal('');
  protected readonly createPassword = signal('');
  protected readonly createError = signal<string | null>(null);
  protected readonly creating = signal(false);

  /** Utilisateur dont la suppression attend confirmation. */
  protected readonly pendingDelete = signal<User | null>(null);
  /** Message d'échec de la dernière action (suppression…), affiché en bandeau. */
  protected readonly actionError = signal<string | null>(null);

  /** Largeur totale de la table (colonnes structurelles + colonnes visibles). */
  protected readonly tableWidth = computed(
    () =>
      INDICATOR_WIDTH +
      ACTIONS_WIDTH +
      this.screen()
        .visibleColumns()
        .reduce((sum, col) => sum + this.screen().columnWidth(col.id), 0)
  );

  protected key(user: User): string {
    return userKey(user);
  }

  protected edit(user: User): void {
    this.screen().openDetail(userKey(user));
  }

  /** Réorganisation des colonnes par glisser-déposer (en-têtes). */
  protected onColumnDrop(event: CdkDragDrop<unknown>): void {
    this.screen().moveColumn(event.previousIndex, event.currentIndex);
  }

  // --- Création --------------------------------------------------------------

  protected openCreate(): void {
    this.createName.set('');
    this.createEmail.set('');
    this.createPassword.set('');
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
  }

  protected async submitCreate(event: Event): Promise<void> {
    event.preventDefault();
    if (this.creating()) {
      return;
    }
    this.creating.set(true);
    this.createError.set(null);
    try {
      const user = await this.usersService.createUser({
        name: this.createName().trim(),
        email: this.createEmail().trim(),
        password: this.createPassword()
      });
      this.createOpen.set(false);
      this.screen().openDetail(userKey(user));
    } catch (error) {
      this.createError.set(
        extractApiErrorMessage(error, "Échec de la création de l'utilisateur.")
      );
    } finally {
      this.creating.set(false);
    }
  }

  protected onCreateField(field: 'name' | 'email' | 'password', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (field === 'name') {
      this.createName.set(value);
    } else if (field === 'email') {
      this.createEmail.set(value);
    } else {
      this.createPassword.set(value);
    }
  }

  // --- Suppression (logique, avec confirmation) ------------------------------

  protected askDelete(event: Event, user: User): void {
    event.stopPropagation();
    this.pendingDelete.set(user);
  }

  protected async confirmDelete(): Promise<void> {
    const user = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!user) {
      return;
    }
    this.actionError.set(null);
    try {
      await this.usersService.deleteUser(user);
    } catch (error) {
      this.actionError.set(
        extractApiErrorMessage(error, "Échec de la suppression de l'utilisateur.")
      );
    }
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  // --- Redimensionnement de colonne (poignée sur le bord droit de l'en-tête) --

  protected startResize(columnId: UserColumnId, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.resize = {
      columnId,
      startX: event.clientX,
      startWidth: this.screen().columnWidth(columnId)
    };
    this.resizingColumn.set(columnId);
  }

  protected onResize(event: PointerEvent): void {
    if (!this.resize) {
      return;
    }
    const delta = event.clientX - this.resize.startX;
    this.screen().setColumnWidth(this.resize.columnId, this.resize.startWidth + delta);
  }

  protected endResize(event: PointerEvent): void {
    if (!this.resize) {
      return;
    }
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    this.resize = null;
    this.resizingColumn.set(null);
  }

  /** Double-clic sur la poignée : revient à la largeur par défaut. */
  protected resetWidth(columnId: UserColumnId): void {
    this.screen().resetColumnWidth(columnId);
  }

  /** Ouvre/ferme le menu contextuel d'en-tête d'une colonne. */
  protected toggleMenu(columnId: UserColumnId): void {
    this.openMenuColumn.update((current) => (current === columnId ? null : columnId));
  }

  protected closeMenu(): void {
    this.openMenuColumn.set(null);
  }

  // --- Tri (délégué au store), depuis le menu contextuel d'en-tête ----------

  protected setSort(columnId: UserColumnId, direction: SortDirection): void {
    this.screen().setSort(columnId, direction);
  }

  protected addSort(columnId: UserColumnId, direction: SortDirection): void {
    this.screen().addSort(columnId, direction);
  }

  protected removeSort(columnId: UserColumnId): void {
    this.screen().removeSort(columnId);
  }

  protected clearSort(): void {
    this.screen().clearSort();
  }

  /** Indicateur de sens (▲/▼) affiché dans l'en-tête, ou '' si non trié. */
  protected sortIndicator(columnId: UserColumnId): string {
    const direction = this.screen().sortDirectionFor(columnId);
    return direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '';
  }

  /** Valeur ARIA de tri pour l'en-tête de colonne. */
  protected ariaSort(columnId: UserColumnId): 'ascending' | 'descending' | 'none' {
    const direction = this.screen().sortDirectionFor(columnId);
    if (!direction) {
      return 'none';
    }
    return direction === 'asc' ? 'ascending' : 'descending';
  }

  protected toggleColumn(columnId: UserColumnId): void {
    this.screen().toggleColumnVisibility(columnId);
  }

  /** Ouvre la side bar de recherche (contextuelle aux utilisateurs). */
  protected openSearch(): void {
    this.shellUi.revealSearch();
  }

  protected onPageSizeChange(value: string): void {
    this.screen().setPageSize(value === 'all' ? 'all' : Number(value));
  }

  protected pageSizeLabel(size: PageSize): string {
    return size === 'all' ? 'Tous' : String(size);
  }

  protected pageSizeValue(size: PageSize): string {
    return size === 'all' ? 'all' : String(size);
  }

  /** Libellé « début–fin sur total » de la page courante. */
  protected rangeLabel(): string {
    const total = this.screen().filteredCount();
    if (total === 0) {
      return '0 sur 0';
    }
    const size = this.screen().pageSize();
    const start = size === 'all' ? 1 : this.screen().pageIndex() * size + 1;
    const end = start + this.screen().pagedUsers().length - 1;
    return `${start}–${end} sur ${total}`;
  }

  /** Valeur d'affichage d'une cellule pour une colonne donnée. */
  protected cellValue(user: User, columnId: UserColumnId): string {
    switch (columnId) {
      case 'id':
        return String(user.id);
      case 'name':
        return user.name;
      case 'email':
        return user.email;
      case 'status':
        return this.statusLabel(user);
      case 'createdAt':
        return this.formatDate(user.createdAt);
      case 'updatedAt':
        return this.formatDate(user.updatedAt);
    }
  }

  protected statusLabel(user: User): string {
    return USER_STATUS_LABELS[userStatus(user)];
  }

  protected statusClass(user: User): string {
    return 'status-' + userStatus(user);
  }

  protected formatDate(iso: string): string {
    if (!iso) {
      return '—';
    }
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
  }
}
