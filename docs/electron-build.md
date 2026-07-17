# Electron Build — packaging de l'application desktop

> État : 16 juillet 2026. Décrit le packaging de l'application (Angular 21 +
> Electron 43) en exécutable Windows via **Electron Builder 26**, le piège
> `baseHref` rencontré lors de la mise en place, et la vérification de
> l'exécutable produit.

## 1. Vue d'ensemble

```text
src/  ──ng build──▶  dist/desktop-app/browser/   (bundle Angular, file://)
                              │
electron/ ────────────────────┤
                              │  electron-builder  (config : package.json "build")
                              ▼
release/
├── win-unpacked/Desktop App.exe          app dépaquetée (lançable directement)
├── Desktop App Setup 0.0.0.exe           installeur NSIS (~99 Mo)
└── Desktop App Setup 0.0.0.exe.blockmap  (mises à jour différentielles futures)
```

`release/` est **gitignoré** (artefact généré, comme `dist/`).

## 2. Commandes

```bash
npm run dist       # ng build + electron-builder → installeur NSIS dans release/
npm run dist:dir   # idem sans installeur (release/win-unpacked/ seulement, plus rapide)
```

Rappel des modes d'exécution :

```bash
npm run electron:dev   # dev : ng serve + Electron (ELECTRON_RENDERER_URL=http://localhost:4200)
npm run electron       # prod locale : Electron charge dist/ (faire `npm run build` avant)
```

## 3. Configuration

### 3.1 `package.json` — champ `build`

```json
"build": {
  "appId": "fr.chezandre.desktop-app",
  "productName": "Desktop App",
  "directories": { "output": "release" },
  "files": ["electron/**/*", "dist/desktop-app/browser/**/*"],
  "win": { "target": ["nsis"] },
  "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
}
```

Points clés :

- **`files`** embarque `electron/` et `dist/desktop-app/browser/` dans
  `app.asar` **avec la même arborescence relative qu'à la racine du dépôt** :
  c'est ce qui permet à `electron/main.cjs` de charger
  `path.join(__dirname, '../dist/desktop-app/browser/index.html')` sans
  distinction dev/prod. Toute modification du chemin de sortie Angular
  (`outputPath`) doit être répercutée ici **et** dans `main.cjs`.
- **`main: "electron/main.cjs"`** (racine de package.json) est le point
  d'entrée utilisé à la fois par `electron .` et par le packaging.
- **NSIS `oneClick: false`** : installeur classique avec choix du dossier
  (plus adapté à un poste de gestion qu'une installation silencieuse).

### 3.2 `angular.json` — `baseHref: "./"` (⚠️ indispensable)

```json
"options": { "browser": "src/main.ts", "baseHref": "./", ... }
```

**Le piège rencontré** : sans cette option, l'app packagée s'ouvre sur une
**fenêtre vide**. `index.html` se charge, mais avec `<base href="/">` toutes
les ressources (`main-*.js`, `styles-*.css`, chunks) se résolvent à la
**racine du disque** en `file://` → `ERR_FILE_NOT_FOUND` sur chaque script,
Angular ne démarre jamais. Aucun symptôme en dev (`ng serve` sert en HTTP où
`/` est la racine du serveur).

`baseHref: "./"` rend toutes les URLs relatives au dossier d'`index.html`
(dans `app.asar`) et reste sans effet négatif sur `ng serve`. L'app n'utilise
pas le routeur (résolution des écrans par `tab-content`, cf. fenêtrage), donc
aucune interaction avec des routes profondes.

## 4. Vérifier l'exécutable produit

Le build packagé a des modes de défaillance **invisibles en dev** (chargement
`file://`, asar, chemins) : toujours vérifier le binaire réel, pas seulement
`npm run build`.

1. Lancer l'app dépaquetée avec le débogueur distant :
   ```powershell
   .\release\win-unpacked\'Desktop App.exe' --remote-debugging-port=9223
   ```
2. Vérifier `http://localhost:9223/json/list` : la page doit pointer sur
   `file:///…/app.asar/dist/desktop-app/browser/index.html`.
3. Contrôles minimaux (console DevTools ou script CDP) :
   - l'écran **Bienvenue** est rendu (Angular a démarré — c'est ce contrôle
     qui attrape le bug `baseHref`) ;
   - `window.desktopAPI.app.getVersion()` répond (preload + IPC OK) ;
   - ouvrir **Commandes** → la liste affiche des lignes ;
   - **détacher un onglet** → 2 fenêtres natives, onglets internes transférés
     (le multi-fenêtres fonctionne en `file://`).

Vérification effectuée le 16/07/2026 : tous les contrôles passent, y compris
le détachement d'onglet dans le binaire packagé.

## 5. Limites actuelles / reste à faire

| Sujet | État | Piste |
|-------|------|-------|
| **Icône applicative** | Icône Electron par défaut (`default Electron icon is used`) | Fournir `build.win.icon` (`.ico` ≥ 256px) |
| **Signature de code** | Binaires non signés pour distribution (electron-builder appose au mieux une signature locale de dev) — **SmartScreen avertira** sur un poste tiers | Certificat de signature de code (EV ou standard) + config `win.certificateFile`/`signtoolOptions` ; prérequis aussi pour les mises à jour auto (CLAUDE.md : pas de MAJ auto sans stratégie de signature) |
| **Version** | `0.0.0` (jamais incrémentée) — nomme l'installeur | Adopter une politique de version avant toute diffusion |
| **Plateformes** | Cible Windows/NSIS uniquement | Ajouter `mac`/`linux` dans `build` le moment venu (CI multi-OS nécessaire pour macOS) |
| **CI/CD** | Packaging manuel local | Job GitHub Actions/Azure DevOps : `npm ci && npm test && npm run dist` + artefact |
| **Budget CSS `order-list.css`** | Warning connu (> 4 kB) au build prod | Non bloquant, documenté dans gestion-nouvelle-entité §7 |

## 6. Pièges connus (résumé)

- **`baseHref: "./"` obligatoire** — sans lui, fenêtre vide en packagé,
  aucun symptôme en dev (§3.2). Ne pas le retirer d'`angular.json`.
- **Cohérence des chemins** — `build.files`, `main.cjs` (`loadFile`) et le
  `outputPath` Angular décrivent le même chemin `dist/desktop-app/browser/` ;
  les faire évoluer ensemble.
- **Premier run lent** — electron-builder télécharge Electron + NSIS + 7zip ;
  les runs suivants utilisent le cache (`%LOCALAPPDATA%\electron-builder`).
- **Tester le binaire** — un `npm run build` vert ne prouve pas que l'app
  packagée démarre (cf. §4).
