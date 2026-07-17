# Système de fenêtrage — document de référence

> État : juillet 2026. Décrit le système tel qu'implémenté (shell type VSCode,
> multi-fenêtres Electron). Les évolutions prévues sont listées en fin de
> document.

## 1. Vue d'ensemble

L'application reproduit le visuel et le comportement de fenêtrage de Visual
Studio Code :

```text
+--------------------------------------------------------------------------+
| Title bar : menus | titre centré | agencement | contrôles fenêtre        |  35px
+----+---------------------+---------------------------------------------+
| A  |                     |  Groupe 1        ║  Groupe 2                 |
| c  |  Side bar           |  [tab][tab][tab] ║  [tab]                    |
| t  |  (explorateur /     |                  ║                           |
| i  |   recherche)        |  contenu onglet  ║  contenu onglet           |
| v  |                     |     actif        ║     actif                 |
| i  |                     +---------------------------------------------+
| t  |                     |  Panneau inférieur (Problèmes/Sortie/Term.) |
+----+---------------------+---------------------------------------------+
| Status bar : mode fenêtre | runtime          |  n onglets | n groupes   |  22px
+--------------------------------------------------------------------------+
     48px        280px            ║ = poignée de redimensionnement
```

Capacités :

- onglets métier ouvrables, réordonnables et transférables par drag-and-drop
  (Angular CDK) avec alternatives clavier ;
- groupes d'éditeurs divisibles **horizontalement et verticalement, à
  n'importe quelle profondeur** (layout récursif), avec splits
  redimensionnables (ratio par nœud) ;
- **détachement d'un onglet dans une nouvelle fenêtre native** (transactionnel) ;
- side bar et panneau inférieur affichables/masquables (boutons d'agencement
  dans la title bar, comme VSCode) ; panneau redimensionnable en hauteur ;
- fenêtre sans cadre (`frame: false`) avec title bar personnalisée pilotant
  la fenêtre native (réduire / agrandir / restaurer / fermer) ;
- fonctionnement dégradé en navigateur pur (`ng serve` sans Electron).

## 2. Architecture en trois contextes

```text
Electron Main  (electron/main.cjs)
    |   IPC validé (liste blanche de canaux, payloads sanitizés)
    v
Preload        (electron/preload.cjs)
    |   window.desktopAPI (contextBridge, API minimale typée)
    v
Renderer Angular (src/app/)
```

| Contexte | Rôle dans le fenêtrage |
|---|---|
| **Main** | WindowManager (registre `windowId` → fenêtre + contexte), création des fenêtres, validation des payloads IPC, contrôles natifs, suppression du menu par défaut |
| **Preload** | Expose `window.desktopAPI` ; liste blanche des canaux d'événements ; jamais `ipcRenderer` directement |
| **Renderer** | Layout du shell, store du workspace (signals), drag-and-drop, raccourcis ; ne touche jamais Node.js ni Electron |

### Fichiers clés

```text
electron/
├── main.cjs                  WindowManager + IpcRouter + sécurité
└── preload.cjs               window.desktopAPI (contextBridge)

src/app/
├── core/
│   ├── electron/
│   │   ├── desktop-api.ts    Contrats TypeScript de l'API preload + WindowContext
│   │   ├── electron.service.ts  Frontière Angular/Electron (signals, no-op navigateur)
│   │   └── window-sync.service.ts  Bus de synchronisation inter-fenêtres
│   ├── shell/
│   │   ├── shell-ui.service.ts       Visibilité/vue de la side bar (+ revealSearch)
│   │   └── recent-records.service.ts Historique des fiches ouvertes (§6.2)
│   └── workspace/
│       ├── workspace-store.ts      Store signals : arbre de layout + onglets
│       ├── layout.ts               Fonctions pures sur l'arbre (split, remove…)
│       ├── tab-detach.service.ts   Détachement transactionnel (+ capture d'état)
│       ├── tab-state-registry.ts   Fournisseurs d'état d'écran (transport détachement)
│       └── workspace-close.service.ts  Garde de fermeture (confirmation si dirty)
├── shared/
│   ├── models/workspace.ts         WorkspaceTab, EditorGroup, WorkspaceLayout
│   └── components/
│       ├── confirm-dialog/         Dialogue de confirmation modale réutilisable
│       └── icon/                   Pictogrammes Fluent System Icons (inline, §6.1)
└── shell/
    ├── shell.ts/.html/.css         Layout + raccourcis centralisés + init contexte
    ├── title-bar/                  Menus, titre, agencement, contrôles fenêtre
    ├── activity-bar/               Icônes verticales (explorateur, recherche…)
    ├── side-bar/                   Explorateur (arbre de modules + Fiches récentes) / recherche (§6.1)
    ├── editor/
    │   ├── editor-area.ts          Racine de l'arbre + cdkDropListGroup
    │   ├── layout-node.ts          Rendu récursif (feuille ou split + poignée)
    │   ├── editor-group.ts         Bande d'onglets (CDK, dock, chevrons de défilement)
    │   ├── tab-drag.service.ts     Suivi du drag + résolution de la cible de dock
    │   ├── tab-content.ts          Résolution type d'onglet → contenu (@defer)
    │   └── welcome-view.ts         Page d'accueil
    ├── panel/                      Panneau inférieur (Problèmes/Sortie/Terminal)
    └── status-bar/                 Mode fenêtre, runtime, compteurs

src/app/features/
└── orders/                         Fenêtre Commandes (1er écran métier réel)
    ├── data-access/                orders.service.ts (bus sync) + order.dto.ts (JSON)
    ├── mappers/                    DTO → domaine + gardes de type (bus)
    ├── models/                     Order, OrderDraft, statuts
    ├── store/                      orders-screen.store.ts (état par onglet)
    │                              + orders-screen.registry.ts (1 instance / onglet)
    ├── components/                 order-list / order-detail / orders-search (side bar)
    └── pages/                      orders-page.ts (onglets internes Liste/Détail)
```

## 3. Modèle de données

Tout ce qui transite par IPC est **sérialisable** — jamais de composant
Angular ni d'objet Electron.

```typescript
// src/app/shared/models/workspace.ts
interface WorkspaceTab {
  id: string;          // stable, `tab-<uuid>`
  type: TabType;       // type logique : 'welcome', 'customer-editor', …
  title: string;
  entityId?: string;   // clé de dédoublonnage avec type
  icon?: string;
  closable: boolean;
  dirty: boolean;      // modifications non enregistrées (● dans l'onglet)
  pinned: boolean;     // réservé (pas encore d'UI)
  detached: boolean;
  windowId?: string;
  state?: Record<string, unknown>;
}

interface EditorGroup {
  id: string;                      // `group-<uuid>`
  tabs: readonly WorkspaceTab[];
  activeTabId: string | null;
}

// Layout récursif : un arbre dont les feuilles sont les groupes.
type WorkspaceLayout =
  | { kind: 'group'; group: EditorGroup }
  | { kind: 'split';
      id: string;                          // `split-<uuid>`
      direction: 'horizontal' | 'vertical'; // côte à côte / empilés
      ratio: number;                        // part du premier enfant (0..1)
      first: WorkspaceLayout;               // ← récursif
      second: WorkspaceLayout };
```

Exemple — « A à gauche ; à droite, B au-dessus de C » :

```text
split horizontal (ratio 0.5)         +-------------+--------------+
├── group A                          |             |      B       |
└── split vertical (ratio 0.5)       |      A      +--------------+
    ├── group B                      |             |      C       |
    └── group C                      +-------------+--------------+
```

Le contenu d'un onglet est résolu par **type logique** (`TabContent`,
`@switch` sur `tab.type`) : les écrans métier sont branchés là depuis
`src/app/features/`, chargés en différé (`@defer`) pour le code-splitting.

Premier écran réel : `order-list` → `features/orders` (fenêtre Commandes).
Modèle maître/détail des écrans « liste d'entités » : l'écran porte sa
propre barre d'onglets internes avec un onglet **Liste** systématique (non
fermable) et un onglet **Détail** par entité ouverte, identifiée par sa clé
naturelle (n° de commande). Un écran « entité simple » s'affichera au
contraire directement en fiche.

**État par instance d'onglet.** Les brouillons d'édition et l'état des
onglets internes vivent dans un `OrdersScreenStore` — non pas singleton,
mais **une instance par onglet du workspace**, résolue par
`OrdersScreenRegistry` (`forTab(tabId)`). Cet état est sérialisable
(`snapshot`/`hydrate`) et suit l'onglet lors d'un détachement de fenêtre
(§5, transport de l'état d'écran). Ainsi Ctrl+clic dans l'explorateur
(option `newInstance` d'`openTab`) ouvre une **seconde fenêtre Commandes
totalement indépendante** : détails ouverts et brouillons propres à chacune.
L'instance survit aux changements d'onglet (seul l'onglet actif est monté)
et est libérée par un `effect` du registre quand l'onglet du workspace
disparaît (fermeture ou détachement). Les modifications non enregistrées de
chaque instance remontent au drapeau `dirty` de son onglet du workspace.

À distinguer de la synchronisation inter-**fenêtres** (§5) : les *données*
Commandes (`OrdersService`) restent partagées et synchronisées entre toutes
les fenêtres et instances ; seul l'*état d'écran* (onglets internes,
brouillons, **critères de recherche**) est propre à chaque instance.

**Fiche en lecture seule + confirmation.** Une ligne de la liste s'ouvre en
détail par le bouton ✎ **ou par double-clic**. La fiche s'ouvre en **lecture
seule** (bouton « Modifier ») ; « Modifier » repart d'un brouillon frais,
« Enregistrer » persiste et repasse en lecture seule, « Annuler » abandonne.
Fermer un onglet Détail **modifié** demande confirmation via `ConfirmDialog`
(`shared/components`) — « fermer sans enregistrer » ou « continuer
l'édition ». Le mode édition est un état par fiche de l'`OrdersScreenStore`.
Fermer le **conteneur** Commandes (onglet du workspace) est également gardé
au niveau du shell (`WorkspaceCloseService`, §6), puisque la fenêtre remonte
son état modifié au drapeau `dirty` de l'onglet.

**Recherche contextuelle.** Le panneau « Rechercher » de la side bar est
contextuel à l'onglet qui a le focus (`WorkspaceStore.activeTab`). Pour un
`order-list`, il rend `OrdersSearch` (chargé en `@defer`, résolvant
l'instance d'écran via son id d'onglet) : recherche texte tous champs,
par n° de commande et par statut, combinées en ET. Les critères vivent dans
l'`OrdersScreenStore` de l'instance ⇒ le filtrage persiste indépendamment de
la visibilité de la side bar, et deux listes ouvertes ont des recherches
distinctes. Les autres types d'onglet conservent le placeholder générique.

## 4. Le store du workspace (`WorkspaceStore`)

Store `providedIn: 'root'` à base de **signals**, un par fenêtre (les signals
ne sont jamais partagés entre fenêtres). Il est **pur** (aucun IPC) et
entièrement testé (`workspace-store.spec.ts`, 51 tests).

L'état central est le signal `layout` (l'arbre `WorkspaceLayout`) ; le
computed `groups` expose les feuilles de gauche à droite (parcours en
profondeur) pour tout ce qui raisonne en liste : cycle d'onglets et de
groupes, dédoublonnage, drag-and-drop. Les manipulations de l'arbre sont des
**fonctions pures** dans `core/workspace/layout.ts` (`splitGroup`,
`removeGroup`, `setSplitRatio`, `mapGroups`, `collectGroups`) qui préservent
les références des sous-arbres non modifiés (compatible OnPush). Les
composants ne manipulent jamais l'arbre directement : toute mutation passe
par une méthode du store.

### Sémantique des opérations

| Opération | Règles |
|---|---|
| `openTab(request, { newInstance? })` | Dédoublonnage global sur `type + entityId` : si l'écran est déjà ouvert (même dans un autre groupe), il est activé ; sinon création en fin du groupe actif. `newInstance: true` (Ctrl+clic dans l'explorateur) court-circuite le dédoublonnage → seconde instance indépendante |
| `closeTab(id)` | Respecte `closable` ; l'onglet actif fermé active le **voisin de droite, sinon de gauche**. Fermeture directe (pure) : la garde de confirmation vit dans `WorkspaceCloseService`, en amont (§6) |
| `forceRemoveTab(id)` | Idem sans condition (fin de détachement) |
| `moveTab` / `transferTab` | Réordonnancement / transfert inter-groupes (indices bornés) ; l'onglet transféré devient actif dans la cible et le focus suit |
| `splitActiveGroup(direction)` | Remplace la feuille du groupe actif par un nœud split (ratio 0.5) dont le second enfant contient un duplicata de l'onglet actif (**nouvel id**, même type/entité). Plus de bouton ni de raccourci : la division se fait par docking (§7) ; la méthode reste l'API programmatique du store |
| `resizeSplit(splitId, ratio)` | Ajuste le ratio d'un nœud split (poignée) ; borné à [0.1, 0.9], rejette NaN |
| Groupe vidé | Retiré de l'arbre : son nœud split parent est remplacé par le **frère, qui occupe alors tout l'espace** (simplification de l'arbre). Le dernier groupe est conservé vide (filigrane + raccourcis) |
| `initializeForContext(ctx)` | Applique le contexte fenêtre au démarrage ; en mode `detached-tab`, **revalide** `initialTab` (donnée IPC non fiable) et retombe sur l'accueil si invalide ; idempotent |

## 5. Multi-fenêtrage Electron

### WindowManager (main process)

- Registre central `Map<windowId, { window, context }>` ; `windowId` stable
  (`win-<uuid>`) attribué à la création.
- Contexte inscrit **avant** `loadURL` — pas de course sur
  `window:get-context`.
- Chaque fenêtre : `frame: false`, `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`.
- `Menu.setApplicationMenu(null)` : sans cela, les accélérateurs du menu par
  défaut (Ctrl+W, Ctrl+R, F11) court-circuitent les raccourcis du renderer.

```typescript
interface WindowContext {
  windowId: string;
  mode: 'main' | 'detached-tab' | 'secondary-workspace';
  initialTab?: unknown;   // non fiable : revalidé par le renderer
}
```

### Canaux IPC

| Canal | Sens | Rôle |
|---|---|---|
| `app:get-version` | invoke | Version de l'application |
| `window:get-context` | invoke | Contexte de la fenêtre appelante |
| `window:minimize` / `window:close` | invoke | Contrôles natifs |
| `window:toggle-maximize` / `window:is-maximized` | invoke | Agrandir/restaurer |
| `window:detach-tab` | invoke | Crée une fenêtre détachée (payload sanitizé) |
| `sync:publish` | invoke | Publie l'état d'un sujet sur le bus inter-fenêtres |
| `sync:get-state` | invoke | Dernier état retenu pour un sujet |
| `window:maximized-changed` | event main→renderer | Icône agrandir/restaurer |
| `sync:event` | event main→renderer | Diffusion d'une publication aux autres fenêtres |

Les canaux d'événements sont en **liste blanche** dans le preload ; chaque
abonnement retourne une fonction de désabonnement.

### Détachement d'un onglet (transactionnel)

Déclencheurs : bouton de la bande d'onglets, `Ctrl+Alt+D`, ou **drop d'un
onglet sans destination** (hors de tout groupe d'éditeurs — voir §7).

```text
Renderer source                     Main                        Renderer détaché
---------------                     ----                        ----------------
1. markDetachPending(tabId)
   (onglet grisé, verrou anti
    double-clic)
2. invoke window:detach-tab  ---->  3. sanitizeTab(payload)
                                    4. createWindow({mode:'detached-tab',
                                       initialTab})
                                    5. retour { ok, windowId }
6. ok  → forceRemoveTab(tabId) ;                                7. getContext()
   groupe vidé → frère promu                                    8. revalidation
   (§4)                                                            initialTab
   échec → l'onglet reste intact                                9. groupe unique
                                                                   avec l'onglet
```

- L'onglet n'est retiré de la source **qu'après** confirmation du main.
- Fermer le dernier onglet d'une fenêtre détachée **ferme la fenêtre native**
  (effect dans `Shell`).
- Cas résiduel accepté : fenêtre créée (`ok`) mais renderer qui échoue au
  chargement — amélioration prévue (« renderer prêt » avant confirmation).

**Transport de l'état d'écran.** Le détachement reconstruit aussi l'état
interne de l'écran (onglets internes, brouillons, mode édition, filtres),
pas seulement l'onglet nu. Mécanisme, entièrement porté par le champ
sérialisable `WorkspaceTab.state` :

1. `TabDetachService` demande à `TabStateRegistry.capture(tab)` un instantané
   sérialisable (chaque feature enregistre un fournisseur par type d'onglet ;
   Commandes via `OrdersScreenRegistry`) et l'embarque dans `tab.state` ;
2. `main` (`sanitizeTab`) transporte `state` tel quel (objet simple) dans le
   contexte de la nouvelle fenêtre ;
3. la fenêtre destination revalide via `parseInitialTab` (état non fiable) et
   le conserve sur l'onglet ;
4. à la création de l'instance d'écran, `OrdersScreenRegistry.forTab` **hydrate**
   depuis `tab.state` (`OrdersScreenStore.hydrate`, qui écarte les détails
   inconnus et les champs malformés).

> ⚠️ **`forTab` est lu depuis un `computed`** (`OrdersPage.screen`). L'hydratation
> écrit des signals, interdit dans un computed (`NG0600`) — et ne se déclenche que
> dans une fenêtre détachée (seul cas où `tab.state` existe). La création +
> hydratation doit donc s'exécuter dans **`untracked()`**. À défaut, le
> détachement casse silencieusement (onglet détail perdu, écran vide) sans qu'un
> unit test appelant `hydrate` hors computed ne l'attrape. Reproductible en
> pilotant l'app via CDP (`electron --remote-debugging-port`).

Les *données* passent, elles, par le bus (ci-dessous) ; l'état d'écran par
`tab.state`. Ce même champ servira à la persistance du workspace (§12).

### Synchronisation inter-fenêtres (bus par sujet)

Les Signals Angular ne sont jamais partagés entre fenêtres : chaque fenêtre
a sa propre instance Angular. La synchronisation passe par un **bus de
publication par sujet** dans Electron Main — qui ne porte aucune logique
métier : il valide le sujet, **retient le dernier état** par sujet et
rediffuse aux autres fenêtres (l'émetteur est exclu).

```text
Fenêtre A                        Main                         Fenêtre B
---------                        ----                         ---------
updateOrder(...)
  → sync:publish
    { topic: 'orders/state',  →  retient l'état,
      data: Order[] }             rediffuse `sync:event`   →  validation du
                                                              payload (unknown)
                                                              → signal mis à jour
Fenêtre C (ouverte APRÈS) : au boot, sync:get-state('orders/state')
  → rattrape l'état retenu (cas typique : fenêtre détachée).
```

Côté renderer :

- `core/electron/window-sync.service.ts` — `publish(topic, data)`,
  `getState(topic)`, `onTopic(topic, listener)` (désabonnement retourné) ;
  inerte en navigateur pur ;
- chaque abonné **revalide** le payload (`unknown`, donnée IPC non fiable) —
  ex. `parseSyncedOrders` dans `features/orders/mappers/order.mapper.ts` ;
- premier usage : `OrdersService` publie l'état complet des commandes à
  chaque modification et applique les états reçus. Stratégie
  dernier-écrit-gagnant, en attendant que l'API backend devienne l'autorité
  (le bus véhiculera alors des invalidations plutôt que des états).

## 6. Layout du shell et panneaux

- **Grille** : `35px (title bar) / 1fr / 22px (status bar)` ; corps en flex
  `activity bar (48px) | side bar (280px) | colonne centrale`. La grille est
  déclarée `grid-template-columns: minmax(0, 1fr)` et `.shell-body` porte
  `min-width: 0` : sans cela, la colonne implicite (`min-width: auto`)
  s'élargit avec le contenu qui déborde (bande d'onglets), décale tout le
  shell hors de la fenêtre et empêche la bande de défiler. La chaîne
  `min-width: 0` doit rester complète de la grille jusqu'à `.tab-strip`.
- **Colonne centrale** : `éditeur (flex: 1)` + `panneau inférieur (hauteur
  fixe pilotée par signal)`. La chaîne `min-height: 0` est complète : quand le
  panneau réduit la hauteur disponible, le contenu d'onglet (`overflow: auto`)
  affiche son propre **ascenseur vertical** au lieu de déborder.
- **Rendu récursif des splits** : `LayoutNode` (`layout-node.ts`) s'auto-
  référence — une feuille rend `app-editor-group`, un nœud split rend ses
  deux branches en flex (row ou column selon la direction) avec
  `flex-grow = ratio / 1 − ratio`. Poignée de 4 px par nœud : drag au
  pointeur (pointer capture) ou flèches clavier selon l'axe (pas de 5 %),
  ratio borné à [0.1, 0.9].
- **Panneau inférieur** : onglets Problèmes / Sortie / Terminal
  (placeholders) ; poignée horizontale (pointeur ou ↑/↓, hauteur bornée
  100 px → fenêtre − 220 px) ; bouton de fermeture.
- **Boutons d'agencement** (title bar, comme VSCode) : bascule de la side bar
  et du panneau, icônes remplies/évidées selon l'état, `aria-pressed`.
- **Débordement de la bande d'onglets** : quand les onglets dépassent la
  largeur du groupe, deux chevrons de défilement (‹ ›) apparaissent — chacun
  **uniquement si un onglet déborde de son côté** (`canScrollLeft` /
  `canScrollRight`). L'onglet actif (ex. onglet fraîchement ouvert) est
  amené à l'écran automatiquement (`scrollIntoView`). L'état des chevrons est
  recalculé sur défilement, sur changement d'onglets (`effect`) et sur
  redimensionnement du groupe (`ResizeObserver`, nettoyé à la destruction).
  Prérequis : la chaîne `min-width: 0` ci-dessus — sinon la bande s'élargit
  au lieu de défiler et aucun chevron n'apparaît.
- **Title bar** : `-webkit-app-region: drag` (déplacement + double-clic
  natif pour agrandir) ; menus et boutons en `no-drag` ; contrôles fenêtre
  masqués hors Electron.
- **Garde de fermeture d'onglet** : le × de l'onglet, `Ctrl+W` et `Suppr`
  passent par `WorkspaceCloseService.requestClose(tabId)` (et non
  `store.closeTab` directement). Si l'onglet est `dirty`, un `ConfirmDialog`
  (rendu par le `Shell`) demande confirmation avant de fermer. Les features
  remontent leur état modifié au drapeau `dirty` de l'onglet (ex. la fenêtre
  Commandes via un `effect`), si bien qu'un conteneur avec des fiches non
  enregistrées est protégé. Les fermetures **programmatiques** (détachement,
  transfert) passent par le store et ne sont pas gardées — ce sont des
  déplacements, pas des abandons.
- **Garde de fermeture de fenêtre** : la croix système **et** Fichier › Quitter
  passent par `WindowCloseService.requestExit()` (comportement identique). Si un
  onglet de la fenêtre porte des modifications non enregistrées
  (`WorkspaceStore.hasUnsavedChanges`), un `ConfirmDialog` (rendu par le
  `Shell`) demande confirmation ; sinon la fenêtre se ferme directement (fermer
  la dernière fenêtre quitte l'application, cf. `window-all-closed`).

### 6.1 — Explorateur : arbre des modules, recherche & pictogrammes

La **side bar** (`shell/side-bar/`) rend, selon la vue active de l'activity bar
(`explorer` / `search`) :

- **Explorateur** — deux **sections repliables** (accordéon) :
  - **Modules** : arbre **hiérarchique** des écrans métier ;
  - **Fiches récentes** : historique **dynamique** des fiches ouvertes (§6.2).
- **Rechercher** — panneau de recherche **contextuel à l'onglet actif**
  (`@switch (tab.type)`), qui délègue à la side bar de la feature (ex.
  `<app-orders-search>` pour `order-list`).

**Arbre des modules.** Chaque nœud de premier niveau est soit un **écran isolé**,
soit un **groupe** repliable contenant des enfants. Structure actuelle :

```text
▾ MODULES
   ▤ Tableau de bord               (écran isolé)
   ▸ ⌦ Ventes                       (groupe)
        ▢ Clients      → customer-list
        ▢ Commandes    → order-list
   ▸ ▤ Données de base              (groupe)
        ▢ Articles     → article-list
   ▸ ▤ Stock                        (groupe)
        ▢ Consultation Stock       → inventory
        ▢ Consultation Mouvements  → inventory-movements
▾ FICHES RÉCENTES
   …
```

- **Modèle** (`side-bar.ts`) : union discriminée `ModuleNode = ModuleLink |
  ModuleGroup`. Un `ModuleLink` porte une `IconName` et un `SideBarEntry`
  (`type` + `title` [+ `entityId`]) ; un `ModuleGroup` porte une `IconName`, un
  `title` et des `children`. **Chaque groupe et chaque item ont un pictogramme.**
- **Ouverture** : clic → `WorkspaceStore.openTab(entry)` ; **Ctrl/⌘+clic** →
  nouvelle instance (`newInstance`). Les types sans feature dédiée
  (`dashboard`, `customer-list`, `article-list`, `inventory`,
  `inventory-movements`) retombent sur le **placeholder** de `tab-content`
  (§ modèle de données) ; seul `order-list` a un écran réel.
- **Repli/dépli** : un unique signal **local au composant**
  `collapsed: Set<string>` porte l'état des **sections d'accordéon ET des
  groupes** (clés : `'screens'`, `'records'`, puis l'`id` de chaque groupe).
  `toggle(key)` / `isExpanded(key)`. État **local et éphémère** : il survit au
  basculement Explorateur ↔ Rechercher (contrairement à l'état DOM d'un
  `<details>`, réinitialisé par le `@switch`), mais **n'est pas persisté** dans
  le workspace. Défaut : **tout déplié**.
- **Accessibilité** : chaque en-tête est un `<button>` avec `aria-expanded` et
  `aria-controls` pointant sur la liste enfant ; l'indentation par niveau et un
  « twistie » de largeur fixe alignent les pictogrammes des items sans enfants.

**Pictogrammes (`shared/components/icon/`).** Petit composant `<app-icon
[name]>` rendant un SVG **inline** résolu par un `@switch` sur `IconName` :

- **source** : **Fluent System Icons** (Microsoft, **MIT**), variantes
  `20 regular` ; les données de tracé sont **intégrées** dans le composant — ni
  dépendance npm, ni requête réseau (compatible **CSP stricte** et packaging
  Electron) ;
- **thémable** : rendu `fill: currentColor` (l'icône prend la couleur du texte,
  pilotée par les tokens `--vscode-*`), viewBox `20` mis à l'échelle 16px ;
- **étendre** : copier le tracé du SVG Fluent officiel, ajouter un `@case` et
  l'entrée correspondante dans le type `IconName`.

### 6.2 — Fiches récentes (historique dynamique)

La section **Fiches récentes** de l'explorateur liste les fiches (détails
d'entité, ex. une commande) récemment ouvertes. **Vide au démarrage** ; elle se
remplit à l'usage.

- **État** : `RecentRecordsService` (`core/shell/`), signal `records` d'un
  tableau de `RecentRecord` = données simples (`key`, `title`, `icon`,
  `containerType`, `recordId`). Liste **de la plus récente à la plus ancienne**,
  **dédoublonnée par `key`** (une réouverture remonte la fiche en tête) et
  **bornée** à `MAX_RECENT_RECORDS` (15). **Aucune persistance disque** :
  redémarrer (toutes fenêtres fermées) repart d'une liste vide.
- **Portée globale (toutes fenêtres)** : les Signals ne traversant pas les
  fenêtres, l'historique est synchronisé via le **bus inter-fenêtres**
  (`WindowSyncService`, sujet `recent-records/state`) — même patron que
  `OrdersService`. Chaque `add`/`clear` **publie la liste complète** ; les
  autres fenêtres l'appliquent **après validation** (payload `unknown` non
  fiable → `parseSyncedRecords`), et une fenêtre ouverte après coup **rattrape**
  le dernier état retenu par Electron Main (le rattrapage n'écrase pas une fiche
  déjà consignée localement entre-temps). Stratégie dernier-écrit-gagnant.
- **Consignation** : `orders-page` porte un `effect` qui observe
  `screen().detailNumbers()` et appelle `recentRecords.add(…)` pour chaque
  détail **nouvellement** ouvert (la simple ouverture suffit, sans
  modification). Le suivi est resynchronisé sur les détails encore ouverts, si
  bien que rouvrir un détail fermé le reconsigne (et le remonte).
- **Réouverture découplée** (feature ↔ shell) : chaque feature enregistre un
  **ouvreur** par type de conteneur —
  `recentRecords.registerOpener('order-list', …)` dans `OrdersScreenRegistry`.
  Au clic sur une fiche, l'explorateur appelle `recentRecords.open(record)` qui
  délègue à l'ouvreur ; l'explorateur ne connaît **que des données** (même
  principe de découplage que `TabStateRegistry`).
- **« Sans ouvrir la liste »** : l'ouvreur des commandes **réactive** le
  conteneur Commandes (ou le **crée** s'il n'existe pas) puis appelle
  `openDetail(orderNumber)` — l'utilisateur atterrit **directement sur la
  fiche** (vue Détail active), pas sur la Liste.
- **Limite** : historique **non persisté sur disque** (perdu quand la dernière
  fenêtre se ferme). Seules les fiches commande l'alimentent aujourd'hui (les
  autres entités n'ont pas encore de feature ouvrant des fiches).

## 7. Drag-and-drop des onglets (docking façon Visual Studio)

Trois issues possibles selon l'endroit où l'onglet est relâché :

| Zone de drop | Résultat |
|---|---|
| Une **bande d'onglets** (la sienne ou celle d'un autre groupe) | Réordonnancement / transfert à l'index visé (CDK) |
| Le **corps d'un groupe** — guides de dock | `center` : ajout comme onglet du groupe ; `left`/`right` : split horizontal ; `top`/`bottom` : split vertical (le nouveau groupe est placé du côté choisi) |
| **Aucune destination** (panneau inférieur, side bar, hors fenêtre…) | **Détachement** dans une nouvelle fenêtre native (Electron ; en navigateur pur, l'onglet revient à sa place) |

Le panneau inférieur n'est jamais une cible de dock.

### Guides de dock

Dès que le pointeur survole le corps d'un groupe pendant un drag, le groupe
affiche une **croix de guides** à la Visual Studio (5 pastilles : centre,
gauche, droite, haut, bas) et un **aperçu translucide** de la zone
résultante. La zone est choisie soit en survolant une pastille, soit par
proximité des bords (bandes de 20 %), sinon centre.

Mécanique (`shell/editor/tab-drag.service.ts`) :

- les événements CDK (`cdkDragStarted/Moved/Ended`) alimentent le service,
  qui résout la cible par `document.elementFromPoint` → ancêtre
  `[data-dock-group]` (l'aperçu CDK et l'overlay sont en
  `pointer-events: none`) ;
- au-dessus d'une bande d'onglets, la cible de dock est annulée (le CDK gère
  l'insertion) ;
- au drop (`cdkDropListDropped` avec `isPointerOverContainer: false`), le
  handler traduit la cible en `store.dockTab(tabId, groupId, zone)` — ou en
  détachement si aucune cible ;
- le nettoyage de fin de drag est **différé** (`scheduleClear`) car
  `cdkDragEnded` est émis avant `cdkDropListDropped`, qui lit encore la
  cible ;
- la géométrie du hit-test des pastilles (40 px, offset 44 px) est alignée
  sur la grille CSS `.dock-guides` de `editor-group.css`.

Conventions CDK conservées :

- `cdkDropListGroup` sur la zone d'éditeurs connecte automatiquement toutes
  les bandes, quelle que soit la profondeur dans l'arbre ;
- les listes échangent des **ids**, jamais des références de tableaux ;
- l'aperçu de drag est cloné sur `<body>` : styles **globaux**
  (`styles.css`, classes `.cdk-drag-*`) ;
- le bouton × d'un onglet stoppe `mousedown` pour ne pas démarrer un drag.

## 8. Raccourcis clavier

Centralisés dans `Shell` (un seul listener `document:keydown`).

| Raccourci | Action |
|---|---|
| `Ctrl+W` | Fermer l'onglet actif (confirmation si modifié) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent (cycle) |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Alias navigateur (Ctrl+Tab réservé par Chrome) |
| `Ctrl+B` | Side bar |
| `Ctrl+ù` (AZERTY, comme VSCode fr ; alias `Ctrl+J`) | Panneau inférieur |
| `Ctrl+Alt+D` | Détacher l'onglet actif dans une nouvelle fenêtre |
| `Ctrl+Shift+←/→` | Déplacer l'onglet dans son groupe (alternative au drag) |
| `Ctrl+Alt+→` | Envoyer l'onglet au groupe suivant |
| `Ctrl+F6` | Focus au groupe suivant |
| Sur un onglet focalisé : `←/→`, `Home/End`, `Suppr`, `Entrée` | Navigation locale (roving tabindex), fermeture, activation |
| Sur une poignée focalisée : flèches | Redimensionner split / panneau |

## 9. Sécurité

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` sur
  toutes les fenêtres ; `window.open` refusé ; navigation limitée à l'URL de
  dev ou aux fichiers locaux ; permissions web refusées.
- CSP restrictive dans `index.html` (`script-src 'self'`,
  `style-src 'unsafe-inline'` requis par Angular, `ws://localhost:4200`
  requis par le HMR — inerte en prod).
- Toute donnée IPC est non fiable : sanitizée côté main
  (`sanitizeTab`) **et** revalidée côté renderer (`parseInitialTab`).

## 10. Mode navigateur pur

Sans Electron (`npm start` seul), `window.desktopAPI` est absent :

- `ElectronService.isElectron = false`, toutes les méthodes no-op ;
- contrôles fenêtre et actions de détachement masqués ;
- contexte `null` → workspace principal avec l'accueil ;
- `Ctrl+PageUp/PageDown` remplacent `Ctrl+Tab` (réservé par Chrome).

## 11. Lancer et tester

```bash
npm run electron:dev    # dev : ng serve + Electron (rechargement)
npm run build && npm run electron   # prod
npm test                # 140 tests Vitest (store, layout, sync, gardes, menus, feature Commandes)
```

## 12. Limites actuelles / feuille de route

| Sujet | État |
|---|---|
| Persistance / restauration du workspace | À venir (schéma versionné + migrations) — l'arbre `WorkspaceLayout` est déjà sérialisable |
| Persistance des préférences d'agencement | À venir, dans le même schéma : **largeur de la side bar** (`Shell.sidebarWidth`), hauteur du panneau inférieur (`Shell.panelHeight`), visibilité side bar/panneau. Aujourd'hui réinitialisées au démarrage (330 px / 200 px / visibles) |
| Onglets épinglés (`pinned`) | Champ présent, pas d'UI |
| Conservation de l'état des onglets masqués | Seul l'onglet actif est monté (recréation au changement) |
| Menus de la title bar | Déroulants fonctionnels : **Fichier › Quitter** (garde de fermeture, cf. §6), **Affichage › fenêtres ouvertes** (liste des écrans/onglets de la fenêtre, puce si modifications non enregistrées, activation au clic — via `WorkspaceStore`, côté renderer), **Aide › Version** (boîte « À propos » : nom + version). **Édition** reste un emplacement réservé (pas encore de commandes). Cross-fenêtres natives : liste des écrans des **autres** fenêtres natives à venir (agrégation par le bus de sync) |
| Attente « renderer prêt » avant confirmation du détachement | À venir |
