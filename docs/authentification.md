# Authentification (login / session)

Le client consomme l'API d'authentification de **Ref.Api** (dépôt
`C:\Users\py.fevre\source\ReposBA\Ref_BA_Backend_Poc`) : JWT Bearer +
refresh token opaque avec rotation.

## Mise en route (dev)

1. Démarrer Ref.Api (profil `Development` ou `http`) : l'API doit écouter sur
   `http://localhost:5064`. Son `appsettings.Development.json` doit fournir
   `Jwt:SigningKey`, sinon l'auth Bearer n'est pas câblée et tout login échoue.
2. Lancer le client : `npm run electron:dev` (ou `npm start` pour le
   navigateur seul).
3. L'écran de connexion s'affiche tant qu'aucune session n'est établie ;
   se connecter avec un compte existant côté backend. La déconnexion se fait
   par le bouton « Se déconnecter » de la status bar ; le bouton « Changer
   d'utilisateur » voisin empile une nouvelle session sans fermer la première
   (voir « Pile de sessions » ci-dessous).

Trois points de configuration doivent rester alignés sur l'origine de l'API :

| Où | Quoi |
|---|---|
| `src/environments/environment*.ts` | `apiBaseUrl` (dev = `http://localhost:5064`, remplacement dev via `fileReplacements` d'`angular.json`) |
| `src/index.html` (CSP `connect-src`) | origines API autorisées côté client |
| `Cors:AllowedOrigins` (backend) | origine du renderer (`http://localhost:4200` déjà autorisée) |

## Contrat HTTP (camelCase, erreurs en ProblemDetails RFC 7807)

| Endpoint | Corps | Réponse |
|---|---|---|
| `POST /api/auth/login` | `{ email, password }` | `AuthResponseDto` / `401` « Identifiants invalides. » |
| `POST /api/auth/refresh` | `{ refreshToken }` | `AuthResponseDto` (rotation : l'ancien refresh token est révoqué) |
| `POST /api/auth/revoke` | `{ refreshToken }` | `204` (logout, idempotent) |

`AuthResponseDto` : `accessToken` (JWT, 60 min, claims `sub`/`email`/`name`/`perm`),
`accessTokenExpiresAtUtc`, `refreshToken` (opaque, 7 j), `refreshTokenExpiresAtUtc`.

## Architecture côté client

```text
features/auth/
├── pages/login-page                    écran de connexion plein écran (titlebar + carte)
└── components/
    ├── login-form                      formulaire partagé (validation, Annuler optionnel)
    └── user-switch-dialog              dialog modal « Changer d'utilisateur »
core/auth/
├── auth.dto.ts                  contrats HTTP /api/auth/*
├── auth-session.ts              AuthSession, AuthUser, SyncedAuthState (pile)
├── auth.mapper.ts               DTO -> session, décodage claims JWT, garde parseSyncedAuthState
├── auth-api.ts                  appels HTTP bruts (endpoints anonymes)
├── auth.service.ts              autorité de session (signals), pile login/switchUser/logout/refresh
└── auth.interceptor.ts          Bearer + refresh single-flight sur 401 + rejeu
core/api/problem-details.ts      parsing RFC 7807 -> message utilisateur
```

- **Garde d'authentification** : `App` (`app.ts`) rend la page de login tant
  qu'aucune session n'existe ; le shell (et tous les écrans protégés) n'est
  détruit que lorsque la **pile est vide**. La page de login porte sa propre
  bande de titre (fenêtre sans cadre : drag + réduire/fermer).
- **Multi-fenêtres** : la pile entière est publiée sur le bus IPC (sujet
  `auth/state`, forme `{ sessions: AuthSession[] }` validée par
  `parseSyncedAuthState` — une entrée invalide rejette tout le payload).
  Connexion, changement d'utilisateur et déconnexion se propagent à toutes
  les fenêtres ; une fenêtre détachée après coup rattrape l'état retenu par
  Electron Main. Le bus transporte donc N refresh tokens (même modèle de
  confiance qu'avant : mémoire seulement, jamais journalisés).
- **Refresh** : sur `401` d'un appel métier, l'intercepteur déclenche UN
  renouvellement partagé (single-flight dans `AuthService`) puis rejoue la
  requête. Le résultat s'applique **à la session capturée** (retrouvée par son
  refresh token), jamais « au sommet » — la pile peut changer pendant l'appel.
  Refresh rejeté (400/401) → cette session est retirée de la pile partout
  (les autres survivent ; pile vide → retour au login). Erreur réseau →
  session conservée. Pas de rejeu sous l'identité de l'utilisateur précédent :
  le 401 d'origine est propagé.
- **Déconnexion** : dépile la session active (purge locale immédiate +
  publication), `revoke` de son seul refresh token en meilleur effort, puis
  reprise de la session précédente. Bouton dans la status bar.
- **Déconnexion forcée par la maintenance** : l'annonce d'une maintenance ouvre
  un sursis de deux minutes (sessions conservées, `refresh` toujours autorisé
  pour que les enregistrements aboutissent, mais `login` déjà refusé) ; à
  l'échéance `MaintenanceService` appelle `logoutAll()` — TOUTE la pile est
  fermée (un simple dépilement rendrait la main à l'utilisateur précédent) —
  et un voile bloquant recouvre l'écran de connexion. Voir
  `docs/mode-maintenance.md`.

## Pile de sessions — « Changer d'utilisateur »

La session unique a été remplacée par une **pile de sessions** dont le sommet
est la session active (`AuthService.session()`). Sémantique :

| Opération | Effet |
|---|---|
| `login(email, password)` | remplace la pile par `[session]` (appelé pile vide, depuis la page de login) |
| `switchUser(email, password)` | **empile** une nouvelle session ; l'utilisateur précédent reste connecté, inactif. Échec → pile intacte |
| `logout()` | **dépile** le sommet (revoke de son seul token), l'utilisateur précédent redevient actif ; pile vide → page de login |
| `logoutAll()` | vide la pile (revoke best-effort de chaque session) — réservé au gel de maintenance |

Signals exposés en plus : `sessionCount` (taille de la pile) et
`previousUser` (utilisateur repris à la prochaine déconnexion).

Règles :

- **Jamais deux sessions du même utilisateur** : au `switchUser`, une session
  existante du même `user.id` (repli sur l'e-mail si les claims sont
  indécodables) est retirée de la pile et révoquée — « se reconnecter à
  soi-même » rafraîchit simplement sa session.
- **Reprise après dépilement** : les sessions inactives ne sont PAS
  rafraîchies en arrière-plan. Au dépilement, si l'access token repris est
  expiré (marge 30 s), un `refresh` est tenté ; rejet serveur → la session est
  retirée à son tour et on continue avec la suivante (jusqu'à une session
  valide ou une pile vide) ; erreur réseau → session conservée (l'intercepteur
  retentera au premier 401).
- **Le workspace survit à la bascule** : `switchUser` empile avant tout
  dépilement, `isAuthenticated()` ne repasse donc jamais à `false` pendant un
  changement d'utilisateur — le `@if` de `App` ne détruit pas le shell, les
  onglets restent ouverts. Ne jamais implémenter un changement d'utilisateur
  comme « logout puis login ».
- **Les données survivent aussi à la bascule** (choix produit) : les listes
  chargées, les saisies en cours et l'historique des fiches récentes sont
  CONSERVÉS au changement d'utilisateur comme au dépilement — aucun cache
  n'est purgé. Conséquence assumée : des données chargées sous les
  permissions de l'utilisateur précédent restent visibles tant qu'aucun
  rechargement n'a lieu ; les appels API suivants portent en revanche le
  token du nouvel utilisateur actif.
- **Purge à la déconnexion complète uniquement** (pile vide — bouton
  « Se déconnecter » sur la dernière session, ou gel de maintenance) : les
  services concernés se purgent d'eux-mêmes via un `effect` sur
  `auth.user()?.id` qui ne réagit qu'au passage à `null` (comparaison à l'id
  précédent : rien au premier run ni sur rotation de token). Aujourd'hui :
  `UsersService` (liste + cache d'accès, rechargement paresseux, état vidé
  non publié — chaque fenêtre purge via son propre effect) et
  `RecentRecordsService` (`clear()`, publié — historique global).
  `OrdersService` n'est pas purgé : ses données de démo locales simulent
  l'état serveur, qui ne dépend pas de l'utilisateur connecté.

Côté UI (status bar) : nom de l'utilisateur actif + badge `+N` (tooltip
« Reviendra à X ») quand des sessions sont empilées ; bouton « Changer
d'utilisateur » (dialog modal `user-switch-dialog`, rendu par `Shell`, état
d'ouverture porté par `ShellUiService`) ; bouton « Se déconnecter (revient à
X) ». Le dialog refuse la soumission sous maintenance (comme la page de
login) et reste sous le voile de maintenance (z-index 1500 < 2000).

## Tests

Specs Vitest (`ng test --include '**/core/auth/*.spec.ts'`) :

- `auth.mapper.spec.ts` — décodage JWT (UTF-8, tokens malformés), mapping
  DTO → session, garde `parseSyncedAuthState` contre les payloads hostiles
  (pile partielle rejetée en bloc) ;
- `auth.service.spec.ts` — login, `switchUser` (empilement, dédoublonnage par
  utilisateur), `logout` (dépilement, revoke ciblé, reprise avec refresh en
  boucle), `logoutAll`, refresh « par identité » (switchUser intercalé),
  publication/réception de la pile sur le bus (mock de `window.desktopAPI`) ;
- `auth.interceptor.spec.ts` — ajout du Bearer, exclusion des endpoints
  d'auth et des URLs externes, refresh sur 401 + rejeu, refresh rejeté avec
  pile > 1 : 401 propagé sans rejeu sous l'identité précédente ;
- `user-switch-dialog.spec.ts` — soumission/erreur/abandon (Annuler, Échap,
  arrière-plan), refus sous maintenance, focus initial ;
- `status-bar.spec.ts` — libellés, badge de pile, ouverture du dialog,
  déclenchement du dépilement ;
- `users.service.spec.ts` / `recent-records.service.spec.ts` — conservation
  des données à la bascule d'utilisateur, purge à la déconnexion complète
  uniquement (et absence de purge au premier run / sur rotation) ;
- `app.spec.ts` — garde d'authentification (login hors session, shell une
  fois la session établie).

## Dépannage

- **« Impossible de joindre le serveur. »** (statut HTTP 0) : la requête est
  bloquée avant émission ou le serveur ne répond pas. Vérifier dans l'ordre :
  1. l'API tourne : `Invoke-WebRequest http://localhost:5064/api/auth/login
     -Method Post ...` doit renvoyer 400/401 (pas une erreur de connexion) ;
  2. la CSP de `src/index.html` liste l'origine de l'API dans `connect-src`
     (une violation CSP est visible dans la console DevTools) ;
  3. `apiBaseUrl` de l'environnement actif pointe vers la bonne origine.
  Attention : `index.html` n'est pas toujours rechargé à chaud — relancer
  `npm run electron:dev` après modification.
- **« Identifiants invalides. »** (401) : l'API est joignable ; compte ou mot
  de passe erroné côté backend.
- **Tout login échoue alors que les identifiants sont bons** : vérifier
  `Jwt:SigningKey` côté Ref.Api (en Development, sans clé, l'auth n'est pas
  câblée et un avertissement figure dans les logs du backend).
- **Retours intempestifs à l'écran de login** : le refresh token a été rejeté
  (expiré après 7 j, ou révoqué — la rotation invalide l'ancien token à
  chaque refresh) ; c'est le comportement attendu.

## Limites connues / reste à faire

- **Tokens en mémoire uniquement** : pas de persistance disque (interdiction
  `localStorage`) → reconnexion à chaque lancement. Persistance possible plus
  tard via `safeStorage` d'Electron (nouveau canal IPC + surface preload).
- **App packagée (`file://`)** : l'origine `null` n'est pas dans
  `Cors:AllowedOrigins` de Ref.Api, et la CSP/`apiBaseUrl` de production
  pointent encore sur localhost — à traiter au moment du packaging (en dev
  via `ng serve`/`electron:dev`, l'origine `http://localhost:4200` est
  autorisée).
- Les permissions (`perm` du JWT, `GET /api/Users/me/permissions`) ne sont
  pas encore exploitées côté client.
