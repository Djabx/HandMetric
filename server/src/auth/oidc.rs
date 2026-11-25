//! Connexion par OpenID Connect, avec autant de fournisseurs que configuré.

use super::{may_register, optional_user, session_cookie};
use crate::error::AppError;
use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::response::Redirect;
use axum_extra::extract::CookieJar;
use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl,
    Scope, TokenResponse,
};
use serde::Deserialize;
use std::collections::HashMap;
use tokio::sync::Mutex;

pub struct Pending {
    provider: String,
    verifier: PkceCodeVerifier,
    nonce: Nonce,
    link_user: Option<String>,
}

#[derive(Default)]
pub struct MetadataCache(Mutex<HashMap<String, CoreProviderMetadata>>);

fn http() -> reqwest::Client {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().expect("client HTTP")
}

fn redirect_url(state: &AppState) -> String {
    let mut u = state.config.public_url.clone();
    u.set_path("/auth/oidc/callback");
    u.set_query(None);
    u.to_string()
}

async fn metadata(state: &AppState, provider: &str) -> Result<CoreProviderMetadata, AppError> {
    let mut cache = state.oidc_metadata.0.lock().await;
    if let Some(m) = cache.get(provider) {
        return Ok(m.clone());
    }
    let cfg = state.config.oidc.get(provider).ok_or(AppError::NotFound)?;
    let issuer = IssuerUrl::new(cfg.issuer.clone()).map_err(|e| AppError::Internal(e.to_string()))?;
    let m = CoreProviderMetadata::discover_async(issuer, &http())
        .await
        .map_err(|e| AppError::Internal(format!("découverte OIDC de {provider} : {e}")))?;
    cache.insert(provider.to_string(), m.clone());
    Ok(m)
}

/// Redirige vers le fournisseur. Si l'utilisateur est connecté, l'identité sera liée à son compte.
pub async fn start(State(state): State<AppState>, jar: CookieJar, Path(provider): Path<String>) -> Result<Redirect, AppError> {
    let cfg = state.config.oidc.get(&provider).ok_or(AppError::NotFound)?.clone();
    let meta = metadata(&state, &provider).await?;
    let client = CoreClient::from_provider_metadata(meta, ClientId::new(cfg.client_id.clone()), cfg.client_secret.clone().map(ClientSecret::new))
        .set_redirect_uri(RedirectUrl::new(redirect_url(&state)).map_err(|e| AppError::Internal(e.to_string()))?);
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let mut req = client.authorize_url(CoreAuthenticationFlow::AuthorizationCode, CsrfToken::new_random, Nonce::new_random);
    for s in cfg.scopes.iter().filter(|s| s.as_str() != "openid") {
        req = req.add_scope(Scope::new(s.clone()));
    }
    let (url, csrf, nonce) = req.set_pkce_challenge(challenge).url();
    let link_user = optional_user(&state, &jar).await?;
    state.oidc_pending.put(csrf.secret().clone(), Pending { provider, verifier, nonce, link_user });
    Ok(Redirect::to(url.as_str()))
}

#[derive(Deserialize)]
pub struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

pub async fn callback(State(state): State<AppState>, jar: CookieJar, Query(q): Query<Callback>) -> (CookieJar, Redirect) {
    match finish(&state, &q).await {
        Ok(Some(user_id)) => match state.db.create_session(&user_id).await {
            Ok(token) => (jar.add(session_cookie(&state, token)), Redirect::to("/#/settings")),
            Err(e) => (jar, error_redirect(&e.to_string())),
        },
        Ok(None) => (jar, Redirect::to("/#/settings")),
        Err(e) => {
            tracing::warn!("échec OIDC : {e}");
            (jar, error_redirect(&e.to_string()))
        }
    }
}

fn error_redirect(msg: &str) -> Redirect {
    let enc: String = url::form_urlencoded::byte_serialize(msg.as_bytes()).collect();
    Redirect::to(&format!("/#/settings?auth_error={enc}"))
}

/// Renvoie l'utilisateur à connecter (ou None si l'identité a seulement été liée).
async fn finish(state: &AppState, q: &Callback) -> Result<Option<String>, AppError> {
    if let Some(e) = &q.error {
        return Err(AppError::BadRequest(format!("refusé par le fournisseur : {e}")));
    }
    let (Some(code), Some(csrf)) = (&q.code, &q.state) else { return Err(AppError::BadRequest("réponse incomplète".into())) };
    let pending = state.oidc_pending.take(csrf).ok_or_else(|| AppError::BadRequest("session de connexion expirée".into()))?;
    let cfg = state.config.oidc.get(&pending.provider).ok_or(AppError::NotFound)?.clone();
    let meta = metadata(state, &pending.provider).await?;
    let client = CoreClient::from_provider_metadata(meta, ClientId::new(cfg.client_id.clone()), cfg.client_secret.clone().map(ClientSecret::new))
        .set_redirect_uri(RedirectUrl::new(redirect_url(state)).map_err(|e| AppError::Internal(e.to_string()))?);
    let token = client
        .exchange_code(AuthorizationCode::new(code.clone()))
        .map_err(|e| AppError::Internal(e.to_string()))?
        .set_pkce_verifier(pending.verifier)
        .request_async(&http())
        .await
        .map_err(|e| AppError::BadRequest(format!("échange du code : {e}")))?;
    let id_token = token.id_token().ok_or_else(|| AppError::BadRequest("pas de jeton d'identité".into()))?;
    let claims = id_token
        .claims(&client.id_token_verifier(), &pending.nonce)
        .map_err(|e| AppError::BadRequest(format!("jeton d'identité invalide : {e}")))?;
    let subject = claims.subject().to_string();
    let email = claims.email().map(|e| e.to_string());
    let name = claims.name().and_then(|n| n.get(None)).map(|n| n.to_string()).or(email.clone());
    let provider = pending.provider;

    if let Some((uid, _)) = state.db.find_identity(&provider, &subject).await? {
        return Ok(Some(uid));
    }
    if let Some(uid) = pending.link_user {
        state.db.add_identity(&uid, "oidc", &provider, &subject, email.as_deref(), None).await?;
        return Ok(None);
    }
    if !may_register(state, Some(&provider)) {
        return Err(AppError::Forbidden("aucun compte LifeLog n'est lié à cette identité".into()));
    }
    let user = state.db.create_user(name.as_deref()).await?;
    state.db.add_identity(&user.id, "oidc", &provider, &subject, email.as_deref(), None).await?;
    Ok(Some(user.id))
}
