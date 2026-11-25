//! Comptes, sessions et jetons d'API. Aucun mot de passe : passkeys ou OIDC uniquement.

pub mod oidc;
pub mod passkey;

use crate::db::{now, Db};
use crate::error::AppError;
use crate::AppState;
use anyhow::Result;
use axum::http::HeaderMap;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const SESSION_COOKIE: &str = "lifelog_session";
const SESSION_DAYS: i64 = 90;

/// 256 bits aléatoires, encodés en base64url.
pub fn random_token(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!(
        "{prefix}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IdentityInfo {
    pub id: String,
    pub kind: String,
    pub provider: String,
    pub label: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenInfo {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub tracker_id: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// Jeton d'API authentifié.
#[derive(Debug, Clone)]
pub struct ApiToken {
    pub id: String,
    pub user_id: String,
    pub scope: String,
    pub tracker_id: Option<String>,
}

impl Db {
    pub async fn create_user(&self, display_name: Option<&str>) -> Result<User> {
        let id = uuid::Uuid::now_v7().to_string();
        sqlx::query("INSERT INTO app_user (id, display_name, created_at) VALUES ($1, $2, $3)")
            .bind(&id)
            .bind(display_name.map(str::to_string))
            .bind(now())
            .execute(&self.pool)
            .await?;
        Ok(User {
            id,
            display_name: display_name.map(str::to_string),
        })
    }

    pub async fn get_user(&self, id: &str) -> Result<Option<User>> {
        Ok(
            sqlx::query("SELECT id, display_name FROM app_user WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
                .map(|r| User {
                    id: r.get("id"),
                    display_name: r.get("display_name"),
                }),
        )
    }

    pub async fn add_identity(
        &self,
        user_id: &str,
        kind: &str,
        provider: &str,
        subject: &str,
        label: Option<&str>,
        credential: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO identity (id, user_id, kind, provider, subject, label, credential, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(uuid::Uuid::now_v7().to_string())
        .bind(user_id)
        .bind(kind)
        .bind(provider)
        .bind(subject)
        .bind(label.map(str::to_string))
        .bind(credential.map(str::to_string))
        .bind(now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Utilisateur lié à une identité (fournisseur, sujet), et met à jour sa date d'utilisation.
    pub async fn find_identity(
        &self,
        provider: &str,
        subject: &str,
    ) -> Result<Option<(String, Option<String>)>> {
        let row = sqlx::query(
            "SELECT user_id, credential FROM identity WHERE provider = $1 AND subject = $2",
        )
        .bind(provider)
        .bind(subject)
        .fetch_optional(&self.pool)
        .await?;
        if row.is_some() {
            sqlx::query(
                "UPDATE identity SET last_used_at = $1 WHERE provider = $2 AND subject = $3",
            )
            .bind(now())
            .bind(provider)
            .bind(subject)
            .execute(&self.pool)
            .await?;
        }
        Ok(row.map(|r| (r.get("user_id"), r.get("credential"))))
    }

    pub async fn update_credential(
        &self,
        provider: &str,
        subject: &str,
        credential: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE identity SET credential = $1 WHERE provider = $2 AND subject = $3")
            .bind(credential)
            .bind(provider)
            .bind(subject)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn passkeys_of(&self, user_id: &str) -> Result<Vec<String>> {
        Ok(
            sqlx::query("SELECT credential FROM identity WHERE user_id = $1 AND kind = 'passkey'")
                .bind(user_id)
                .fetch_all(&self.pool)
                .await?
                .iter()
                .filter_map(|r| r.get::<Option<String>, _>("credential"))
                .collect(),
        )
    }

    pub async fn identities(&self, user_id: &str) -> Result<Vec<IdentityInfo>> {
        Ok(sqlx::query(
            "SELECT id, kind, provider, label, created_at, last_used_at FROM identity WHERE user_id = $1 ORDER BY created_at",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?
        .iter()
        .map(|r| IdentityInfo {
            id: r.get("id"),
            kind: r.get("kind"),
            provider: r.get("provider"),
            label: r.get("label"),
            created_at: r.get("created_at"),
            last_used_at: r.get("last_used_at"),
        })
        .collect())
    }

    /// Supprime une identité, sauf la dernière (on ne peut pas se bloquer dehors).
    pub async fn delete_identity(&self, user_id: &str, id: &str) -> Result<bool> {
        let count: i64 = sqlx::query("SELECT COUNT(*) AS n FROM identity WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?
            .get("n");
        if count <= 1 {
            return Ok(false);
        }
        let r = sqlx::query("DELETE FROM identity WHERE user_id = $1 AND id = $2")
            .bind(user_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn create_session(&self, user_id: &str) -> Result<String> {
        let token = random_token("");
        let expires = chrono::Utc::now() + chrono::Duration::days(SESSION_DAYS);
        sqlx::query("INSERT INTO session (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)")
            .bind(hash_token(&token))
            .bind(user_id)
            .bind(now())
            .bind(expires.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .execute(&self.pool)
            .await?;
        Ok(token)
    }

    pub async fn session_user(&self, token: &str) -> Result<Option<String>> {
        Ok(
            sqlx::query("SELECT user_id FROM session WHERE token_hash = $1 AND expires_at > $2")
                .bind(hash_token(token))
                .bind(now())
                .fetch_optional(&self.pool)
                .await?
                .map(|r| r.get("user_id")),
        )
    }

    pub async fn delete_session(&self, token: &str) -> Result<()> {
        sqlx::query("DELETE FROM session WHERE token_hash = $1")
            .bind(hash_token(token))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn purge_sessions(&self) -> Result<()> {
        sqlx::query("DELETE FROM session WHERE expires_at <= $1")
            .bind(now())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_token(
        &self,
        user_id: &str,
        name: &str,
        scope: &str,
        tracker_id: Option<&str>,
    ) -> Result<(TokenInfo, String)> {
        let token = random_token("lt_");
        let info = TokenInfo {
            id: uuid::Uuid::now_v7().to_string(),
            name: name.to_string(),
            scope: scope.to_string(),
            tracker_id: tracker_id.map(str::to_string),
            created_at: now(),
            last_used_at: None,
        };
        sqlx::query(
            "INSERT INTO api_token (id, user_id, name, token_hash, scope, tracker_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&info.id)
        .bind(user_id)
        .bind(&info.name)
        .bind(hash_token(&token))
        .bind(&info.scope)
        .bind(info.tracker_id.clone())
        .bind(&info.created_at)
        .execute(&self.pool)
        .await?;
        Ok((info, token))
    }

    pub async fn tokens(&self, user_id: &str) -> Result<Vec<TokenInfo>> {
        Ok(sqlx::query(
            "SELECT id, name, scope, tracker_id, created_at, last_used_at FROM api_token WHERE user_id = $1 ORDER BY created_at",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?
        .iter()
        .map(|r| TokenInfo {
            id: r.get("id"),
            name: r.get("name"),
            scope: r.get("scope"),
            tracker_id: r.get("tracker_id"),
            created_at: r.get("created_at"),
            last_used_at: r.get("last_used_at"),
        })
        .collect())
    }

    pub async fn revoke_token(&self, user_id: &str, id: &str) -> Result<bool> {
        Ok(
            sqlx::query("DELETE FROM api_token WHERE user_id = $1 AND id = $2")
                .bind(user_id)
                .bind(id)
                .execute(&self.pool)
                .await?
                .rows_affected()
                > 0,
        )
    }

    pub async fn token_auth(&self, token: &str) -> Result<Option<ApiToken>> {
        let row = sqlx::query(
            "SELECT id, user_id, scope, tracker_id FROM api_token WHERE token_hash = $1",
        )
        .bind(hash_token(token))
        .fetch_optional(&self.pool)
        .await?;
        let Some(r) = row else { return Ok(None) };
        let t = ApiToken {
            id: r.get("id"),
            user_id: r.get("user_id"),
            scope: r.get("scope"),
            tracker_id: r.get("tracker_id"),
        };
        sqlx::query("UPDATE api_token SET last_used_at = $1 WHERE id = $2")
            .bind(now())
            .bind(&t.id)
            .execute(&self.pool)
            .await?;
        Ok(Some(t))
    }
}

/// Cookie de session.
pub fn session_cookie(state: &AppState, token: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .secure(state.config.secure_cookies())
        .same_site(SameSite::Lax)
        .max_age(time_days(SESSION_DAYS))
        .build()
}

fn time_days(d: i64) -> time::Duration {
    time::Duration::days(d)
}

/// Utilisateur connecté (cookie de session), ou 401.
pub async fn require_user(state: &AppState, jar: &CookieJar) -> Result<String, AppError> {
    let Some(c) = jar.get(SESSION_COOKIE) else {
        return Err(AppError::Unauthorized);
    };
    state
        .db
        .session_user(c.value())
        .await?
        .ok_or(AppError::Unauthorized)
}

pub async fn optional_user(state: &AppState, jar: &CookieJar) -> Result<Option<String>, AppError> {
    match jar.get(SESSION_COOKIE) {
        Some(c) => Ok(state.db.session_user(c.value()).await?),
        None => Ok(None),
    }
}

pub fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
}

/// Peut-on créer un compte par ce moyen ?
pub fn may_register(state: &AppState, provider: Option<&str>) -> bool {
    if !state.config.registration_enabled {
        return false;
    }
    match provider {
        None => state.config.passkey.allow_registration,
        Some(p) => state
            .config
            .oidc
            .get(p)
            .map(|o| o.allow_registration)
            .unwrap_or(false),
    }
}

/// Petit stockage en mémoire à durée limitée (défis WebAuthn, états OIDC).
pub struct Ephemeral<T> {
    items: Mutex<HashMap<String, (Instant, T)>>,
    ttl: Duration,
}

impl<T> Ephemeral<T> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            items: Mutex::new(HashMap::new()),
            ttl,
        }
    }
    pub fn put(&self, key: String, value: T) {
        let mut m = self.items.lock().unwrap();
        let ttl = self.ttl;
        m.retain(|_, (t, _)| t.elapsed() < ttl);
        if m.len() > 10_000 {
            m.clear();
        }
        m.insert(key, (Instant::now(), value));
    }
    pub fn take(&self, key: &str) -> Option<T> {
        let mut m = self.items.lock().unwrap();
        m.remove(key)
            .filter(|(t, _)| t.elapsed() < self.ttl)
            .map(|(_, v)| v)
    }
}

/// Limiteur de débit simple par clé (fenêtre glissante d'une minute).
pub struct RateLimiter {
    hits: Mutex<HashMap<String, Vec<Instant>>>,
    per_minute: usize,
}

impl RateLimiter {
    pub fn new(per_minute: usize) -> Self {
        Self {
            hits: Mutex::new(HashMap::new()),
            per_minute,
        }
    }
    pub fn check(&self, key: &str) -> bool {
        let mut m = self.hits.lock().unwrap();
        if m.len() > 10_000 {
            m.clear();
        }
        let v = m.entry(key.to_string()).or_default();
        v.retain(|t| t.elapsed() < Duration::from_secs(60));
        if v.len() >= self.per_minute {
            return false;
        }
        v.push(Instant::now());
        true
    }
}

impl Db {
    pub async fn create_user_with_id(&self, id: &str, display_name: Option<&str>) -> Result<()> {
        sqlx::query("INSERT INTO app_user (id, display_name, created_at) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(display_name.map(str::to_string))
            .bind(now())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
