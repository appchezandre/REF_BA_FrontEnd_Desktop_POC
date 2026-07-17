# Graphify MCP — graphe de connaissances du code

> État : 15 juillet 2026. Décrit l'installation et la configuration de Graphify
> (graphe de connaissances interrogeable du dépôt) et son exposition à Claude
> Code via un serveur MCP. Le graphe couvre le code source (`src/`, `electron/`)
> et les docs du dépôt.

## 1. Vue d'ensemble

Graphify transforme le dépôt en un **graphe de connaissances** (nœuds =
symboles/fichiers/entités, arêtes = relations : appels, imports, champs,
relations inférées). Ce graphe est :

- construit localement (extraction AST) puis enrichi par un LLM (extraction
  sémantique) ;
- exposé à Claude Code via un **serveur MCP** (`graphify-mcp`) déclaré dans
  `.mcp.json` à la racine du dépôt ;
- interrogeable par 10 outils MCP (voir §5).

```text
Code du dépôt (src/, electron/, docs/)
        |
        |  graphify extract  (AST local + LLM sémantique)
        v
graphify-out/graph.json  (602 nœuds · 1088 arêtes · 26 communautés)
        |
        |  graphify-mcp --graph graphify-out/graph.json  (stdio)
        v
Claude Code  <-- .mcp.json  (serveur MCP « graphify »)
```

## 2. Opérations réalisées

| # | Opération | Détail |
|---|-----------|--------|
| 1 | Installation de `uv` | `winget install astral-sh.uv` (v0.11.28). Ni Python ni `uv` n'étaient présents auparavant (seulement les stubs Microsoft Store). `uv` gère Python automatiquement (CPython 3.14.6 téléchargé). |
| 2 | Installation de Graphify | `uv tool install "graphifyy[mcp]"`. **Le paquet PyPI s'appelle `graphifyy`** (double « y »), pas `graphify`. L'extra **`[mcp]`** est obligatoire (sinon `ModuleNotFoundError: No module named 'mcp'`). |
| 3 | Construction du graphe (AST) | `graphify extract . --code-only` — 66 fichiers de code, sans clé API. |
| 4 | Extraction sémantique (LLM) | `graphify extract . --backend claude-cli` — 602 nœuds, 1088 arêtes. Coût 0 $ (via abonnement, voir §3). |
| 5 | Nommage des communautés | `graphify label . --backend claude-cli` — 26 communautés nommées + `GRAPH_REPORT.md` + `graph.html`. |
| 6 | Déclaration du serveur MCP | Création de `.mcp.json` à la racine (scope projet). |
| 7 | `.gitignore` | Ajout de `/graphify-out` (artefact généré). |
| 8 | Vérification bout-en-bout | Handshake MCP OK : 10 outils exposés, `graph_stats` renvoie le bon graphe. |

## 3. Paramétrage

### 3.1 Emplacements

| Élément | Chemin |
|---------|--------|
| Exécutables | `C:\Users\py.fevre\.local\bin\graphify.exe` et `graphify-mcp.exe` |
| Environnement Python de l'outil | `C:\Users\py.fevre\AppData\Roaming\uv\tools\graphifyy\` |
| Graphe + rapports | `graphify-out/` (à la racine du dépôt, **gitignoré**) |
| Config MCP | `.mcp.json` (racine du dépôt, versionné) |

### 3.2 `.mcp.json`

```json
{
  "mcpServers": {
    "graphify": {
      "command": "graphify-mcp",
      "args": ["--graph", "graphify-out/graph.json"]
    }
  }
}
```

La commande `graphify-mcp` est résolue via le PATH (`~\.local\bin`). Un coéquipier
qui a fait `uv tool install "graphifyy[mcp]"` obtient donc la même config. En
revanche `graphify-out/` étant gitignoré, **chacun reconstruit son graphe
localement** (voir §6).

### 3.3 Backend LLM — `claude-cli` (sans clé API)

- Le backend **`claude`** de Graphify exige la variable `ANTHROPIC_API_KEY`.
- Le backend **`claude-cli`** (non listé dans `--help` mais valide) shelle vers
  le CLI `claude` local et utilise l'**abonnement Pro/Max** → **coût 0 $**.
- Concurrence forcée à 1 (séquentiel) pour `claude-cli` ; ~1 min pour ce dépôt.

> Toujours passer `--backend claude-cli` pour les opérations LLM tant qu'aucune
> clé API n'est configurée.

### 3.4 État du graphe

- 602 nœuds · 1088 arêtes · 26 communautés · 99 % EXTRACTED / 1 % INFERRED.
- God node (le plus connecté) : `OrdersScreenStore` (52 arêtes).
- Construit depuis le commit `4d7e12a4`.

## 4. Process — modification de code et mise à jour du graphe

Le graphe est un **instantané** : il se périme quand le code change. Workflow
recommandé :

| Situation | Commande | LLM ? | Durée |
|-----------|----------|-------|-------|
| Après modif de code (courant) | `graphify update .` | Non (AST) | quelques s |
| Suppression de code / refactor qui retire des symboles | `graphify update . --force` | Non | quelques s |
| Gros refactor (rafraîchir la couche sémantique) | `graphify extract . --backend claude-cli` | Oui | ~1 min |
| Re-nommer les communautés + rapport | `graphify label . --backend claude-cli` | Oui | ~1 min |
| Vérifier si le graphe est périmé | comparer `git rev-parse HEAD` au commit du `GRAPH_REPORT.md` | — | — |

Toutes les commandes se lancent depuis la racine du dépôt (`.` = dossier
courant). Rappel : `graphify-out/` n'est pas commité.

> Après avoir régénéré le graphe, **recharger le serveur MCP** dans Claude Code
> (le serveur charge `graph.json` au démarrage) — voir §7.

## 5. Outils MCP disponibles

| Outil | Rôle |
|-------|------|
| `query_graph` | Recherche BFS/DFS en langage naturel, renvoie le contexte pertinent. |
| `get_node` | Détails complets d'un nœud (par label ou ID). |
| `get_neighbors` | Voisins directs d'un nœud + relations. |
| `get_community` | Tous les nœuds d'une communauté. |
| `god_nodes` | Nœuds les plus connectés (cœur de l'architecture). |
| `graph_stats` | Statistiques (nœuds, arêtes, communautés, confiance). |
| `shortest_path` | Plus court chemin entre deux concepts. |
| `list_prs` | PRs GitHub ouvertes + impact graphe (communautés touchées). |
| `get_pr_impact` | Impact détaillé d'une PR (fichiers, communautés, blast radius). |
| `triage_prs` | PRs actionnables triées par priorité de revue / risque. |

En complément, hors MCP, `graphify-out/graph.html` offre une visualisation
interactive et `GRAPH_REPORT.md` un résumé lisible (communautés, god nodes).

## 6. Reprise sur une autre machine / par un coéquipier

1. `winget install astral-sh.uv` (ou installeur officiel `uv`).
2. `uv tool install "graphifyy[mcp]"`.
3. Ouvrir un nouveau terminal (PATH `~\.local\bin` mis à jour).
4. Depuis la racine du dépôt : `graphify extract . --backend claude-cli` puis
   `graphify label . --backend claude-cli` (ou `--code-only` sans LLM).
5. Recharger Claude Code → approuver le serveur MCP `graphify` (§7).

## 7. Reste à faire

- [ ] **Recharger Claude Code** pour charger `.mcp.json` (scope projet) et
      **approuver** le serveur `graphify`. Vérifier ensuite avec `/mcp`.
- [ ] **(Optionnel) Hooks git** : `graphify hook install` régénère le graphe
      automatiquement à chaque commit / checkout. À évaluer (coût LLM si
      configuré pour l'extraction sémantique ; `update` reste gratuit).
- [ ] **(Optionnel) Clé API** : configurer une clé (`ANTHROPIC_API_KEY`,
      `GEMINI_API_KEY`, …) si l'on veut paralléliser l'extraction sémantique
      (le backend `claude-cli` est séquentiel).
- [ ] **(Optionnel) Extraction `--mode deep`** : extraction sémantique plus
      agressive (plus d'arêtes INFERRED) si l'on veut un graphe plus riche.

## 8. Points d'attention

- **Nom du paquet** : `graphifyy` (PyPI) ≠ `graphify` (CLI). `graphify` seul
  n'existe pas sur PyPI.
- **Extra `[mcp]` obligatoire** pour le serveur MCP.
- **Backend `claude-cli`** (pas `claude`) pour le LLM sans clé API.
- **Avertissement « node minté par deux fichiers »** : concerne les paires de
  composants Angular `.ts` + `.html` (ex. `panel.ts` / `panel.html`). Graphify
  conserve le nœud `.ts` et abandonne celui du template. Sans impact pratique
  (le template reste couvert via le `.ts`). Pour les distinguer : extraction par
  sous-dossier puis `graphify merge-graphs`.
- **Graphe périmé** : le graphe ne se met pas à jour tout seul ; suivre le
  process §4 après les changements de code.
