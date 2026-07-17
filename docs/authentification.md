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
   par le bouton « Se déconnecter » de la status bar.

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
features/auth/pages/login-page   UI de connexion uniquement (fiche simple)
core/auth/
├── auth.dto.ts                  contrats HTTP /api/auth/*
├── auth-session.ts              AuthSession, AuthUser, SyncedAuthState
├── auth.mapper.ts               DTO -> session, décodage claims JWT, garde parseSyncedAuthState
├── auth-api.ts                  appels HTTP bruts (endpoints anonymes)
├── auth.service.ts              autorité de session (signals), login/logout/refresh
└── auth.interceptor.ts          Bearer + refresh single-flight sur 401 + rejeu
core/api/problem-details.ts      parsing RFC 7807 -> message utilisateur
```

- **Garde d'authentification** : `App` (`app.ts`) rend la page de login tant
  qu'aucune session n'existe ; le shell (et tous les écrans protégés) est
  détruit à la déconnexion. La page de login porte sa propre bande de titre
  (fenêtre sans cadre : drag + réduire/fermer).
- **Multi-fenêtres** : la session est publiée sur le bus IPC (sujet
  `auth/state`, forme enveloppée `{ authenticated, session? }` validée par
  `parseSyncedAuthState`). Connexion et déconnexion se propagent à toutes les
  fenêtres ; une fenêtre détachée après coup rattrape l'état retenu par
  Electron Main.
- **Refresh** : sur `401` d'un appel métier, l'intercepteur déclenche UN
  renouvellement partagé (single-flight dans `AuthService`) puis rejoue la
  requête. Refresh rejeté (400/401) → session purgée partout → retour au
  login. Erreur réseau → session conservée.
- **Déconnexion** : purge locale immédiate + publication, puis `revoke` du
  refresh token en meilleur effort. Bouton dans la status bar.

## Tests

Specs Vitest (`ng test --include '**/core/auth/*.spec.ts'`) :

- `auth.mapper.spec.ts` — décodage JWT (UTF-8, tokens malformés), mapping
  DTO → session, garde `parseSyncedAuthState` contre les payloads hostiles ;
- `auth.service.spec.ts` — login/logout, publication et réception sur le bus
  inter-fenêtres (mock de `window.desktopAPI`), rattrapage de l'état retenu ;
- `auth.interceptor.spec.ts` — ajout du Bearer, exclusion des endpoints
  d'auth et des URLs externes, refresh sur 401 + rejeu, purge sur refresh
  rejeté ;
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
