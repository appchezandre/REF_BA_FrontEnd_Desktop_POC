# Génération des factures — lancement et suivi temps réel

## Vue d'ensemble

La génération des factures de vente se lance depuis l'explorateur :
**Modules / Ventes / Génération Factures** ouvre un dialog modal de saisie de
la période (pré-rempli au mois précédent). Le lancement appelle l'API puis la
progression du job s'affiche dans la vue **« Traitements en cours »** de la
side bar (icône roue dentée de la barre d'activité, avec pastille tant qu'un
traitement est actif). Après le lancement, la side bar bascule automatiquement
sur cette vue.

```text
SideBar (action 'invoice-generation')
   └─> ShellUiService.openInvoiceGenerationDialog()
         └─> InvoiceGenerationDialog (shell/invoice-generation-dialog/)
               └─> InvoiceGenerationService.launch(year, month)
                     ├─ 1. InvoiceGenerationHubClient.start()   ← AVANT le POST
                     ├─ 2. InvoicingApi.generate({year, month}) → jobId (202/409)
                     └─ 3. subscribeToJob(jobId) + job 'pending'
JobsPanel (shell/side-bar/jobs-panel/) ← signaux du service
```

## Contrat backend (Ref.Api)

- `POST /api/Invoices/generate`, corps `{ "year": number, "month": number }`
  (validation : mois 1–12, année 2000..année courante + 1) :
  - **202** `{ "jobId": "<guid>", "message": string }` — génération démarrée ;
  - **409** même corps — une génération est **déjà en cours** pour la période ;
    `jobId` identifie le run existant. Traité comme une **reprise de suivi**
    (`resumed`), pas comme une erreur ;
  - **400** `ValidationProblemDetails`.
- `POST /api/Invoices/{jobId}/cancel` : **202** (annulation coopérative,
  l'état final arrive par le hub), 404 (inconnu), 409 (déjà terminé).
- Hub SignalR `/hubs/invoice-generation` :
  - diffusion **par groupe** `invoice-job-{jobId}` : il faut invoquer
    `SubscribeToJob(jobId)` pour recevoir. Les groupes sont **perdus à chaque
    reconnexion** : le client ré-invoque l'abonnement dans `onreconnected` ;
  - événement client `InvoiceGenerationProgressChanged`, payload camelCase
    `{ jobId, status, processed, total, message, timestampUtc }` avec `status`
    **numérique** : 0 Started, 1 Running, 2 Completed, 3 Failed, 4 Cancelled.

## Cycle de vie côté client (`InvoiceGenerationService`)

- **Course assumée** : le job démarre dès la réponse HTTP, mais l'abonnement au
  groupe ne peut partir qu'une fois le `jobId` connu. L'événement `Started`
  peut donc être manqué — le hub est connecté avant le POST pour réduire la
  fenêtre, et l'état local `pending` + le premier `Running` reçu couvrent le
  reste. Ne jamais dépendre de `Started`.
- **`Failed` n'est pas figé** : Hangfire réessaie côté serveur, le même jobId
  peut réémettre `Started`/`Running`. Le client **reste abonné** après un
  échec ; l'UI affiche « Échec — nouvelle tentative automatique ».
- **`Completed` / `Cancelled`** : plus rien n'arrivera — désabonnement du
  groupe et arrêt du hub ; le résultat reste affiché jusqu'au clic « Masquer »
  (`dismiss()`).
- **Suivi silencieux** : sans événement pendant 10 s (`STALE_AFTER_MS`) alors
  que le job est actif, le panneau affiche « En attente de nouvelles du
  serveur… ». Il n'existe **pas de `GET` de statut** côté backend : aucun
  rattrapage HTTP possible après une coupure ou un abonnement tardif.
- Payloads du hub et corps du 409 traités comme **non fiables** : gardes de
  type dans `invoicing.mapper.ts`.

## Découplage bundle

`core/invoicing/` (service, API, client hub) n'est référencé que par deux
composants rendus derrière `@defer (on immediate)` : le dialog (dans
`shell.html`) et `JobsPanel` (dans `side-bar.html`). `@microsoft/signalr` est
chargé en import dynamique par le client hub (même patron que
`MaintenanceHubClient`). La pastille de la barre d'activité passe par
`ShellUiService.jobActivity` (bundle initial) pour ne pas tirer
`core/invoicing` au démarrage.

## Limites (itération actuelle)

- **Suivi local à la fenêtre courante** : pas de synchronisation
  inter-fenêtres (`WindowSyncService`) — chaque fenêtre qui lance un
  traitement suit le sien. Extension possible en publiant l'état du job sur un
  sujet `invoicing/state`.
- **Un seul job suivi à la fois** : le modèle
  `job: InvoiceGenerationJob | null` reste extensible vers une liste.
- **Pas de rattrapage d'état** après rechargement de la fenêtre ou abonnement
  tardif (dépend d'un futur endpoint de lecture côté backend).
- Le hub est anonyme côté serveur (pas de `[Authorize]`) ; si le backend le
  protège un jour, il faudra passer un `accessTokenFactory` à `withUrl()` et
  câbler `OnMessageReceived` côté API.

## Tests

- `invoicing.mapper.spec.ts` — gardes de type (payloads valides/invalides,
  statuts hors bornes, corps 409) ;
- `invoicing-api.spec.ts` — URLs, méthodes et corps des appels HTTP ;
- `invoice-generation.service.spec.ts` — ordre hub/POST, reprise 409, fusion
  des événements, retry après échec, annulation, suivi silencieux ;
- `invoice-generation-dialog.spec.ts` — pré-remplissage (dont janvier →
  décembre N−1), validation des bornes, lancement/fermeture/bascule ;
- `jobs-panel.spec.ts` — états vide/en cours/terminé, annulation, attente ;
- `shell-ui.service.spec.ts`, `activity-bar.spec.ts` — vue `jobs`, dialog,
  pastille.
