# LifeLog

> Compte ce qui compte. Tes habitudes, tes compteurs, tes données.

LifeLog est une application web progressive (PWA) qui permet de suivre des événements du quotidien, bons ou mauvais, et de les transformer en compteurs et en succès façon jeu vidéo :

- 🚭 **« 6 mois sans cigarette »** : le temps écoulé depuis la dernière occurrence.
- 🏃 **« 100 courses »** : le nombre d'occurrences, les séries, les records.
- 🚽 Ou n'importe quoi d'autre que tu as envie de compter.

## Principes

1. **Local d'abord.** L'application fonctionne entièrement hors ligne, sans compte ni serveur. Les données vivent sur l'appareil.
2. **Tes données t'appartiennent.** Export en un clic dans un fichier SQLite lisible par n'importe quel outil, et réimport sans perte.
3. **Serveur optionnel et multi-utilisateur.** Un serveur auto-hébergé (en Rust) permet de sauvegarder et de synchroniser plusieurs appareils. Il accepte PostgreSQL ou SQLite comme stockage. Connexion par passkey ou SSO (OpenID Connect), sans mot de passe.
4. **Simple à enregistrer.** Noter un événement doit prendre un seul geste depuis l'écran d'accueil.

## État du projet

✅ **v1.** Application hors ligne complète, serveur de synchronisation, paquets Nix et module NixOS. La spécification est dans [`docs/SPEC.md`](docs/SPEC.md), et sa [section 11](docs/SPEC.md#11-écarts-dimplémentation-v1) liste ce qui a changé en route.

Ce que fait la v1 :

- Compteurs bons, mauvais ou neutres, en mode « temps depuis la dernière fois » ou « fréquence », avec icône, couleur et modèles (cigarette, alcool, course, eau, tension, sommeil).
- Plusieurs mesures par événement (distance et durée, systolique et diastolique…), unités UCUM.
- Objectifs (au plus ou au moins N par jour, semaine ou mois), séries, records, graphique, calendrier type heatmap, succès façon jeu vidéo.
- Export SQLite, JSON et CSV, import SQLite et JSON par fusion (sans doublon).
- Interface en français et en anglais.
- Serveur : comptes multiples, passkeys et OIDC (autant de fournisseurs que voulu), synchronisation automatique, jetons d'API et webhooks entrants.

## Deux façons de l'utiliser

- **Mode solo** : la PWA publiée sur GitHub Pages, sans compte ni serveur.
- **Mode auto-hébergé** : ton serveur LifeLog sert sa propre PWA et synchronise tes appareils, pour plusieurs utilisateurs.

On passe de l'un à l'autre par export et import (Réglages → Données).

## Architecture en bref

```
┌──────────────────────────────┐            ┌──────────────────────────────┐
│  PWA (navigateur / mobile)   │            │  Serveur Rust (optionnel)    │
│                              │  HTTPS     │                              │
│  UI  ──►  SQLite (WASM/OPFS) │ ◄────────► │  API sync  ──►  sqlx         │
│            │                 │  push/pull │                 ├─ PostgreSQL│
│            ▼                 │            │                 └─ SQLite    │
│  export .sqlite / JSON / CSV │            │  passkeys, OIDC, webhooks    │
└──────────────────────────────┘            └──────────────────────────────┘
```

- **Client** : Svelte 5 + TypeScript, base SQLite locale (SQLite WASM persistée dans OPFS). Le fichier exporté est cette même base.
- **Serveur** : Rust (axum + sqlx), mêmes requêtes sur PostgreSQL et SQLite. Il sert la PWA sur la même origine (pas de CORS).

Les choix détaillés et leurs justifications sont dans la [spec](docs/SPEC.md#7-choix-techniques).

## Mode solo : GitHub Pages

Le workflow `.github/workflows/pages.yml` publie la PWA à chaque push sur `main`. Une seule fois, dans le dépôt GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.

## Auto-hébergement sous NixOS

```nix
# flake.nix de la machine
inputs.lifelog.url = "github:Djabx/lifelog";

# configuration NixOS
imports = [ inputs.lifelog.nixosModules.default ];

services.lifelog = {
  enable = true;
  publicUrl = "https://lifelog.exemple.fr";
  database.createLocally = true;           # PostgreSQL local ; sans ça, SQLite dans /var/lib/lifelog
  auth.passkey.allowRegistration = false;  # passkey ajoutée depuis un compte existant
  auth.oidc.pocket-id = {
    displayName = "Pocket ID";
    issuer = "https://id.exemple.fr";
    clientId = "lifelog";
    clientSecretFile = config.sops.secrets."lifelog/pocket-id".path;
  };
};

services.caddy.virtualHosts."lifelog.exemple.fr".extraConfig = ''
  reverse_proxy 127.0.0.1:8080
'';
```

Pour un fournisseur OIDC, l'URL de retour à déclarer est `https://<serveur>/auth/oidc/callback`. Toutes les options sont décrites dans [`nix/module.nix`](nix/module.nix) et dans la [spec](docs/SPEC.md#64-nix).

## Sans NixOS

- **Docker** : `nix build .#docker && docker load < result`, puis voir [`docs/docker-compose.yml`](docs/docker-compose.yml).
- **Binaire** : `nix build .#server` donne `result/bin/lifelog-server`, PWA incluse. Configuration par variables `LIFELOG_*` ou par un fichier TOML ([exemple](docs/lifelog.example.toml)). `lifelog-server --check` vérifie la configuration.

## Webhooks

Dans l'application connectée au serveur : Réglages → Jetons d'API → « Webhook » sur un compteur. L'URL n'est affichée qu'une fois.

```sh
curl -X POST https://lifelog.exemple.fr/hooks/lt_…                          # un événement maintenant
curl -X POST https://lifelog.exemple.fr/hooks -H "Authorization: Bearer lt_…" \
     -H "Content-Type: application/json" \
     -d '{"measures": {"Distance": 10.2, "Durée": 52}, "note": "Footing"}'
```

## Développement

```sh
nix develop                     # Rust, Node.js, pnpm, SQLite, PostgreSQL

cd app && pnpm install
pnpm dev                        # PWA sur http://localhost:5173 (proxy /api, /auth et /hooks vers :8080)
pnpm test && pnpm check

cd server
cargo run                       # serveur sur http://localhost:8080, base SQLite locale
cargo test                      # LIFELOG_TEST_PG=postgres://… pour tester aussi PostgreSQL

nix build .#server              # serveur + PWA
nix build .#app-solo            # PWA pour GitHub Pages
nix flake check                 # tout construire et tester
```

Les messages de commit suivent [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat(app): …`, `fix(server): …`, `build(nix): …`). Les dépendances npm, Cargo, Nix et GitHub Actions sont tenues à jour par [Renovate](renovate.json), qui n'installe que des versions publiées depuis au moins un jour.

## Organisation du dépôt

```
app/       PWA (Svelte, TypeScript)
server/    Serveur de synchronisation (Rust)
nix/       Paquets, image Docker et module NixOS
docs/      Spécification, exemples de configuration
flake.nix  Point d'entrée Nix
```

## Licence

[MIT](LICENSE).
