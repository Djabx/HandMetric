# LifeLog : spécification v0.1

*Statut : brouillon, 2026-11-25.*

Les points marqués **🟡 Hypothèse** sont des choix faits par défaut, sans validation. Ils sont à confirmer ou à changer. La liste complète est reprise en [section 9](#9-questions-ouvertes).

---

## 1. Vision

LifeLog transforme les événements de la vie quotidienne en statistiques et en succès, comme dans un jeu vidéo. On déclare des **compteurs** (« cigarette », « course à pied », « passage aux toilettes »), on enregistre des **événements** d'un geste, et l'application affiche :

- le temps écoulé depuis la dernière occurrence (« 6 mois sans cigarette ») ;
- le nombre d'occurrences sur une période, les séries, les records ;
- des **succès** débloqués quand un palier est franchi.

Contraintes fondatrices :

| Contrainte | Conséquence |
|---|---|
| Fonctionne seul, hors ligne | Toute la logique et les données sont dans le client. Le serveur n'est jamais requis. |
| Export facile | Le format d'export est un fichier SQLite standard, ouvrable avec n'importe quel outil. |
| Réimport sur un serveur auto-hébergé | Le même fichier s'importe dans le serveur, et l'import est idempotent. |
| Backend en Rust | Serveur axum + sqlx. |
| Stockage interchangeable | PostgreSQL (le NUC d'Alex) ou SQLite (installation légère). |

## 2. Utilisateurs et cas d'usage

- **Utilisateur solo, sans serveur** : installe la PWA, suit ses compteurs, exporte de temps en temps une sauvegarde.
- **Utilisateur auto-hébergé** (Alex) : même usage, avec synchronisation automatique entre téléphone et ordinateur via son serveur.

🟡 **Hypothèse** : un serveur sert **un seul utilisateur** (ou un foyer qui partage un compte). Le multi-utilisateur avec comptes séparés n'est pas prévu en v1, mais le modèle de données prévoit une colonne `owner_id` côté serveur pour ne pas le bloquer.

## 3. Fonctionnalités

### 3.1 MVP (v1)

**Compteurs**
- Créer, modifier, archiver un compteur : nom, icône (emoji), couleur, **polarité** (bon / mauvais / neutre).
- Choisir le **mode d'affichage principal** :
  - *abstinence* : « temps depuis la dernière fois » (cigarette) ;
  - *fréquence* : « combien de fois » sur jour / semaine / mois (course).
- Valeur numérique facultative avec unité (ex. course : `5.2 km`).

**Événements**
- Enregistrer un événement en un geste (bouton sur la carte du compteur). Horodatage = maintenant.
- Modifier l'heure après coup (« j'ai oublié de noter ce matin »), ajouter une note ou une valeur.
- Supprimer un événement (suppression logique, voir sync).

**Tableau de bord**
- Une carte par compteur, avec la statistique principale en grand et mise à jour en direct (« 182 j 4 h sans 🚬 »).
- Formatage humain des durées : « 6 mois », « 3 semaines et 2 jours ».

**Statistiques par compteur**
- Historique (liste et calendrier façon heatmap).
- Série en cours et record : plus longue abstinence, plus longue série de jours consécutifs avec au moins un événement.
- Totaux par jour, semaine, mois.

**Succès**
- Paliers prédéfinis selon le mode :
  - abstinence : 1 j, 3 j, 1 sem, 2 sem, 1 mois, 3 mois, 6 mois, 1 an, puis chaque année ;
  - fréquence : 1, 10, 50, 100, 500, 1000 occurrences ; séries de 7, 30, 100 jours.
- Les succès sont **calculés** à partir des événements, jamais stockés comme vérité (voir 4.3).
- Une notification dans l'application quand un succès est débloqué pendant que l'app est ouverte.

**Données**
- Export SQLite (`.lifelog.sqlite`) et JSON.
- Import d'un fichier exporté, avec fusion sans doublon.
- Fonctionnement 100 % hors ligne après la première visite. Installable sur l'écran d'accueil.

**Synchronisation (si un serveur est configuré)**
- Saisir l'URL du serveur et un jeton d'accès.
- Synchronisation automatique au démarrage, au retour en ligne, et après chaque modification (avec un délai de regroupement).

### 3.2 Plus tard (hors v1)

- Paliers de succès personnalisés par compteur.
- Objectifs (« max 5 cigarettes / semaine », « 3 courses / semaine »).
- Rappels et notifications push (nécessite le serveur pour le Web Push).
- Raccourcis : actions rapides de l'icône d'app, widget, Share Target.
- Étiquettes / catégories de compteurs.
- Multi-utilisateur sur un même serveur.
- Import depuis d'autres applis (CSV générique).

### 3.3 Hors périmètre

- Réseau social, partage public, classements.
- Toute dépendance à un service tiers (analytics, cloud propriétaire).

## 4. Modèle de données

### 4.1 Principes

- **Identifiants UUIDv7** générés par le client. Ils sont uniques sans coordination et triables dans le temps, ce qui rend la fusion d'exports et la sync triviales.
- **Instants en UTC** (ISO 8601, millisecondes) + **décalage horaire local** au moment de l'événement, pour que « mardi 23 h à Tokyo » reste mardi dans les statistiques.
- **Suppression logique** (`deleted_at`) : une suppression est une modification comme une autre, elle se propage par la sync et par l'import.
- **Chaque ligne synchronisable** porte `updated_at` (horloge logique hybride, voir 5.2) et `device_id`.
- Le **même schéma** est utilisé dans le client, dans le fichier d'export, et (aux types près) sur le serveur.

### 4.2 Schéma (SQLite, client et export)

```sql
-- Métadonnées de la base / du fichier exporté
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- clés attendues : schema_version, app_version, device_id,
--                  exported_at (fichiers d'export), created_at

CREATE TABLE tracker (
  id           TEXT PRIMARY KEY,          -- UUIDv7
  name         TEXT NOT NULL,
  icon         TEXT,                      -- emoji
  color        TEXT,                      -- #RRGGBB
  polarity     TEXT NOT NULL CHECK (polarity IN ('good','bad','neutral')),
  display_mode TEXT NOT NULL CHECK (display_mode IN ('abstinence','frequency')),
  value_unit   TEXT,                      -- NULL = pas de valeur numérique
  sort_order   REAL NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,             -- HLC
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);

CREATE TABLE event (
  id           TEXT PRIMARY KEY,          -- UUIDv7
  tracker_id   TEXT NOT NULL REFERENCES tracker(id),
  occurred_at  TEXT NOT NULL,             -- instant UTC
  tz_offset    INTEGER NOT NULL,          -- minutes, ex. +60 pour Paris en hiver
  value        REAL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,             -- HLC
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);
CREATE INDEX event_by_tracker_time ON event(tracker_id, occurred_at);

-- Local au client, jamais exporté ni synchronisé
CREATE TABLE sync_state (
  server_url   TEXT PRIMARY KEY,
  cursor       INTEGER NOT NULL DEFAULT 0, -- dernier server_seq reçu
  last_sync_at TEXT
);
```

🟡 **Hypothèse** : pas de table `achievement`. Les succès sont dérivés des événements et des paliers (voir 4.3). Si on veut un jour mémoriser « vu / pas vu » pour les notifications, ce sera une table locale non synchronisée.

### 4.3 Succès et statistiques : calculés, pas stockés

Stocker un succès crée une seconde source de vérité. Si on corrige l'heure d'un événement, un succès stocké devient faux. On calcule donc tout à partir de `event` :

- **Abstinence en cours** = `now - max(occurred_at)` des événements non supprimés.
- **Record d'abstinence** = plus grand écart entre deux événements consécutifs (ou entre le dernier et maintenant).
- **Succès « 6 mois sans »** = débloqué si un écart ≥ 6 mois existe. *Actif* si c'est l'écart en cours, *historique* sinon.
- **Série de jours** = jours locaux consécutifs (via `tz_offset`) avec au moins un événement.

Les volumes attendus (quelques milliers d'événements par compteur et par an) permettent de tout calculer à la volée en SQL ou en mémoire. On ajoutera un cache si les mesures le justifient.

### 4.4 Schéma serveur (PostgreSQL)

Mêmes tables, avec ces différences :

| Colonne | SQLite client | PostgreSQL serveur |
|---|---|---|
| `id`, `tracker_id` | `TEXT` | `UUID` |
| dates | `TEXT` ISO 8601 | `TIMESTAMPTZ` (sauf `updated_at` : `TEXT` HLC) |
| en plus | | `owner_id UUID NOT NULL` |
| en plus | | `server_seq BIGINT` (séquence globale, mise à jour à chaque écriture) |

Le backend SQLite du serveur reprend le schéma client, avec `owner_id` et `server_seq` en plus.

## 5. Export, import et synchronisation

### 5.1 Format d'export

**Format principal : fichier SQLite** `lifelog-AAAA-MM-JJ.lifelog.sqlite`.

- C'est une copie de la base du client, sans les tables locales (`sync_state`), avec `meta.exported_at` renseigné.
- Il s'ouvre avec `sqlite3`, DB Browser, Datasette, Python, etc.
- `meta.schema_version` permet de migrer un vieux fichier à l'import.

**Format secondaire : JSON**, pour la lisibilité et les scripts :

```json
{
  "format": "lifelog",
  "schema_version": 1,
  "exported_at": "2026-11-25T07:40:00.000Z",
  "trackers": [ { "id": "…", "name": "Cigarette", "…": "…" } ],
  "events":   [ { "id": "…", "tracker_id": "…", "occurred_at": "…", "…": "…" } ]
}
```

🟡 **Hypothèse** : le CSV n'est pas un format d'échange (il perd les relations). Il pourra venir plus tard comme export « lecture seule » pour tableur.

### 5.2 Résolution des conflits

Le modèle est **last-writer-wins par ligne**, ordonné par une **horloge logique hybride** (HLC) plutôt que par l'horloge murale :

- `updated_at` = `"<ms UTC sur 13 chiffres>-<compteur sur 4 chiffres>-<device_id>"`, comparable comme une simple chaîne.
- Une HLC reste monotone même si l'horloge d'un téléphone est fausse de quelques minutes, et départage deux écritures dans la même milliseconde.
- Fusion d'une ligne entrante : on la garde si son `updated_at` est plus grand que celui de la ligne locale, sinon on l'ignore.

Pourquoi c'est suffisant ici :
- Les événements sont essentiellement en **ajout seul**. Deux appareils qui ajoutent chacun un événement ne sont jamais en conflit (UUID différents).
- Les vrais conflits (renommer le même compteur sur deux appareils hors ligne) sont rares, et « le plus récent gagne » est le comportement attendu.

🟡 **Hypothèse** : pas de CRDT ni de fusion champ par champ. Ce serait plus complexe pour un gain quasi nul vu l'usage.

### 5.3 Import d'un fichier

Import = **fusion** avec la règle 5.2, ligne par ligne, en une transaction :

1. Lire `meta.schema_version`, migrer en mémoire si le fichier est plus ancien, refuser s'il est plus récent que l'application.
2. Pour chaque `tracker` puis chaque `event` : insérer s'il est absent, remplacer si `updated_at` est plus grand.
3. Afficher un résumé : « 12 compteurs, 3 402 événements, 15 nouveaux, 2 mis à jour ».

Propriétés : **idempotent** (importer deux fois le même fichier ne change rien) et **commutatif** (l'ordre des imports n'importe pas). Le même code sert à importer un fichier dans la PWA et à l'envoyer au serveur.

### 5.4 Protocole de synchronisation

API HTTP JSON, versionnée sous `/api/v1`. Authentification par jeton porteur (`Authorization: Bearer …`).

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/v1/health` | Version du serveur et du schéma |
| `GET` | `/api/v1/changes?since=<cursor>&limit=500` | Lignes avec `server_seq > cursor`, plus le nouveau `cursor` et `has_more` |
| `POST` | `/api/v1/changes` | Envoi d'un lot de lignes modifiées. Le serveur applique la règle 5.2 et renvoie le nouveau `cursor` |
| `POST` | `/api/v1/import` | Envoi d'un fichier `.lifelog.sqlite` ou JSON (multipart). Même fusion que `changes` |
| `GET` | `/api/v1/export?format=sqlite\|json` | Télécharge toutes les données du compte |

Cycle client :
1. **Push** : envoyer les lignes dont `updated_at` est postérieur au dernier push réussi.
2. **Pull** : demander `changes?since=cursor` en boucle jusqu'à `has_more = false`, fusionner, enregistrer le `cursor`.

Le serveur n'a aucune logique métier (pas de calcul de succès). Il stocke, fusionne et redistribue.

🟡 **Hypothèse** : le jeton est créé en ligne de commande sur le serveur (`lifelog-server token create`), puis collé dans la PWA. Pas d'écran de connexion ni de mot de passe en v1.

## 6. Architecture

### 6.1 Client (PWA)

```
app/
  src/
    ui/            composants et écrans
    domain/        calculs : durées, séries, succès (fonctions pures, testées)
    db/            SQLite WASM dans un Web Worker, migrations, requêtes
    sync/          HLC, fusion, client HTTP
    export/        export/import SQLite et JSON
  public/manifest.webmanifest
```

- La base tourne dans un **Web Worker** (exigence d'OPFS pour l'accès synchrone, et l'UI ne bloque pas).
- Un **Service Worker** met en cache l'application pour le hors ligne.
- Persistance demandée via `navigator.storage.persist()` pour éviter l'éviction par le navigateur.

### 6.2 Serveur

```
server/
  crates/
    lifelog-core/     types, HLC, règle de fusion, migrations de format d'export
    lifelog-storage/  trait Storage + impl. postgres et sqlite (features Cargo)
    lifelog-server/   binaire axum : API, auth, CLI d'admin
```

```rust
#[async_trait]
pub trait Storage: Send + Sync {
    async fn changes_since(&self, owner: OwnerId, cursor: i64, limit: u32) -> Result<ChangeSet>;
    async fn apply(&self, owner: OwnerId, rows: Vec<Row>) -> Result<Cursor>;
    async fn export(&self, owner: OwnerId) -> Result<Snapshot>;
}
```

Configuration par variables d'environnement, par exemple `LIFELOG_DATABASE_URL=postgres://…` ou `sqlite:///data/lifelog.db`. Le schéma d'URL choisit l'implémentation.

Distribution : un binaire statique et une image Docker. Un `docker-compose.yml` d'exemple avec PostgreSQL.

### 6.3 Redis

🟡 **Hypothèse** : **Redis n'est pas utilisé en v1.** Pour un serveur personnel, PostgreSQL suffit largement (y compris `LISTEN/NOTIFY` si on veut prévenir les autres appareils en direct). Redis pourra servir plus tard, en option, pour :
- diffuser les changements en temps réel entre appareils (pub/sub, SSE) si on dépasse un seul processus ;
- limiter le débit des requêtes si le serveur devient multi-utilisateur.

Le code ne doit pas en dépendre : derrière un trait, désactivé par défaut.

## 7. Choix techniques

| Sujet | Choix | Pourquoi | Alternatives écartées |
|---|---|---|---|
| Stockage client | **SQLite WASM officiel** (`@sqlite.org/sqlite-wasm`) persisté dans **OPFS** | L'export est le fichier lui-même, sans conversion. Requêtes SQL pour les stats. Même moteur que le backend SQLite. | IndexedDB (Dexie) : il faudrait convertir vers SQLite à l'export, et pas de SQL pour les stats. |
| Langage client | **TypeScript** | Écosystème PWA mature, typage. | Rust/WASM (Leptos) : séduisant pour partager le code avec le serveur, mais plus lourd à builder et à déboguer, et l'UI reste du DOM. |
| Framework UI | 🟡 **Svelte 5 + Vite** | Bundle léger (bon pour le hors ligne et les mobiles modestes), réactivité simple pour un compteur qui tique chaque seconde. | React (plus lourd), Solid (écosystème plus petit). Choix réversible à ce stade. |
| PWA | **vite-plugin-pwa** (Workbox) | Manifest et Service Worker générés, stratégie de cache standard. | Service Worker écrit à la main. |
| Identifiants | **UUIDv7** | Uniques sans serveur, triables dans le temps. | Entiers auto-incrémentés (collisions entre appareils). |
| Ordre des écritures | **HLC** | Robuste aux horloges décalées des téléphones. | `updated_at` en heure murale (fragile). |
| Serveur | **Rust, axum, tokio** | Demandé. axum est le standard de fait, léger. | actix-web (équivalent, moins idiomatique avec tokio). |
| Accès BDD serveur | **sqlx** (features `postgres`, `sqlite`) | Un seul outil pour les deux moteurs, requêtes vérifiées à la compilation, migrations intégrées. | Diesel (plus lourd), SeaORM (ORM inutile pour 2 tables). |
| Format d'échange | **SQLite + JSON** | SQLite = sauvegarde complète et requêtable. JSON = lisible et scriptable. | CSV (perd la structure). |

### Compatibilité navigateurs

OPFS avec accès synchrone est disponible dans Chrome/Edge 108+, Firefox 111+ et Safari 16.4+ (iOS compris). 🟡 **Hypothèse** : on ne prend pas en charge les navigateurs plus anciens. Repli possible plus tard : SQLite en mémoire + sauvegarde dans IndexedDB.

**Point d'attention iOS** : Safari peut purger les données d'un site non installé après 7 jours sans visite. Il faut inciter à « Ajouter à l'écran d'accueil » et rappeler l'export ou la sync dans l'interface.

## 8. Plan de livraison

1. **Squelette** : monorepo, PWA Vite + Svelte installable, SQLite WASM dans un worker, migrations.
2. **Cœur hors ligne** : compteurs, événements, tableau de bord, durées.
3. **Stats et succès** : séries, records, paliers, heatmap.
4. **Export / import** SQLite et JSON, avec tests de fusion (idempotence, commutativité).
5. **Serveur Rust** : API sync, backends PostgreSQL et SQLite, CLI de jetons, image Docker.
6. **Sync côté PWA** : écran de configuration, cycle push/pull, indicateur d'état.

Les étapes 1 à 4 donnent une application complète utilisable sans serveur.

## 9. Questions ouvertes

Hypothèses à valider (récapitulatif) :

1. Un serveur = un utilisateur en v1 ?
2. Pas de table de succès : tout est calculé ?
3. Last-writer-wins par ligne (pas de CRDT) ?
4. Jeton créé en CLI, pas d'écran de connexion ?
5. Redis absent en v1 ?
6. Svelte comme framework UI ?
7. Pas de support des navigateurs sans OPFS ?
8. CSV seulement en export lecture seule, plus tard ?

Autres questions :

- **Langue de l'interface** : français seul, ou français + anglais dès le départ ?
- **Licence** : open source (MIT, AGPL…) ou privée ?
- **Événements avec durée** (ex. une course de 45 min) : faut-il un `ended_at`, ou la valeur numérique suffit-elle ?
- **Compteurs « mauvais » en mode fréquence** (ex. « max 5 cigarettes par jour ») : à prévoir dès la v1 ou avec les objectifs ?
