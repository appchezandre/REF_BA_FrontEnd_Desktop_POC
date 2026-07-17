# Intégrer une nouvelle entité — procédure de référence

> But : **simplifier et fiabiliser** l'ajout d'un écran métier (ex. Articles,
> Clients, Stock…). Ce document est la **checklist faisant autorité** : le suivre
> dans l'ordre garantit que **tous** les points de branchement sont câblés et
> qu'aucune régression n'est introduite. Il condense la recette de
> [`système-liste-entitées.md`](./système-liste-entitées.md) (comportements de la
> table) et de [`systeme-fenetrage.md`](./systeme-fenetrage.md) (shell, onglets,
> multi-fenêtres) en une marche à suivre file-par-file.
>
> Patron de référence : **`src/app/features/orders/`** (données de démonstration).
> Second exemple réel : **`src/app/features/users/`** (même patron, branché sur la
> **vraie API** Ref.Api — service HTTP, erreurs, concurrence optimiste). On
> **copie-adapte** ce patron (il n'existe pas encore de socle générique — cf.
> roadmap §11 de `système-liste-entitées.md`).

## 0. Principe : ajout **additif** et **incrémental**

- L'app **accepte déjà** les types d'onglet non implémentés : `tab-content` et le
  panneau de recherche ont un **`@default` placeholder**. On peut donc câbler par
  étapes en gardant le **build vert** à chaque étape.
- Les fichiers **partagés** ne sont modifiés qu'en **ajout** (nouveau membre
  d'union, nouveau `@case`, nouvelle entrée de tableau) : aucune modification du
  comportement existant ⇒ **risque de régression faible**.
- Les écrans sont résolus par `tab-content` (`@switch` + `@defer`), **pas** par le
  routeur Angular (`app.routes.ts` est vide et le reste). **Aucune route à créer.**

## 1. Décisions préalables (à figer avant de coder)

| Décision | Détail |
|---|---|
| **Nom & libellé** | Nom de domaine (`Article`), libellé UI (« Articles »). ⚠️ Vérifier les **synonymes/collisions** avec les entrées existantes de l'arbre Modules avant de nommer. *Décidé : l'entité produit est nommée « Articles » (`article-list`) — l'ancien libellé « Produits »/`product-list` a été retiré.* |
| **`TabType`** | Identifiant stable du conteneur liste : `'article-list'`. (Optionnel : `'article-editor'` si fiche autonome — sinon le détail vit **dans** le conteneur, modèle orders.) |
| **Clé naturelle** | Identifiant métier stable de la fiche (ex. `reference`, `ART-0001`) — sert de clé de dédoublonnage, d'ancre de détail et de `recordId` des fiches récentes. |
| **Colonnes** | Liste, libellés, types (texte / date / nombre / énum), largeurs par défaut. |
| **Filtres** | Champs recherchés (texte, clé, statut/énum, bornes date/montant). |
| **Pictogramme** | 1 `IconName` (réutiliser un existant ou en ajouter un depuis Fluent System Icons, cf. §3.2). |
| **Fiche : liste ou simple ?** | Entité riche ⇒ maître/détail (patron orders). Entité simple ⇒ fiche directe (page unique, cf. `features/settings`). |

## 2. Fichiers de la feature à créer (copie-adapter depuis `orders/`)

Arborescence cible `src/app/features/article/` :

```text
article/
├── models/
│   ├── article.ts              Modèle domaine (readonly) + statuts + libellés + Draft
│   └── article-column.ts       Registre des colonnes (id, label, numeric?, mono?, width)
├── data-access/
│   ├── article.dto.ts          DTO (snake_case) + données de démo
│   └── article.service.ts      Données + bus inter-fenêtres (topic 'articles/state')
├── mappers/
│   ├── article.mapper.ts       DTO → domaine + gardes parseSynced* (payload IPC non fiable)
│   └── article.mapper.spec.ts
├── store/
│   ├── article-screen.store.ts     État présentation + maître/détail (par onglet)
│   ├── article-screen.store.spec.ts
│   ├── article-screen.registry.ts  1 instance / onglet + détachement + ouvreur fiches récentes
│   └── article-screen.registry.spec.ts
├── components/
│   ├── article-list.{ts,html,css}    Table (menu d'en-tête, tri multi, colonnes, largeurs, pagination)
│   ├── article-detail.{ts,html,css}  Fiche (lecture seule / édition + brouillon)
│   └── article-search.{ts,html,css}  Panneau side bar (statut / dates / montant)
└── pages/
    └── article-page.{ts,html,css}    Hôte maître/détail (dirty + consignation fiches récentes)
```

> Astuce : reprendre chaque fichier d'`orders/`, renommer `Order`→`Article`,
> `order`→`article`, `orderNumber`→`reference`, `order-list`→`article-list`.

## 3. Points de branchement partagés (append-only)

### 3.1 — `TabType` — `src/app/shared/models/workspace.ts`

```ts
export type TabType =
  | 'welcome'
  | …
  | 'article-list'      // ← ajouter
  | (string & {});
```

### 3.2 — Pictogramme — `src/app/shared/components/icon/icon.ts`

Réutiliser un `IconName` existant, ou en ajouter un depuis **Fluent System Icons**
(MIT, variante `20 regular`) : copier le tracé du SVG officiel, ajouter l'entrée
au type `IconName` **et** un `@case` correspondant.

### 3.3 — Contenu d'onglet — `src/app/shell/editor/tab-content.{ts,html}`

`tab-content.html` :
```html
@case ('article-list') {
  @defer (on immediate) { <app-article-page [tab]="tab()" /> }
  @placeholder { <div class="placeholder">Chargement…</div> }
}
```
`tab-content.ts` : importer `ArticlePage` et l'ajouter au tableau `imports`.
*(Sans ce `@case`, l'onglet s'ouvre quand même sur le placeholder `@default` — sûr.)*

### 3.4 — Explorateur / arbre Modules — `src/app/shell/side-bar/side-bar.ts`

Ajouter une entrée `ModuleLink` (avec `icon`) dans le tableau `modules`, au bon
groupe (ex. « Données de base ») :
```ts
{ kind: 'item', icon: 'product', entry: { type: 'article-list', title: 'Articles' } }
```

### 3.5 — Recherche contextuelle — `src/app/shell/side-bar/side-bar.{ts,html}`

`side-bar.html`, dans `@case ('search')` → `@switch (tab.type)` :
```html
@case ('article-list') {
  <div class="side-bar-section-title">Articles</div>
  @defer (on immediate) { <app-article-search [tabId]="tab.id" /> }
}
```
`side-bar.ts` : importer `ArticleSearch` et l'ajouter aux `imports`.
*(Sans ce `@case`, la recherche tombe sur le `@default` générique — sûr.)*

## 4. Branchements sur les services **core** (dans la feature)

Ces quatre raccordements se font **dans la feature** (aucun fichier core à modifier) :

1. **Données inter-fenêtres** — `article.service.ts` : publier/rattraper sur le
   sujet `'articles/state'` via `WindowSyncService` (`getState` au démarrage +
   `onTopic` + `publish` à chaque mutation ; valider le payload avec un
   `parseSynced*` du mapper). Modèle : `OrdersService`.
2. **Détachement de fenêtre** — dans `article-screen.registry.ts`, constructeur :
   `this.tabState.register('article-list', { capture: (id) => this.capture(id) })`.
   Le store expose `snapshot()` / `hydrate(raw)` (état **sérialisable**, hydraté
   comme **non fiable**). Modèle : `OrdersScreenRegistry`.
   ⚠️ **`forTab(tabId)` est lu depuis un `computed`** (`article-page.ts` :
   `screen = computed(() => registry.forTab(tab().id))`). L'hydratation y **écrit
   des signals**, ce qui est interdit dans un computed (`NG0600`) et ne se
   déclenche que dans une fenêtre détachée (seul cas où `tab.state` existe).
   **Envelopper la création + l'hydratation dans `untracked(() => …)`** :
   ```ts
   forTab(tabId: string): ArticleScreenStore {
     let store = this.stores.get(tabId);
     if (!store) {
       store = untracked(() => {
         const created = new ArticleScreenStore(this.articlesService);
         const state = this.workspace.findTab(tabId)?.state;
         if (state) { created.hydrate(state); }
         return created;
       });
       this.stores.set(tabId, store);
     }
     return store;
   }
   ```
3. **Pastille « modifications non enregistrées » (dirty)** — la parité avec le
   shell exige **quatre liaisons**, toutes obligatoires (l'oubli d'une seule
   passe inaperçu au build — rien ne casse, la pastille manque juste) :
   1. **store** : un `computed` `dirtyKeys`/`dirtyNumbers` (clés dont le
      brouillon diverge de l'enregistré) + `hasDirty` ;
   2. **page hôte** (`*-page.ts`, constructeur) : un `effect` **reporte l'état
      sur l'onglet du workspace** — c'est LUI qui allume la pastille de
      l'en-tête d'onglet du tab-strip (`editor-group.html` affiche `tab.dirty`)
      et du menu Fenêtre :
      ```ts
      effect(() => {
        this.workspace.setDirty(this.tab().id, this.screen().hasDirty());
      });
      ```
   3. **onglets internes Détail** (`*-page.html`) : pastille par onglet —
      `@if (screen().dirtyKeys().has(key)) { <span class="screen-tab-dirty">●</span> }` ;
   4. **liste** (`*-list.html`) : la **colonne indicateur** (1re colonne
      structurelle) affiche `row-dirty-dot` pour chaque ligne dont la fiche
      est modifiée — `@if (screen().dirtyKeys().has(key(entité)))`.

   S'y rattache : la fermeture d'une fiche modifiée (onglet interne **et**
   fermeture d'onglet/fenêtre du workspace) doit demander confirmation
   (`ConfirmDialog`, cf. `closeDetail` de la page). Modèles : `orders-page` /
   `users-page` ; **test d'intégration de bout en bout** (les 3 pastilles +
   effacement à l'annulation) : `users/pages/users-page.spec.ts`.

4. **Fiches récentes (global, §6.2 fenêtrage)** — dans le même constructeur :
   `this.recentRecords.registerOpener('article-list', (ref) => this.openRecord(ref))`
   où `openRecord` réactive (ou crée) le conteneur puis `openDetail(ref)`. Et dans
   `article-page.ts`, un `effect` consigne chaque fiche **nouvellement ouverte** :
   ```ts
   effect(() => {
     const open = this.screen().detailNumbers();
     for (const ref of open) {
       if (!this.recorded.has(ref)) {
         this.recentRecords.add({
           key: `article-list::${ref}`, title: `Article ${ref}`,
           icon: 'product', containerType: 'article-list', recordId: ref
         });
       }
     }
     this.recorded = new Set(open);
   });
   ```

## 5. Tests attendus (Vitest)

Répliquer les specs d'`orders/` (et de `users/` pour la page) :
- **store** : tri (multi-colonnes), filtres (énum / dates / montant), pagination,
  colonnes (ordre + visibilité + largeurs + garde-fous), `snapshot`/`hydrate`,
  brouillons/dirty (`dirtyKeys`, `hasDirty`, reset à l'annulation).
- **page (intégration DOM)** : pastille dirty de bout en bout — modifier un
  brouillon allume ① la pastille de l'onglet interne Détail, ② `tab.dirty` de
  l'onglet du workspace (via l'`effect` `setDirty`) et ③ le point sur la ligne
  de la liste ; l'annulation efface les trois. Modèle :
  `users/pages/users-page.spec.ts`.
- **mapper** : DTO → domaine + gardes `parseSynced*`.
- **registry** : instance par onglet, indépendance, libération à la fermeture,
  **réouverture d'une fiche récente** (crée le conteneur + ouvre le détail),
  **hydratation d'un onglet détaché lue depuis un `computed`** (garde anti-`NG0600` :
  lire `forTab` dans `computed(() => …)` avec un onglet portant un `state`, et
  vérifier l'absence d'exception — cf. `orders-screen.registry.spec.ts`).

Lancer un seul fichier : `ng test --include '**/article-screen.store.spec.ts'`.

## 6. Vérification & critères d'acceptation

```bash
npm test        # toute la suite doit rester verte
npm run build   # build de production (AOT) sans erreur
```

Checklist finale :

- [ ] Décisions §1 figées (nom, `TabType`, clé, colonnes, filtres, icône).
- [ ] Fichiers feature créés (§2) — domaine ≠ DTO, mapping explicite.
- [ ] `TabType`, icône, `tab-content`, side-bar (Modules **et** recherche) câblés (§3).
- [ ] Sync données, détachement, ouvreur fiches récentes enregistrés (§4).
- [ ] Pastille dirty câblée aux **4 niveaux** (§4.3 : store, `effect` `setDirty`
      de la page, onglets internes, colonne indicateur de la liste) + test
      d'intégration de la page.
- [ ] `forTab` hydrate dans `untracked()` + garde anti-`NG0600` testée (§4.2, §7).
- [ ] Détachement vérifié **dans une vraie fenêtre détachée** (console sans
      erreur, onglets internes et données présents) — pas seulement en unit test.
- [ ] Sécurité Electron intacte (aucune primitive Node/IPC exposée ; payloads validés).
- [ ] Tests ajoutés et **verts** ; **build vert**.
- [ ] Ouverture, tri, filtres, pagination, colonnes, détachement, fiches récentes
      vérifiés dans l'app (au moins l'ouverture + une fiche).

## 7. Pièges connus (non bloquants)

- **Synonymes** : vérifier les synonymes/collisions de libellé avant de coder
  (décidé pour l'entité produit : « Articles » / `article-list`).
- **Budget de style** : un CSS de liste copié d'`orders` déclenche l'**avertissement**
  `anyComponentStyle` (> 4 kB, < 8 kB erreur) — rogner ou accepter.
- **Pas de socle générique** : c'est une **copie-adaptation** de ~12 fichiers, pas
  une extension de base. Envisager une extraction générique après 2-3 entités.
- **Modèle fiche** : détails **dans** le conteneur liste (patron orders). Une fiche
  totalement autonome (`*-editor`) est un chantier distinct.
- **Router inutilisé** : ne pas ajouter de route ; la résolution passe par
  `tab-content`.
- **Hydratation dans un `computed` (`NG0600`)** : `forTab` étant lu depuis le
  `computed` `screen` de la page, l'hydratation (qui écrit des signals) **doit**
  s'exécuter dans `untracked()` (cf. §4.2). Sinon, le détachement casse
  **silencieusement** : onglet détail perdu, corps d'écran vide, exception
  visible **uniquement** dans la console de la fenêtre détachée (pas en unit
  test si `hydrate` est appelé hors computed). Régression déjà rencontrée sur
  Commandes.
```
