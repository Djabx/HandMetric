-- Compteur de périodes, avec un début et une fin (sommeil, jeûne) : NULL ou 0 = non, 1 = oui.
ALTER TABLE tracker ADD COLUMN span INTEGER;
-- Fin d'une période (instant UTC), pour un compteur de périodes. NULL : instant, ou période en cours.
ALTER TABLE event ADD COLUMN ended_at TEXT;
