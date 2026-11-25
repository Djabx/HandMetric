//! Tests d'intégration de l'API, sur SQLite (toujours) et PostgreSQL (si LIFELOG_TEST_PG est défini).

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use lifelog_server::config::{Config, FileConfig};
use lifelog_server::{router, AppState};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn backends() -> Vec<(String, AppState)> {
    let mut out = Vec::new();
    let dir = tempfile::tempdir().unwrap().keep();
    let mut urls = vec![format!("sqlite://{}/t.db?mode=rwc", dir.display())];
    if let Ok(pg) = std::env::var("LIFELOG_TEST_PG") {
        urls.push(pg);
    }
    for url in urls {
        let file = FileConfig {
            database_url: Some(url.clone()),
            public_url: Some("https://lifelog.example.org".into()),
            ..Default::default()
        };
        let state = AppState::new(Config::from_parts(file).unwrap())
            .await
            .unwrap();
        out.push((url, state));
    }
    out
}

struct Client {
    app: axum::Router,
    cookie: Option<String>,
}

impl Client {
    async fn req(
        &self,
        method: &str,
        uri: &str,
        body: Option<Value>,
        auth: Option<&str>,
    ) -> (StatusCode, Value, Vec<u8>) {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(c) = &self.cookie {
            b = b.header("cookie", c);
        }
        if let Some(a) = auth {
            b = b.header("authorization", format!("Bearer {a}"));
        }
        let req = match body {
            Some(v) => b
                .header("content-type", "application/json")
                .body(Body::from(v.to_string()))
                .unwrap(),
            None => b.body(Body::empty()).unwrap(),
        };
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        let v = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, v, bytes)
    }
}

async fn login(state: &AppState) -> Client {
    let user = state.db.create_user(Some("Alex")).await.unwrap();
    let token = state.db.create_session(&user.id).await.unwrap();
    Client {
        app: router(state.clone()),
        cookie: Some(format!("lifelog_session={token}")),
    }
}

fn tracker(id: &str, name: &str, hlc: &str) -> Value {
    json!({
        "id": id, "name": name, "icon": "🏃", "color": null, "polarity": "good", "display_mode": "frequency",
        "goal_kind": "min", "goal_count": 3, "goal_period": "week", "sort_order": 0, "archived_at": null,
        "created_at": "2026-11-25T08:00:00.000Z", "updated_at": hlc, "deleted_at": null, "device_id": "dev1"
    })
}

fn field(id: &str, tracker_id: &str, name: &str, unit: &str) -> Value {
    json!({
        "id": id, "tracker_id": tracker_id, "name": name, "unit": unit, "sort_order": 0,
        "created_at": "2026-11-25T08:00:00.000Z", "updated_at": "1795600000000-0000-dev1", "deleted_at": null, "device_id": "dev1"
    })
}

fn event(id: &str, tracker_id: &str, hlc: &str) -> Value {
    json!({
        "id": id, "tracker_id": tracker_id, "occurred_at": "2026-11-25T08:30:00.000Z", "tz_offset": 60,
        "measures": null, "note": "test", "created_at": "2026-11-25T08:30:00.000Z", "updated_at": hlc,
        "deleted_at": null, "device_id": "dev1"
    })
}

#[tokio::test]
async fn sync_push_pull_merge() {
    for (url, state) in backends().await {
        let c = login(&state).await;
        let anon = Client {
            app: router(state.clone()),
            cookie: None,
        };
        assert_eq!(
            anon.req("GET", "/api/v1/changes", None, None).await.0,
            StatusCode::UNAUTHORIZED,
            "{url}"
        );

        let changes = json!({ "changes": {
            "tracker": [tracker("t1", "Course", "1795600000000-0000-dev1")],
            "tracker_field": [field("f1", "t1", "Distance", "km")],
            "event": [event("e1", "t1", "1795600000001-0000-dev1"), event("e2", "t1", "1795600000002-0000-dev1"), {"id": "bad"}],
        }});
        let (s, v, _) = c
            .req("POST", "/api/v1/changes", Some(changes.clone()), None)
            .await;
        assert_eq!(s, StatusCode::OK, "{url} {v}");
        assert_eq!(v["summary"]["inserted"], 4, "{url}");
        assert_eq!(v["summary"]["ignored"], 1, "{url}");

        // Idempotent.
        let (_, v, _) = c.req("POST", "/api/v1/changes", Some(changes), None).await;
        assert_eq!(v["summary"]["inserted"], 0, "{url}");
        assert_eq!(v["summary"]["ignored"], 5, "{url}");

        // Une version plus ancienne ne remplace pas, une plus récente oui.
        let older = json!({ "changes": { "tracker": [tracker("t1", "Vieux", "1795500000000-0000-dev2")] } });
        let (_, v, _) = c.req("POST", "/api/v1/changes", Some(older), None).await;
        assert_eq!(v["summary"]["ignored"], 1);
        let mut newer_t = tracker("t1", "Course à pied", "1795700000000-0000-dev2");
        newer_t["achievements"] = json!(0);
        let newer = json!({ "changes": { "tracker": [newer_t] } });
        let (_, v, _) = c.req("POST", "/api/v1/changes", Some(newer), None).await;
        assert_eq!(v["summary"]["updated"], 1);

        // Pull paginé : tout arrive, dans l'ordre, sans doublon.
        let mut cursor = 0;
        let mut seen = Vec::new();
        loop {
            let (s, v, _) = c
                .req(
                    "GET",
                    &format!("/api/v1/changes?since={cursor}&limit=2"),
                    None,
                    None,
                )
                .await;
            assert_eq!(s, StatusCode::OK);
            for t in ["tracker", "tracker_field", "event"] {
                for r in v["changes"][t].as_array().unwrap() {
                    seen.push(r["id"].as_str().unwrap().to_string());
                    assert!(r.get("user_id").is_none() && r.get("server_seq").is_none());
                }
            }
            cursor = v["cursor"].as_i64().unwrap();
            if !v["has_more"].as_bool().unwrap() {
                break;
            }
        }
        seen.sort();
        assert_eq!(seen, vec!["e1", "e2", "f1", "t1"], "{url}");
        let (_, v, _) = c.req("GET", "/api/v1/changes?since=0", None, None).await;
        assert_eq!(v["changes"]["tracker"][0]["name"], "Course à pied");
        assert_eq!(v["changes"]["tracker"][0]["goal_count"], 3);
        assert_eq!(v["changes"]["tracker"][0]["achievements"], 0, "{url}");

        // Isolation entre utilisateurs.
        let other = login(&state).await;
        let (_, v, _) = other
            .req("GET", "/api/v1/changes?since=0", None, None)
            .await;
        assert_eq!(
            v["changes"]["tracker"].as_array().unwrap().len(),
            0,
            "{url}"
        );
    }
}

#[tokio::test]
async fn purge_erases_rows_for_good() {
    for (url, state) in backends().await {
        let c = login(&state).await;
        let data = json!({ "changes": {
            "tracker": [tracker("t1", "Cigarette", "1795600000000-0000-dev1"), tracker("t2", "Course", "1795600000000-0000-dev1")],
            "tracker_field": [field("f1", "t1", "Nombre", "")],
            "event": [event("e1", "t1", "1795600000001-0000-dev1"), event("e2", "t2", "1795600000001-0000-dev1"), event("e3", "t2", "1795600000002-0000-dev1")],
        }});
        c.req("POST", "/api/v1/changes", Some(data.clone()), None)
            .await;
        let (_, v, _) = c.req("GET", "/api/v1/changes?since=0", None, None).await;
        let cursor = v["cursor"].as_i64().unwrap();

        // Compteur t1 (avec champ et événement) et événement e3 effacés.
        let purge = json!({ "changes": { "purge": [
            {"id": "t1", "tbl": "tracker", "updated_at": "1795600000010-0000-dev1", "device_id": "dev1"},
            {"id": "e3", "tbl": "event", "updated_at": "1795600000011-0000-dev1", "device_id": "dev1"},
            {"id": "x", "tbl": "app_user", "updated_at": "1795600000011-0000-dev1", "device_id": "dev1"},
        ]}});
        let (s, v, _) = c.req("POST", "/api/v1/changes", Some(purge), None).await;
        assert_eq!(s, StatusCode::OK, "{url} {v}");
        assert_eq!(v["summary"]["inserted"], 2, "{url}");
        assert_eq!(v["summary"]["ignored"], 1, "{url}");

        // Plus aucune ligne en base, à part l'identifiant effacé.
        let (_, me, _) = c.req("GET", "/api/v1/me", None, None).await;
        let uid = me["user"]["id"].as_str().unwrap().to_string();
        for (table, n) in [
            ("tracker", 1),
            ("tracker_field", 0),
            ("event", 1),
            ("purge", 2),
        ] {
            let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM {table} WHERE user_id = $1"
            )))
            .bind(&uid)
            .fetch_one(&state.db.pool)
            .await
            .unwrap();
            assert_eq!(count, n, "{url} {table}");
        }

        // Les autres appareils reçoivent l'effacement.
        let (_, v, _) = c
            .req(
                "GET",
                &format!("/api/v1/changes?since={cursor}"),
                None,
                None,
            )
            .await;
        let ids: Vec<&str> = v["changes"]["purge"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["t1", "e3"], "{url}");
        assert!(v["changes"]["purge"][0].get("user_id").is_none());

        // Un appareil en retard qui renvoie les anciennes lignes, même plus récentes, ne les fait pas revenir.
        let stale = json!({ "changes": {
            "tracker": [tracker("t1", "Cigarette", "1795700000000-0000-dev2")],
            "tracker_field": [field("f1", "t1", "Nombre", "")],
            "event": [event("e1", "t1", "1795700000001-0000-dev2"), event("e3", "t2", "1795700000002-0000-dev2")],
        }});
        let (_, v, _) = c.req("POST", "/api/v1/changes", Some(stale), None).await;
        assert_eq!(v["summary"]["ignored"], 4, "{url}");
        let (_, v, _) = c.req("GET", "/api/v1/export?format=json", None, None).await;
        assert_eq!(v["trackers"].as_array().unwrap().len(), 1, "{url}");
        assert_eq!(v["events"].as_array().unwrap().len(), 1, "{url}");
        assert!(v.get("purge").is_none(), "{url}");
    }
}

#[tokio::test]
async fn tokens_webhooks_export_import() {
    for (url, state) in backends().await {
        let c = login(&state).await;
        let push = json!({ "changes": {
            "tracker": [tracker("t1", "Tension", "1795600000000-0000-dev1")],
            "tracker_field": [field("sys", "t1", "Systolique", "mm[Hg]"), field("dia", "t1", "Diastolique", "mm[Hg]")],
        }});
        c.req("POST", "/api/v1/changes", Some(push), None).await;

        let (s, v, _) = c
            .req(
                "POST",
                "/api/v1/tokens",
                Some(json!({"name": "Raccourci", "scope": "webhook", "tracker_id": "t1"})),
                None,
            )
            .await;
        assert_eq!(s, StatusCode::CREATED, "{url} {v}");
        let secret = v["secret"].as_str().unwrap().to_string();
        assert!(secret.starts_with("lt_") && secret.len() > 40);
        assert!(v["webhook_url"]
            .as_str()
            .unwrap()
            .starts_with("https://lifelog.example.org/hooks/lt_"));

        let anon = Client {
            app: router(state.clone()),
            cookie: None,
        };
        // Webhook par URL, corps vide.
        let (s, _, _) = anon
            .req("POST", &format!("/hooks/{secret}"), None, None)
            .await;
        assert_eq!(s, StatusCode::CREATED, "{url}");
        // Webhook par en-tête, mesures par nom.
        let (s, v, _) = anon
            .req("POST", "/hooks", Some(json!({"measures": {"systolique": 12.5, "Diastolique": "8,2"}, "note": "matin"})), Some(&secret))
            .await;
        assert_eq!(s, StatusCode::CREATED, "{url} {v}");
        let m: Value = serde_json::from_str(v["measures"].as_str().unwrap()).unwrap();
        assert_eq!(m["sys"], 12.5);
        assert_eq!(m["dia"], 8.2);
        // Mauvais jeton, mesure inconnue, portée insuffisante.
        assert_eq!(
            anon.req("POST", "/hooks/lt_nope", None, None).await.0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            anon.req(
                "POST",
                "/hooks",
                Some(json!({"measures": {"x": 1}})),
                Some(&secret)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            anon.req("GET", "/api/v1/export", None, Some(&secret))
                .await
                .0,
            StatusCode::FORBIDDEN
        );

        // Jeton d'export.
        let (_, v, _) = c
            .req(
                "POST",
                "/api/v1/tokens",
                Some(json!({"name": "Backup", "scope": "export:read"})),
                None,
            )
            .await;
        let exp = v["secret"].as_str().unwrap().to_string();
        let (s, json_export, _) = anon
            .req("GET", "/api/v1/export?format=json", None, Some(&exp))
            .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(json_export["format"], "lifelog");
        assert_eq!(json_export["events"].as_array().unwrap().len(), 2, "{url}");
        let (s, _, sqlite) = anon
            .req("GET", "/api/v1/export?format=sqlite", None, Some(&exp))
            .await;
        assert_eq!(s, StatusCode::OK);
        assert!(sqlite.starts_with(b"SQLite format 3\0"));

        // Import du fichier SQLite par un autre utilisateur : tout arrive.
        let other = login(&state).await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/import")
            .header("cookie", other.cookie.clone().unwrap())
            .body(Body::from(sqlite.clone()))
            .unwrap();
        let res = other.app.clone().oneshot(req).await.unwrap();
        let st = res.status();
        let body: Value =
            serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(st, StatusCode::OK, "{url} {body}");
        assert_eq!(body["summary"]["inserted"], 5, "{url} {body}");
        // Et l'import JSON est idempotent.
        let (_, v, _) = other
            .req("POST", "/api/v1/import", Some(json_export), None)
            .await;
        assert_eq!(v["summary"]["inserted"], 0, "{url} {v}");

        // Révocation.
        let (_, v, _) = c.req("GET", "/api/v1/tokens", None, None).await;
        let id = v["tokens"][0]["id"].as_str().unwrap().to_string();
        assert!(v["tokens"][0]["last_used_at"].is_string());
        assert_eq!(
            c.req("DELETE", &format!("/api/v1/tokens/{id}"), None, None)
                .await
                .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            anon.req("POST", &format!("/hooks/{secret}"), None, None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
}

#[tokio::test]
async fn health_and_registration_config() {
    let mut file = FileConfig::default();
    let dir = tempfile::tempdir().unwrap().keep();
    file.database_url = Some(format!("sqlite://{}/h.db?mode=rwc", dir.display()));
    file.registration.enabled = false;
    let toml_cfg: FileConfig = toml::from_str(
        r#"
        [auth.oidc.pocket-id]
        issuer = "https://id.example.org"
        client_id = "lifelog"
        client_secret = "s"
        display_name = "Pocket ID"
        "#,
    )
    .unwrap();
    file.auth.oidc = toml_cfg.auth.oidc;
    let state = AppState::new(Config::from_parts(file).unwrap())
        .await
        .unwrap();
    let c = Client {
        app: router(state.clone()),
        cookie: None,
    };
    let (_, v, _) = c.req("GET", "/api/v1/health", None, None).await;
    assert_eq!(v["auth"]["registration"], false);
    assert_eq!(v["auth"]["passkey_registration"], false);
    assert_eq!(v["auth"]["oidc"][0]["name"], "Pocket ID");
    // Inscription par passkey refusée quand fermée.
    assert_eq!(
        c.req(
            "POST",
            "/auth/passkey/register/start",
            Some(json!({})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    // Connexion par passkey : le défi est généré.
    let (s, v, _) = c.req("POST", "/auth/passkey/login/start", None, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["options"]["publicKey"]["challenge"].is_string());
}
