-- Schéma du fichier d'export, identique à app/src/lib/db/schema.ts (DATA_SCHEMA).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  icon         TEXT,
  color        TEXT,
  polarity     TEXT NOT NULL CHECK (polarity IN ('good','bad','neutral')),
  display_mode TEXT NOT NULL CHECK (display_mode IN ('abstinence','frequency')),
  goal_kind    TEXT CHECK (goal_kind IN ('max','min')),
  goal_count   INTEGER,
  goal_period  TEXT CHECK (goal_period IN ('day','week','month')),
  sort_order   REAL NOT NULL DEFAULT 0,
  archived_at  TEXT,
  achievements INTEGER,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker_field (
  id           TEXT PRIMARY KEY,
  tracker_id   TEXT NOT NULL REFERENCES tracker(id),
  name         TEXT NOT NULL,
  unit         TEXT,
  sort_order   REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS field_by_tracker ON tracker_field(tracker_id);

CREATE TABLE IF NOT EXISTS event (
  id           TEXT PRIMARY KEY,
  tracker_id   TEXT NOT NULL REFERENCES tracker(id),
  occurred_at  TEXT NOT NULL,
  tz_offset    INTEGER NOT NULL,
  measures     TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  device_id    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_by_tracker_time ON event(tracker_id, occurred_at);
CREATE INDEX IF NOT EXISTS event_by_updated ON event(updated_at);
