# Système « liste d'entités » — document de référence

> État : juillet 2026. Décrit le modèle **générique** des écrans métier de type
> « liste d'entités » (table triable, filtrable, paginée, à colonnes
> configurables). Le patron est **implémenté concrètement pour la fenêtre
> Commandes** (`features/orders`), premier écran réel ; ce document généralise
> ses comportements à toutes les futures entités (Clients, Produits, Stock…).
> Complément de [`systeme-fenetrage.md`](./systeme-fenetrage.md), qui décrit le
> shell, les onglets et le multi-fenêtrage sous-jacents.

## 1. Vue d'ensemble

Un **écran liste d'entités** présente une collection d'entités métier dans une
table dense, professionnelle, manipulable sans quitter le clavier. Il s'insère
dans le shell comme n'importe quel écran (onglet du workspace, type logique
résolu par `TabContent`, cf. fenêtrage §3) et suit le **modèle maître/détail** :
un onglet interne **Liste** systématique (non fermable) et un onglet **Détail**
par entité ouverte, identifiée par sa clé naturelle.

Dix comportements composent la table de référence :

| # | Comportement | Résumé |
|---|---|---|
| 1 | **Colonnes déplaçables** | Réordonnancement gauche/droite par drag-and-drop des en-têtes (CDK) |
| 2 | **Menu contextuel d'en-tête** | Clic gauche sur un en-tête : menu regroupant le tri **et** l'affichage/masquage des colonnes (plus de bouton « Colonnes » séparé) |
| 3 | **Tri multi-colonnes** | Depuis le menu : trier sur une colonne, ou en empiler plusieurs (chacune asc/desc, priorité = ordre d'ajout) |
| 4 | **Filtre par statut** (énumération) | Filtre sur une valeur d'un champ à domaine fini |
| 5 | **Filtre par borne de dates** | Plage `[début, fin]` incluse sur une colonne date |
| 6 | **Filtre par borne de montant** | Plage `[min, max]` incluse sur une colonne numérique |
| 7 | **Pagination** | En bas à gauche ; taille de page `10 / 50 / 100 / Tous` |
| 8 | **Bouton Rechercher** | En haut à droite ; ouvre la side bar de recherche contextuelle |
| 9 | **Largeur des colonnes** | Redimensionnement à la souris (poignée sur le bord droit de l'en-tête), double-clic pour réinitialiser ; largeur persistée par instance |
| 10 | **Grille visible** | Traits verticaux entre colonnes (en plus des traits horizontaux entre lignes) |

Principe directeur : **tout l'état de présentation (colonnes, largeurs, tri,
filtres, pagination) vit dans le store d'écran par instance d'onglet** — il est
sérialisable, persiste aux changements d'onglet et **suit l'onglet lors d'un
détachement de fenêtre** (cf. fenêtrage §5, transport de l'état d'écran). Deux
listes de la même entité ouvertes côte à côte (Ctrl+clic) ont donc des colonnes,
tris et filtres **indépendants**, tout en partageant les mêmes *données*.

## 2. Anatomie de l'écran

```text
 Onglet workspace « Clients » (ou Commandes, Produits…)
+---------------------------------------------------------------+
| [ Liste ] [ Détail — CLI-001 ✎ ]        <- onglets internes   |
+---------------------------------------------------------------+
| Clients                                        [⌕ Rechercher] |  ← 1. toolbar (droite)
| 42 clients — …                                                |
+---+-----------+‖----------+‖----------+‖--------+‖-------------+  ‖ = poignée
| ● | Réf ▲▾    | Date      | Nom       | Statut  |     Total HT |  ← en-têtes : clic = menu
+---+-----------+----------+-----------+---------+--------------+     (tri 3 + colonnes 2)
|   | CLI-001   | 12/05/26 | ACME SA   | Actif   |    12 450,50 |     déplaçables (1), grille
|   | CLI-002   | 15/05/26 | Contoso   | Actif   |     3 980,00 |     verticale (10), poignée
|  …                                                            |     de largeur (9)
+---------------------------------------------------------------+
| Lignes par page : [10 ▾]  1–10 sur 42  ‹ 1/5 ›                |  ← 7. pagination (bas-gauche)
+---------------------------------------------------------------+

 Menu contextuel d'en-tête (clic gauche sur « Nom ») — tri + colonnes
+--------------------------------+
| TRI                            |
|  ▲ Trier croissant             |   ← setSort(col,'asc')  (remplace le tri)
|  ▼ Trier décroissant           |   ← setSort(col,'desc')
|  ＋ Ajouter au tri (croissant) |   ← addSort(col,'asc')  (multi-colonnes)
|  ＋ Ajouter au tri (décroiss.) |   ← addSort(col,'desc')
|  ✕ Retirer du tri              |   ← removeSort(col)   (si col triée)
|  ⌫ Effacer le tri              |   ← clearSort()       (si tri actif)
| COLONNES                       |
|  ☑ Réf   ☑ Date   ☑ Nom …      |   ← toggleColumnVisibility(id)
+--------------------------------+

 Side bar « Rechercher » (contextuelle à l'onglet actif) — ouverte par [⌕]
+----------------------+
| Recherche (tous ch.) |   ← texte libre
| N° / Référence       |   ← clé naturelle
| Statut        [▾]    |   ← 4. filtre énumération
| Date  [ ]→[ ]        |   ← 5. borne de dates
| Total HT [min]→[max] |   ← 6. borne de montant
| 12 résultat(s)  Effacer
+----------------------+
```

- **Colonnes structurelles** (indicateur d'état à gauche, actions à droite) :
  ni déplaçables ni masquables, hors du registre des colonnes.
- **Colonnes de données** : déplaçables (drag), masquables et triables via le
  **menu contextuel d'en-tête** (clic gauche).
- Les **filtres** (4/5/6 + texte + clé) vivent dans la **side bar de recherche
  contextuelle**, cohérente avec le reste du shell ; le bouton **Rechercher**
  (8) ne fait que la révéler.

## 3. Où vit l'état — le store d'écran par instance

Chaque écran liste d'entités possède un **store d'écran** (classe simple à base
de signals, **pas** un singleton), instancié **une fois par onglet du
workspace** et résolu par un **registre** `providedIn: 'root'`
(`forTab(tabId)`). C'est le même mécanisme que la fenêtre Commandes
(`OrdersScreenStore` + `OrdersScreenRegistry`, cf. fenêtrage §3).

Ce store porte, en plus de l'état maître/détail (onglets internes, brouillons,
mode édition) :

```typescript
// État de présentation — signals privés, exposés en lecture seule.
columnOrder   : readonly ColumnId[]          // ordre courant (avec masquées)
hiddenColumns : ReadonlySet<ColumnId>        // colonnes masquées
columnWidths  : ReadonlyMap<ColumnId, number>// largeurs (px) ; absentes = défaut
sortCriteria  : readonly SortCriterion[]     // tri multi-colonnes, ordonné par
                                             // priorité — { column, direction }[]
// Filtres (combinés en ET) :
searchText, searchNumber : string
statusFilter  : StatusValue | 'all'
dateFrom, dateTo : string                    // ISO yyyy-MM-dd, '' = pas de borne
amountMin, amountMax : number | null         // null = pas de borne
// Pagination :
pageSize      : number | 'all'
pageIndex     : number                        // 0-based, borné par pageCount
```

Il est **sérialisable** (`snapshot()` / `hydrate()`) : ces champs sont tous des
données simples, transportées dans `WorkspaceTab.state` lors d'un détachement
(fenêtrage §5). `hydrate()` traite l'instantané comme **non fiable** (valide
chaque champ, écarte le reste).

> ⚠️ **`hydrate()` écrit des signals et `forTab(tabId)` est lu depuis un `computed`**
> (`screen = computed(() => registry.forTab(tab().id))`). Écrire un signal dans un
> computed est interdit (`NG0600`) : la création + hydratation du store dans
> `forTab` **doit** être enveloppée dans `untracked(() => …)`. Le bug ne se
> manifeste qu'en fenêtre détachée (seul cas où `tab.state` existe). Cf.
> fenêtrage §5 et gestion-nouvelle-entité §4.2/§7.

> Séparation à retenir : les **données** de l'entité restent partagées et
> synchronisées entre toutes les fenêtres (service de données + bus inter-
> fenêtres, fenêtrage §5) ; seul l'**état de présentation** est propre à chaque
> instance d'écran.

## 4. Les huit comportements en détail

### 4.1 — Colonnes déplaçables (drag-and-drop)

- **UI** : les `th` des colonnes de données sont des `cdkDrag` dans un `tr`
  `cdkDropList` en orientation `horizontal`. Les `th` structurels (indicateur,
  actions) restent hors du drag.
- **Contrat** : `moveColumn(from, to)` où `from`/`to` sont des indices dans la
  liste **visible**. Les colonnes masquées conservent leur **position
  d'ancrage** dans l'ordre global (on réordonne les visibles, puis on
  réinsère).
- **Aperçu de drag** : réutilise les styles CDK **globaux** (`styles.css`,
  `.cdk-drag-*`) — le clone est apposé sur `<body>`, hors portée des styles
  encapsulés (cf. fenêtrage §7).
- Le corps de table itère la **même** liste `visibleColumns()` que l'en-tête :
  cellules et colonnes restent alignées quel que soit l'ordre.

### 4.2 — Menu contextuel d'en-tête (colonnes affichables / masquables)

- **UI** : **clic gauche** sur un en-tête ouvre un menu contextuel ancré sous la
  colonne. Il n'y a **plus de bouton « Colonnes »** dans la toolbar : l'affichage
  et le masquage se font dans la section **Colonnes** du menu (une case à cocher
  par colonne), aux côtés des actions de **tri** (§4.3). Un chevron ▾ discret
  révélé au survol signale que l'en-tête est cliquable.
- **Ouverture/fermeture** : portées par un signal **local au composant**
  (`openMenuColumn`), pas par le store — c'est de l'état d'UI éphémère, non
  sérialisé. Un *backdrop* plein écran ferme au clic extérieur ; `Échap` ferme
  aussi. Le clic sur une action de tri ferme le menu ; cocher/décocher une
  colonne **le laisse ouvert** (pour en régler plusieurs d'affilée).
- **Contrat (visibilité)** : `toggleColumnVisibility(id)`, `isColumnVisible(id)`.
- **Garde-fous** : impossible de masquer la **dernière** colonne visible ;
  masquer une colonne triée la **retire du tri** (sans toucher les autres
  critères).
- **Cohabitation avec le drag** : l'en-tête reste un `cdkDrag` déplaçable ; seul
  le **bouton libellé** porte `cdkDragHandle`, si bien que cliquer dans le menu
  (backdrop, items, cases) **n'initie jamais** un déplacement de colonne. Clic
  simple ⇒ menu, glisser depuis le libellé ⇒ réordonnancement.

### 4.3 — Tri multi-colonnes (ascendant / descendant par colonne)

Le tri n'est plus mono-critère : c'est une **liste ordonnée de critères**
`SortCriterion { column, direction }`, où **l'ordre définit la priorité** (le 1er
départage, le 2e départage les ex æquo, etc.).

- **UI** : dans la section **Tri** du menu d'en-tête (§4.2). L'en-tête affiche
  l'indicateur ▲/▼ de son sens et, dès que **plusieurs** colonnes sont triées, un
  **rang** en indice (¹²³) ; `aria-sort` (`ascending`/`descending`/`none`) reste
  posé sur le `th`.
- **Contrat** :
  - `setSort(id, dir)` — **remplace** tout le tri par ce seul critère ;
  - `addSort(id, dir)` — **empile** la colonne (priorité = ordre d'ajout), ou met
    à jour son sens **sans changer son rang** si elle est déjà présente ;
  - `removeSort(id)` — retire une colonne (les autres gardent leur ordre) ;
  - `clearSort()` — vide le tri ;
  - lecture : `sortCriteria()`, `sortDirectionFor(id)`, `sortRankFor(id)`.
- **Comparateurs par type de colonne** (croissant, le sens est appliqué ensuite,
  puis on passe au critère suivant en cas d'égalité) :
  - texte → `localeCompare(…, 'fr')` ;
  - date ISO → comparaison lexicographique (= chronologique) ;
  - énumération (statut) → index dans l'ordre métier déclaré ;
  - nombre → soustraction.
- Sans critère, l'ordre filtré d'origine est conservé.

### 4.4 — Filtre par statut (champ à domaine fini)

- **UI** : `<select>` dans la side bar (« Tous les statuts » + une option par
  valeur).
- **Contrat** : `setSearchStatus(value)` avec `value: StatusValue | 'all'`.
- Généralisable à **tout champ énuméré** (type de client, catégorie produit,
  état de stock…) via son tableau de valeurs et sa table de libellés.

### 4.5 — Filtre par borne de dates

- **UI** : deux `<input type="date">` (début → fin) dans la side bar.
- **Contrat** : `setDateFrom(iso)`, `setDateTo(iso)` ; `''` retire la borne.
- **Sémantique** : bornes **incluses** ; comparaison lexicographique sur ISO
  `yyyy-MM-dd` (pas de conversion `Date`, donc pas de piège de fuseau).

### 4.6 — Filtre par borne de montant (colonne numérique)

- **UI** : deux `<input type="number">` (min → max) dans la side bar.
- **Contrat** : `setAmountMin(n | null)`, `setAmountMax(n | null)` ; `null`
  retire la borne ; les valeurs non finies sont traitées comme `null`.
- **Sémantique** : bornes **incluses**. Généralisable à toute colonne numérique
  (quantité, remise…).

> Recherche texte & clé naturelle : `setSearchText` (insensible à la casse, sur
> tous les champs) et `setSearchNumber` (sous-chaîne sur la clé) complètent les
> filtres ci-dessus. **Tous les critères se combinent en ET.** `hasActiveSearch`
> indique qu'au moins un critère est posé ; `clearSearch()` les réinitialise.

### 4.7 — Pagination

- **UI** : pied de table **en bas à gauche** — `<select>` « Lignes par page »
  (`10 / 50 / 100 / Tous`), libellé « début–fin sur total », boutons ‹ › et
  indicateur « Page n / N ».
- **Contrat** : `setPageSize(size)` (`number | 'all'`), `setPage(i)`,
  `nextPage()`, `previousPage()`.
- **Invariants** :
  - `pageCount ≥ 1` ; `'all'` ⇒ une seule page ;
  - `pageIndex` est un **computed borné** à `[0, pageCount-1]` (le signal brut
    n'est jamais lu directement) — un filtre qui réduit les résultats ne laisse
    jamais sur une page vide ;
  - **tout changement de filtre ou de tri revient à la page 1**.

### 4.8 — Bouton « Rechercher » → side bar contextuelle

- **UI** : bouton « Rechercher » dans la toolbar (haut-droite de la table).
- **Mécanisme** : la visibilité et la vue de la side bar sont portées par
  `ShellUiService` (`core/shell/`), singleton signals :
  `activityView`, `sidebarVisible`, `selectActivity()`, `toggleSidebar()`,
  `revealSearch()`. Le bouton appelle `revealSearch()`, ce qui permet à un
  composant **profond** (la table, dans la zone d'éditeurs) de piloter le shell
  **sans dépendance directe** au composant `Shell`.
- La side bar « Rechercher » est déjà contextuelle à l'onglet actif
  (`@switch (tab.type)`) et rend le panneau de recherche de l'entité, résolu par
  id d'onglet — donc branché sur la **bonne** instance d'écran.

### 4.9 — Largeur des colonnes (redimensionnement) & grille

- **Layout** : la table est en `table-layout: fixed` et **sa largeur est la somme
  exacte** des largeurs de colonnes (colonnes structurelles comprises) ; le
  conteneur défile horizontalement au besoin. Chaque colonne a une **largeur par
  défaut** déclarée dans sa définition (`OrderColumnDef.width`) ; l'utilisateur
  peut la surcharger. Le contenu trop long est **tronqué avec « … »** et une
  **infobulle** (`title`) restitue la valeur complète.
- **UI** : une **poignée** (`.col-resize`, curseur `col-resize`) sur le bord droit
  de chaque en-tête. Un glisser ajuste la largeur en direct ; un **double-clic**
  réinitialise à la valeur par défaut.
- **Mécanisme de drag** : pointer events natifs avec **capture de pointeur** sur
  la poignée (les mouvements lui sont livrés même hors cadre). La poignée est
  **distincte du `cdkDragHandle`** (le libellé) et fait `stopPropagation` sur
  `pointerdown` : la saisir ne déclenche donc **ni réordonnancement ni menu**.
  `pointercancel` remet l'état à zéro si le geste est interrompu.
- **Contrat** : `columnWidth(id)` (override utilisateur ou défaut),
  `setColumnWidth(id, px)` (borné à `MIN_COLUMN_WIDTH`, arrondi),
  `resetColumnWidth(id)`. La largeur totale est recalculée par un `computed` du
  composant (`tableWidth`) qui somme les colonnes visibles + structurelles.
- **Grille** : traits **verticaux** entre colonnes (`border-right` sur `th`/`td`,
  retiré sur la dernière), pendant naturel des traits horizontaux entre lignes.
- **État transitoire vs persistant** : l'ouverture du menu (`openMenuColumn`) et
  le redimensionnement en cours (`resizingColumn`) sont des **signals locaux au
  composant** (UI éphémère, non sérialisée) ; seule la **largeur résultante** est
  persistée dans le store.

## 5. Pipeline de données (l'ordre compte)

Trois `computed` en chaîne, dérivés de la collection du service de données :

```text
service.entities()            (source, partagée entre fenêtres)
      │  filtres (statut, dates, montant, texte, clé)  — ET
      ▼
filteredEntities   ── filteredCount = longueur (toutes pages)
      │  tri (critères multi-colonnes, par priorité)
      ▼
sortedEntities     ── pageCount = ceil(longueur / pageSize)
      │  découpe [pageIndex·size ; +size]  ('all' ⇒ tout)
      ▼
pagedEntities      → lignes réellement affichées
```

- La table itère `pagedEntities` ; les **compteurs** (« X sur Y », « n
  résultats ») utilisent `filteredCount` ; la **pagination** raisonne sur
  `sortedEntities`.
- Chaîne 100 % réactive (signals) : toute mutation d'un critère recalcule
  automatiquement l'aval — pas de souscription manuelle.

## 6. Modèle de colonnes générique

Chaque entité déclare ses colonnes de données dans un petit module dédié
(`models/<entity>-column.ts`), sur le patron de `order-column.ts` :

```typescript
export type EntityColumnId = 'ref' | 'date' | 'name' | 'status' | 'total';

export interface EntityColumnDef {
  readonly id: EntityColumnId;
  readonly label: string;
  readonly numeric?: boolean;  // aligné à droite + chiffres tabulaires
  readonly mono?: boolean;     // police à chasse fixe (identifiants)
  readonly width: number;      // largeur par défaut (px) ; surchargeable (§4.9)
}

export const ENTITY_COLUMN_DEFS: Record<EntityColumnId, EntityColumnDef> = { … };
export const DEFAULT_ENTITY_COLUMNS: readonly EntityColumnId[] = [ … ];
export function isEntityColumnId(v: unknown): v is EntityColumnId { … }
```

- `isEntityColumnId` sert de **garde** à l'hydratation (données non fiables).
- Seules les colonnes de données figurent ici ; les colonnes structurelles
  (indicateur, actions) restent dans le gabarit.
- Le **rendu d'une cellule** dépend de la colonne (`@switch (col.id)` : badge de
  statut, formatage `Intl` date/montant, chasse fixe…), pas de sa position.

## 7. Sérialisation & détachement de fenêtre

Le store d'écran doit round-tripper l'intégralité de la présentation :

```typescript
snapshot(): { …maître/détail…,
  search:     { text, number, status, dateFrom, dateTo, amountMin, amountMax },
  columns:    { order: ColumnId[], hidden: ColumnId[],
                widths: Array<[ColumnId, number]> },
  sort:       Array<{ column: ColumnId, direction: 'asc' | 'desc' }>,
  pagination: { size: number | 'all', index: number } }
```

Règles d'`hydrate()` (instantané **non fiable**, reçu par IPC) :

- **ordre des colonnes** : ne garder que des ids connus, sans doublon, puis
  **compléter** avec les colonnes manquantes dans l'ordre par défaut (tolère un
  schéma futur enrichi) ;
- **masquées** : ids connus uniquement, en garantissant ≥ 1 colonne visible ;
- **largeurs** : entrées `[id, px]` à id connu et px fini, bornées à
  `MIN_COLUMN_WIDTH` (les colonnes absentes retombent sur la largeur par défaut) ;
- **tri** : tableau de critères ; chacun retenu seulement si la colonne est
  **connue, visible et non déjà présente** (pas de doublon) et le sens ∈
  {asc, desc} ; l'ordre du tableau (donc la priorité) est préservé ;
- **pagination** : `size = 'all'` ou entier > 0 ; index entier ≥ 0 (le computed
  le rebornera de toute façon) ; **restaurée en dernier**, une fois filtres et
  tri appliqués.

## 8. Recette — ajouter un nouvel écran liste d'entités

En repartant du patron `features/orders`, pour une entité `X` :

1. **Domaine & DTO** : `models/x.ts` (modèle `readonly`, statuts + libellés),
   `data-access/x.dto.ts` (DTO snake_case + données de démo), `mappers/x.mapper.ts`
   (DTO → domaine + gardes `parseSynced*` pour le bus).
2. **Service de données** : `data-access/x.service.ts` (`providedIn: 'root'`,
   signal d'état, publication/abonnement sur le sujet `'x/state'` du bus inter-
   fenêtres).
3. **Colonnes** : `models/x-column.ts` (cf. §6).
4. **Store d'écran** : `store/x-screen.store.ts` (état maître/détail + présentation
   des §3–§7) et `store/x-screen.registry.ts` (une instance par onglet +
   enregistrement d'un `TabStateProvider` pour le détachement).
5. **Composants** : `components/x-list.*` (table §4), `components/x-detail.*`
   (fiche), `components/x-search.*` (panneau side bar §4.4–4.6).
6. **Page** : `pages/x-page.ts` (`input.required<WorkspaceTab>()`, résout le store
   via le registre, remonte `dirty` au workspace, garde de fermeture des détails).
7. **Branchements dans le shell** (3 points) :
   - `shell/editor/tab-content.html` : `@case ('x-list')` → page en `@defer` ;
   - `shell/side-bar/side-bar.*` : entrée dans `screens[]` **et** `@case ('x-list')`
     rendant `<app-x-search>` dans la vue recherche ;
   - `shared/models/workspace.ts` : ajouter le `TabType` `'x-list'` si nouveau.
8. **Tests** (Vitest) : tri, filtres (énumération / dates / montant), pagination,
   colonnes (ordre + visibilité + garde-fous), `snapshot`/`hydrate`.

Rien de tout ceci n'introduit de nouvelle dépendance : Angular CDK (déjà utilisé
pour les onglets) couvre le drag des colonnes ; `ShellUiService` est déjà en
place.

## 9. Conventions & garde-fous

- **≥ 1 colonne visible** en permanence ; le tri sur colonne masquée est annulé.
- **Retour page 1** à chaque changement de filtre ou de tri ; `pageIndex` borné
  par un computed (jamais de page vide).
- **Bornes incluses** pour dates et montants ; `''`/`null` = borne absente.
- **Critères combinés en ET** ; état de recherche propre à l'instance d'écran.
- **Toute donnée hydratée est validée** (ids de colonnes, sens de tri, tailles
  de page, bornes) — jamais de confiance dans `tab.state`.
- **Accessibilité** : `aria-sort` sur les en-têtes ; le menu d'en-tête porte
  `role="menu"` / `menuitem` / `menuitemcheckbox`, `aria-haspopup`/`aria-expanded`
  sur le déclencheur, fermeture au clic extérieur et à `Échap` ; alternative
  clavier au drag et navigation clavier complète du menu **à parfaire** (cf. §11) ;
  libellés ARIA sur les contrôles de pagination et de recherche, focus visible.
- **Formatage** : `Intl.NumberFormat`/`DateTimeFormat` en `fr-FR` / EUR ;
  chiffres tabulaires sur les colonnes numériques.
- **Style** : tokens `--vscode-*`, pas de styles ad hoc ; budget de style par
  composant (4 kB) — factoriser et déléguer aux styles globaux CDK.

## 10. Référence d'implémentation (fenêtre Commandes)

```text
src/app/
├── core/shell/shell-ui.service.ts        Visibilité/vue side bar + revealSearch (8)
└── features/orders/
    ├── models/
    │   ├── order.ts                       Domaine + statuts + libellés
    │   └── order-column.ts               Registre des colonnes (§6)
    ├── data-access/orders.service.ts      Données + bus inter-fenêtres
    ├── store/
    │   ├── orders-screen.store.ts         État présentation + pipeline (§4–§7)
    │   └── orders-screen.registry.ts      1 instance / onglet + détachement
    ├── components/
    │   ├── order-list.{ts,html,css}       Table : menu d'en-tête (tri multi + colonnes)/DnD/pagination
    │   └── orders-search.{ts,html,css}    Panneau side bar : statut/dates/montant
    └── pages/orders-page.ts               Hôte maître/détail
```

Points d'entrée à lire en premier pour répliquer : `orders-screen.store.ts`
(tout le comportement testable) et `order-list.html` (le gabarit de table).

## 11. Limites actuelles / feuille de route

| Sujet | État |
|---|---|
| **Extraction d'un socle générique** | Aujourd'hui chaque entité **réplique** le patron. Une base réutilisable (store de présentation générique paramétré par les colonnes + comparateurs, composant de table générique) est envisageable une fois 2–3 entités stabilisées |
| **Tri / filtre / pagination côté serveur** | Actuellement **en mémoire** (données de démo). Pour les gros volumes ERP, basculer vers pagination et tri serveur (l'API backend devient l'autorité) — le contrat du store reste, l'implémentation des `computed` change |
| **Navigation clavier du menu d'en-tête** | Le menu s'ouvre au clic et se ferme au clic extérieur / `Échap`, mais la navigation au clavier entre ses items (flèches, `Home`/`End`, piège de focus) et l'ouverture au clavier restent à parfaire ; le réordonnancement des colonnes au clavier (alternative au drag) reste aussi à prévoir |
| **Tri multi-critères** | **Géré** : liste ordonnée de critères, chaque colonne asc/desc, priorité = ordre d'ajout, rang affiché en indice sur l'en-tête (cf. §4.3) |
| **Largeur des colonnes** | **Géré** : redimensionnement à la souris, double-clic pour réinitialiser, largeur persistée par instance ; `table-layout: fixed` + troncature « … » (cf. §4.9). Reste à prévoir : ajustement auto à la largeur du contenu, alternative clavier |
| **Vues enregistrées / préréglages de filtres** | À venir ; l'état étant déjà sérialisable, la persistance s'appuiera sur le même `snapshot()` (cf. persistance du workspace, fenêtrage §12) |
| **Virtualisation des lignes** | La pagination borne le nombre de lignes montées ; virtualisation (CDK) à envisager pour « Tous » sur gros volumes |
