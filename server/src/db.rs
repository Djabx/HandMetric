//! Accès base de données (PostgreSQL ou SQLite) via le pilote `Any` de sqlx.
//! Le SQL est commun aux deux moteurs (placeholders `$1`, `ON CONFLICT`, `RETURNING`).

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::any::{AnyPoolOptions, AnyRow};
use sqlx::{AnyPool, Row as _};

pub type Row = Map<String, Value>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    Postgres,
    Sqlite,
}

#[derive(Clone, Copy)]
enum Ty {
    Text,
    OptText,
    OptInt,
    Int,
    Real,
}

pub const TABLES: [&str; 3] = ["tracker", "tracker_field", "event"];

/// Effacement définitif : identifiant de la ligne effacée, sans aucun contenu.
const PURGE_COLUMNS: &[(&str, Ty)] = &[
    ("id", Ty::Text),
    ("tbl", Ty::Text),
    ("updated_at", Ty::Text),
    ("device_id", Ty::Text),
];

fn columns(table: &str) -> &'static [(&'static str, Ty)] {
    use Ty::*;
    match table {
        "tracker" => &[
            ("id", Text),
            ("name", Text),
            ("icon", OptText),
            ("color", OptText),
            ("polarity", Text),
            ("display_mode", Text),
            ("goal_kind", OptText),
            ("goal_count", OptInt),
            ("goal_period", OptText),
            ("sort_order", Real),
            ("archived_at", OptText),
            ("achievements", OptInt),
            ("tile", OptText),
            ("show_next", OptInt),
            ("span", OptInt),
            ("created_at", Text),
            ("updated_at", Text),
            ("deleted_at", OptText),
            ("device_id", Text),
        ],
        "tracker_field" => &[
            ("id", Text),
            ("tracker_id", Text),
            ("name", Text),
            ("unit", OptText),
            ("sort_order", Real),
            ("created_at", Text),
            ("updated_at", Text),
            ("deleted_at", OptText),
            ("device_id", Text),
        ],
        "event" => &[
            ("id", Text),
            ("tracker_id", Text),
            ("occurred_at", Text),
            ("tz_offset", Int),
            ("measures", OptText),
            ("note", OptText),
            ("ended_at", OptText),
            ("created_at", Text),
            ("updated_at", Text),
            ("deleted_at", OptText),
            ("device_id", Text),
        ],
        "purge" => PURGE_COLUMNS,
        _ => unreachable!("table inconnue"),
    }
}

/// Lot de lignes, par table.
#[derive(Debug, Default, Clone, Serialize, serde::Deserialize)]
pub struct ChangeSet {
    #[serde(default)]
    pub tracker: Vec<Row>,
    #[serde(default)]
    pub tracker_field: Vec<Row>,
    #[serde(default)]
    pub event: Vec<Row>,
    /// Effacements définitifs (synchronisés, jamais exportés).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub purge: Vec<Row>,
}

impl ChangeSet {
    pub fn table(&self, t: &str) -> &Vec<Row> {
        match t {
            "tracker" => &self.tracker,
            "tracker_field" => &self.tracker_field,
            "purge" => &self.purge,
            _ => &self.event,
        }
    }
    fn table_mut(&mut self, t: &str) -> &mut Vec<Row> {
        match t {
            "tracker" => &mut self.tracker,
            "tracker_field" => &mut self.tracker_field,
            "purge" => &mut self.purge,
            _ => &mut self.event,
        }
    }
    pub fn len(&self) -> usize {
        self.tracker.len() + self.tracker_field.len() + self.event.len() + self.purge.len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Default, Serialize, Clone, Copy)]
pub struct MergeSummary {
    pub inserted: u64,
    pub updated: u64,
    pub ignored: u64,
}

/// Normalise une ligne entrante : colonnes connues, types attendus. `None` si invalide.
pub fn sanitize(table: &str, raw: &Row) -> Option<Row> {
    let mut out = Map::new();
    for (col, ty) in columns(table) {
        let v = raw.get(*col).cloned().unwrap_or(Value::Null);
        let v = match (ty, v) {
            (Ty::Text, Value::String(s)) if !s.is_empty() || *col == "device_id" => {
                Value::String(s)
            }
            (Ty::Text, _) => return None,
            (Ty::OptText, Value::Object(o)) if *col == "measures" => {
                Value::String(Value::Object(o).to_string())
            }
            (Ty::OptText, v @ (Value::String(_) | Value::Null)) => v,
            (Ty::OptText, _) => return None,
            (Ty::Int, Value::Number(n)) => Value::from(n.as_f64()? as i64),
            (Ty::Int, _) => return None,
            (Ty::OptInt, Value::Number(n)) => Value::from(n.as_f64()? as i64),
            (Ty::OptInt, Value::Null) => Value::Null,
            (Ty::OptInt, _) => return None,
            (Ty::Real, Value::Number(n)) => Value::from(n.as_f64()?),
            (Ty::Real, Value::Null) => Value::from(0.0),
            (Ty::Real, _) => return None,
        };
        out.insert((*col).to_string(), v);
    }
    match table {
        "tracker" => {
            let ok = |c: &str, allowed: &[&str], opt: bool| match out.get(c) {
                Some(Value::String(s)) => allowed.contains(&s.as_str()),
                Some(Value::Null) | None => opt,
                _ => false,
            };
            if !ok("polarity", &["good", "bad", "neutral"], false)
                || !ok("display_mode", &["abstinence", "frequency"], false)
                || !ok("goal_kind", &["max", "min"], true)
                || !ok("goal_period", &["day", "week", "month"], true)
            {
                return None;
            }
        }
        "purge" => {
            let tbl = out.get("tbl").and_then(|v| v.as_str())?;
            if !TABLES.contains(&tbl) {
                return None;
            }
        }
        "event" => {
            if let Some(Value::String(m)) = out.get("measures") {
                match serde_json::from_str::<Value>(m) {
                    Ok(Value::Object(o)) if o.values().all(|v| v.is_number()) => {}
                    _ => return None,
                }
            }
            let at = out.get("occurred_at").and_then(|v| v.as_str())?;
            chrono::DateTime::parse_from_rfc3339(at).ok()?;
        }
        _ => {}
    }
    Some(out)
}

#[derive(Clone)]
pub struct Db {
    pub pool: AnyPool,
    pub backend: Backend,
}

const PG_MIGRATIONS: &[&str] = &[
    include_str!("../migrations/postgres/0001_init.sql"),
    include_str!("../migrations/postgres/0002_achievements.sql"),
    include_str!("../migrations/postgres/0003_purge.sql"),
    include_str!("../migrations/postgres/0004_tile.sql"),
    include_str!("../migrations/postgres/0005_show_next.sql"),
    include_str!("../migrations/postgres/0006_span.sql"),
];
const SQLITE_MIGRATIONS: &[&str] = &[
    include_str!("../migrations/sqlite/0001_init.sql"),
    include_str!("../migrations/sqlite/0002_achievements.sql"),
    include_str!("../migrations/sqlite/0003_purge.sql"),
    include_str!("../migrations/sqlite/0004_tile.sql"),
    include_str!("../migrations/sqlite/0005_show_next.sql"),
    include_str!("../migrations/sqlite/0006_span.sql"),
];

impl Db {
    pub async fn connect(url: &str) -> Result<Self> {
        sqlx::any::install_default_drivers();
        let backend = if url.starts_with("postgres") {
            Backend::Postgres
        } else if url.starts_with("sqlite") {
            Backend::Sqlite
        } else {
            anyhow::bail!("LIFELOG_DATABASE_URL doit commencer par postgres:// ou sqlite://");
        };
        let mut opts = AnyPoolOptions::new();
        if backend == Backend::Sqlite {
            // SQLite : un seul écrivain, et les clés étrangères à activer par connexion.
            opts = opts.max_connections(1).after_connect(|conn, _| {
                Box::pin(async move {
                    sqlx::query("PRAGMA foreign_keys = ON")
                        .execute(&mut *conn)
                        .await?;
                    sqlx::query("PRAGMA journal_mode = WAL")
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                })
            });
        } else {
            opts = opts.max_connections(10);
        }
        let pool = opts.connect(url).await.context("connexion à la base")?;
        let db = Self { pool, backend };
        db.migrate().await?;
        Ok(db)
    }

    async fn migrate(&self) -> Result<()> {
        let mut conn = self.pool.acquire().await?;
        // PostgreSQL : un seul processus migre à la fois.
        if self.backend == Backend::Postgres {
            sqlx::query("SELECT pg_advisory_lock(7419221)")
                .execute(&mut *conn)
                .await?;
        }
        let result = self.migrate_on(&mut conn).await;
        if self.backend == Backend::Postgres {
            sqlx::query("SELECT pg_advisory_unlock(7419221)")
                .execute(&mut *conn)
                .await?;
        }
        result
    }

    async fn migrate_on(&self, conn: &mut sqlx::AnyConnection) -> Result<()> {
        sqlx::query("CREATE TABLE IF NOT EXISTS lifelog_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
            .execute(&mut *conn)
            .await?;
        let done: Vec<i64> =
            sqlx::query("SELECT CAST(version AS BIGINT) AS v FROM lifelog_migrations")
                .fetch_all(&mut *conn)
                .await?
                .iter()
                .map(|r| r.get::<i64, _>("v"))
                .collect();
        let list = match self.backend {
            Backend::Postgres => PG_MIGRATIONS,
            Backend::Sqlite => SQLITE_MIGRATIONS,
        };
        for (i, sql) in list.iter().enumerate() {
            let v = (i + 1) as i64;
            if done.contains(&v) {
                continue;
            }
            sqlx::query("BEGIN").execute(&mut *conn).await?;
            for stmt in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                if let Err(e) = sqlx::query(stmt).execute(&mut *conn).await {
                    let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
                    return Err(anyhow::Error::from(e).context(format!("migration {v} : {stmt}")));
                }
            }
            sqlx::query("INSERT INTO lifelog_migrations (version, applied_at) VALUES ($1, $2)")
                .bind(v)
                .bind(now())
                .execute(&mut *conn)
                .await?;
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            tracing::info!("migration {v} appliquée");
        }
        Ok(())
    }

    // ---------- synchronisation ----------

    /// Fusionne des lignes (règle last-writer-wins par `updated_at`) et renvoie le résumé.
    pub async fn apply(&self, user_id: &str, changes: &ChangeSet) -> Result<MergeSummary> {
        let mut sum = MergeSummary::default();
        let mut tx = self.pool.begin().await?;
        // Verrouille le compteur de séquence : les poussées sont sérialisées, et l'ordre
        // des server_seq suit l'ordre de validation (aucune ligne « sautée » au pull).
        sqlx::query("UPDATE seq_counter SET value = value WHERE id = 1")
            .execute(&mut *tx)
            .await?;
        // Les effacements d'abord : une ligne effacée ne revient jamais, même plus récente.
        for raw in &changes.purge {
            let Some(row) = sanitize("purge", raw) else {
                sum.ignored += 1;
                continue;
            };
            let s = |c: &str| row[c].as_str().unwrap_or_default().to_string();
            let (id, tbl) = (s("id"), s("tbl"));
            let seq = next_seq(&mut tx).await?;
            let done = sqlx::query(
                "INSERT INTO purge (user_id, id, tbl, updated_at, device_id, server_seq) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, id) DO NOTHING",
            )
            .bind(user_id)
            .bind(&id)
            .bind(&tbl)
            .bind(s("updated_at"))
            .bind(s("device_id"))
            .bind(seq)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if done == 0 {
                sum.ignored += 1;
                continue;
            }
            if tbl == "tracker" {
                for child in ["event", "tracker_field"] {
                    sqlx::query(sqlx::AssertSqlSafe(format!(
                        "DELETE FROM {child} WHERE user_id = $1 AND tracker_id = $2"
                    )))
                    .bind(user_id)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await?;
                }
            }
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {tbl} WHERE user_id = $1 AND id = $2"
            )))
            .bind(user_id)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
            sum.inserted += 1;
        }
        for table in TABLES {
            let cols = columns(table);
            let names: Vec<&str> = cols.iter().map(|(c, _)| *c).collect();
            let placeholders: Vec<String> =
                (1..=names.len() + 2).map(|i| format!("${i}")).collect();
            let set: Vec<String> = names
                .iter()
                .filter(|c| **c != "id")
                .map(|c| format!("{c} = excluded.{c}"))
                .chain(std::iter::once(
                    "server_seq = excluded.server_seq".to_string(),
                ))
                .collect();
            let sql = format!(
                "INSERT INTO {table} (user_id, {}, server_seq) VALUES ({}) ON CONFLICT (user_id, id) DO UPDATE SET {}",
                names.join(", "),
                placeholders.join(", "),
                set.join(", ")
            );
            for raw in changes.table(table) {
                let Some(row) = sanitize(table, raw) else {
                    sum.ignored += 1;
                    continue;
                };
                let id = row["id"].as_str().unwrap_or_default();
                let updated_at = row["updated_at"].as_str().unwrap_or_default();
                let parent = row.get("tracker_id").and_then(Value::as_str).unwrap_or(id);
                let purged =
                    sqlx::query("SELECT id FROM purge WHERE user_id = $1 AND (id = $2 OR id = $3)")
                        .bind(user_id)
                        .bind(id)
                        .bind(parent)
                        .fetch_optional(&mut *tx)
                        .await?
                        .is_some();
                if purged {
                    sum.ignored += 1;
                    continue;
                }
                let current: Option<String> = sqlx::query(sqlx::AssertSqlSafe(format!(
                    "SELECT updated_at FROM {table} WHERE user_id = $1 AND id = $2"
                )))
                .bind(user_id)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .map(|r| r.get::<String, _>("updated_at"));
                if matches!(&current, Some(c) if c.as_str() >= updated_at) {
                    sum.ignored += 1;
                    continue;
                }
                let seq = next_seq(&mut tx).await?;
                let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.as_str())).bind(user_id);
                for (col, ty) in cols {
                    let v = &row[*col];
                    q = match ty {
                        Ty::Text | Ty::OptText => q.bind(v.as_str().map(str::to_string)),
                        Ty::Int | Ty::OptInt => q.bind(v.as_i64()),
                        Ty::Real => q.bind(v.as_f64()),
                    };
                }
                q.bind(seq).execute(&mut *tx).await?;
                if current.is_some() {
                    sum.updated += 1;
                } else {
                    sum.inserted += 1;
                }
            }
        }
        tx.commit().await?;
        Ok(sum)
    }

    /// Lignes de l'utilisateur avec `server_seq > cursor`, par ordre de séquence.
    pub async fn changes_since(
        &self,
        user_id: &str,
        cursor: i64,
        limit: i64,
    ) -> Result<(ChangeSet, i64, bool)> {
        let mut all: Vec<(i64, &str, Row)> = Vec::new();
        let mut truncated = false;
        for table in ["purge", "tracker", "tracker_field", "event"] {
            let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT * FROM {table} WHERE user_id = $1 AND server_seq > $2 ORDER BY server_seq LIMIT $3"
            )))
            .bind(user_id)
            .bind(cursor)
            .bind(limit + 1)
            .fetch_all(&self.pool)
            .await?;
            if rows.len() as i64 > limit {
                truncated = true;
            }
            for r in rows.iter().take(limit as usize) {
                let seq: i64 = r.get("server_seq");
                all.push((seq, table, decode(table, r)?));
            }
        }
        all.sort_by_key(|(s, _, _)| *s);
        let has_more = truncated || all.len() as i64 > limit;
        all.truncate(limit as usize);
        let new_cursor = all.last().map(|(s, _, _)| *s).unwrap_or(cursor);
        let mut out = ChangeSet::default();
        for (_, table, row) in all {
            out.table_mut(table).push(row);
        }
        Ok((out, new_cursor, has_more))
    }

    /// Toutes les lignes de l'utilisateur (export).
    pub async fn snapshot(&self, user_id: &str) -> Result<ChangeSet> {
        let mut out = ChangeSet::default();
        for table in TABLES {
            let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT * FROM {table} WHERE user_id = $1 ORDER BY server_seq"
            )))
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
            for r in &rows {
                out.table_mut(table).push(decode(table, r)?);
            }
        }
        Ok(out)
    }

    pub async fn tracker_exists(&self, user_id: &str, tracker_id: &str) -> Result<bool> {
        Ok(sqlx::query(
            "SELECT id FROM tracker WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL",
        )
        .bind(user_id)
        .bind(tracker_id)
        .fetch_optional(&self.pool)
        .await?
        .is_some())
    }

    /// Champs de mesure d'un compteur : (id, nom).
    pub async fn tracker_fields(
        &self,
        user_id: &str,
        tracker_id: &str,
    ) -> Result<Vec<(String, String)>> {
        Ok(sqlx::query("SELECT id, name FROM tracker_field WHERE user_id = $1 AND tracker_id = $2 AND deleted_at IS NULL")
            .bind(user_id)
            .bind(tracker_id)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(|r| (r.get::<String, _>("id"), r.get::<String, _>("name")))
            .collect())
    }
}

async fn next_seq(tx: &mut sqlx::Transaction<'_, sqlx::Any>) -> Result<i64> {
    Ok(
        sqlx::query("UPDATE seq_counter SET value = value + 1 WHERE id = 1 RETURNING value")
            .fetch_one(&mut **tx)
            .await?
            .get::<i64, _>("value"),
    )
}

fn decode(table: &str, r: &AnyRow) -> Result<Row> {
    let mut out = Map::new();
    for (col, ty) in columns(table) {
        let v = match ty {
            Ty::Text | Ty::OptText => r
                .try_get::<Option<String>, _>(*col)?
                .map(Value::from)
                .unwrap_or(Value::Null),
            Ty::Int | Ty::OptInt => r
                .try_get::<Option<i64>, _>(*col)?
                .map(Value::from)
                .unwrap_or(Value::Null),
            Ty::Real => r
                .try_get::<Option<f64>, _>(*col)?
                .map(Value::from)
                .unwrap_or(Value::Null),
        };
        out.insert((*col).to_string(), v);
    }
    Ok(out)
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
