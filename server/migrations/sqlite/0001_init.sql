CREATE TABLE IF NOT EXISTS app_user (
  id           TEXT PRIMARY KEY,
  display_name TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('oidc','passkey')),
  provider     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  label        TEXT,
  credential   TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS identity_by_user ON identity(user_id);

CREATE TABLE IF NOT EXISTS session (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_token (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scope        TEXT NOT NULL CHECK (scope IN ('webhook','events:write','export:read')),
  tracker_id   TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS seq_counter (
  id    INTEGER PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO seq_counter (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tracker (
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
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
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  device_id    TEXT NOT NULL,
  server_seq   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS tracker_seq ON tracker(user_id, server_seq);

CREATE TABLE IF NOT EXISTS tracker_field (
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  tracker_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  unit         TEXT,
  sort_order   REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  device_id    TEXT NOT NULL,
  server_seq   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS field_seq ON tracker_field(user_id, server_seq);

CREATE TABLE IF NOT EXISTS event (
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  tracker_id   TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  tz_offset    INTEGER NOT NULL,
  measures     TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  device_id    TEXT NOT NULL,
  server_seq   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS event_seq ON event(user_id, server_seq);
