import { Signal, computed, signal } from '@angular/core';
import { extractApiErrorMessage } from '../../../core/api/problem-details';
import {
  USER_STATUSES,
  USER_STATUS_LABELS,
  User,
  UserDraft,
  UserStatus,
  draftFromUser,
  isDraftEqual,
  userKey,
  userStatus
} from '../models/user';
import {
  DEFAULT_USER_COLUMNS,
  USER_COLUMN_DEFS,
  UserColumnDef,
  UserColumnId,
  isUserColumnId
} from '../models/user-column';

/** Vue « Liste » de l'écran (les autres vues sont des clés d'utilisateur). */
export const LIST_VIEW = 'list';

/** Filtre de statut de la recherche : un statut précis ou tous. */
export type StatusFilter = UserStatus | 'all';

/** Sens du tri d'une colonne. */
export type SortDirection = 'asc' | 'desc';

/** Un critère du tri multi-colonnes : une colonne et son sens. L'ordre des
 *  critères dans la liste définit leur priorité (le premier départage). */
export interface SortCriterion {
  readonly column: UserColumnId;
  readonly direction: SortDirection;
}

/** Nombre d'enregistrements par page ; 'all' affiche tout. */
export type PageSize = number | 'all';

/** Choix proposés dans le sélecteur de pagination. */
export const PAGE_SIZE_OPTIONS: readonly PageSize[] = [10, 50, 100, 'all'];

/** Largeur minimale d'une colonne (px) — borne basse du redimensionnement. */
export const MIN_COLUMN_WIDTH = 60;

/** Clé d'écran valide : représentation décimale d'un id utilisateur. */
function isUserKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

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
 * Surface de données requise par l'écran Utilisateurs (implémentée par
 * `UsersService`). Extraite en interface pour tester le store sans HTTP.
 */
export interface UsersScreenData {
  readonly users: Signal<readonly User[]>;
  getUserByKey(key: string): User | undefined;
  updateUser(user: User, draft: UserDraft): Promise<User>;
}

/**
 * État d'UNE instance de la fenêtre Utilisateurs : onglets internes (la
 * Liste, systématique, plus un onglet Détail par utilisateur ouvert, clé =
 * id backend en chaîne) et brouillons d'édition.
 *
 * Classe instanciée par `UsersScreenRegistry` — une instance par onglet du
 * workspace (Ctrl+clic ouvre une seconde fenêtre indépendante). Les
 * brouillons vivent ici — pas dans les composants — pour survivre aux
 * changements d'onglet (seul l'onglet actif est monté).
 *
 * Contrairement aux Commandes (données de démo), les données arrivent de
 * l'API : un détail peut référencer un utilisateur pas encore chargé
 * (fenêtre détachée, fiche récente) — la clé est conservée et la fiche
 * s'affiche à l'arrivée des données.
 */
export class UsersScreenStore {
  private readonly detailsSignal = signal<readonly string[]>([]);
  private readonly activeViewSignal = signal<string>(LIST_VIEW);
  private readonly draftsSignal = signal<ReadonlyMap<string, UserDraft>>(new Map());
  // Clés des détails en mode édition ; une fiche est en lecture seule par défaut.
  private readonly editingSignal = signal<ReadonlySet<string>>(new Set());

  // Critères de recherche propres à CETTE instance (Ctrl+clic = recherches
  // indépendantes) : texte libre tous champs, e-mail, statut et borne de
  // dates sur la date de création.
  private readonly searchTextSignal = signal('');
  private readonly searchEmailSignal = signal('');
  private readonly searchStatusSignal = signal<StatusFilter>('all');
  private readonly createdFromSignal = signal(''); // ISO yyyy-MM-dd inclus
  private readonly createdToSignal = signal(''); // ISO yyyy-MM-dd inclus

  // Présentation de la table : ordre et masquage des colonnes, tri.
  private readonly columnOrderSignal = signal<readonly UserColumnId[]>([...DEFAULT_USER_COLUMNS]);
  private readonly hiddenColumnsSignal = signal<ReadonlySet<UserColumnId>>(new Set());
  // Largeurs personnalisées (px) ; seules les colonnes redimensionnées y
  // figurent — les autres retombent sur la largeur par défaut de leur définition.
  private readonly columnWidthsSignal = signal<ReadonlyMap<UserColumnId, number>>(new Map());
  // Tri multi-colonnes : liste ordonnée de critères (le 1er départage, le 2e
  // départage les ex æquo, etc.). Vide = aucun tri.
  private readonly sortCriteriaSignal = signal<readonly SortCriterion[]>([]);

  // Pagination (index de page 0-based ; borné par pageCount via le computed).
  private readonly pageSizeSignal = signal<PageSize>(10);
  private readonly pageIndexRawSignal = signal(0);

  /** Clés des utilisateurs ouverts en onglet Détail, dans l'ordre d'ouverture. */
  readonly detailKeys = this.detailsSignal.asReadonly();
  /** Vue active : LIST_VIEW ou une clé d'utilisateur. */
  readonly activeView = this.activeViewSignal.asReadonly();
  readonly drafts = this.draftsSignal.asReadonly();
  /** Clés des détails actuellement en mode édition (les autres = lecture seule). */
  readonly editing = this.editingSignal.asReadonly();

  readonly searchText = this.searchTextSignal.asReadonly();
  readonly searchEmail = this.searchEmailSignal.asReadonly();
  readonly searchStatus = this.searchStatusSignal.asReadonly();
  readonly createdFrom = this.createdFromSignal.asReadonly();
  readonly createdTo = this.createdToSignal.asReadonly();

  /** Critères de tri actifs, dans l'ordre de priorité (vide = aucun tri). */
  readonly sortCriteria = this.sortCriteriaSignal.asReadonly();
  /** Largeurs personnalisées par colonne (les absentes = largeur par défaut). */
  readonly columnWidths = this.columnWidthsSignal.asReadonly();
  readonly pageSize = this.pageSizeSignal.asReadonly();

  /** Colonnes de données dans l'ordre courant (avec les masquées). */
  readonly allColumns = computed<readonly UserColumnDef[]>(() =>
    this.columnOrderSignal().map((id) => USER_COLUMN_DEFS[id])
  );

  /** Colonnes effectivement affichées (ordre courant, hors masquées). */
  readonly visibleColumns = computed<readonly UserColumnDef[]>(() => {
    const hidden = this.hiddenColumnsSignal();
    return this.columnOrderSignal()
      .filter((id) => !hidden.has(id))
      .map((id) => USER_COLUMN_DEFS[id]);
  });

  readonly hasActiveSearch = computed(
    () =>
      this.searchTextSignal().trim() !== '' ||
      this.searchEmailSignal().trim() !== '' ||
      this.searchStatusSignal() !== 'all' ||
      this.createdFromSignal() !== '' ||
      this.createdToSignal() !== ''
  );

  /** Utilisateurs filtrés par les critères (combinés en ET). */
  readonly filteredUsers = computed<readonly User[]>(() => {
    const text = this.searchTextSignal().trim().toLowerCase();
    const email = this.searchEmailSignal().trim().toLowerCase();
    const status = this.searchStatusSignal();
    const createdFrom = this.createdFromSignal();
    const createdTo = this.createdToSignal();
    return this.usersService.users().filter((user) => {
      if (status !== 'all' && userStatus(user) !== status) {
        return false;
      }
      if (email && !user.email.toLowerCase().includes(email)) {
        return false;
      }
      // Bornes de dates incluses (comparaison lexicographique sur ISO).
      const created = user.createdAt.slice(0, 10);
      if (createdFrom && created < createdFrom) {
        return false;
      }
      if (createdTo && created > createdTo) {
        return false;
      }
      if (text && !this.matchesText(user, text)) {
        return false;
      }
      return true;
    });
  });

  /** Nombre d'utilisateurs correspondant aux filtres (toutes pages). */
  readonly filteredCount = computed(() => this.filteredUsers().length);

  /** Utilisateurs filtrés puis triés selon les critères actifs (multi-colonnes,
   *  par priorité : le 1er critère départage, le 2e les ex æquo, etc.). */
  readonly sortedUsers = computed<readonly User[]>(() => {
    const criteria = this.sortCriteriaSignal();
    const users = this.filteredUsers();
    if (criteria.length === 0) {
      return users;
    }
    return [...users].sort((a, b) => {
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
    return Math.max(1, Math.ceil(this.sortedUsers().length / size));
  });

  /** Index de page effectif, borné à [0, pageCount-1]. */
  readonly pageIndex = computed(() =>
    Math.min(Math.max(this.pageIndexRawSignal(), 0), this.pageCount() - 1)
  );

  /** Utilisateurs de la page courante (filtrés + triés + paginés). */
  readonly pagedUsers = computed<readonly User[]>(() => {
    const size = this.pageSizeSignal();
    const sorted = this.sortedUsers();
    if (size === 'all') {
      return sorted;
    }
    const start = this.pageIndex() * size;
    return sorted.slice(start, start + size);
  });

  /** Clés des détails dont le brouillon diffère de l'utilisateur enregistré. */
  readonly dirtyKeys = computed<ReadonlySet<string>>(() => {
    const dirty = new Set<string>();
    const users = this.usersService.users();
    for (const [key, draft] of this.draftsSignal()) {
      const user = users.find((u) => userKey(u) === key);
      if (user && !isDraftEqual(user, draft)) {
        dirty.add(key);
      }
    }
    return dirty;
  });

  readonly hasDirty = computed(() => this.dirtyKeys().size > 0);

  constructor(private readonly usersService: UsersScreenData) {}

  /**
   * Ouvre (ou réactive) l'onglet Détail d'un utilisateur. La clé est acceptée
   * même si l'utilisateur n'est pas (encore) chargé — la fiche s'affichera à
   * l'arrivée des données (fenêtre détachée, fiche récente).
   */
  openDetail(key: string): void {
    if (!isUserKey(key)) {
      return;
    }
    if (!this.detailsSignal().includes(key)) {
      this.detailsSignal.update((details) => [...details, key]);
    }
    const user = this.usersService.getUserByKey(key);
    if (user) {
      this.draftsSignal.update((drafts) =>
        drafts.has(key) ? drafts : new Map(drafts).set(key, draftFromUser(user))
      );
    }
    this.activeViewSignal.set(key);
  }

  /** Ferme un onglet Détail ; active le voisin, sinon la Liste. */
  closeDetail(key: string): void {
    const details = this.detailsSignal();
    const index = details.indexOf(key);
    if (index === -1) {
      return;
    }
    const next = details.filter((k) => k !== key);
    this.detailsSignal.set(next);
    this.draftsSignal.update((drafts) => {
      const copy = new Map(drafts);
      copy.delete(key);
      return copy;
    });
    this.setEditing(key, false);
    if (this.activeViewSignal() === key) {
      this.activeViewSignal.set(next[Math.min(index, next.length - 1)] ?? LIST_VIEW);
    }
  }

  isEditing(key: string): boolean {
    return this.editingSignal().has(key);
  }

  /** Passe la fiche en édition ; repart d'un brouillon frais (état courant). */
  beginEdit(key: string): void {
    if (!this.detailsSignal().includes(key) || !this.usersService.getUserByKey(key)) {
      return;
    }
    this.resetDraft(key);
    this.setEditing(key, true);
  }

  /** Annule l'édition : rétablit les valeurs enregistrées et repasse en lecture seule. */
  cancelEdit(key: string): void {
    this.resetDraft(key);
    this.setEditing(key, false);
  }

  activateList(): void {
    this.activeViewSignal.set(LIST_VIEW);
  }

  activateDetail(key: string): void {
    if (this.detailsSignal().includes(key)) {
      this.activeViewSignal.set(key);
    }
  }

  updateDraft(key: string, changes: Partial<UserDraft>): void {
    this.draftsSignal.update((drafts) => {
      const current = drafts.get(key);
      if (!current) {
        return drafts;
      }
      return new Map(drafts).set(key, { ...current, ...changes });
    });
  }

  /** Réinitialise le brouillon depuis l'utilisateur enregistré. */
  resetDraft(key: string): void {
    const user = this.usersService.getUserByKey(key);
    if (!user || !this.detailsSignal().includes(key)) {
      return;
    }
    this.draftsSignal.update((drafts) => new Map(drafts).set(key, draftFromUser(user)));
  }

  /**
   * Enregistre le brouillon via l'API puis repasse la fiche en lecture seule.
   * Retourne `null` en cas de succès, sinon un message d'erreur présentable
   * (conflit de concurrence, validation, réseau…).
   */
  async saveDraft(key: string): Promise<string | null> {
    const draft = this.draftsSignal().get(key);
    const user = this.usersService.getUserByKey(key);
    if (!draft || !user) {
      return null;
    }
    try {
      await this.usersService.updateUser(user, draft);
      this.resetDraft(key);
      this.setEditing(key, false);
      return null;
    } catch (error) {
      return extractApiErrorMessage(error, "Échec de l'enregistrement de l'utilisateur.");
    }
  }

  /**
   * Instantané sérialisable de l'état d'écran (transport lors d'un
   * détachement de fenêtre). Ne contient que des données simples.
   */
  snapshot(): Record<string, unknown> {
    return {
      details: [...this.detailsSignal()],
      activeView: this.activeViewSignal(),
      drafts: [...this.draftsSignal()].map(([k, d]) => [k, { ...d }]),
      editing: [...this.editingSignal()],
      search: {
        text: this.searchTextSignal(),
        email: this.searchEmailSignal(),
        status: this.searchStatusSignal(),
        createdFrom: this.createdFromSignal(),
        createdTo: this.createdToSignal()
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
   * chaque élément est validé). Les clés de détail sont conservées même si la
   * liste n'est pas encore chargée (les données arrivent de l'API après coup).
   */
  hydrate(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const s = raw as Record<string, unknown>;

    const details: string[] = [];
    if (Array.isArray(s['details'])) {
      for (const k of s['details']) {
        if (isUserKey(k) && !details.includes(k)) {
          details.push(k);
        }
      }
    }

    const drafts = new Map<string, UserDraft>();
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
    // Compléter les brouillons manquants depuis l'utilisateur enregistré
    // (uniquement s'il est déjà chargé ; sinon beginEdit le créera).
    for (const k of details) {
      if (!drafts.has(k)) {
        const user = this.usersService.getUserByKey(k);
        if (user) {
          drafts.set(k, draftFromUser(user));
        }
      }
    }

    const editing = new Set<string>();
    if (Array.isArray(s['editing'])) {
      for (const k of s['editing']) {
        if (typeof k === 'string' && details.includes(k)) {
          editing.add(k);
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
    if (typeof v['email'] === 'string') {
      this.searchEmailSignal.set(v['email']);
    }
    const status = v['status'];
    if (
      typeof status === 'string' &&
      (status === 'all' || (USER_STATUSES as readonly string[]).includes(status))
    ) {
      this.searchStatusSignal.set(status as StatusFilter);
    }
    if (typeof v['createdFrom'] === 'string') {
      this.createdFromSignal.set(v['createdFrom']);
    }
    if (typeof v['createdTo'] === 'string') {
      this.createdToSignal.set(v['createdTo']);
    }
  }

  private hydrateColumns(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const v = raw as Record<string, unknown>;
    // Ordre : ne garder que des ids connus, sans doublon, puis compléter avec
    // les colonnes manquantes (schéma étendu à l'avenir) dans l'ordre par défaut.
    const order: UserColumnId[] = [];
    if (Array.isArray(v['order'])) {
      for (const id of v['order']) {
        if (isUserColumnId(id) && !order.includes(id)) {
          order.push(id);
        }
      }
    }
    for (const id of DEFAULT_USER_COLUMNS) {
      if (!order.includes(id)) {
        order.push(id);
      }
    }
    this.columnOrderSignal.set(order);

    const hidden = new Set<UserColumnId>();
    if (Array.isArray(v['hidden'])) {
      for (const id of v['hidden']) {
        if (isUserColumnId(id)) {
          hidden.add(id);
        }
      }
    }
    // Ne jamais tout masquer.
    if (order.length - hidden.size >= 1) {
      this.hiddenColumnsSignal.set(hidden);
    }

    // Largeurs : tableau [id, px] ; ids connus, px fini et borné à la valeur mini.
    const widths = new Map<UserColumnId, number>();
    if (Array.isArray(v['widths'])) {
      for (const entry of v['widths']) {
        if (
          Array.isArray(entry) &&
          isUserColumnId(entry[0]) &&
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
    const seen = new Set<UserColumnId>();
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const v = entry as Record<string, unknown>;
      const column = v['column'];
      const direction = v['direction'];
      if (
        isUserColumnId(column) &&
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

  private parseDraft(raw: unknown): UserDraft | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const v = raw as Record<string, unknown>;
    if (typeof v['name'] !== 'string' || typeof v['password'] !== 'string') {
      return null;
    }
    return { name: v['name'], password: v['password'] };
  }

  private setEditing(key: string, editing: boolean): void {
    this.editingSignal.update((set) => {
      if (set.has(key) === editing) {
        return set;
      }
      const next = new Set(set);
      if (editing) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  setSearchText(value: string): void {
    this.searchTextSignal.set(value);
    this.resetPage();
  }

  setSearchEmail(value: string): void {
    this.searchEmailSignal.set(value);
    this.resetPage();
  }

  setSearchStatus(value: StatusFilter): void {
    this.searchStatusSignal.set(value);
    this.resetPage();
  }

  /** Borne basse de la date de création (ISO yyyy-MM-dd), '' = aucune borne. */
  setCreatedFrom(value: string): void {
    this.createdFromSignal.set(value);
    this.resetPage();
  }

  /** Borne haute de la date de création (ISO yyyy-MM-dd), '' = aucune borne. */
  setCreatedTo(value: string): void {
    this.createdToSignal.set(value);
    this.resetPage();
  }

  clearSearch(): void {
    this.searchTextSignal.set('');
    this.searchEmailSignal.set('');
    this.searchStatusSignal.set('all');
    this.createdFromSignal.set('');
    this.createdToSignal.set('');
    this.resetPage();
  }

  // --- Colonnes : ordre et visibilité --------------------------------------

  isColumnVisible(id: UserColumnId): boolean {
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
  columnWidth(id: UserColumnId): number {
    return this.columnWidthsSignal().get(id) ?? USER_COLUMN_DEFS[id].width;
  }

  /** Fixe la largeur d'une colonne (px), bornée à `MIN_COLUMN_WIDTH`. */
  setColumnWidth(id: UserColumnId, width: number): void {
    if (!Number.isFinite(width)) {
      return;
    }
    const clamped = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    this.columnWidthsSignal.update((widths) => new Map(widths).set(id, clamped));
  }

  /** Réinitialise la largeur d'une colonne à sa valeur par défaut. */
  resetColumnWidth(id: UserColumnId): void {
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
  toggleColumnVisibility(id: UserColumnId): void {
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
  sortDirectionFor(id: UserColumnId): SortDirection | null {
    return this.sortCriteriaSignal().find((c) => c.column === id)?.direction ?? null;
  }

  /** Rang (1-based) d'une colonne dans le tri multi-critères, ou `null`. */
  sortRankFor(id: UserColumnId): number | null {
    const index = this.sortCriteriaSignal().findIndex((c) => c.column === id);
    return index === -1 ? null : index + 1;
  }

  /** Remplace tout le tri par un unique critère (colonne + sens). */
  setSort(id: UserColumnId, direction: SortDirection): void {
    this.sortCriteriaSignal.set([{ column: id, direction }]);
    this.resetPage();
  }

  /**
   * Ajoute une colonne au tri multi-critères (priorité = ordre d'ajout), ou met
   * à jour son sens si elle en fait déjà partie sans changer sa priorité.
   */
  addSort(id: UserColumnId, direction: SortDirection): void {
    this.sortCriteriaSignal.update((criteria) => {
      if (criteria.some((c) => c.column === id)) {
        return criteria.map((c) => (c.column === id ? { column: id, direction } : c));
      }
      return [...criteria, { column: id, direction }];
    });
    this.resetPage();
  }

  /** Retire une colonne du tri (les autres critères conservent leur ordre). */
  removeSort(id: UserColumnId): void {
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
  private compareByColumn(a: User, b: User, column: UserColumnId): number {
    switch (column) {
      case 'id':
        return a.id - b.id;
      case 'name':
        return a.name.localeCompare(b.name, 'fr');
      case 'email':
        return a.email.localeCompare(b.email, 'fr');
      case 'status':
        return Number(a.deleted) - Number(b.deleted);
      case 'createdAt':
        return a.createdAt.localeCompare(b.createdAt); // ISO -> chronologique
      case 'updatedAt':
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  }

  /** Recherche texte insensible à la casse sur l'ensemble des champs. */
  private matchesText(user: User, text: string): boolean {
    const haystack = [
      String(user.id),
      user.name,
      user.email,
      USER_STATUS_LABELS[userStatus(user)],
      user.createdAt.slice(0, 10),
      user.updatedAt.slice(0, 10)
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  }
}
