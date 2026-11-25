//! Configuration : variables d'environnement + fichier TOML facultatif (LIFELOG_CONFIG).
//! Les secrets sont lus depuis des fichiers (`*_file`), compatible sops-nix / agenix.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct FileConfig {
    pub listen: Option<String>,
    pub public_url: Option<String>,
    pub database_url: Option<String>,
    pub static_dir: Option<PathBuf>,
    pub timezone: Option<String>,
    pub registration: Registration,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Registration {
    /// Autorise la création de nouveaux comptes.
    pub enabled: bool,
}
impl Default for Registration {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct AuthConfig {
    pub passkey: PasskeyConfig,
    pub oidc: BTreeMap<String, OidcProvider>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PasskeyConfig {
    pub enabled: bool,
    /// Une passkey seule peut créer un compte (si `registration.enabled`).
    pub allow_registration: bool,
}
impl Default for PasskeyConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            allow_registration: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OidcProvider {
    /// Nom affiché (« Google »). Par défaut : la clé.
    pub display_name: Option<String>,
    pub issuer: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub client_secret_file: Option<PathBuf>,
    /// Ce fournisseur peut créer de nouveaux comptes (si `registration.enabled`).
    #[serde(default = "yes")]
    pub allow_registration: bool,
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
}
fn yes() -> bool {
    true
}
fn default_scopes() -> Vec<String> {
    vec!["openid".into(), "email".into(), "profile".into()]
}

#[derive(Debug, Clone)]
pub struct Config {
    pub listen: String,
    pub public_url: url::Url,
    pub database_url: String,
    pub static_dir: Option<PathBuf>,
    pub timezone: chrono_tz::Tz,
    pub registration_enabled: bool,
    pub passkey: PasskeyConfig,
    pub oidc: BTreeMap<String, ResolvedOidc>,
}

#[derive(Debug, Clone)]
pub struct ResolvedOidc {
    pub display_name: String,
    pub issuer: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub allow_registration: bool,
    pub scopes: Vec<String>,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

impl Config {
    pub fn load() -> Result<Self> {
        let file: FileConfig = match env("LIFELOG_CONFIG") {
            Some(path) => {
                let raw =
                    std::fs::read_to_string(&path).with_context(|| format!("lecture de {path}"))?;
                toml::from_str(&raw).with_context(|| format!("analyse de {path}"))?
            }
            None => FileConfig::default(),
        };
        Self::from_parts(file)
    }

    pub fn from_parts(file: FileConfig) -> Result<Self> {
        let listen = env("LIFELOG_LISTEN")
            .or(file.listen)
            .unwrap_or_else(|| "127.0.0.1:8080".into());
        let public_url = env("LIFELOG_PUBLIC_URL")
            .or(file.public_url)
            .unwrap_or_else(|| {
                // Les passkeys exigent un nom d'hôte (pas une IP) : localhost par défaut.
                let port = listen.rsplit(':').next().unwrap_or("8080");
                format!("http://localhost:{port}")
            });
        let public_url = url::Url::parse(&public_url).context("LIFELOG_PUBLIC_URL invalide")?;
        let database_url = env("LIFELOG_DATABASE_URL")
            .or(file.database_url)
            .unwrap_or_else(|| "sqlite://lifelog.db?mode=rwc".into());
        let static_dir = env("LIFELOG_STATIC_DIR")
            .map(PathBuf::from)
            .or(file.static_dir);
        let tz_name = env("LIFELOG_TIMEZONE")
            .or(file.timezone)
            .unwrap_or_else(|| "UTC".into());
        let timezone: chrono_tz::Tz = tz_name
            .parse()
            .map_err(|_| anyhow::anyhow!("fuseau horaire inconnu : {tz_name}"))?;
        let registration_enabled = match env("LIFELOG_REGISTRATION") {
            Some(v) => matches!(v.as_str(), "1" | "true" | "yes" | "on"),
            None => file.registration.enabled,
        };
        let mut oidc = BTreeMap::new();
        for (key, p) in file.auth.oidc {
            if !key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                bail!("nom de fournisseur OIDC invalide : {key}");
            }
            let client_secret = match (&p.client_secret, &p.client_secret_file) {
                (Some(s), _) => Some(s.clone()),
                (None, Some(path)) => Some(
                    std::fs::read_to_string(path)
                        .with_context(|| format!("lecture du secret OIDC {}", path.display()))?
                        .trim()
                        .to_string(),
                ),
                (None, None) => None,
            };
            oidc.insert(
                key.clone(),
                ResolvedOidc {
                    display_name: p.display_name.clone().unwrap_or_else(|| key.clone()),
                    issuer: p.issuer,
                    client_id: p.client_id,
                    client_secret,
                    allow_registration: p.allow_registration,
                    scopes: p.scopes,
                },
            );
        }
        Ok(Self {
            listen,
            public_url,
            database_url,
            static_dir,
            timezone,
            registration_enabled,
            passkey: file.auth.passkey,
            oidc,
        })
    }

    pub fn secure_cookies(&self) -> bool {
        self.public_url.scheme() == "https"
    }
}
