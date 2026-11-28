-- Mettre en avant le prochain événement prévu (compte à rebours) : NULL ou 0 = non, 1 = oui.
ALTER TABLE tracker ADD COLUMN show_next INTEGER;
