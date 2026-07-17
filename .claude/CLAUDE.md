# CLAUDE.md

## Commands

```bash
npm start                          # ng serve — dev server at http://localhost:4200
npm run build                      # ng build — production build to dist/desktop-app/browser/
npm run watch                      # ng build --watch --configuration development
npm test                           # ng test — unit tests via Vitest (@angular/build:unit-test builder)
ng test --include '**/app.spec.ts' # run a single test file
npm run electron:dev               # dev complet : ng serve + Electron (ELECTRON_RENDERER_URL)
npm run electron                   # Electron seul (prod : charge dist/, faire `npm run build` avant)
npm run dist                       # build Angular + Electron Builder → release/ (installeur NSIS)
npm run dist:dir                   # idem sans installeur (release/win-unpacked/ seulement)
```

Packaging (Electron Builder, config dans le champ `build` de package.json) :
sortie dans `release/` (gitignoré) — `win-unpacked/Desktop App.exe` (app dépaquetée)
et `Desktop App Setup <version>.exe` (installeur NSIS). Icône applicative non
définie (icône Electron par défaut) ; binaires non signés pour distribution
(pas de certificat de signature de code configuré).

⚠️ `angular.json` définit `baseHref: "./"` (options communes du build) : requis
pour que les ressources se résolvent en `file://` dans l'app packagée
(`<base href="/">` casserait tous les chargements de scripts/styles).

Détails complets (config, vérification du binaire, pièges, reste à faire) :
`docs/electron-build.md`.

---

## État actuel du dépôt

Les sections suivantes décrivent la **cible** ; état réel du dépôt (juillet 2026) :

- scaffold Angular 21 : standalone components, signals, zoneless, Tailwind CSS v4 via PostCSS (pas de tailwind.config) ;
- shell Electron minimal à la racine : `electron/main.cjs` (une seule fenêtre, un seul canal IPC `app:get-version`) et `electron/preload.cjs` (expose `window.desktopAPI`) ;
- tests unitaires : Vitest via le builder `@angular/build:unit-test` ;
- packaging : Electron Builder installé et configuré (`npm run dist`, cible NSIS Windows, sortie `release/`) ;
- pas encore installés : NgRx SignalStore, Dexie, Fluent UI, Angular Split, Playwright.

---

## Objectif du projet

Construire une application desktop métier de type ERP avec une expérience utilisateur proche d’un IDE moderne comme Visual Studio Code.

L’application doit permettre :

- l’ouverture simultanée de nombreux écrans métier ;
- l’utilisation de plusieurs fenêtres natives ;
- le détachement d’onglets dans de nouvelles fenêtres ;
- le déplacement et la réorganisation des onglets ;
- la synchronisation de l’état entre plusieurs fenêtres ;
- la persistance de l’espace de travail ;
- une interface professionnelle, accessible et adaptée aux applications de gestion lourdes ;
- une architecture front cohérente avec un backend DDD / Clean Architecture.

Le projet doit rester maintenable, testable, sécurisé et extensible.

---

## Stack technique cible

### Desktop

- Electron
- Electron Builder pour le packaging
- BrowserWindow pour les fenêtres natives
- Electron IPC pour la communication entre processus et entre fenêtres
- Electron Menu API pour les menus natifs
- Notifications, impression et accès aux ressources locales via le processus principal

### Frontend

- Angular moderne, version 20 ou supérieure
- Priorité à Angular 21 lorsque l’écosystème du projet le permet
- Standalone components
- Angular Signals
- NgRx SignalStore pour les états applicatifs complexes
- RxJS uniquement pour les flux asynchrones complexes, temps réel ou événementiels
- Angular CDK Drag and Drop
- Fluent UI pour l’interface
- Angular Split ou une solution équivalente pour les layouts divisibles
- HttpClient pour les appels REST
- IndexedDB avec Dexie pour le cache local et les besoins offline

### Backend attendu

Le frontend consomme une API métier externe :

- ASP.NET Core REST API
- OAuth2 / OpenID Connect
- JWT
- architecture DDD / Clean Architecture
- EF Core
- SQL Server
- SignalR lorsque des mises à jour temps réel sont nécessaires

Le backend ne fait pas partie du processus Electron et doit rester indépendant du frontend desktop.

### Tests et automatisation

- tests unitaires Angular avec Vitest (déjà configuré via le builder `@angular/build:unit-test`) ;
- tests end-to-end avec Playwright ;
- tests Electron pour les parcours multi-fenêtres critiques ;
- CI/CD avec GitHub Actions ou Azure DevOps ;
- packaging avec Electron Builder.

---

## Principes d’architecture

L’application doit être séparée en trois contextes stricts :

```text
Electron Main
    |
    | IPC sécurisé
    v
Electron Preload
    |
    | API limitée exposée via contextBridge
    v
Angular Renderer
```

### Electron Main

Le processus principal est responsable de :

- la création, la fermeture et le suivi des fenêtres ;
- la gestion du cycle de vie Electron ;
- la gestion des menus natifs ;
- l’accès au système d’exploitation ;
- l’accès contrôlé aux fichiers ;
- l’impression ;
- les notifications natives ;
- le packaging ;
- la persistance globale du workspace si elle dépend du système ;
- la validation des messages IPC ;
- la synchronisation inter-fenêtres ;
- la gestion des raccourcis globaux lorsque nécessaire.

Le processus principal ne doit pas contenir de logique d’interface Angular.

### Electron Preload

Le preload est responsable de :

- l’exposition d’une API minimale au renderer ;
- l’utilisation de `contextBridge` ;
- la validation des canaux IPC autorisés ;
- la conversion des appels Angular en messages IPC ;
- l’abonnement sécurisé aux événements provenant du processus principal ;
- l’absence d’exposition directe des primitives Node.js.

Aucun objet Electron complet ne doit être exposé au renderer.

### Angular Renderer

Angular est responsable de :

- l’interface utilisateur ;
- les pages métier ;
- les composants Fluent UI ;
- les stores de feature ;
- la navigation interne ;
- les formulaires ;
- le drag-and-drop des onglets ;
- les layouts divisibles ;
- les appels API ;
- le cache local ;
- la représentation de l’espace de travail ;
- les interactions avec l’API Electron exposée par le preload.

Angular ne doit jamais accéder directement à Node.js, au système de fichiers ou à Electron.

---

## Sécurité Electron obligatoire

Toujours respecter les paramètres suivants :

```typescript
new BrowserWindow({
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
});
```

Règles obligatoires :

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` sauf justification technique documentée
- aucune utilisation de `remote`
- aucune interpolation non contrôlée dans les URLs chargées
- aucune exécution de contenu distant non maîtrisé
- aucune API Node.js disponible directement dans Angular
- liste blanche stricte des canaux IPC
- validation systématique des payloads IPC
- validation des chemins de fichiers
- interdiction de transmettre des secrets dans les logs
- CSP restrictive
- navigation externe bloquée ou explicitement autorisée
- ouverture des liens externes via une API contrôlée
- permissions Electron explicitement gérées
- séparation claire entre données fiables et données utilisateur

Toutes les données reçues par IPC doivent être considérées comme non fiables et validées.

---

## Architecture Angular

Utiliser une architecture feature-first orientée domaine.

Arborescence cible :

```text
src/
├── app/
│   ├── core/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── electron/
│   │   ├── errors/
│   │   ├── logging/
│   │   ├── routing/
│   │   └── workspace/
│   │
│   ├── shared/
│   │   ├── components/
│   │   ├── directives/
│   │   ├── pipes/
│   │   ├── models/
│   │   └── utilities/
│   │
│   ├── shell/
│   │   ├── navigation/
│   │   ├── command-bar/
│   │   ├── status-bar/
│   │   ├── tab-strip/
│   │   ├── split-layout/
│   │   └── quick-open/
│   │
│   └── features/
│       ├── customers/
│       ├── products/
│       ├── orders/
│       └── inventory/
│
└── environments/
```

Le code Electron vit à la **racine du dépôt** (hors de `src/`, qui est le `sourceRoot` Angular — il n'est pas compilé par le build Angular) :

```text
electron/
├── main/
├── preload/
├── ipc/
├── windows/
├── persistence/
└── security/
```

Structure recommandée pour une feature :

```text
customers/
├── models/
├── data-access/
├── services/
├── store/
├── components/
├── pages/
├── routes/
└── mappers/
```

### Règles de dépendance

- `features` peut dépendre de `shared` et `core`.
- `shared` ne doit dépendre d’aucune feature.
- une feature ne doit pas importer directement les composants internes d’une autre feature ;
- les échanges inter-features passent par des contrats, des services applicatifs ou le workspace ;
- `core` contient uniquement les services singleton et les abstractions transverses ;
- les composants UI ne contiennent pas de logique métier complexe ;
- les modèles API sont séparés des modèles de domaine front ;
- les DTO backend sont convertis via des mappers explicites.

---

## Standalone components

Tous les nouveaux composants Angular doivent être standalone.

Ne pas créer de NgModule métier sauf nécessité imposée par une bibliothèque.

Utiliser le lazy loading par routes pour les features lourdes.

Exemple :

```typescript
export const routes: Routes = [
  {
    path: 'customers',
    loadComponent: () =>
      import('./features/customers/pages/customer-list.page')
        .then(m => m.CustomerListPage)
  }
];
```

---

## Gestion d’état

### Signals

Utiliser Angular Signals pour :

- l’état local des composants ;
- les valeurs dérivées ;
- l’état d’interface ;
- les sélections ;
- les filtres ;
- la visibilité des panneaux ;
- les états de formulaire simples ;
- les stores de feature lorsque leur complexité reste modérée.

Privilégier :

- `signal`
- `computed`
- `effect`
- `linkedSignal` lorsque pertinent
- les APIs de ressources Angular si elles sont stables dans la version utilisée

Éviter les `subscribe()` manuels lorsque des Signals ou les helpers d’interop Angular suffisent.

### NgRx SignalStore

Utiliser NgRx SignalStore lorsque :

- l’état est partagé par plusieurs composants d’une feature ;
- les transitions d’état deviennent complexes ;
- les commandes asynchrones doivent être structurées ;
- des entités doivent être normalisées ;
- les états de chargement, erreur et synchronisation doivent être centralisés.

### RxJS

Conserver RxJS pour :

- les flux temps réel ;
- SignalR ;
- les événements complexes ;
- les annulations ;
- la combinaison de plusieurs flux asynchrones ;
- les scénarios de retry, debounce ou orchestration ;
- les APIs Electron ou navigateur naturellement orientées événements.

Ne pas remplacer systématiquement RxJS par Signals lorsque le problème est réellement un flux.

---

## Fluent UI

Fluent UI est le design system principal.

> Note : il n'existe pas de bibliothèque Fluent UI officielle pour Angular (Fluent UI est React ou Web Components). L'intégration cible passe par `@fluentui/web-components` (custom elements + `CUSTOM_ELEMENTS_SCHEMA`) derrière des wrappers Angular applicatifs — à valider avant de démarrer le shell.

À utiliser en priorité pour :

- DataGrid
- formulaires
- boutons
- menus
- dialogues
- panneaux
- navigation
- command bars
- tree views
- notifications
- personas
- états de chargement
- composants accessibles

L’interface doit être :

- professionnelle ;
- dense sans être illisible ;
- cohérente ;
- accessible au clavier ;
- compatible avec les lecteurs d’écran ;
- adaptée aux grands volumes de données ;
- compatible avec les thèmes clair et sombre ;
- cohérente entre Windows, macOS et Linux.

Créer des wrappers applicatifs lorsque Fluent UI ne couvre pas directement un besoin ou lorsque l’application doit imposer des conventions communes.

Ne pas disséminer des styles ad hoc dans toute l’application.

---

## Gestion des onglets

Le shell doit permettre d’ouvrir plusieurs écrans métier sous forme d’onglets.

Modèle recommandé :

```typescript
export interface WorkspaceTab {
  id: string;
  type: string;
  title: string;
  route?: string;
  entityId?: string;
  icon?: string;
  closable: boolean;
  dirty: boolean;
  pinned: boolean;
  detached: boolean;
  windowId?: string;
  state?: Record<string, unknown>;
}
```

Chaque onglet doit avoir un identifiant stable.

Un onglet peut représenter :

- une liste ;
- une fiche métier ;
- un tableau de bord ;
- un écran de recherche ;
- un document ;
- un écran de configuration ;
- un écran temporaire.

Le registre des types d’onglets doit permettre de résoudre un type logique vers un composant ou une route sans transmettre directement des classes Angular via IPC.

Exemple :

```typescript
export interface TabDescriptor {
  id: string;
  type: 'customer-editor';
  title: string;
  entityId: string;
}
```

Ne jamais tenter de sérialiser un composant Angular dans IPC.

---

## Drag-and-drop des onglets

Utiliser Angular CDK Drag and Drop pour :

- la réorganisation des onglets ;
- le déplacement d’un onglet entre groupes ;
- le déplacement entre zones de split ;
- la détection d’une intention de détachement.

Le détachement ne doit pas dépendre uniquement d’un événement imprécis de sortie de zone.

Prévoir une stratégie robuste :

- suivi du pointeur pendant le drag ;
- détection du franchissement des limites de la fenêtre ;
- seuil avant détachement ;
- annulation possible ;
- restauration de l’onglet si la création de fenêtre échoue ;
- prévention des doubles créations ;
- gestion des écrans multiples ;
- prise en compte du zoom et du device pixel ratio.

---

## Multi-fenêtrage Electron

L’application doit prendre en charge au minimum deux fenêtres natives et pouvoir évoluer vers davantage.

Chaque fenêtre charge l’application Angular avec un contexte de workspace.

Architecture cible :

```text
Electron Main
├── WindowManager
│   ├── MainWindow
│   ├── DetachedTabWindow
│   └── SecondaryWorkspaceWindow
├── IpcRouter
├── WorkspaceRegistry
└── PersistenceService
```

### WindowManager

Créer un service central dans Electron Main chargé de :

- créer les fenêtres ;
- enregistrer les fenêtres ;
- attribuer un identifiant stable à chaque fenêtre ;
- suivre leur position et leur taille ;
- transmettre leur contexte initial ;
- gérer les fermetures ;
- restaurer les fenêtres au démarrage ;
- éviter les fenêtres orphelines ;
- gérer les écrans multiples ;
- déplacer une fenêtre sur un écran encore disponible si un écran a disparu.

Exemple de contexte :

```typescript
export interface WindowContext {
  windowId: string;
  workspaceId: string;
  mode: 'main' | 'detached-tab' | 'secondary-workspace';
  initialTabId?: string;
}
```

### Création d’une fenêtre détachée

Le renderer demande la création d’une fenêtre via l’API preload :

```typescript
await window.desktopAPI.windows.detachTab({
  tabId,
  sourceWindowId,
  screenPosition
});
```

Le processus principal :

1. valide la requête ;
2. récupère l’état de l’onglet ;
3. crée une nouvelle BrowserWindow ;
4. associe la fenêtre à l’onglet ;
5. attend que le nouveau renderer soit prêt ;
6. transfère le contexte ;
7. confirme le détachement à la fenêtre source ;
8. remet l’onglet dans la fenêtre source si l’opération échoue.

La mutation d’état doit être transactionnelle autant que possible.

---

## Communication inter-fenêtres

Les Signals Angular ne sont pas partagés entre fenêtres.

Chaque fenêtre Angular possède :

- sa propre instance Angular ;
- sa propre mémoire ;
- ses propres Signals ;
- son propre store de renderer.

La synchronisation doit passer par Electron Main ou par une couche de persistance partagée.

Flux recommandé :

```text
Renderer A
   |
   | commande IPC
   v
Electron Main
   |
   | validation + mutation du registre
   v
Workspace Registry
   |
   | événement ciblé ou broadcast
   v
Renderer A / Renderer B / Renderer C
```

### Catégories de messages IPC

Séparer clairement :

- commandes ;
- requêtes ;
- événements.

Exemple :

```typescript
type WorkspaceCommand =
  | { type: 'tab/detach'; payload: DetachTabRequest }
  | { type: 'tab/move'; payload: MoveTabRequest }
  | { type: 'tab/close'; payload: CloseTabRequest };

type WorkspaceEvent =
  | { type: 'tab/detached'; payload: TabDetachedEvent }
  | { type: 'tab/moved'; payload: TabMovedEvent }
  | { type: 'tab/updated'; payload: TabUpdatedEvent };
```

Éviter les noms de canaux dispersés sous forme de chaînes magiques.

Centraliser les contrats IPC dans une bibliothèque ou un dossier partagé ne dépendant ni d’Angular ni d’Electron Main.

Valider les payloads avec une solution de schéma explicite.

---

## API preload recommandée

Exposer une API typée et minimale.

Exemple conceptuel :

```typescript
export interface DesktopApi {
  app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<string>;
  };

  windows: {
    getContext(): Promise<WindowContext>;
    detachTab(request: DetachTabRequest): Promise<DetachTabResult>;
    focusWindow(windowId: string): Promise<void>;
    closeWindow(windowId: string): Promise<void>;
  };

  workspace: {
    getSnapshot(workspaceId: string): Promise<WorkspaceSnapshot>;
    dispatch(command: WorkspaceCommand): Promise<CommandResult>;
    onEvent(listener: (event: WorkspaceEvent) => void): () => void;
  };

  files: {
    openFile(options: OpenFileOptions): Promise<OpenFileResult>;
    saveFile(options: SaveFileOptions): Promise<SaveFileResult>;
  };
}
```

Chaque abonnement doit retourner une fonction de désabonnement.

Déclarer les types globaux Angular dans un fichier dédié :

```typescript
declare global {
  interface Window {
    desktopAPI: DesktopApi;
  }
}
```

Ne pas exposer `ipcRenderer` directement.

---

## Workspace et persistance

Le workspace représente l’état de travail de l’utilisateur.

Exemple :

```typescript
export interface WorkspaceSnapshot {
  version: number;
  workspaceId: string;
  activeWindowId?: string;
  windows: WorkspaceWindowState[];
}
```

```typescript
export interface WorkspaceWindowState {
  id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  maximized: boolean;
  fullscreen: boolean;
  activeTabId?: string;
  layout: WorkspaceLayout;
}
```

Le layout doit pouvoir représenter :

- plusieurs groupes d’onglets ;
- des splits horizontaux ;
- des splits verticaux ;
- les ratios de panneaux ;
- les onglets actifs ;
- les onglets épinglés ;
- les onglets détachés.

Prévoir une version de schéma et des migrations.

Ne jamais supposer que le snapshot sauvegardé est valide.

Au démarrage :

1. charger le snapshot ;
2. valider sa version ;
3. migrer si nécessaire ;
4. vérifier les écrans disponibles ;
5. corriger les positions hors écran ;
6. restaurer les fenêtres ;
7. restaurer les onglets ;
8. sélectionner un état par défaut si la restauration échoue.

---

## Split editor

Le workspace doit prendre en charge des groupes d’onglets divisibles.

Exemples :

```text
+----------------------+----------------------+
| Client               | Commande             |
|                      |                      |
+----------------------+----------------------+
```

```text
+---------------------------------------------+
| Client                                      |
+---------------------------------------------+
| Historique                                  |
+---------------------------------------------+
```

Le modèle de layout doit être indépendant de la bibliothèque UI choisie.

Exemple :

```typescript
export type WorkspaceLayout =
  | {
      kind: 'group';
      id: string;
      tabs: string[];
      activeTabId?: string;
    }
  | {
      kind: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      ratio: number;
      first: WorkspaceLayout;
      second: WorkspaceLayout;
    };
```

---

## Raccourcis clavier

Prévoir au minimum :

- `Ctrl+P` ou `Cmd+P` : ouverture rapide ;
- `Ctrl+W` ou `Cmd+W` : fermer l’onglet actif ;
- `Ctrl+Tab` : onglet suivant ;
- `Ctrl+Shift+Tab` : onglet précédent ;
- `Ctrl+Shift+F` ou `Cmd+Shift+F` : recherche globale ;
- raccourci pour détacher un onglet ;
- raccourci pour déplacer un onglet vers une autre fenêtre ;
- raccourci pour créer un split ;
- raccourci pour naviguer entre groupes ;
- raccourci pour restaurer le dernier onglet fermé si nécessaire.

Centraliser la gestion des raccourcis.

Prendre en compte Windows, Linux et macOS.

Ne pas disperser les `HostListener` dans de nombreux composants.

---

## API et modèles

Ne jamais utiliser directement les DTO backend comme modèles de domaine du renderer.

Séparer :

```text
API DTO
   |
   v
Mapper
   |
   v
Frontend Domain Model
   |
   v
View Model
```

Règles :

- aucun modèle EF Core exposé ;
- pas de logique métier backend reproduite arbitrairement dans l’UI ;
- mapping explicite ;
- erreurs API normalisées ;
- gestion standardisée des états loading / success / error ;
- annulation des appels lorsqu’un écran est détruit ;
- retries uniquement lorsqu’ils sont justifiés ;
- pas de retry aveugle sur les commandes métier non idempotentes.

---

## Authentification

Utiliser OAuth2 / OpenID Connect avec JWT.

Principes :

- privilégier Authorization Code Flow avec PKCE ;
- ne pas stocker les tokens dans `localStorage` ;
- préférer un stockage sécurisé adapté au système ;
- isoler les secrets côté main process lorsque possible ;
- renouvellement de token centralisé ;
- déconnexion propagée à toutes les fenêtres ;
- expiration de session gérée proprement ;
- fermeture ou verrouillage des écrans protégés après déconnexion ;
- ne jamais journaliser les tokens.

---

## Offline et cache local

Utiliser IndexedDB avec Dexie pour :

- le cache des référentiels ;
- la consultation de données récemment utilisées ;
- la file d’attente locale lorsque le mode offline est explicitement requis ;
- la persistance d’états de formulaire si cela est fonctionnellement autorisé.

Toute synchronisation offline doit prévoir :

- un identifiant d’opération ;
- l’idempotence ;
- la gestion des conflits ;
- les statuts pending / syncing / failed / completed ;
- la reprise après interruption ;
- l’affichage clair de l’état de synchronisation ;
- une politique de rétention ;
- le chiffrement si des données sensibles sont stockées.

Ne pas implémenter une synchronisation offline implicite sans règles métier définies.

---

## Fichiers, impression et exports

Les opérations suivantes passent par le preload et Electron Main :

- sélection de fichiers ;
- sauvegarde de fichiers ;
- impression ;
- export PDF ;
- export Excel ;
- ouverture dans une application externe ;
- accès à des dossiers ;
- téléchargement local.

Valider :

- le type MIME ;
- l’extension ;
- la taille ;
- le chemin ;
- les autorisations ;
- l’origine du contenu.

Ne jamais laisser Angular écrire directement sur le système de fichiers.

---

## Conventions TypeScript

- activer le mode strict ;
- éviter `any` ;
- préférer `unknown` pour les données externes ;
- typer tous les contrats IPC ;
- utiliser des unions discriminées ;
- privilégier les fonctions pures pour les transformations ;
- limiter les classes aux cas où elles apportent une valeur réelle ;
- utiliser `readonly` lorsque possible ;
- ne pas ignorer les erreurs de promesses ;
- ne pas utiliser d’assertions non nulles sans justification ;
- documenter les invariants complexes ;
- conserver des fichiers de taille raisonnable ;
- éviter les dépendances circulaires.

---

## Conventions Angular

- composants standalone ;
- change detection moderne ;
- Signals pour l’état local ;
- `@if`, `@for` et `@switch` pour les nouveaux templates ;
- `track` obligatoire dans les listes ;
- `inject()` lorsque cela améliore la lisibilité ;
- pas de logique métier importante dans les templates ;
- pas de souscriptions non nettoyées ;
- destruction via les APIs Angular prévues ;
- lazy loading des features ;
- routes typées autant que possible ;
- formulaires réactifs pour les écrans métier complexes ;
- validation synchrone et asynchrone explicite ;
- composants conteneurs séparés des composants de présentation lorsque cela clarifie le code.

---

## Conventions Electron

- un `WindowManager` central ;
- un `IpcRouter` central ;
- aucun `ipcMain.handle` dispersé arbitrairement ;
- canaux IPC constants et typés ;
- BrowserWindow créé uniquement par le main process ;
- destruction explicite des listeners ;
- fermeture propre de l’application ;
- gestion du cycle de vie macOS ;
- single instance lock si requis ;
- gestion des deep links si requis ;
- logs séparés par contexte ;
- crash handling ;
- mises à jour automatiques uniquement lorsqu’une stratégie de signature et de déploiement est définie.

---

## Gestion des erreurs

Créer un modèle d’erreur commun :

```typescript
export interface AppError {
  code: string;
  message: string;
  technicalMessage?: string;
  correlationId?: string;
  recoverable: boolean;
}
```

Les erreurs doivent être :

- journalisées dans le contexte approprié ;
- transformées en messages compréhensibles ;
- associées à un identifiant de corrélation si disponible ;
- propagées sans exposer de secrets ;
- récupérables lorsque possible ;
- affichées via des composants Fluent UI cohérents.

Les erreurs IPC doivent être sérialisables.

---

## Journalisation

Prévoir des logs distincts :

- Electron Main ;
- Preload ;
- Renderer Angular ;
- appels API ;
- synchronisation offline ;
- gestion des fenêtres ;
- restauration du workspace.

Les logs doivent inclure lorsque pertinent :

- timestamp ;
- niveau ;
- contexte ;
- fenêtre ;
- workspace ;
- feature ;
- correlation ID.

Ne jamais journaliser :

- tokens ;
- mots de passe ;
- secrets ;
- données personnelles sensibles ;
- contenu métier complet sans nécessité.

---

## Performance

L’application vise des usages ERP lourds.

Prévoir :

- lazy loading ;
- virtualisation des grandes listes ;
- pagination serveur ;
- tri et filtres côté serveur lorsque les volumes le nécessitent ;
- mise en cache maîtrisée ;
- réduction des broadcasts IPC ;
- événements ciblés par workspace ou fenêtre ;
- snapshots incrémentaux lorsque pertinent ;
- debounce sur la persistance du layout ;
- suivi des fuites mémoire ;
- désabonnement des listeners ;
- destruction correcte des stores de fenêtre ;
- limitation du nombre de composants lourds gardés en mémoire.

Un onglet masqué ne doit pas nécessairement rester entièrement monté si cela dégrade les performances.

Définir une stratégie explicite de conservation ou de recréation de l’état.

---

## Accessibilité

Respecter au minimum :

- navigation clavier complète ;
- focus visible ;
- ordre de tabulation cohérent ;
- rôles ARIA corrects ;
- libellés associés aux champs ;
- annonces pour les changements importants ;
- contrastes suffisants ;
- taille de cible suffisante ;
- raccourcis documentés ;
- comportement cohérent des dialogues ;
- focus restauré après fermeture ;
- compatibilité lecteur d’écran ;
- support du zoom.

Le drag-and-drop doit avoir une alternative clavier.

---

## Tests attendus

### Tests unitaires

Tester :

- stores Signals ;
- reducers ou mutations de SignalStore ;
- mappers ;
- validateurs ;
- modèles de layout ;
- migrations de workspace ;
- services Angular ;
- gestion des erreurs ;
- contrats de sérialisation.

### Tests Electron

Tester :

- création de fenêtre ;
- détachement d’onglet ;
- rattachement ou déplacement d’onglet ;
- fermeture de fenêtre ;
- restauration du workspace ;
- écrans multiples ;
- disparition d’un écran ;
- échec de création d’une fenêtre ;
- synchronisation entre fenêtres ;
- nettoyage des listeners.

### Tests end-to-end

Tester les scénarios critiques :

1. ouvrir plusieurs onglets ;
2. réordonner les onglets ;
3. créer un split ;
4. détacher un onglet ;
5. modifier une donnée dans une fenêtre ;
6. vérifier la mise à jour dans une autre fenêtre ;
7. fermer et relancer l’application ;
8. vérifier la restauration ;
9. se déconnecter ;
10. vérifier que toutes les fenêtres reviennent à un état sécurisé.

---

## Critères d’acceptation principaux

Le projet est considéré conforme lorsque :

- l’application démarre via Electron ;
- Angular ne dispose d’aucun accès Node.js direct ;
- au moins deux BrowserWindow peuvent être ouvertes ;
- un onglet peut être détaché dans une nouvelle fenêtre ;
- les fenêtres possèdent un identifiant stable ;
- les événements inter-fenêtres sont synchronisés par IPC ;
- un changement métier pertinent peut être reflété dans plusieurs fenêtres ;
- les listeners sont nettoyés à la destruction ;
- l’espace de travail est sauvegardé ;
- les fenêtres et onglets sont restaurés ;
- les positions hors écran sont corrigées ;
- les onglets sont réorganisables par drag-and-drop ;
- les groupes peuvent être divisés horizontalement et verticalement ;
- les raccourcis principaux fonctionnent ;
- l’interface utilise Fluent UI ;
- l’état local utilise Signals ;
- l’état complexe utilise SignalStore lorsque justifié ;
- les appels API utilisent des DTO et des mappers ;
- la sécurité Electron est respectée ;
- les tests critiques passent ;
- le packaging fonctionne sur les plateformes ciblées.

---

## Décisions par défaut

En l’absence d’instruction contraire :

- privilégier une architecture simple avant d’ajouter une abstraction ;
- choisir les APIs Angular modernes et stables ;
- utiliser Signals pour l’état local ;
- utiliser SignalStore pour les features complexes ;
- utiliser RxJS pour les flux ;
- centraliser IPC et gestion des fenêtres ;
- garder le preload minimal ;
- modéliser les onglets avec des données sérialisables ;
- considérer Electron Main comme autorité pour le registre des fenêtres ;
- considérer l’API backend comme autorité pour les données métier ;
- ne pas dupliquer les règles métier du backend ;
- préserver l’accessibilité ;
- écrire des tests pour toute logique de workspace ou multi-fenêtres ;
- documenter toute dérogation de sécurité.

---

## Ce qu’il ne faut pas faire

Ne pas :

- activer `nodeIntegration` ;
- désactiver `contextIsolation` ;
- exposer `ipcRenderer` directement ;
- partager des objets non sérialisables via IPC ;
- tenter de partager un Signal Angular entre fenêtres ;
- stocker les tokens dans `localStorage` ;
- mettre la logique métier dans Electron Main ;
- mettre toute l’application dans un unique store global ;
- utiliser RxJS partout par habitude ;
- utiliser Signals pour remplacer artificiellement tous les flux ;
- importer directement les internals d’une autre feature ;
- conserver des chaînes IPC non typées dispersées ;
- sauvegarder le workspace sans version ;
- restaurer aveuglément des positions de fenêtres ;
- ignorer les cas d’échec de détachement ;
- bloquer le thread principal avec des opérations lourdes ;
- envoyer de gros volumes de données en broadcast à toutes les fenêtres ;
- créer des composants UI non accessibles ;
- exposer les modèles EF Core ou backend directement au frontend.

---

## Méthode de travail attendue de Claude Code

Lors de toute modification :

1. lire les fichiers concernés avant de proposer une solution ;
2. respecter l’architecture existante ;
3. éviter les refactorings sans rapport avec la demande ;
4. expliquer brièvement les décisions structurantes ;
5. conserver la compatibilité multi-fenêtres ;
6. vérifier les impacts sur IPC ;
7. vérifier les impacts sur la persistance du workspace ;
8. vérifier la sécurité Electron ;
9. ajouter ou mettre à jour les tests ;
10. lancer les vérifications disponibles ;
11. signaler les hypothèses et limites ;
12. ne pas inventer d’API ou de fichier existant ;
13. préférer des changements incrémentaux et réversibles.

Avant de créer une nouvelle dépendance :

- vérifier si le besoin est déjà couvert ;
- évaluer sa maintenance ;
- vérifier sa compatibilité Angular / Electron ;
- vérifier son impact sur le bundle ;
- vérifier sa licence ;
- justifier son ajout.

Lorsqu’une exigence est ambiguë, privilégier la solution la plus sûre, la plus testable et la moins couplée.

---

## Priorités du projet

Ordre de priorité :

1. sécurité Electron ;
2. stabilité des données métier ;
3. fiabilité du multi-fenêtrage ;
4. maintenabilité ;
5. expérience utilisateur ;
6. accessibilité ;
7. performance ;
8. extensibilité ;
9. sophistication visuelle.

Une fonctionnalité multi-fenêtres ne doit jamais compromettre la cohérence des données ni la sécurité.
