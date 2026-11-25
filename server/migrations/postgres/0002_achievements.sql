-- Trophées par compteur : NULL = selon le type, 0 = non, 1 = oui.
ALTER TABLE tracker ADD COLUMN achievements BIGINT;
