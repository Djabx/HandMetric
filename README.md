# LifeLog

*(dépôt : `HandMetric`, nom de travail d'origine)*

> Les succès de ta vie, comme dans un jeu vidéo.

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

🚧 **Phase de conception.** Aucun code pour l'instant. La spécification se trouve dans [`docs/SPEC.md`](docs/SPEC.md).

## Deux façons de l'utiliser

- **Mode solo** : la PWA publiée sur GitHub Pages, sans compte ni serveur.
- **Mode auto-hébergé** : ton serveur LifeLog sert sa propre PWA et synchronise tes appareils, pour plusieurs utilisateurs.

On passe de l'un à l'autre par export et import.

## Architecture en bref

```
┌──────────────────────────────┐            ┌──────────────────────────────┐
│  PWA (navigateur / mobile)   │            │  Serveur Rust (optionnel)    │
│                              │  HTTPS     │                              │
│  UI  ──►  SQLite (WASM/OPFS) │ ◄────────► │  API sync  ──► Storage trait │
│            │                 │  push/pull │                 ├─ PostgreSQL│
│            ▼                 │            │                 └─ SQLite    │
│      export .sqlite / JSON   │            │  (Redis : optionnel, plus    │
└──────────────────────────────┘            │   tard)                      │
                                            └──────────────────────────────┘
```

- **Client** : PWA en TypeScript, base SQLite locale (SQLite WASM persistée dans OPFS). Le fichier exporté est cette même base.
- **Serveur** : Rust (axum + sqlx), API de synchronisation et d'import, stockage interchangeable derrière un trait.

Les choix détaillés et leurs justifications sont dans la [spec](docs/SPEC.md#7-choix-techniques).

## Développement et déploiement (prévu)

Le dépôt inclut un Nix flake :

```sh
nix develop                     # environnement de dev complet
nix build .#server              # serveur Rust
nix build .#app                 # PWA statique
nix flake check                 # tests et lint
```

Pour l'auto-hébergement sous NixOS, le flake fournit un module `services.lifelog`. Une image Docker est aussi disponible.

## Organisation du dépôt (prévue)

```
app/       PWA (TypeScript)
server/    Serveur de synchronisation (Rust)
docs/      Spécification et décisions d'architecture
flake.nix  Environnement de dev, paquets et module NixOS
```

## Licence

[MIT](LICENSE).
