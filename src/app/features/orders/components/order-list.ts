import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ShellUiService } from '../../../core/shell/shell-ui.service';
import { OrdersService } from '../data-access/orders.service';
import { OrderColumnId } from '../models/order-column';
import { ORDER_STATUS_LABELS, OrderStatus } from '../models/order';
import {
  OrdersScreenStore,
  PAGE_SIZE_OPTIONS,
  PageSize,
  SortDirection
} from '../store/orders-screen.store';

const AMOUNT_FORMAT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR'
});
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR');

/** Largeurs fixes des colonnes structurelles (indicateur d'état, actions), en
 *  px — doivent correspondre aux règles `.cg-indicator` / `.cg-actions` du CSS. */
const INDICATOR_WIDTH = 28;
const ACTIONS_WIDTH = 48;

/** Suivi d'un redimensionnement de colonne en cours. */
interface ResizeState {
  readonly columnId: OrderColumnId;
  readonly startX: number;
  readonly startWidth: number;
}

/** Onglet Liste de la fenêtre Commandes : table à colonnes déplaçables et
 *  masquables, triable (multi-colonnes), paginée, avec ouverture du détail
 *  (clé naturelle). Le clic sur un en-tête ouvre un menu contextuel (tri +
 *  affichage/masquage des colonnes) — il n'y a plus de bouton « Colonnes ». */
@Component({
  selector: 'app-order-list',
  imports: [CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './order-list.html',
  styleUrl: './order-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderList {
  protected readonly ordersService = inject(OrdersService);
  private readonly shellUi = inject(ShellUiService);

  /** État de l'instance d'écran hôte (fourni par la page). */
  readonly screen = input.required<OrdersScreenStore>();

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  /** Colonne dont le menu contextuel d'en-tête est ouvert (une seule à la fois). */
  protected readonly openMenuColumn = signal<OrderColumnId | null>(null);

  /** Colonne en cours de redimensionnement (pour le style ; null au repos). */
  protected readonly resizingColumn = signal<OrderColumnId | null>(null);
  private resize: ResizeState | null = null;

  /** N° des commandes actuellement ouvertes en fiche (surbrillance). */
  protected readonly openNumbers = computed(
    () => new Set(this.screen().detailNumbers())
  );

  /** Largeur totale de la table (colonnes structurelles + colonnes visibles) :
   *  la table est en `table-layout: fixed`, elle occupe donc exactement la somme
   *  des largeurs (le conteneur défile horizontalement si besoin). */
  protected readonly tableWidth = computed(
    () =>
      INDICATOR_WIDTH +
      ACTIONS_WIDTH +
      this.screen()
        .visibleColumns()
        .reduce((sum, col) => sum + this.screen().columnWidth(col.id), 0)
  );

  protected edit(orderNumber: string): void {
    this.screen().openDetail(orderNumber);
  }

  /** Réorganisation des colonnes par glisser-déposer (en-têtes). */
  protected onColumnDrop(event: CdkDragDrop<unknown>): void {
    this.screen().moveColumn(event.previousIndex, event.currentIndex);
  }

  // --- Redimensionnement de colonne (poignée sur le bord droit de l'en-tête) --
  // La poignée capture le pointeur : les mouvements suivants lui sont livrés même
  // hors de son cadre. Elle est distincte du `cdkDragHandle` (le libellé) : la
  // saisir ne déclenche donc ni réordonnancement ni ouverture du menu.

  protected startResize(columnId: OrderColumnId, event: PointerEvent): void {
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
  protected resetWidth(columnId: OrderColumnId): void {
    this.screen().resetColumnWidth(columnId);
  }

  /** Ouvre/ferme le menu contextuel d'en-tête d'une colonne. */
  protected toggleMenu(columnId: OrderColumnId): void {
    this.openMenuColumn.update((current) => (current === columnId ? null : columnId));
  }

  protected closeMenu(): void {
    this.openMenuColumn.set(null);
  }

  // --- Tri (délégué au store), depuis le menu contextuel d'en-tête ----------

  /** Trie sur cette seule colonne (remplace le tri courant). */
  protected setSort(columnId: OrderColumnId, direction: SortDirection): void {
    this.screen().setSort(columnId, direction);
  }

  /** Ajoute la colonne au tri multi-critères (ou met à jour son sens). */
  protected addSort(columnId: OrderColumnId, direction: SortDirection): void {
    this.screen().addSort(columnId, direction);
  }

  protected removeSort(columnId: OrderColumnId): void {
    this.screen().removeSort(columnId);
  }

  protected clearSort(): void {
    this.screen().clearSort();
  }

  /** Indicateur de sens (▲/▼) affiché dans l'en-tête, ou '' si non trié. */
  protected sortIndicator(columnId: OrderColumnId): string {
    const direction = this.screen().sortDirectionFor(columnId);
    return direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '';
  }

  /** Valeur ARIA de tri pour l'en-tête de colonne. */
  protected ariaSort(columnId: OrderColumnId): 'ascending' | 'descending' | 'none' {
    const direction = this.screen().sortDirectionFor(columnId);
    if (!direction) {
      return 'none';
    }
    return direction === 'asc' ? 'ascending' : 'descending';
  }

  protected toggleColumn(columnId: OrderColumnId): void {
    this.screen().toggleColumnVisibility(columnId);
  }

  /** Ouvre la side bar de recherche (contextuelle aux commandes). */
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
    const end = start + this.screen().pagedOrders().length - 1;
    return `${start}–${end} sur ${total}`;
  }

  /** Valeur d'affichage d'une cellule pour une colonne donnée. */
  protected cellValue(order: {
    orderNumber: string;
    date: string;
    customer: string;
    status: OrderStatus;
    total: number;
  }, columnId: OrderColumnId): string {
    switch (columnId) {
      case 'orderNumber':
        return order.orderNumber;
      case 'date':
        return this.formatDate(order.date);
      case 'customer':
        return order.customer;
      case 'status':
        return this.statusLabel(order.status);
      case 'total':
        return this.formatAmount(order.total);
    }
  }

  protected statusLabel(status: OrderStatus): string {
    return ORDER_STATUS_LABELS[status];
  }

  protected formatAmount(value: number): string {
    return AMOUNT_FORMAT.format(value);
  }

  protected formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(iso));
  }
}
