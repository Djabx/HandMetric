//! Serveur de synchronisation LifeLog.

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod export;
pub mod hlc;

use axum::extract::Request;
use axum::http::{header, HeaderValue};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::Router;
use std::sync::Arc;
use std::time::Duration;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

pub struct Inner {
    pub config: config::Config,
    pub db: db::Db,
    pub hlc: hlc::Hlc,
    pub webauthn: webauthn_rs::Webauthn,
    pub webauthn_pending: auth::Ephemeral<auth::passkey::Pending>,
    pub oidc_pending: auth::Ephemeral<auth::oidc::Pending>,
    pub oidc_metadata: auth::oidc::MetadataCache,
    pub rate_limit: auth::RateLimiter,
}

impl std::ops::Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl AppState {
    pub async fn new(config: config::Config) -> anyhow::Result<Self> {
        let db = db::Db::connect(&config.database_url).await?;
        let webauthn = auth::passkey::build(&config.public_url)?;
        Ok(Self(Arc::new(Inner {
            db,
            hlc: hlc::Hlc::new(),
            webauthn,
            webauthn_pending: auth::Ephemeral::new(Duration::from_secs(300)),
            oidc_pending: auth::Ephemeral::new(Duration::from_secs(600)),
            oidc_metadata: Default::default(),
            rate_limit: auth::RateLimiter::new(60),
            config,
        })))
    }
}

/// Cache policy for the PWA files.
///
/// Files under `assets/` have a content hash in their name: cached for good. Everything else
/// (`index.html`, `sw.js`, the manifest, icons) must be revalidated, otherwise an installed PWA
/// never sees a new version. `Last-Modified` cannot be trusted for that: in the Nix store every
/// file is dated 1970, so a conditional request would get a `304` after an upgrade. We drop it
/// (and ignore `If-Modified-Since`) so the browser always gets the current file.
async fn static_cache(mut req: Request, next: Next) -> Response {
    let hashed = req.uri().path().contains("/assets/");
    req.headers_mut().remove(header::IF_MODIFIED_SINCE);
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    if hashed {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else {
        headers.remove(header::LAST_MODIFIED);
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    res
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(api::health))
        .route("/me", get(api::me))
        .route("/identities/{id}", delete(api::delete_identity))
        .route("/changes", get(api::pull).post(api::push))
        .route("/import", post(api::import))
        .route("/export", get(api::export_data))
        .route("/trackers/{id}/events", post(api::add_event))
        .route("/tokens", get(api::list_tokens).post(api::create_token))
        .route("/tokens/{id}", delete(api::revoke_token))
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ));

    let auth_routes = Router::new()
        .route("/logout", post(api::logout))
        .route(
            "/passkey/register/start",
            post(auth::passkey::register_start),
        )
        .route(
            "/passkey/register/finish",
            post(auth::passkey::register_finish),
        )
        .route("/passkey/login/start", post(auth::passkey::login_start))
        .route("/passkey/login/finish", post(auth::passkey::login_finish))
        .route("/oidc/callback", get(auth::oidc::callback))
        .route("/oidc/{provider}/start", get(auth::oidc::start));

    let hooks = Router::new()
        .route("/", post(api::hook_header))
        .route("/{token}", post(api::hook_url))
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024));

    let mut app = Router::new()
        .nest("/api/v1", api)
        .nest("/auth", auth_routes)
        .nest("/hooks", hooks);

    if let Some(dir) = &state.config.static_dir {
        let index = dir.join("index.html");
        let files = Router::new()
            .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
            .layer(middleware::from_fn(static_cache));
        app = app.fallback_service(files);
    }

    app.layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state)
}
