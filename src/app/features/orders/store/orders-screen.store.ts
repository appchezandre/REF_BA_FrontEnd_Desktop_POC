import { computed, signal } from '@angular/core';
import { OrdersService } from '../data-access/orders.service';
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  Order,
  OrderDraft,
  OrderStatus,
  draftFromOrder,
  isDraftEqual
} from '../models/order';
import {
  DEFAULT_ORDER_COLUMNS,
  ORDER_COLUMN_DEFS,
  OrderColumnDef,
  OrderColumnId,
  isOrderColumnId
} from '../models/order-column';

/** Vue « Liste » de l'écran (les autres vues sont des n° de commande). */
export const LIST_VIEW = 'list';

/** Filtre de statut de la recherche : un statut précis ou tous. */
export type StatusFilter = OrderStatus | 'all';

/** Sens du tri d'une colonne. */
export type SortDirection = 'asc' | 'desc';

/** Un critère du tri multi-colonnes : une colonne et son sens. L'ordre des
 *  critères dans la liste définit leur priorité (le premier départage). */
export interface SortCriterion {
  readonly column: OrderColumnId;
  readonly direction: SortDirection;
}

/** Nombre d'enregistrements par page ; 'all' affiche tout. */
export type PageSize = number | 'all';

/** Choix proposés dans le sélecteur de pagination. */
export const PAGE_SIZE_OPTIONS: readonly PageSize[] = [10, 50, 100, 'all'];

/** Largeur minimale d'une colonne (px) — borne basse du redimensionnement. */
export const MIN_COLUMN_WIDTH = 60;

/** Réordonne un tableau en place (équivalent de CDK moveItemInArray, sans la
 *  dépendance CDK dans le store). */
function moveInArray<T>(items: T[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return;
  }
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
}

/**
 * État d'UNE instance de la fenêtre Commandes : onglets internes (la Liste,
 * systématique, plus un onglet Détail par commande ouverte, clé naturelle =
 * n° de commande) et brouillons d'édition.
 *
 * Classe instanciée par `OrdersScreenRegistry` — une instance par onglet du
 * workspace (Ctrl+clic ouvre une seconde fenêtre indépendante). Les
 * brouillons vivent ici — pas dans les composants — pour survivre aux
 * changements d'onglet (seul l'onglet actif est monté).
 */
export class OrdersScreenStore {
  private readonly detailsSignal = signal<readonly string[]>([]);
  private readonly activeViewSignal = signal<string>(LIST_VIEW);
  private readonly draftsSignal = signal<ReadonlyMap<string, OrderDraft>>(new Map());
  // N° des détails en mode édition ; une fiche est en lecture seule par défaut.
  private readonly editingSignal = signal<ReadonlySet<string>>(new Set());

  // Critères de recherche propres à CETTE instance (Ctrl+clic = recherches
  // indépendantes) : texte libre tous champs, n° de commande, statut, borne
  // de dates (colonne Date) et borne de montant (colonne Total HT).
  private readonly searchTextSignal = signal('');
  private readonly searchNumberSignal = signal('');
  private readonly searchStatusSignal = signal<StatusFilter>('all');
  private readonly dateFromSignal = signal(''); // ISO yyyy-MM-dd inclus
  private readonly dateToSignal = signal(''); // ISO yyyy-MM-dd inclus
  private readonly amountMinSignal = signal<number | null>(null);
  private readonly amountMaxSignal = signal<number | null>(null);

  // Présentation de la table : ordre et masquage des colonnes, tri.
  private readonly columnOrderSignal = signal<readonly OrderColumnId[]>([...DEFAULT_ORDER_COLUMNS]);
  private readonly hiddenColumnsSignal = signal<ReadonlySet<OrderColumnId>>(new Set());
  // Largeurs personnalisées (px) ; seules les colonnes redimensionnées y
  // figurent — les autres retombent sur la largeur par défaut de leur définition.
  private readonly columnWidthsSignal = signal<ReadonlyMap<OrderColumnId, number>>(new Map());
  // Tri multi-colonnes : liste ordonnée de critères (le 1er départage, le 2e
  // départage les ex æquo, etc.). Vide = aucun tri.
  private readonly sortCriteriaSignal = signal<readonly SortCriterion[]>([]);

  // Pagination (index de page 0-based ; borné par pageCount via le computed).
  private readonly pageSizeSignal = signal<PageSize>(10);
  private readonly pageIndexRawSignal = signal(0);

  /** N° des commandes ouvertes en onglet Détail, dans l'ordre d'ouverture. */
  readonly detailNumbers = this.detailsSignal.asReadonly();
  /** Vue active : LIST_VIEW ou un n° de commande. */
  readonly activeView = this.activeViewSignal.asReadonly();
  readonly drafts = this.draftsSignal.asReadonly();
  /** N° des détails actuellement en mode édition (les autres = lecture seule). */
  readonly editing = this.editingSignal.asReadonly();

  readonly searchText = this.searchTextSignal.asReadonly();
  readonly searchNumber = this.searchNumberSignal.asReadonly();
  readonly searchStatus = this.searchStatusSignal.asReadonly();
  readonly dateFrom = this.dateFromSignal.asReadonly();
  readonly dateTo = this.dateToSignal.asReadonly();
  readonly amountMin = this.amountMinSignal.asReadonly();
  readonly amountMax = this.amountMaxSignal.asReadonly();

  /** Critères de tri actifs, dans l'ordre de priorité (vide = aucun tri). */
  readonly sortCriteria = this.sortCriteriaSignal.asReadonly();
  /** Largeurs personnalisées par colonne (les absentes = largeur par défaut). */
  readonly columnWidths = this.columnWidthsSignal.asReadonly();
  readonly pageSize = this.pageSizeSignal.asReadonly();

  /** Colonnes de données dans l'ordre courant (avec les masquées). */
  readonly allColumns = computed<readonly OrderColumnDef[]>(() =>
    this.columnOrderSignal().map((id) => ORDER_COLUMN_DEFS[id])
  );

  /** Colonnes effectivement affichées (ordre courant, hors masquées). */
  readonly visibleColumns = computed<readonly OrderColumnDef[]>(() => {
    const hidden = this.hiddenColumnsSignal();
    return this.columnOrderSignal()
      .filter((id) => !hidden.has(id))
      .map((id) => ORDER_COLUMN_DEFS[id]);
  });

  readonly hasActiveSearch = computed(
    () =>
      this.searchTextSignal().trim() !== '' ||
      this.searchNumberSignal().trim() !== '' ||
      this.searchStatusSignal() !== 'all' ||
      this.dateFromSignal() !== '' ||
      this.dateToSignal() !== '' ||
      this.amountMinSignal() !== null ||
      this.amountMaxSignal() !== null
  );

  /** Commandes filtrées par les critères (combinés en ET). */
  readonly filteredOrders = computed<readonly Order[]>(() => {
    const text = this.searchTextSignal().trim().toLowerCase();
    const num = this.searchNumberSignal().trim().toLowerCase();
    const status = this.searchStatusSignal();
    const dateFrom = this.dateFromSignal();
    const dateTo = this.dateToSignal();
    const amountMin = this.amountMinSignal();
    const amountMax = this.amountMaxSignal();
    return this.ordersService.orders().filter((order) => {
      if (status !== 'all' && order.status !== status) {
        return false;
      }
      if (num && !order.orderNumber.toLowerCase().includes(num)) {
        return false;
      }
      // Bornes de dates incluses (comparaison lexicographique sur ISO).
      if (dateFrom && order.date < dateFrom) {
        return false;
      }
      if (dateTo && order.date > dateTo) {
        return false;
      }
      // Bornes de montant incluses (Total HT).
      if (amountMin !== null && order.total < amountMin) {
        return false;
      }
      if (amountMax !== null && order.total > amountMax) {
        return false;
      }
      if (text && !this.matchesText(order, text)) {
        return false;
      }
      return true;
    });
  });

  /** Nombre de commandes correspondant aux filtres (toutes pages). */
  readonly filteredCount = computed(() => this.filteredOrders().length);

  /** Commandes filtrées puis triées selon les critères actifs (multi-colonnes,
   *  par priorité : le 1er critère départage, le 2e les ex æquo, etc.). */
  readonly sortedOrders = computed<readonly Order[]>(() => {
    const criteria = this.sortCriteriaSignal();
    const orders = this.filteredOrders();
    if (criteria.length === 0) {
      return orders;
    }
    return [...orders].sort((a, b) => {
      for (const { column, direction } of criteria) {
        const cmp = this.compareByColumn(a, b, column) * (direction === 'asc' ? 1 : -1);
        if (cmp !== 0) {
          return cmp;
        }
      }
      return 0;
    });
  });

  /** Nombre total de pages (au moins 1). */
  readonly pageCount = computed(() => {
    const size = this.pageSizeSignal();
    if (size === 'all') {
      return 1;
    }
    return Math.max(1, Math.ceil(this.sortedOrders().length / size));
  });

  /** Index de page effectif, borné à [0, pageCount-1]. */
  readonly pageIndex = computed(() =>
    Math.min(Math.max(this.pageIndexRawSignal(), 0), this.pageCount() - 1)
  );

  /** Commandes de la page courante (filtrées + triées + paginées). */
  readonly pagedOrders = computed<readonly Order[]>(() => {
    const size = this.pageSizeSignal();
    const sorted = this.sortedOrders();
    if (size === 'all') {
      return sorted;
    }
    const start = this.pageIndex() * size;
    return sorted.slice(start, start + size);
  });

  /** N° des détails dont le brouillon diffère de la commande enregistrée. */
  readonly dirtyNumbers = computed<ReadonlySet<string>>(() => {
    const dirty = new Set<string>();
    const orders = this.ordersService.orders();
    for (const [orderNumber, draft] of this.draftsSignal()) {
      const order = orders.find((o) => o.orderNumber === orderNumber);
      if (order && !isDraftEqual(order, draft)) {
        dirty.add(orderNumber);
      }
    }
    return dirty;
  });

  readonly hasDirty = computed(() => this.dirtyNumbers().size > 0);

  constructor(private readonly ordersService: OrdersService) {}

  /** Ouvre (ou réactive) l'onglet Détail d'une commande. */
  openDetail(orderNumber: string): void {
    const order = this.ordersService.getOrder(orderNumber);
    if (!order) {
      return;
    }
    if (!this.detailsSignal().includes(orderNumber)) {
      this.detailsSignal.update((details) => [...details, orderNumber]);
    }
    this.draftsSignal.update((drafts) =>
      drafts.has(orderNumber)
        ? drafts
        : new Map(drafts).set(orderNumber, draftFromOrder(order))
    );
    this.activeViewSignal.set(orderNumber);
  }

  /** Ferme un onglet Détail ; active le voisin, sinon la Liste. */
  closeDetail(orderNumber: string): void {
    const details = this.detailsSignal();
    const index = details.indexOf(orderNumber);
    if (index === -1) {
      return;
    }
    const next = details.filter((n) => n !== orderNumber);
    this.detailsSignal.set(next);
    this.draftsSignal.update((drafts) => {
      const copy = new Map(drafts);
      copy.delete(orderNumber);
      return copy;
    });
    this.setEditing(orderNumber, false);
    if (this.activeViewSignal() === orderNumber) {
      this.activeViewSignal.set(next[Math.min(index, next.length - 1)] ?? LIST_VIEW);
    }
  }

  isEditing(orderNumber: string): boolean {
    return this.editingSignal().has(orderNumber);
  }

  /** Passe la fiche en édition ; repart d'un brouillon frais (état courant). */
  beginEdit(orderNumber: string): void {
    if (!this.detailsSignal().includes(orderNumber)) {
      return;
    }
    this.resetDraft(orderNumber);
    this.setEditing(orderNumber, true);
  }

  /** Annule l'édition : rétablit les valeurs enregistrées et repasse en lecture seule. */
  cancelEdit(orderNumber: string): void {
    this.resetDraft(orderNumber);
    this.setEditing(orderNumber, false);
  }

  activateList(): void {
    this.activeViewSignal.set(LIST_VIEW);
  }

  activateDetail(orderNumber: string): void {
    if (this.detailsSignal().includes(orderNumber)) {
      this.activeViewSignal.set(orderNumber);
    }
  }

  updateDraft(orderNumber: string, changes: Partial<OrderDraft>): void {
    this.draftsSignal.update((drafts) => {
      const current = drafts.get(orderNumber);
      if (!current) {
        return drafts;
      }
      return new Map(drafts).set(orderNumber, { ...current, ...changes });
    });
  }

  /** Réinitialise le brouillon depuis la commande enregistrée. */
  resetDraft(orderNumber: string): void {
    const order = this.ordersService.getOrder(orderNumber);
    if (!order || !this.draftsSignal().has(orderNumber)) {
      return;
    }
    this.draftsSignal.update((drafts) =>
      new Map(drafts).set(orderNumber, draftFromOrder(order))
    );
  }

  /**
   * Enregistre le brouillon puis repasse la fiche en lecture seule (le détail
   * n'est alors plus « modifié »).
   */
  saveDraft(orderNumber: string): void {
    const draft = this.draftsSignal().get(orderNumber);
    if (!draft) {
      return;
    }
    this.ordersService.updateOrder(orderNumber, draft);
    this.setEditing(orderNumber, false);
  }

  /**
   * Instantané sérialisable de l'état d'écran (transport lors d'un
   * détachement de fenêtre). Ne contient que des données simples.
   */
  snapshot(): Record<string, unknown> {
    return {
      details: [...this.detailsSignal()],
      activeView: this.activeViewSignal(),
      drafts: [...this.draftsSignal()].map(([n, d]) => [n, { ...d }]),
      editing: [...this.editingSignal()],
      search: {
        text: this.searchTextSignal(),
        number: this.searchNumberSignal(),
        status: this.searchStatusSignal(),
        dateFrom: this.dateFromSignal(),
        dateTo: this.dateToSignal(),
        amountMin: this.amountMinSignal(),
        amountMax: this.amountMaxSignal()
      },
      columns: {
        order: [...this.columnOrderSignal()],
        hidden: [...this.hiddenColumnsSignal()],
        widths: [...this.columnWidthsSignal()]
      },
      sort: this.sortCriteriaSignal().map((c) => ({ ...c })),
      pagination: {
        size: this.pageSizeSignal(),
        index: this.pageIndex()
      }
    };
  }

  /**
   * Reconstruit l'état d'écran depuis un instantané reçu par IPC (non fiable :
   * chaque élément est validé, les détails inconnus sont écartés).
   */
  hydrate(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const s = raw as Record<string, unknown>;

    const details: string[] = [];
    if (Array.isArray(s['details'])) {
      for (const n of s['details']) {
        if (typeof n === 'string' && this.ordersService.getOrder(n) && !details.includes(n)) {
          details.push(n);
        }
      }
    }

    const drafts = new Map<string, OrderDraft>();
    if (Array.isArray(s['drafts'])) {
      for (const entry of s['drafts']) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && details.includes(entry[0])) {
          const draft = this.parseDraft(entry[1]);
          if (draft) {
            drafts.set(entry[0], draft);
          }
        }
      }
    }
    // Tout détail ouvert doit avoir un brouillon (sinon repartir de l'enregistré).
    for (const n of details) {
      if (!drafts.has(n)) {
        const order = this.ordersService.getOrder(n);
        if (order) {
          drafts.set(n, draftFromOrder(order));
        }
      }
    }

    const editing = new Set<string>();
    if (Array.isArray(s['editing'])) {
      for (const n of s['editing']) {
        if (typeof n === 'string' && details.includes(n)) {
          editing.add(n);
        }
      }
    }

    let activeView = LIST_VIEW;
    const rawView = s['activeView'];
    if (typeof rawView === 'string' && (rawView === LIST_VIEW || details.includes(rawView))) {
      activeView = rawView;
    }

    this.hydrateSearch(s['search']);
    this.hydrateColumns(s['columns']);
    this.hydrateSort(s['sort']);
    this.detailsSignal.set(details);
    this.draftsSignal.set(drafts);
    this.editingSignal.set(editing);
    this.activeViewSignal.set(activeView);
    // La pagination dépend des filtres/du tri : à restaurer en dernier.
    this.hydratePagination(s['pagination']);
  }

  private hydrateSearch(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const v = raw as Record<string, unknown>;
    if (typeof v['text'] === 'string') {
      this.searchTextSignal.set(v['text']);
    }
    if (typeof v['number'] === 'string') {
      this.searchNumberSignal.set(v['number']);
    }
    const status = v['status'];
    if (
      typeof status === 'string' &&
      (status === 'all' || (ORDER_STATUSES as readonly string[]).includes(status))
    ) {
      this.searchStatusSignal.set(status as StatusFilter);
    }
    if (typeof v['dateFrom'] === 'string') {
      this.dateFromSignal.set(v['dateFrom']);
    }
    if (typeof v['dateTo'] === 'string') {
      this.dateToSignal.set(v['dateTo']);
    }
    if (typeof v['amountMin'] === 'number' && Number.isFinite(v['amountMin'])) {
      this.amountMinSignal.set(v['amountMin']);
    }
    if (typeof v['amountMax'] === 'number' && Number.isFinite(v['amountMax'])) {
      this.amountMaxSignal.set(v['amountMax']);
    }
  }

  private hydrateColumns(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const v = raw as Record<string, unknown>;
    // Ordre : ne garder que des ids connus, sans doublon, puis compléter avec
    // les colonnes manquantes (schéma étendu à l'avenir) dans l'ordre par défaut.
    const order: OrderColumnId[] = [];
    if (Array.isArray(v['order'])) {
      for (const id of v['order']) {
        if (isOrderColumnId(id) && !order.includes(id)) {
          order.push(id);
        }
      }
    }
    for (const id of DEFAULT_ORDER_COLUMNS) {
      if (!order.includes(id)) {
        order.push(id);
      }
    }
    this.columnOrderSignal.set(order);

    const hidden = new Set<OrderColumnId>();
    if (Array.isArray(v['hidden'])) {
      for (const id of v['hidden']) {
        if (isOrderColumnId(id)) {
          hidden.add(id);
        }
      }
    }
    // Ne jamais tout masquer.
    if (order.length - hidden.size >= 1) {
      this.hiddenColumnsSignal.set(hidden);
    }

    // Largeurs : tableau [id, px] ; ids connus, px fini et borné à la valeur mini.
    const widths = new Map<OrderColumnId, number>();
    if (Array.isArray(v['widths'])) {
      for (const entry of v['widths']) {
        if (
          Array.isArray(entry) &&
          isOrderColumnId(entry[0]) &&
          typeof entry[1] === 'number' &&
          Number.isFinite(entry[1])
        ) {
          widths.set(entry[0], Math.max(MIN_COLUMN_WIDTH, Math.round(entry[1])));
        }
      }
    }
    this.columnWidthsSignal.set(widths);
  }

  private hydrateSort(raw: unknown): void {
    // Format : tableau ordonné de critères ; ne garder que des colonnes connues,
    // visibles et sans doublon, avec un sens valide (le reste est écarté).
    if (!Array.isArray(raw)) {
      return;
    }
    const criteria: SortCriterion[] = [];
    const seen = new Set<OrderColumnId>();
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const v = entry as Record<string, unknown>;
      const column = v['column'];
      const direction = v['direction'];
      if (
        isOrderColumnId(column) &&
        !seen.has(column) &&
        this.isColumnVisible(column) &&
        (direction === 'asc' || direction === 'desc')
      ) {
        seen.add(column);
        criteria.push({ column, direction });
      }
    }
    this.sortCriteriaSignal.set(criteria);
  }

  private hydratePagination(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const v = raw as Record<string, unknown>;
    const size = v['size'];
    if (size === 'all' || (typeof size === 'number' && Number.isInteger(size) && size > 0)) {
      this.pageSizeSignal.set(size);
    }
    if (typeof v['index'] === 'number' && Number.isInteger(v['index'])) {
      this.pageIndexRawSignal.set(Math.max(0, v['index']));
    }
  }

  private parseDraft(raw: unknown): OrderDraft | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const v = raw as Record<string, unknown>;
    if (typeof v['customer'] !== 'string' || typeof v['date'] !== 'string') {
      return null;
    }
    if (typeof v['notes'] !== 'string') {
      return null;
    }
    if (
      typeof v['status'] !== 'string' ||
      !(ORDER_STATUSES as readonly string[]).includes(v['status'])
    ) {
      return null;
    }
    return {
      customer: v['customer'],
      date: v['date'],
      status: v['status'] as OrderStatus,
      notes: v['notes']
    };
  }

  private setEditing(orderNumber: string, editing: boolean): void {
    this.editingSignal.update((set) => {
      if (set.has(orderNumber) === editing) {
        return set;
      }
      const next = new Set(set);
      if (editing) {
        next.add(orderNumber);
      } else {
        next.delete(orderNumber);
      }
      return next;
    });
  }

  setSearchText(value: string): void {
    this.searchTextSignal.set(value);
    this.resetPage();
  }

  setSearchNumber(value: string): void {
    this.searchNumberSignal.set(value);
    this.resetPage();
  }

  setSearchStatus(value: StatusFilter): void {
    this.searchStatusSignal.set(value);
    this.resetPage();
  }

  /** Borne basse de la plage de dates (ISO yyyy-MM-dd), '' = aucune borne. */
  setDateFrom(value: string): void {
    this.dateFromSignal.set(value);
    this.resetPage();
  }

  /** Borne haute de la plage de dates (ISO yyyy-MM-dd), '' = aucune borne. */
  setDateTo(value: string): void {
    this.dateToSignal.set(value);
    this.resetPage();
  }

  /** Borne basse du montant (Total HT) ; null = aucune borne. */
  setAmountMin(value: number | null): void {
    this.amountMinSignal.set(Number.isFinite(value as number) ? value : null);
    this.resetPage();
  }

  /** Borne haute du montant (Total HT) ; null = aucune borne. */
  setAmountMax(value: number | null): void {
    this.amountMaxSignal.set(Number.isFinite(value as number) ? value : null);
    this.resetPage();
  }

  clearSearch(): void {
    this.searchTextSignal.set('');
    this.searchNumberSignal.set('');
    this.searchStatusSignal.set('all');
    this.dateFromSignal.set('');
    this.dateToSignal.set('');
    this.amountMinSignal.set(null);
    this.amountMaxSignal.set(null);
    this.resetPage();
  }

  // --- Colonnes : ordre et visibilité --------------------------------------

  isColumnVisible(id: OrderColumnId): boolean {
    return !this.hiddenColumnsSignal().has(id);
  }

  /**
   * Déplace une colonne visible de la position `from` vers `to` (indices dans
   * la liste des colonnes AFFICHÉES). Les colonnes masquées conservent leur
   * position d'ancrage dans l'ordre global.
   */
  moveColumn(from: number, to: number): void {
    const order = [...this.columnOrderSignal()];
    const hidden = this.hiddenColumnsSignal();
    const visible = order.filter((id) => !hidden.has(id));
    if (from < 0 || to < 0 || from >= visible.length || to >= visible.length) {
      return;
    }
    moveInArray(visible, from, to);
    let vi = 0;
    const next = order.map((id) => (hidden.has(id) ? id : visible[vi++]));
    this.columnOrderSignal.set(next);
  }

  /** Largeur courante d'une colonne (px) : override utilisateur ou défaut. */
  columnWidth(id: OrderColumnId): number {
    return this.columnWidthsSignal().get(id) ?? ORDER_COLUMN_DEFS[id].width;
  }

  /** Fixe la largeur d'une colonne (px), bornée à `MIN_COLUMN_WIDTH`. */
  setColumnWidth(id: OrderColumnId, width: number): void {
    if (!Number.isFinite(width)) {
      return;
    }
    const clamped = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    this.columnWidthsSignal.update((widths) => new Map(widths).set(id, clamped));
  }

  /** Réinitialise la largeur d'une colonne à sa valeur par défaut. */
  resetColumnWidth(id: OrderColumnId): void {
    this.columnWidthsSignal.update((widths) => {
      if (!widths.has(id)) {
        return widths;
      }
      const next = new Map(widths);
      next.delete(id);
      return next;
    });
  }

  /** Affiche ou masque une colonne ; refuse de masquer la dernière visible. */
  toggleColumnVisibility(id: OrderColumnId): void {
    this.hiddenColumnsSignal.update((hidden) => {
      const next = new Set(hidden);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // Toujours conserver au moins une colonne visible.
      if (this.columnOrderSignal().length - next.size <= 1) {
        return hidden;
      }
      next.add(id);
      // Ne pas trier sur une colonne masquée : la retirer des critères.
      this.sortCriteriaSignal.update((criteria) => criteria.filter((c) => c.column !== id));
      return next;
    });
  }

  // --- Tri multi-colonnes ---------------------------------------------------

  /** Sens de tri appliqué à une colonne, ou `null` si elle ne participe pas au tri. */
  sortDirectionFor(id: OrderColumnId): SortDirection | null {
    return this.sortCriteriaSignal().find((c) => c.column === id)?.direction ?? null;
  }

  /** Rang (1-based) d'une colonne dans le tri multi-critères, ou `null`. */
  sortRankFor(id: OrderColumnId): number | null {
    const index = this.sortCriteriaSignal().findIndex((c) => c.column === id);
    return index === -1 ? null : index + 1;
  }

  /** Remplace tout le tri par un unique critère (colonne + sens). */
  setSort(id: OrderColumnId, direction: SortDirection): void {
    this.sortCriteriaSignal.set([{ column: id, direction }]);
    this.resetPage();
  }

  /**
   * Ajoute une colonne au tri multi-critères (priorité = ordre d'ajout), ou met
   * à jour son sens si elle en fait déjà partie sans changer sa priorité.
   */
  addSort(id: OrderColumnId, direction: SortDirection): void {
    this.sortCriteriaSignal.update((criteria) => {
      if (criteria.some((c) => c.column === id)) {
        return criteria.map((c) => (c.column === id ? { column: id, direction } : c));
      }
      return [...criteria, { column: id, direction }];
    });
    this.resetPage();
  }

  /** Retire une colonne du tri (les autres critères conservent leur ordre). */
  removeSort(id: OrderColumnId): void {
    this.sortCriteriaSignal.update((criteria) => {
      const next = criteria.filter((c) => c.column !== id);
      return next.length === criteria.length ? criteria : next;
    });
    this.resetPage();
  }

  /** Efface entièrement le tri. */
  clearSort(): void {
    if (this.sortCriteriaSignal().length === 0) {
      return;
    }
    this.sortCriteriaSignal.set([]);
    this.resetPage();
  }

  // --- Pagination ----------------------------------------------------------

  setPageSize(size: PageSize): void {
    this.pageSizeSignal.set(size);
    this.resetPage();
  }

  setPage(index: number): void {
    this.pageIndexRawSignal.set(Math.max(0, index));
  }

  nextPage(): void {
    this.pageIndexRawSignal.set(Math.min(this.pageIndex() + 1, this.pageCount() - 1));
  }

  previousPage(): void {
    this.pageIndexRawSignal.set(Math.max(this.pageIndex() - 1, 0));
  }

  private resetPage(): void {
    this.pageIndexRawSignal.set(0);
  }

  /** Comparateur d'une colonne (ordre croissant). */
  private compareByColumn(a: Order, b: Order, column: OrderColumnId): number {
    switch (column) {
      case 'orderNumber':
        return a.orderNumber.localeCompare(b.orderNumber, 'fr');
      case 'date':
        return a.date.localeCompare(b.date); // ISO -> chronologique
      case 'customer':
        return a.customer.localeCompare(b.customer, 'fr');
      case 'status':
        return ORDER_STATUSES.indexOf(a.status) - ORDER_STATUSES.indexOf(b.status);
      case 'total':
        return a.total - b.total;
    }
  }

  /** Recherche texte insensible à la casse sur l'ensemble des champs. */
  private matchesText(order: Order, text: string): boolean {
    const haystack = [
      order.orderNumber,
      order.customer,
      order.date,
      ORDER_STATUS_LABELS[order.status],
      order.notes,
      String(order.total)
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  }
}
