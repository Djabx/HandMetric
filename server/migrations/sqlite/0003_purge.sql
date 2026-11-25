-- Effacements définitifs : seul l'identifiant de la ligne effacée est gardé,
-- pour propager l'effacement aux appareils et refuser qu'une ligne effacée revienne.
CREATE TABLE IF NOT EXISTS purge (
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  tbl        TEXT NOT NULL CHECK (tbl IN ('tracker','tracker_field','event')),
  updated_at TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  server_seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS purge_seq ON purge(user_id, server_seq);

-- Anciens compteurs supprimés définitivement (lignes vidées, nommées ∅) : effacés pour de bon.
INSERT INTO purge (user_id, id, tbl, updated_at, device_id, server_seq)
  SELECT user_id, id, 'tracker', updated_at, device_id, server_seq FROM tracker WHERE name = '∅';
DELETE FROM event WHERE EXISTS (
  SELECT 1 FROM tracker t WHERE t.user_id = event.user_id AND t.id = event.tracker_id AND t.name = '∅'
);
DELETE FROM tracker_field WHERE EXISTS (
  SELECT 1 FROM tracker t WHERE t.user_id = tracker_field.user_id AND t.id = tracker_field.tracker_id AND t.name = '∅'
);
DELETE FROM tracker WHERE name = '∅';
