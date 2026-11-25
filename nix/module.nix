# Module NixOS : services.lifelog
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.lifelog;
  inherit (lib) mkOption mkEnableOption mkIf types;
  credDir = "/run/credentials/lifelog.service";

  settingsFile = (pkgs.formats.toml { }).generate "lifelog.toml" (
    lib.recursiveUpdate {
      registration.enabled = cfg.registration.enable;
      auth.passkey = {
        enabled = cfg.auth.passkey.enable;
        allow_registration = cfg.auth.passkey.allowRegistration;
      };
      auth.oidc = lib.mapAttrs (name: p: {
        display_name = p.displayName;
        inherit (p) issuer scopes;
        client_id = p.clientId;
        allow_registration = p.allowRegistration;
      } // lib.optionalAttrs (p.clientSecretFile != null) {
        client_secret_file = "${credDir}/oidc-${name}";
      }) cfg.auth.oidc;
    } cfg.extraSettings
  );

  databaseUrl =
    if cfg.database.url != null then cfg.database.url
    else if cfg.database.createLocally then "postgres://lifelog@/lifelog?host=/run/postgresql"
    else "sqlite:///var/lib/lifelog/lifelog.db?mode=rwc";
in
{
  options.services.lifelog = {
    enable = mkEnableOption "LifeLog, serveur de synchronisation auto-hébergé";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.server;
      defaultText = lib.literalExpression "lifelog.packages.\${system}.server";
      description = "Paquet du serveur (avec la PWA embarquée).";
    };

    listen = mkOption {
      type = types.str;
      default = "127.0.0.1:8080";
      description = "Adresse d'écoute HTTP. Garder une adresse locale derrière un reverse proxy (Caddy, nginx).";
    };

    publicUrl = mkOption {
      type = types.str;
      example = "https://lifelog.exemple.fr";
      description = "URL publique, nécessaire aux passkeys et aux retours OIDC.";
    };

    timezone = mkOption {
      type = types.str;
      default = config.time.timeZone or "UTC";
      defaultText = lib.literalExpression "config.time.timeZone";
      description = "Fuseau horaire des événements reçus par webhook sans décalage explicite.";
    };

    database = {
      url = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "postgres://lifelog@/lifelog?host=/run/postgresql";
        description = "URL de la base (postgres:// ou sqlite://). Par défaut : PostgreSQL local si createLocally, sinon SQLite dans /var/lib/lifelog.";
      };
      createLocally = mkOption {
        type = types.bool;
        default = false;
        description = "Crée la base et le rôle « lifelog » dans services.postgresql (authentification peer).";
      };
    };

    registration.enable = mkOption {
      type = types.bool;
      default = true;
      description = "Autorise la création de nouveaux comptes. Les comptes existants peuvent toujours se connecter.";
    };

    auth.passkey = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Connexion par passkey.";
      };
      allowRegistration = mkOption {
        type = types.bool;
        default = true;
        description = "Une passkey seule peut créer un compte. Sinon, elle s'ajoute depuis un compte déjà connecté.";
      };
    };

    auth.oidc = mkOption {
      default = { };
      description = "Fournisseurs OpenID Connect (Google, Pocket ID, Authelia…), autant que voulu.";
      example = lib.literalExpression ''
        {
          pocket-id = {
            displayName = "Pocket ID";
            issuer = "https://id.exemple.fr";
            clientId = "lifelog";
            clientSecretFile = config.sops.secrets."lifelog/pocket-id".path;
          };
          google = {
            displayName = "Google";
            issuer = "https://accounts.google.com";
            clientId = "1234.apps.googleusercontent.com";
            clientSecretFile = config.sops.secrets."lifelog/google".path;
            allowRegistration = false;
          };
        }
      '';
      type = types.attrsOf (
        types.submodule (
          { name, ... }:
          {
            options = {
              displayName = mkOption {
                type = types.str;
                default = name;
                description = "Nom affiché sur le bouton de connexion.";
              };
              issuer = mkOption {
                type = types.str;
                description = "URL de l'émetteur OIDC.";
              };
              clientId = mkOption {
                type = types.str;
                description = "Identifiant client.";
              };
              clientSecretFile = mkOption {
                type = types.nullOr types.path;
                default = null;
                description = "Fichier contenant le secret client (sops-nix, agenix…). Chargé via LoadCredential.";
              };
              allowRegistration = mkOption {
                type = types.bool;
                default = true;
                description = "Ce fournisseur peut créer de nouveaux comptes (si registration.enable).";
              };
              scopes = mkOption {
                type = types.listOf types.str;
                default = [ "openid" "email" "profile" ];
                description = "Portées demandées.";
              };
            };
          }
        )
      );
    };

    extraSettings = mkOption {
      type = types.attrs;
      default = { };
      description = "Réglages TOML supplémentaires, fusionnés dans le fichier de configuration.";
    };

    environmentFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      description = "Fichier de variables LIFELOG_* supplémentaires (secrets éventuels).";
    };
  };

  config = mkIf cfg.enable {
    services.postgresql = mkIf cfg.database.createLocally {
      enable = true;
      ensureDatabases = [ "lifelog" ];
      ensureUsers = [
        {
          name = "lifelog";
          ensureDBOwnership = true;
        }
      ];
    };

    systemd.services.lifelog = {
      description = "LifeLog";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ] ++ lib.optional cfg.database.createLocally "postgresql.service";
      wants = [ "network-online.target" ];
      requires = lib.optional cfg.database.createLocally "postgresql.service";
      environment = {
        LIFELOG_CONFIG = "${settingsFile}";
        LIFELOG_LISTEN = cfg.listen;
        LIFELOG_PUBLIC_URL = cfg.publicUrl;
        LIFELOG_DATABASE_URL = databaseUrl;
        LIFELOG_TIMEZONE = cfg.timezone;
        TMPDIR = "/var/lib/lifelog/tmp";
      };
      preStart = "mkdir -p /var/lib/lifelog/tmp";
      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        User = "lifelog";
        DynamicUser = true;
        StateDirectory = "lifelog";
        EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
        LoadCredential = lib.mapAttrsToList (name: p: "oidc-${name}:${p.clientSecretFile}") (
          lib.filterAttrs (_: p: p.clientSecretFile != null) cfg.auth.oidc
        );
        Restart = "on-failure";
        # Durcissement
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        NoNewPrivileges = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [ "@system-service" "~@privileged" ];
        CapabilityBoundingSet = "";
        UMask = "0077";
      };
    };
  };
}
