# LifeLog : spécification v0.1

*Statut : v1 implémentée, 2026-11-25. Les écarts entre la spec initiale et le code sont listés en [section 11](#11-écarts-dimplémentation-v1).*

Les décisions prises et les questions encore ouvertes sont en [section 10](#10-décisions-et-questions-ouvertes).

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

Il existe deux façons d'utiliser LifeLog, chacune avec **son propre front** :

- **Mode solo** : la PWA publiée sur **GitHub Pages**, accessible à tout le monde. Aucun serveur, aucun compte. Les données restent sur l'appareil, et on exporte de temps en temps une sauvegarde.
- **Mode auto-hébergé** : un serveur LifeLog (par exemple sur le NUC d'Alex) sert **sa propre PWA** et synchronise les appareils. Un serveur accueille **plusieurs utilisateurs**, chacun avec ses données, connectés par SSO ou passkey (voir 5.5).

Un front n'est jamais branché sur le backend d'un autre (pas de CORS). Pour passer du mode solo au mode auto-hébergé, on exporte ses données depuis la version GitHub Pages et on les importe dans la PWA du serveur.

LifeLog est une **application pour soi**, pas une vitrine : rien n'est partagé ni publié.

## 3. Fonctionnalités

### 3.1 MVP (v1)

**Compteurs**
- Créer, modifier, archiver un compteur : nom, icône (emoji), couleur, **polarité** (bon / mauvais / neutre).
- Choisir le **mode d'affichage principal** :
  - *abstinence* : « temps depuis la dernière fois » (cigarette) ;
  - *fréquence* : « combien de fois » sur jour / semaine / mois (course).
- **Mesures** facultatives, une ou plusieurs par compteur, chacune avec son nom et son unité : course = distance (km) + durée (min), tension = systolique + diastolique (mmHg), sommeil = durée (h).

**Événements**
- Enregistrer un événement en un geste (bouton sur la carte du compteur). Horodatage = maintenant.
- Modifier l'heure après coup (« j'ai oublié de noter ce matin »), ajouter une note ou les mesures.
- Supprimer un événement : il va à la corbeille (Réglages), restaurable 30 jours, puis effacé définitivement.

**Tableau de bord**
- Une carte par compteur, avec la statistique principale en grand et mise à jour en direct (« 182 j 4 h sans 🚬 »).
- Formatage humain des durées : « 6 mois », « 3 semaines et 2 jours ».

**Statistiques par compteur**
- Historique (liste et calendrier façon heatmap).
- Série en cours et record : plus longue abstinence, plus longue série de jours consécutifs avec au moins un événement.
- Totaux par jour, semaine, mois.

**Succès**
- Paliers prédéfinis selon le mode :
  - abstinence : 1 j, 3 j, 1 sem, 2 sem, 1 mois, 3 mois, 6 mois, 1 an, 2, 3, 5, 10 ans, puis tous les 5 ans ;
  - fréquence, compteur « bon » seulement : 1, 10, 50, 100, 500, 1000 occurrences ; séries de 7, 30, 100 jours ;
  - objectif tenu : quel que soit le type.
- Une occurrence d'un compteur « mauvais » ne donne jamais de trophée : on récompense le temps tenu sans.
- Trophées activables par compteur (colonne `tracker.achievements` : NULL = selon le type, 0 = non, 1 = oui). Par défaut : activés, sauf pour un compteur « neutre » (mesures comme la tension).
- Les succès sont **calculés** à partir des événements, jamais stockés comme vérité (voir 4.3).
- Une notification dans l'application quand un succès est débloqué pendant que l'app est ouverte.

**Données**
- Export SQLite (`.lifelog.sqlite`) et JSON.
- Import d'un fichier exporté, avec fusion sans doublon.
- Fonctionnement 100 % hors ligne après la première visite. Installable sur l'écran d'accueil.

**Objectifs**
- Optionnels, sur n'importe quel compteur, bon ou mauvais : « au plus 5 cigarettes par semaine », « au moins 3 courses par semaine ».
- Affichage de la progression sur la période en cours, et succès liés (« 4 semaines d'affilée dans l'objectif »).

**Interface**
- Français et anglais dès la v1, avec la langue du navigateur par défaut.

**Synchronisation (mode auto-hébergé uniquement)**
- Se connecter par passkey ou SSO (voir 5.5) sur la PWA servie par le serveur.
- Synchronisation automatique au démarrage, au retour en ligne, et après chaque modification (avec un délai de regroupement).

### 3.2 Plus tard (hors v1)

- Paliers de succès personnalisés par compteur.
- Rappels et notifications push (nécessite le serveur pour le Web Push).
- Raccourcis : actions rapides de l'icône d'app, widget, Share Target.
- Étiquettes / catégories de compteurs.
- Import depuis d'autres applis (CSV générique).
- Sources de données tierces, en entrée uniquement : Strava, fichiers GPX/FIT (voir [section 8](#8-intégrations-futures)).

### 3.3 Hors périmètre

- Réseau social, partage public, classements, publication vers d'autres services. LifeLog est une appli « pour soi ».
- Intégrations sortantes : les services tiers ne sont que des **sources** de données.
- Toute dépendance à un service tiers (analytics, cloud propriétaire).

## 4. Modèle de données

### 4.1 Principes

- **Identifiants UUIDv7** générés par le client. Ils sont uniques sans coordination et triables dans le temps, ce qui rend la fusion d'exports et la sync triviales.
- **Instants en UTC** (ISO 8601, millisecondes) + **décalage horaire local** au moment de l'événement, pour que « mardi 23 h à Tokyo » reste mardi dans les statistiques.
- **Suppression logique** (`deleted_at`) : mettre à la corbeille est une modification comme une autre, elle se propage par la sync et par l'import.
- **Effacement définitif** (corbeille vidée à la main ou après 30 jours) : les lignes sont réellement supprimées, sur l'appareil comme sur le serveur. Seul l'identifiant aléatoire de la ligne effacée reste, dans la table `purge` (avec la table d'origine et l'estampille), pour propager l'effacement et refuser qu'un appareil en retard la fasse revenir. Un effacement de compteur emporte ses champs et ses événements. Les exports ne contiennent pas `purge`.
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
  goal_kind    TEXT CHECK (goal_kind IN ('max','min')),  -- NULL = pas d'objectif
  goal_count   INTEGER,                   -- ex. 5
  goal_period  TEXT CHECK (goal_period IN ('day','week','month')),
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
  measures     TEXT,                      -- JSON { "<field_id>": 5.2, … }, NULL si aucune mesure
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,             -- HLC
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);
CREATE INDEX event_by_tracker_time ON event(tracker_id, occurred_at);

-- Mesures définies pour un compteur (0, 1 ou plusieurs)
CREATE TABLE tracker_field (
  id           TEXT PRIMARY KEY,          -- UUIDv7, clé utilisée dans event.measures
  tracker_id   TEXT NOT NULL REFERENCES tracker(id),
  name         TEXT NOT NULL,             -- « Distance », « Systolique »
  unit         TEXT,                      -- code UCUM : km, min, mm[Hg], h, g, L
  sort_order   REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,             -- HLC
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);

-- Local au client, jamais exporté ni synchronisé
CREATE TABLE sync_state (
  server_url   TEXT PRIMARY KEY,
  cursor       INTEGER NOT NULL DEFAULT 0, -- dernier server_seq reçu
  last_sync_at TEXT
);
```

**Décidé** : pas de table `achievement`. Les succès sont dérivés des événements et des paliers (voir 4.3). Si on veut un jour mémoriser « vu / pas vu » pour les notifications, ce sera une table locale non synchronisée.

### 4.3 Succès et statistiques : calculés, pas stockés

Stocker un succès crée une seconde source de vérité. Si on corrige l'heure d'un événement, un succès stocké devient faux. On calcule donc tout à partir de `event` :

- **Abstinence en cours** = `now - max(occurred_at)` des événements non supprimés.
- **Record d'abstinence** = plus grand écart entre deux événements consécutifs (ou entre le dernier et maintenant).
- **Succès « 6 mois sans »** = débloqué si un écart ≥ 6 mois existe. *Actif* si c'est l'écart en cours, *historique* sinon.
- **Série de jours** = jours locaux consécutifs (via `tz_offset`) avec au moins un événement.

**Mesures.** Les valeurs d'un événement sont stockées en JSON dans `event.measures`, indexées par l'`id` du champ. Un événement reste ainsi une seule ligne, ce qui garde la sync et la fusion simples. Les requêtes passent par `json_extract` (SQLite) ou `jsonb` (PostgreSQL). Les valeurs dérivées (allure = durée / distance) sont calculées, pas stockées. Les unités suivent les codes **UCUM**, le standard utilisé par FHIR et Open mHealth (voir section 10).

Les volumes attendus (quelques milliers d'événements par compteur et par an) permettent de tout calculer à la volée en SQL ou en mémoire. On ajoutera un cache si les mesures le justifient.

### 4.4 Schéma serveur (PostgreSQL et SQLite)

Mêmes tables que le client, avec ces différences :

| Colonne | SQLite client | Serveur |
|---|---|---|
| en plus | | `user_id TEXT NOT NULL REFERENCES app_user(id)`, clé primaire `(user_id, id)` |
| en plus | | `server_seq BIGINT` (séquence par serveur, mise à jour à chaque écriture) |

**Décidé à l'implémentation** : identifiants et dates restent en `TEXT` sur PostgreSQL aussi (UUID et ISO 8601 sous forme de chaînes). Le serveur utilise ainsi exactement les mêmes requêtes SQL sur les deux moteurs (pilote `Any` de sqlx), et une ligne fait l'aller-retour client → serveur → export sans conversion. Les migrations sont dans `server/migrations/{postgres,sqlite}`.

Tables propres au serveur, jamais exportées :

```sql
CREATE TABLE app_user (
  id           TEXT PRIMARY KEY,
  display_name TEXT,
  created_at   TEXT NOT NULL
);

-- Une ligne par moyen de connexion lié au compte
CREATE TABLE identity (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('oidc','passkey')),
  provider     TEXT NOT NULL,    -- nom du fournisseur OIDC dans la config, ou 'passkey'
  subject      TEXT NOT NULL,    -- claim `sub` OIDC, ou identifiant de la clé
  label        TEXT,             -- affiché dans « Moyens de connexion »
  credential   TEXT,             -- passkey WebAuthn sérialisée (clé publique)
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (provider, subject)
);

CREATE TABLE session (
  token_hash TEXT PRIMARY KEY,   -- SHA-256 du cookie
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE api_token (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE, -- seul le hash est stocké
  scope        TEXT NOT NULL,        -- webhook, events:write ou export:read
  tracker_id   TEXT,                 -- jeton limité à un compteur (webhook)
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
```

Le backend SQLite du serveur reprend le même schéma (`REAL` et `INTEGER` à la place de `DOUBLE PRECISION` et `BIGINT`).

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

Le CSV n'est pas un format d'échange entre instances LifeLog (il perd les relations). Son rôle est discuté en section 10.

### 5.2 Résolution des conflits

Le modèle est **last-writer-wins par ligne**, ordonné par une **horloge logique hybride** (HLC) plutôt que par l'horloge murale :

- `updated_at` = `"<ms UTC sur 13 chiffres>-<compteur sur 4 chiffres>-<device_id>"`, comparable comme une simple chaîne.
- Une HLC reste monotone même si l'horloge d'un téléphone est fausse de quelques minutes, et départage deux écritures dans la même milliseconde.
- Fusion d'une ligne entrante : on la garde si son `updated_at` est plus grand que celui de la ligne locale, sinon on l'ignore.

Pourquoi c'est suffisant ici :
- Les événements sont essentiellement en **ajout seul**. Deux appareils qui ajoutent chacun un événement ne sont jamais en conflit (UUID différents).
- Les vrais conflits (renommer le même compteur sur deux appareils hors ligne) sont rares, et « le plus récent gagne » est le comportement attendu.

**Décidé** : pas de CRDT ni de fusion champ par champ. Ce serait plus complexe pour un gain quasi nul vu l'usage.

### 5.3 Import d'un fichier

Import = **fusion** avec la règle 5.2, ligne par ligne, en une transaction :

1. Lire `meta.schema_version`, migrer en mémoire si le fichier est plus ancien, refuser s'il est plus récent que l'application.
2. Pour chaque `tracker` puis chaque `event` : insérer s'il est absent, remplacer si `updated_at` est plus grand.
3. Afficher un résumé : « 12 compteurs, 3 402 événements, 15 nouveaux, 2 mis à jour ».

Propriétés : **idempotent** (importer deux fois le même fichier ne change rien) et **commutatif** (l'ordre des imports n'importe pas). Le même code sert à importer un fichier dans la PWA et à l'envoyer au serveur.

### 5.4 Protocole de synchronisation

API HTTP JSON, versionnée sous `/api/v1`. Authentification décrite en 5.5.

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/v1/health` | Version du serveur et du schéma |
| `GET` | `/api/v1/changes?since=<cursor>&limit=500` | Lignes avec `server_seq > cursor`, plus le nouveau `cursor` et `has_more` |
| `POST` | `/api/v1/changes` | Envoi d'un lot de lignes modifiées. Le serveur applique la règle 5.2 et renvoie le nouveau `cursor` |
| `POST` | `/api/v1/import` | Envoi d'un fichier `.lifelog.sqlite` ou JSON (multipart). Même fusion que `changes` |
| `GET` | `/api/v1/export?format=sqlite\|json` | Télécharge toutes les données du compte |
| `POST` | `/api/v1/trackers/{id}/events` | Ajoute un événement (corps facultatif : `occurred_at`, `measures`, `note`). Pour les scripts. |
| `POST` | `/hooks/{token}` | **Webhook entrant** : ajoute un événement au compteur lié au jeton. Aucun en-tête requis, pour les outils qui ne savent faire qu'un simple POST. |

Cycle client :
1. **Push** : envoyer les lignes dont `updated_at` est postérieur au dernier push réussi.
2. **Pull** : demander `changes?since=cursor` en boucle jusqu'à `has_more = false`, fusionner, enregistrer le `cursor`.

Le serveur n'a aucune logique métier (pas de calcul de succès). Il stocke, fusionne et redistribue.

**Sécurité des webhooks.** Le jeton dans l'URL fonctionne comme les webhooks Slack ou Discord (« URL à capacité ») : qui connaît l'URL peut ajouter un événement, et rien d'autre. Les protections :
- **Impossible à deviner** : 256 bits aléatoires (CSPRNG), préfixe `lt_` pour le repérer dans un dépôt de code ou un log.
- **Stocké haché** (SHA-256) : une fuite de la base ne donne pas les jetons.
- **Portée minimale** : un jeton de webhook ne peut qu'ajouter un événement à **un** compteur. Pas de lecture, pas d'export, pas de modification.
- **Révocable** depuis l'interface, avec la date de dernière utilisation affichée.
- **HTTPS obligatoire** (assuré par le reverse proxy) et limitation de débit par jeton.
- **Variante en en-tête** : `Authorization: Bearer lt_…` sur `/hooks`, pour les outils qui le permettent. Le jeton n'apparaît alors pas dans les logs d'accès du reverse proxy (Caddy journalise l'URL complète par défaut).

Le pire cas d'une URL qui fuit est donc l'ajout d'événements parasites sur un compteur. On les supprime, on révoque le jeton et on en crée un autre.

**Pousser des événements depuis l'extérieur.** Un jeton d'API limité à un compteur donne une URL de webhook, par exemple `https://lifelog.exemple.fr/hooks/lt_9f3a…`. Exemples d'usage : un raccourci iOS ou Android « J'ai fumé » sur l'écran d'accueil, une automatisation Home Assistant, un bouton NFC, un `curl` dans un script. L'événement créé passe par la même fusion que la sync, et arrive sur les appareils au prochain pull.

### 5.5 Authentification (mode serveur)

**Pas d'identifiant ni de mot de passe.** Le mode solo n'a aucune authentification. En mode auto-hébergé, deux méthodes, cumulables :

1. **Passkeys (WebAuthn)**, méthode par défaut. Rien à configurer côté hébergeur. Le serveur stocke uniquement des clés publiques. Bibliothèque Rust : `webauthn-rs`.
2. **SSO via OpenID Connect générique**, avec **autant de fournisseurs que voulu** (Google, Facebook, un IdP perso…). Le serveur ne connaît aucun fournisseur en dur : chacun est décrit dans la configuration (URL de l'émetteur, `client_id`, fichier du `client_secret`). Bibliothèque Rust : `openidconnect`.

Toute la configuration passe par le module NixOS (voir 6.4) ou, hors Nix, par des variables d'environnement et un fichier TOML. Il n'y a **aucun écran d'administration** dans l'interface.

Fournisseurs possibles :

| Fournisseur | Effort pour l'hébergeur |
|---|---|
| **Google** | Créer un « client OAuth » dans Google Cloud Console (gratuit, environ 10 min) et y déclarer l'URL de retour `https://<serveur>/auth/oidc/callback`. Pas de validation Google nécessaire tant qu'on ne demande que `openid email profile`. |
| **GitHub, Microsoft, GitLab** | Même principe : enregistrer une application, copier les identifiants. |
| **Facebook** | Possible, mais plus pénible : support OIDC partiel (« Limited Login »), et l'app Facebook doit être validée pour d'autres comptes que le sien. |
| **IdP auto-hébergé** (Pocket ID, Authelia, Authentik, Keycloak) | Idéal sur un NUC : un seul compte pour tous ses services. Pocket ID fait du passkey uniquement. |

Fonctionnement :
- **Pas de rôle « propriétaire » ni d'administrateur.** Tous les comptes sont égaux. Le serveur se pilote uniquement par sa configuration.
- **Création de comptes** : une première connexion réussie crée le compte, si l'inscription est ouverte. On contrôle qui peut s'inscrire par la configuration :
  - `registration.enabled = false` ferme toute nouvelle inscription ;
  - `allowRegistration` par fournisseur OIDC limite les inscriptions à une population (par exemple, seulement les comptes de son IdP perso, alors que Google sert à se connecter à un compte existant) ;
  - une passkey seule ne crée un compte que si l'inscription par passkey est ouverte. Sinon, on l'ajoute depuis un compte déjà connecté.
- Après connexion, le serveur ouvre une session par cookie `lifelog_session` (`HttpOnly`, `Secure` dès que l'URL publique est en HTTPS, `SameSite=Lax`, 90 jours). `Lax` et non `Strict` : avec `Strict`, le navigateur n'enverrait pas le cookie au retour d'un fournisseur OIDC. Seul le hash du cookie est stocké.
- Plusieurs passkeys et identités OIDC peuvent être liées au même compte (téléphone, ordinateur, Google…).
- Chaque utilisateur peut créer des **jetons d'API** depuis l'interface : pour la sauvegarde automatisée (`export:read`) et pour **pousser des événements** (`events:write`, webhook, voir 5.4).

**La PWA est toujours servie par son serveur** (même origine). Pas de CORS : la PWA de GitHub Pages ne peut pas se connecter à un serveur auto-hébergé. On migre ses données d'un front à l'autre par export et import.

## 6. Architecture

### 6.1 Client (PWA)

```
app/
  src/
    ui/            écrans et composants Svelte
    lib/domain/    calculs : durées, séries, objectifs, succès (fonctions pures, testées)
    lib/db/        SQLite WASM dans un Web Worker, schéma, HLC, fusion, export/import
    lib/sync/      client HTTP, passkeys, cycle push/pull
    lib/i18n/      dictionnaires FR et EN
    lib/io/        CSV, téléchargement
  public/          icônes (le manifest est généré par vite-plugin-pwa)
```

- La base tourne dans un **Web Worker** (exigence d'OPFS pour l'accès synchrone, et l'UI ne bloque pas).
- Un **Service Worker** met en cache l'application pour le hors ligne.
- Persistance demandée via `navigator.storage.persist()` pour éviter l'éviction par le navigateur.

### 6.2 Serveur

```
server/
  migrations/      SQL PostgreSQL et SQLite
  src/
    config.rs      fichier TOML + variables LIFELOG_*
    db.rs          fusion, curseur, instantané (mêmes requêtes sur les deux moteurs)
    auth/          sessions, jetons, passkeys, OIDC
    api.rs         routes /api/v1 et /hooks
    export.rs      export/import SQLite et JSON
  tests/           tests d'intégration (SQLite, et PostgreSQL si LIFELOG_TEST_PG)
```

**Décidé à l'implémentation** : une seule crate plutôt que trois, et pas de trait `Storage`. Le pilote `Any` de sqlx exécute les mêmes requêtes sur PostgreSQL et SQLite, ce qui rend l'abstraction inutile pour l'instant. On découpera si un troisième moteur ou un deuxième binaire apparaît.

Pas de CLI d'administration : la configuration suffit. `lifelog-server --check` valide la configuration et la base, puis quitte.

Configuration par variables d'environnement, par exemple `LIFELOG_DATABASE_URL=postgres://…` ou `sqlite:///data/lifelog.db`. Le schéma d'URL choisit l'implémentation. Les réglages structurés (liste des fournisseurs OIDC) vont dans un fichier TOML désigné par `LIFELOG_CONFIG`. Les secrets ne sont jamais écrits en clair : la configuration référence des fichiers (`client_secret_file`), ce qui marche directement avec sops-nix ou agenix.

Le serveur écoute en HTTP sur une adresse locale. Il est prévu pour être placé derrière un reverse proxy (Caddy, nginx) qui gère le TLS. Il n'utilise pas les en-têtes `X-Forwarded-*` : il connaît son URL publique (`LIFELOG_PUBLIC_URL`), nécessaire pour les passkeys et les retours OIDC.

Distribution : un module NixOS, un paquet Nix et une image Docker (construite par le flake, voir 6.4). Un `docker-compose.yml` d'exemple avec PostgreSQL est dans `docs/`.

### 6.3 Redis

**Décidé** : **Redis n'est pas utilisé en v1.** Pour un serveur personnel ou familial, PostgreSQL suffit largement (y compris `LISTEN/NOTIFY` si on veut prévenir les autres appareils en direct). Redis pourra servir plus tard, en option, pour :
- diffuser les changements en temps réel entre appareils (pub/sub, SSE) si on dépasse un seul processus ;
- servir de cache de sessions ;
- limiter le débit des requêtes (webhooks, connexions).

Le code ne doit pas en dépendre : derrière un trait, désactivé par défaut.

### 6.4 Nix

Le dépôt fournit un **`flake.nix` à la racine**, dès le squelette (étape 1 du plan). Il expose :

| Sortie | Contenu |
|---|---|
| `devShells.default` | Rust de nixpkgs (cargo, clippy, rustfmt, rust-analyzer), Node.js 22 + pnpm, `sqlite`, `postgresql`. `nix develop` suffit pour tout builder et tester. |
| `packages.server` | Binaire `lifelog-server` (`rustPlatform.buildRustPackage`), avec la PWA embarquée pour qu'il la serve sur la même origine (voir 5.5). Les tests Rust tournent pendant le build. |
| `packages.app` | PWA buildée (fichiers statiques), via `pnpm` et un hash des dépendances fixé. Les tests TS tournent pendant le build. `packages.app-solo` : la variante GitHub Pages. |
| `packages.default` | Le serveur. |
| `packages.docker` | Image OCI construite avec `dockerTools`, sans Dockerfile. |
| `nixosModules.default` | Module NixOS `services.lifelog` pour l'auto-hébergement (voir ci-dessous). |
| `checks` | Build de la PWA et du serveur, donc leurs tests. Lancés par `nix flake check` en CI (`clippy` et `rustfmt` tournent dans le job Rust de la CI). |

Module NixOS, exemple d'usage :

```nix
services.lifelog = {
  enable = true;
  listen = "127.0.0.1:8080";               # pas d'exposition directe
  publicUrl = "https://lifelog.exemple.fr";
  database.createLocally = true;           # crée la base et le rôle PostgreSQL (sinon SQLite dans /var/lib/lifelog)

  registration.enable = true;
  auth.passkey.allowRegistration = false;  # passkey ajoutée depuis un compte existant
  auth.oidc = {
    pocket-id = {
      displayName = "Pocket ID";
      issuer = "https://id.exemple.fr";
      clientId = "lifelog";
      clientSecretFile = config.sops.secrets."lifelog/pocket-id".path;
      allowRegistration = true;            # seuls les comptes de l'IdP perso s'inscrivent
    };
    google = {
      displayName = "Google";
      issuer = "https://accounts.google.com";
      clientId = "1234.apps.googleusercontent.com";
      clientSecretFile = config.sops.secrets."lifelog/google".path;
      allowRegistration = false;           # connexion à un compte existant seulement
    };
  };
};

# Reverse proxy de l'hôte
services.caddy.virtualHosts."lifelog.exemple.fr".extraConfig = ''
  reverse_proxy 127.0.0.1:8080
'';
```

Toutes les options du serveur sont exposées par le module, qui génère les variables d'environnement et le fichier TOML. Les secrets passent par sops-nix (ou agenix) via les options `*File`. Le module crée un service systemd durci (`DynamicUser`, `ProtectSystem=strict`, `StateDirectory`, filtre d'appels système), charge les secrets OIDC par `LoadCredential`, et avec `createLocally` configure la base dans `services.postgresql` (authentification par socket Unix, sans mot de passe). Le reverse proxy et le TLS restent dans la configuration de l'hôte. Autres options : `timezone` (fuseau des webhooks sans décalage, par défaut `time.timeZone`), `extraSettings`, `environmentFile`.

**Décidé à l'implémentation** : uniquement nixpkgs (pas de `crane` ni de `rust-overlay`). Le flake n'a qu'une entrée, le Rust de nixpkgs suffit, et `Cargo.lock` sert directement au build.

## 7. Choix techniques

| Sujet | Choix | Pourquoi | Alternatives écartées |
|---|---|---|---|
| Stockage client | **SQLite WASM officiel** (`@sqlite.org/sqlite-wasm`) persisté dans **OPFS** | L'export est le fichier lui-même, sans conversion. Requêtes SQL pour les stats. Même moteur que le backend SQLite. | IndexedDB (Dexie) : il faudrait convertir vers SQLite à l'export, et pas de SQL pour les stats. |
| Langage client | **TypeScript** | Écosystème PWA mature, typage. | Rust/WASM (Leptos) : séduisant pour partager le code avec le serveur, mais plus lourd à builder et à déboguer, et l'UI reste du DOM. |
| Framework UI | **Svelte 5 + Vite** | Bundle léger (bon pour le hors ligne et les mobiles modestes), réactivité simple pour un compteur qui tique chaque seconde. | React (plus lourd), Solid (écosystème plus petit). Choix réversible à ce stade. |
| Hébergement mode solo | **GitHub Pages**, déployé par GitHub Actions | Gratuit, statique, aucun serveur à maintenir. | Netlify, Cloudflare Pages (équivalents, mais un compte de plus). |
| i18n | **Dictionnaires TypeScript maison** | Deux langues, quelques centaines de clés : un objet typé par langue suffit. Le français est la source, une clé manquante en anglais est une erreur de compilation. Formats de dates et de nombres par `Intl`. | Paraglide (outil de plus pour un gain nul à cette taille), svelte-i18n (chargé à l'exécution). |
| PWA | **vite-plugin-pwa** (Workbox) | Manifest et Service Worker générés, stratégie de cache standard. | Service Worker écrit à la main. |
| Identifiants | **UUIDv7** | Uniques sans serveur, triables dans le temps. | Entiers auto-incrémentés (collisions entre appareils). |
| Ordre des écritures | **HLC** | Robuste aux horloges décalées des téléphones. | `updated_at` en heure murale (fragile). |
| Serveur | **Rust, axum, tokio** | Demandé. axum est le standard de fait, léger. | actix-web (équivalent, moins idiomatique avec tokio). |
| Accès BDD serveur | **sqlx** (pilote `Any`, features `postgres`, `sqlite`) | Un seul outil et les mêmes requêtes pour les deux moteurs, migrations intégrées. | Diesel (plus lourd), SeaORM (ORM inutile pour 2 tables). |
| Auth serveur | **Passkeys (`webauthn-rs`) + OIDC générique (`openidconnect`)** | Aucun mot de passe à stocker ni à réinitialiser. OIDC générique : n'importe quel fournisseur sans code spécifique. | Login/mot de passe (refusé), intégrations Google/Facebook codées en dur. |
| Build et déploiement | **Nix flake** (devShell, paquets, image OCI, module NixOS) | Environnement de dev reproductible, et déploiement déclaratif sur un NUC sous NixOS. Le Docker reste disponible pour les autres. | Dockerfile seul, scripts d'installation. |
| Format d'échange | **SQLite + JSON** | SQLite = sauvegarde complète et requêtable. JSON = lisible et scriptable. | CSV (perd la structure). |

### Compatibilité navigateurs

OPFS avec accès synchrone est disponible dans Chrome/Edge 108+, Firefox 111+ et Safari 16.4+ (iOS compris). On ne prend pas en charge les navigateurs plus anciens. Repli possible plus tard : SQLite en mémoire + sauvegarde dans IndexedDB.

**Point d'attention iOS** : Safari peut purger les données d'un site non installé après 7 jours sans visite. Il faut inciter à « Ajouter à l'écran d'accueil » et rappeler l'export ou la sync dans l'interface.

## 8. Intégrations futures

Hors v1. Deux familles, selon qu'elles exigent un serveur ou non.

### 8.1 Import de fichiers (sans serveur)

La PWA lit ces fichiers localement, sans compte tiers et hors ligne. On glisse un fichier, ou on le partage vers la PWA (Share Target sur Android).

- **GPX, FIT, TCX** (montres et applis de sport) : chaque activité devient un événement avec date, distance et durée.
- **CSV** (historique d'une autre appli, export de tableur) : l'utilisateur indique quelle colonne est la date, quel compteur alimenter, et quelle colonne va dans quelle mesure. Le mapping est mémorisé pour les imports suivants.

### 8.2 Strava (serveur requis)

Strava fournit une API OAuth 2. Une intégration directe exige :
- **un serveur**, car le `client_secret` Strava ne peut pas vivre dans une PWA, et le serveur doit garder les jetons de rafraîchissement ;
- **que chaque hébergeur crée sa propre application Strava** (gratuit, sur strava.com/settings/api). Une nouvelle app est limitée à un seul athlète tant que Strava ne l'a pas validée, ce qui suffit pour un usage perso ;
- idéalement une **URL publique** pour recevoir les webhooks de Strava (nouvelle activité). Sinon, le serveur interroge l'API périodiquement (limites : 100 requêtes / 15 min, 1 000 / jour).

Principe : on associe un compteur LifeLog à un type d'activité Strava (ex. « Course » → `Run`). Chaque nouvelle activité crée un événement, avec un identifiant dérivé de l'ID Strava pour que la réimportation ne crée pas de doublon. Les événements arrivent ensuite sur les appareils par la sync normale.

D'autres services (Garmin Connect, Google Fit / Health Connect, Apple Santé) suivraient le même modèle de « connecteur » côté serveur. Apple Santé et Health Connect ne sont accessibles qu'à une appli native, pas à une PWA.

## 9. Plan de livraison

1. **Squelette** : monorepo, `flake.nix` (devShell et checks), i18n FR/EN, déploiement GitHub Pages, PWA Vite + Svelte installable, SQLite WASM dans un worker, migrations.
2. **Cœur hors ligne** : compteurs, événements, tableau de bord, durées, objectifs.
3. **Stats et succès** : séries, records, paliers, heatmap.
4. **Export / import** SQLite et JSON, avec tests de fusion (idempotence, commutativité).
5. **Serveur Rust** : multi-utilisateur, API sync, backends PostgreSQL et SQLite, passkeys et OIDC multi-fournisseurs, jetons d'API et webhooks, paquet Nix, module NixOS et image Docker.
6. **Sync côté PWA** : écran de configuration, cycle push/pull, indicateur d'état.

Les étapes 1 à 4 donnent une application complète utilisable sans serveur. **Les six étapes sont livrées (v1).**

## 10. Décisions et questions ouvertes

Décidé (revue du 2026-11-25) :

- Un serveur accueille **plusieurs utilisateurs**, sans rôle d'administrateur. Tout se règle dans la configuration.
- Mode solo = PWA sur GitHub Pages. Chaque front ne parle qu'à son propre backend, pas de CORS.
- Connexion par passkeys et OIDC multi-fournisseurs, jamais de mot de passe.
- Succès calculés, pas stockés. Fusion last-writer-wins par ligne.
- Redis absent en v1, envisagé plus tard pour le cache de sessions.
- Svelte, et pas de support des navigateurs sans OPFS (pas d'objection).
- Interface en français et en anglais dès la v1.
- Objectifs (max ou min par période) dès la v1, sur les compteurs bons comme mauvais.
- Intégrations : sources de données uniquement, rien vers les réseaux sociaux.
- Jetons d'API et webhooks entrants pour pousser des événements.
- **Plusieurs mesures par compteur** (course : distance + durée, tension : systolique + diastolique), stockées en JSON dans l'événement, unités UCUM.
- **CSV** : export simple en v1, import avec choix des colonnes plus tard (section 8.1).
- Licence MIT.

Standards de données :

- **Correspondance avec les standards santé.** Il n'existe pas de standard pour des « événements de vie » en général. Les plus proches couvrent la santé : **HL7 FHIR** (ressource `Observation`, codes **LOINC**, très complet mais lourd), **Open mHealth** (schémas JSON simples, ex. `blood-pressure`), et les types d'Apple Santé ou de Google Health Connect (propriétaires, mais standards de fait). **Décidé** : garder notre format, utiliser les unités UCUM dès la v1, et permettre plus tard d'associer un champ à un code LOINC (ex. systolique = `8480-6`) pour exporter en FHIR ou Open mHealth si besoin.

## 11. Écarts d'implémentation (v1)

Ce que le code fait différemment de la spec initiale, et pourquoi. Les sections ci-dessus sont déjà à jour.

| Sujet | Spec initiale | v1 | Raison |
|---|---|---|---|
| Types PostgreSQL | `UUID`, `TIMESTAMPTZ`, `TEXT[]` | `TEXT` partout, une portée par jeton | Mêmes requêtes sur les deux moteurs, aucune conversion (4.4). |
| Crates Rust | trois crates, trait `Storage` | une crate | Le pilote `Any` de sqlx rend le trait inutile (6.2). |
| Cookie de session | `SameSite=Strict` | `SameSite=Lax` | Sinon le retour OIDC arrive sans cookie (5.5). |
| i18n | Paraglide | dictionnaires typés | Plus simple à cette taille (7). |
| Nix | `crane` + `rust-overlay` | nixpkgs seul | Une seule entrée de flake (6.4). |
| État de sync client | table `sync_state` | clé `sync_state` de la table `meta`, exclue de l'export | Une table de moins, même effet. |
| pnpm | non précisé | pnpm 11, versions publiées depuis plus d'un jour seulement (`minimumReleaseAge`) | Protection contre les paquets npm compromis juste après publication. |

Reste pour après la v1 : section 3.2 et section 8 (imports GPX/FIT/CSV, Strava), cache de sessions Redis, codes LOINC.

