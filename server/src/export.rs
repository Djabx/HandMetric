//! Fichiers d'export / import : SQLite (identique à la PWA) et JSON.

use crate::db::{sanitize, ChangeSet, Row, TABLES};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use sqlx::any::AnyPoolOptions;
use sqlx::Row as _;

pub const SCHEMA_VERSION: i64 = 1;
const EXPORT_SCHEMA: &str = include_str!("export_schema.sql");

fn temp_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("lifelog-{}.sqlite", uuid::Uuid::new_v4()))
}

/// Retire les colonnes propres au serveur, garde le format client.
fn client_row(table: &str, r: &Row) -> Row {
    sanitize(table, r).unwrap_or_else(|| r.clone())
}

pub fn to_json(data: &ChangeSet) -> Value {
    let events: Vec<Value> = data
        .event
        .iter()
        .map(|e| {
            let mut e = client_row("event", e);
            if let Some(Value::String(m)) = e.get("measures").cloned() {
                e.insert(
                    "measures".into(),
                    serde_json::from_str(&m).unwrap_or(Value::Null),
                );
            }
            Value::Object(e)
        })
        .collect();
    json!({
        "format": "lifelog",
        "schema_version": SCHEMA_VERSION,
        "exported_at": crate::db::now(),
        "trackers": data.tracker.iter().map(|r| client_row("tracker", r)).collect::<Vec<_>>(),
        "tracker_fields": data.tracker_field.iter().map(|r| client_row("tracker_field", r)).collect::<Vec<_>>(),
        "events": events,
    })
}

pub fn from_json(v: &Value) -> Result<ChangeSet> {
    if v.get("format").and_then(Value::as_str) != Some("lifelog") {
        bail!("ce fichier n'est pas un export LifeLog");
    }
    if v.get("schema_version").and_then(Value::as_i64).unwrap_or(0) > SCHEMA_VERSION {
        bail!("ce fichier vient d'une version plus récente de LifeLog");
    }
    let rows = |k: &str| -> Vec<Row> {
        v.get(k)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.as_object().cloned()).collect())
            .unwrap_or_default()
    };
    Ok(ChangeSet {
        tracker: rows("trackers"),
        tracker_field: rows("tracker_fields"),
        event: rows("events"),
        purge: Vec::new(),
    })
}

async fn open(path: &std::path::Path) -> Result<sqlx::AnyPool> {
    sqlx::any::install_default_drivers();
    Ok(AnyPoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite://{}?mode=rwc", path.display()))
        .await?)
}

pub async fn to_sqlite(data: &ChangeSet, device_id: &str) -> Result<Vec<u8>> {
    let path = temp_path();
    let result = async {
        let pool = open(&path).await?;
        for stmt in EXPORT_SCHEMA
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(stmt)
                .execute(&pool)
                .await
                .with_context(|| stmt.to_string())?;
        }
        for (k, v) in [
            ("schema_version", SCHEMA_VERSION.to_string()),
            ("app_version", env!("CARGO_PKG_VERSION").to_string()),
            ("exported_at", crate::db::now()),
            ("device_id", device_id.to_string()),
            ("created_at", crate::db::now()),
        ] {
            sqlx::query("INSERT INTO meta (key, value) VALUES ($1, $2)")
                .bind(k)
                .bind(v)
                .execute(&pool)
                .await?;
        }
        let mut tx = pool.begin().await?;
        for table in TABLES {
            for raw in data.table(table) {
                let row = client_row(table, raw);
                let cols: Vec<&String> = row.keys().collect();
                let sql = format!(
                    "INSERT INTO {table} ({}) VALUES ({})",
                    cols.iter()
                        .map(|c| c.as_str())
                        .collect::<Vec<_>>()
                        .join(", "),
                    (1..=cols.len())
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()));
                for c in &cols {
                    q = match &row[*c] {
                        Value::Null => q.bind(None::<String>),
                        Value::String(s) => q.bind(s.clone()),
                        Value::Number(n) if n.is_i64() => q.bind(n.as_i64()),
                        Value::Number(n) => q.bind(n.as_f64()),
                        other => q.bind(other.to_string()),
                    };
                }
                q.execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        pool.close().await;
        Ok::<_, anyhow::Error>(std::fs::read(&path)?)
    }
    .await;
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    result
}

pub async fn from_sqlite(bytes: &[u8]) -> Result<ChangeSet> {
    let path = temp_path();
    std::fs::write(&path, bytes)?;
    let result = async {
        let pool = open(&path).await?;
        let tables: Vec<String> =
            sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table'")
                .fetch_all(&pool)
                .await?
                .iter()
                .map(|r| r.get::<String, _>("name"))
                .collect();
        if !tables.iter().any(|t| t == "tracker") || !tables.iter().any(|t| t == "event") {
            bail!("ce fichier n'est pas un export LifeLog");
        }
        if tables.iter().any(|t| t == "meta") {
            if let Some(r) = sqlx::query("SELECT value FROM meta WHERE key = 'schema_version'")
                .fetch_optional(&pool)
                .await?
            {
                let v: String = r.get("value");
                if v.parse::<i64>().unwrap_or(0) > SCHEMA_VERSION {
                    bail!("ce fichier vient d'une version plus récente de LifeLog");
                }
            }
        }
        let mut out = ChangeSet::default();
        for table in TABLES {
            if !tables.iter().any(|t| t == table) {
                continue;
            }
            // Colonnes présentes : un export plus ancien n'a pas les colonnes ajoutées depuis.
            let present: Vec<String> =
                sqlx::query(sqlx::AssertSqlSafe(format!("PRAGMA table_info({table})")))
                    .fetch_all(&pool)
                    .await?
                    .iter()
                    .map(|r| r.get::<String, _>("name"))
                    .collect();
            // Lecture en JSON côté SQLite : types préservés sans dépendre du pilote.
            let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT json_object({}) AS j FROM {table}",
                json_cols(table, &present)
            )))
            .fetch_all(&pool)
            .await?;
            for r in rows {
                let j: String = r.get("j");
                if let Ok(Value::Object(m)) = serde_json::from_str::<Value>(&j) {
                    match table {
                        "tracker" => out.tracker.push(m),
                        "tracker_field" => out.tracker_field.push(m),
                        _ => out.event.push(m),
                    }
                }
            }
        }
        pool.close().await;
        Ok(out)
    }
    .await;
    let _ = std::fs::remove_file(&path);
    result
}

fn json_cols(table: &str, present: &[String]) -> String {
    let cols: &[&str] = match table {
        "tracker" => &[
            "id",
            "name",
            "icon",
            "color",
            "polarity",
            "display_mode",
            "goal_kind",
            "goal_count",
            "goal_period",
            "sort_order",
            "archived_at",
            "achievements",
            "tile",
            "show_next",
            "created_at",
            "updated_at",
            "deleted_at",
            "device_id",
        ],
        "tracker_field" => &[
            "id",
            "tracker_id",
            "name",
            "unit",
            "sort_order",
            "created_at",
            "updated_at",
            "deleted_at",
            "device_id",
        ],
        _ => &[
            "id",
            "tracker_id",
            "occurred_at",
            "tz_offset",
            "measures",
            "note",
            "created_at",
            "updated_at",
            "deleted_at",
            "device_id",
        ],
    };
    cols.iter()
        .filter(|c| present.iter().any(|p| p == *c))
        .map(|c| format!("'{c}', {c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn parse_any(bytes: &[u8]) -> Result<Option<Value>> {
    if bytes.starts_with(b"SQLite format 3\0") {
        return Ok(None);
    }
    serde_json::from_slice(bytes)
        .map(Some)
        .context("format de fichier non reconnu")
}
