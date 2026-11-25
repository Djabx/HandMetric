//! Routes HTTP de l'API.

use crate::auth::{self, bearer, require_user, ApiToken, SESSION_COOKIE};
use crate::db::{now, ChangeSet, Row};
use crate::error::AppError;
use crate::export;
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum_extra::extract::CookieJar;
use chrono::{Offset, TimeZone};
use serde::Deserialize;
use serde_json::{json, Map, Value};

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let c = &state.config;
    Json(json!({
        "name": "lifelog",
        "version": env!("CARGO_PKG_VERSION"),
        "schema_version": export::SCHEMA_VERSION,
        "auth": {
            "registration": c.registration_enabled,
            "passkey": c.passkey.enabled,
            "passkey_registration": c.passkey.enabled && auth::may_register(&state, None),
            "oidc": c.oidc.iter().map(|(id, p)| json!({ "id": id, "name": p.display_name })).collect::<Vec<_>>(),
        }
    }))
}

pub async fn me(State(state): State<AppState>, jar: CookieJar) -> Result<Json<Value>, AppError> {
    let uid = require_user(&state, &jar).await?;
    let user = state
        .db
        .get_user(&uid)
        .await?
        .ok_or(AppError::Unauthorized)?;
    let identities = state.db.identities(&uid).await?;
    Ok(Json(json!({ "user": user, "identities": identities })))
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        state.db.delete_session(c.value()).await?;
    }
    Ok((
        jar.remove(axum_extra::extract::cookie::Cookie::build(SESSION_COOKIE).path("/")),
        StatusCode::NO_CONTENT,
    ))
}

pub async fn delete_identity(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let uid = require_user(&state, &jar).await?;
    if state.db.delete_identity(&uid, &id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::BadRequest(
            "impossible de supprimer le dernier moyen de connexion".into(),
        ))
    }
}

// ---------- synchronisation ----------

#[derive(Deserialize)]
pub struct ChangesQuery {
    since: Option<i64>,
    limit: Option<i64>,
}

pub async fn pull(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(q): Query<ChangesQuery>,
) -> Result<Json<Value>, AppError> {
    let uid = require_user(&state, &jar).await?;
    let limit = q.limit.unwrap_or(500).clamp(1, 2000);
    let (changes, cursor, has_more) = state
        .db
        .changes_since(&uid, q.since.unwrap_or(0), limit)
        .await?;
    Ok(Json(
        json!({ "changes": changes, "cursor": cursor, "has_more": has_more }),
    ))
}

#[derive(Deserialize)]
pub struct PushBody {
    changes: ChangeSet,
}

pub async fn push(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<PushBody>,
) -> Result<Json<Value>, AppError> {
    let uid = require_user(&state, &jar).await?;
    if body.changes.len() > 10_000 {
        return Err(AppError::BadRequest(
            "lot trop gros (10 000 lignes max)".into(),
        ));
    }
    let summary = state.db.apply(&uid, &body.changes).await?;
    Ok(Json(json!({ "summary": summary })))
}

// ---------- import / export ----------

/// Session, ou jeton avec la portée demandée.
async fn user_or_token(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    scope: &str,
) -> Result<(String, Option<ApiToken>), AppError> {
    if let Some(tok) = bearer(headers) {
        let t = state
            .db
            .token_auth(tok)
            .await?
            .ok_or(AppError::Unauthorized)?;
        if t.scope != scope && !(scope == "webhook" && t.scope == "events:write") {
            return Err(AppError::Forbidden("portée du jeton insuffisante".into()));
        }
        if !state.rate_limit.check(&t.id) {
            return Err(AppError::TooManyRequests);
        }
        return Ok((t.user_id.clone(), Some(t)));
    }
    Ok((require_user(state, jar).await?, None))
}

pub async fn import(
    State(state): State<AppState>,
    jar: CookieJar,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let uid = require_user(&state, &jar).await?;
    let changes = match export::parse_any(&body).map_err(|e| AppError::BadRequest(e.to_string()))? {
        Some(v) => export::from_json(&v).map_err(|e| AppError::BadRequest(e.to_string()))?,
        None => export::from_sqlite(&body)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?,
    };
    let summary = state.db.apply(&uid, &changes).await?;
    Ok(Json(json!({ "summary": summary })))
}

#[derive(Deserialize)]
pub struct ExportQuery {
    format: Option<String>,
}

pub async fn export_data(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Query(q): Query<ExportQuery>,
) -> Result<Response, AppError> {
    let (uid, _) = user_or_token(&state, &jar, &headers, "export:read").await?;
    let data = state.db.snapshot(&uid).await?;
    let date = chrono::Utc::now().format("%Y-%m-%d");
    match q.format.as_deref().unwrap_or("json") {
        "sqlite" => {
            let bytes = export::to_sqlite(&data, crate::hlc::SERVER_DEVICE).await?;
            Ok((
                [
                    (header::CONTENT_TYPE, "application/vnd.sqlite3".to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"lifelog-{date}.lifelog.sqlite\""),
                    ),
                ],
                bytes,
            )
                .into_response())
        }
        "json" => Ok((
            [(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"lifelog-{date}.json\""),
            )],
            Json(export::to_json(&data)),
        )
            .into_response()),
        _ => Err(AppError::BadRequest("format : json ou sqlite".into())),
    }
}

// ---------- événements poussés de l'extérieur ----------

#[derive(Deserialize, Default)]
pub struct NewEvent {
    occurred_at: Option<String>,
    tz_offset: Option<i64>,
    note: Option<String>,
    /// Clés : id du champ ou nom (insensible à la casse).
    measures: Option<Map<String, Value>>,
}

async fn create_event(
    state: &AppState,
    user_id: &str,
    tracker_id: &str,
    body: NewEvent,
) -> Result<Value, AppError> {
    if !state.db.tracker_exists(user_id, tracker_id).await? {
        return Err(AppError::NotFound);
    }
    let at = match &body.occurred_at {
        Some(s) => chrono::DateTime::parse_from_rfc3339(s)
            .map_err(|_| AppError::BadRequest("occurred_at : date RFC 3339 attendue".into()))?
            .with_timezone(&chrono::Utc),
        None => chrono::Utc::now(),
    };
    let tz_offset = body.tz_offset.unwrap_or_else(|| {
        i64::from(
            state
                .config
                .timezone
                .offset_from_utc_datetime(&at.naive_utc())
                .fix()
                .local_minus_utc()
                / 60,
        )
    });
    let mut measures = Map::new();
    if let Some(m) = body.measures {
        let fields = state.db.tracker_fields(user_id, tracker_id).await?;
        for (k, v) in m {
            let Some(n) = v
                .as_f64()
                .or_else(|| v.as_str().and_then(|s| s.replace(',', ".").parse().ok()))
            else {
                return Err(AppError::BadRequest(format!(
                    "mesure « {k} » : nombre attendu"
                )));
            };
            let Some((id, _)) = fields
                .iter()
                .find(|(id, name)| *id == k || name.to_lowercase() == k.to_lowercase())
            else {
                return Err(AppError::BadRequest(format!("mesure inconnue : {k}")));
            };
            measures.insert(id.clone(), json!(n));
        }
    }
    let id = uuid::Uuid::now_v7().to_string();
    let mut row = Row::new();
    row.insert("id".into(), json!(id));
    row.insert("tracker_id".into(), json!(tracker_id));
    row.insert(
        "occurred_at".into(),
        json!(at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
    );
    row.insert("tz_offset".into(), json!(tz_offset));
    row.insert(
        "measures".into(),
        if measures.is_empty() {
            Value::Null
        } else {
            json!(Value::Object(measures).to_string())
        },
    );
    row.insert(
        "note".into(),
        body.note
            .map(|n| json!(n.chars().take(2000).collect::<String>()))
            .unwrap_or(Value::Null),
    );
    row.insert("created_at".into(), json!(now()));
    row.insert("updated_at".into(), json!(state.hlc.now()));
    row.insert("deleted_at".into(), Value::Null);
    row.insert("device_id".into(), json!(crate::hlc::SERVER_DEVICE));
    let changes = ChangeSet {
        event: vec![row.clone()],
        ..Default::default()
    };
    state.db.apply(user_id, &changes).await?;
    Ok(Value::Object(row))
}

fn parse_body(body: &Bytes) -> Result<NewEvent, AppError> {
    if body.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok(NewEvent::default());
    }
    serde_json::from_slice(body).map_err(|e| AppError::BadRequest(format!("JSON invalide : {e}")))
}

/// POST /api/v1/trackers/{id}/events — session ou jeton `events:write`.
pub async fn add_event(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(tracker_id): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let (uid, tok) = user_or_token(&state, &jar, &headers, "events:write").await?;
    if let Some(t) = &tok {
        if t.scope != "events:write" {
            return Err(AppError::Forbidden("portée du jeton insuffisante".into()));
        }
    }
    let ev = create_event(&state, &uid, &tracker_id, parse_body(&body)?).await?;
    Ok((StatusCode::CREATED, Json(ev)))
}

async fn hook_inner(
    state: &AppState,
    token: &str,
    body: &Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let t = state
        .db
        .token_auth(token)
        .await?
        .ok_or(AppError::NotFound)?;
    if t.scope != "webhook" {
        return Err(AppError::NotFound);
    }
    if !state.rate_limit.check(&t.id) {
        return Err(AppError::TooManyRequests);
    }
    let tracker = t.tracker_id.clone().ok_or(AppError::NotFound)?;
    let ev = create_event(state, &t.user_id, &tracker, parse_body(body)?).await?;
    Ok((StatusCode::CREATED, Json(ev)))
}

/// POST /hooks/{token}
pub async fn hook_url(
    State(state): State<AppState>,
    Path(token): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    hook_inner(&state, &token, &body).await
}

/// POST /hooks avec `Authorization: Bearer lt_…` (le jeton n'apparaît pas dans les logs d'accès).
pub async fn hook_header(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let token = bearer(&headers).ok_or(AppError::Unauthorized)?.to_string();
    hook_inner(&state, &token, &body).await
}

// ---------- jetons ----------

pub async fn list_tokens(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Value>, AppError> {
    let uid = require_user(&state, &jar).await?;
    Ok(Json(json!({ "tokens": state.db.tokens(&uid).await? })))
}

#[derive(Deserialize)]
pub struct NewToken {
    name: String,
    scope: String,
    tracker_id: Option<String>,
}

pub async fn create_token(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(b): Json<NewToken>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let uid = require_user(&state, &jar).await?;
    let name = b.name.trim().chars().take(80).collect::<String>();
    if name.is_empty() {
        return Err(AppError::BadRequest("nom obligatoire".into()));
    }
    let tracker = match b.scope.as_str() {
        "webhook" => {
            let id = b.tracker_id.ok_or_else(|| {
                AppError::BadRequest("compteur obligatoire pour un webhook".into())
            })?;
            if !state.db.tracker_exists(&uid, &id).await? {
                return Err(AppError::BadRequest(
                    "compteur inconnu (synchronise d'abord)".into(),
                ));
            }
            Some(id)
        }
        "events:write" | "export:read" => None,
        _ => return Err(AppError::BadRequest("portée inconnue".into())),
    };
    let (info, token) = state
        .db
        .create_token(&uid, &name, &b.scope, tracker.as_deref())
        .await?;
    let mut hook = state.config.public_url.clone();
    hook.set_path(&format!("/hooks/{token}"));
    Ok((
        StatusCode::CREATED,
        Json(
            json!({ "token": info, "secret": token, "webhook_url": (b.scope == "webhook").then(|| hook.to_string()) }),
        ),
    ))
}

pub async fn revoke_token(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let uid = require_user(&state, &jar).await?;
    if state.db.revoke_token(&uid, &id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}
