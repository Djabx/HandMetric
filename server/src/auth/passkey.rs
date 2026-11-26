//! Connexion et inscription par passkey (WebAuthn, identifiants découvrables).

use super::{may_register, optional_user, session_cookie};
use crate::error::AppError;
use crate::AppState;
use axum::extract::State;
use axum::Json;
use axum_extra::extract::CookieJar;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use webauthn_rs::prelude::*;

pub const PROVIDER: &str = "passkey";

pub enum Pending {
    Register {
        user_id: Uuid,
        new_user: bool,
        display_name: Option<String>,
        state: PasskeyRegistration,
    },
    Login(DiscoverableAuthentication),
}

pub fn build(public_url: &url::Url) -> anyhow::Result<Webauthn> {
    let rp_id = public_url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("LIFELOG_PUBLIC_URL sans hôte"))?;
    let mut origin = public_url.clone();
    origin.set_path("");
    Ok(WebauthnBuilder::new(rp_id, &origin)?
        .rp_name("LifeLog")
        .build()?)
}

fn cred_subject(id: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(id)
}

#[derive(Deserialize, Default)]
pub struct RegisterStart {
    pub display_name: Option<String>,
}

/// Démarre l'ajout d'une passkey : à un compte connecté, ou pour créer un compte.
pub async fn register_start(
    State(state): State<AppState>,
    jar: CookieJar,
    body: Option<Json<RegisterStart>>,
) -> Result<Json<Value>, AppError> {
    if !state.config.passkey.enabled {
        return Err(AppError::Forbidden("passkeys désactivées".into()));
    }
    let display_name = body
        .and_then(|b| b.0.display_name)
        .map(|s| s.trim().chars().take(80).collect::<String>())
        .filter(|s| !s.is_empty());
    let current = optional_user(&state, &jar).await?;
    let (user_id, new_user, exclude) = match &current {
        Some(uid) => {
            let creds = state
                .db
                .passkeys_of(uid)
                .await?
                .iter()
                .filter_map(|c| serde_json::from_str::<Passkey>(c).ok())
                .map(|p| p.cred_id().clone())
                .collect::<Vec<_>>();
            (
                Uuid::parse_str(uid)
                    .map_err(|_| AppError::Internal("identifiant utilisateur".into()))?,
                false,
                Some(creds),
            )
        }
        None => {
            if !may_register(&state, None) {
                return Err(AppError::Forbidden("inscription fermée".into()));
            }
            (Uuid::now_v7(), true, None)
        }
    };
    let name = display_name.clone().unwrap_or_else(|| "LifeLog".into());
    let (options, reg) = state
        .webauthn
        .start_passkey_registration(user_id, &name, &name, exclude)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let key = super::random_token("");
    state.webauthn_pending.put(
        key.clone(),
        Pending::Register {
            user_id,
            new_user,
            display_name,
            state: reg,
        },
    );
    Ok(Json(json!({ "key": key, "options": options })))
}

#[derive(Deserialize)]
pub struct RegisterFinish {
    pub key: String,
    pub credential: RegisterPublicKeyCredential,
    pub label: Option<String>,
}

pub async fn register_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<RegisterFinish>,
) -> Result<(CookieJar, Json<Value>), AppError> {
    let Some(Pending::Register {
        user_id,
        new_user,
        display_name,
        state: reg,
    }) = state.webauthn_pending.take(&body.key)
    else {
        return Err(AppError::BadRequest("défi expiré, recommence".into()));
    };
    // Un ajout à un compte existant exige toujours la même session.
    if !new_user
        && optional_user(&state, &jar).await?.as_deref() != Some(user_id.to_string().as_str())
    {
        return Err(AppError::Unauthorized);
    }
    let passkey = state
        .webauthn
        .finish_passkey_registration(&body.credential, &reg)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let subject = cred_subject(passkey.cred_id());
    if state.db.find_identity(PROVIDER, &subject).await?.is_some() {
        return Err(AppError::BadRequest("passkey déjà enregistrée".into()));
    }
    let uid = user_id.to_string();
    if new_user {
        state
            .db
            .create_user_with_id(&uid, display_name.as_deref())
            .await?;
    }
    let label = body.label.map(|l| l.chars().take(80).collect::<String>());
    state
        .db
        .add_identity(
            &uid,
            "passkey",
            PROVIDER,
            &subject,
            label.as_deref(),
            Some(&serde_json::to_string(&passkey)?),
        )
        .await?;
    let jar = if new_user {
        jar.add(session_cookie(&state, state.db.create_session(&uid).await?))
    } else {
        jar
    };
    Ok((jar, Json(json!({ "ok": true }))))
}

pub async fn login_start(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    if !state.config.passkey.enabled {
        return Err(AppError::Forbidden("passkeys désactivées".into()));
    }
    let (options, auth) = state
        .webauthn
        .start_discoverable_authentication()
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let key = super::random_token("");
    state
        .webauthn_pending
        .put(key.clone(), Pending::Login(auth));
    Ok(Json(json!({ "key": key, "options": options })))
}

#[derive(Deserialize)]
pub struct LoginFinish {
    pub key: String,
    pub credential: PublicKeyCredential,
}

pub async fn login_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<LoginFinish>,
) -> Result<(CookieJar, Json<Value>), AppError> {
    let Some(Pending::Login(auth)) = state.webauthn_pending.take(&body.key) else {
        return Err(AppError::BadRequest("défi expiré, recommence".into()));
    };
    let (user_uuid, cred_id) = state
        .webauthn
        .identify_discoverable_authentication(&body.credential)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let subject = cred_subject(cred_id);
    let Some((uid, Some(cred))) = state.db.find_identity(PROVIDER, &subject).await? else {
        return Err(AppError::Unauthorized);
    };
    if uid != user_uuid.to_string() {
        return Err(AppError::Unauthorized);
    }
    let mut passkey: Passkey = serde_json::from_str(&cred)?;
    let result = state
        .webauthn
        .finish_discoverable_authentication_v2(&body.credential, auth, &passkey)
        .map_err(|_| AppError::Unauthorized)?;
    if passkey.update_credential(&result) == Some(true) {
        state
            .db
            .update_credential(PROVIDER, &subject, &serde_json::to_string(&passkey)?)
            .await?;
    }
    let jar = jar.add(session_cookie(&state, state.db.create_session(&uid).await?));
    Ok((jar, Json(json!({ "ok": true }))))
}
