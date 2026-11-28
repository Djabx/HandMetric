import type { TileSize, Tracker } from '../types';

export const TILE_SIZES: readonly TileSize[] = ['small', 'normal', 'wide', 'tall'];

/** Objectif assez petit pour être montré en bâtons (voir la tuile). */
export const TALLY_MAX = 15;

/**
 * Taille de la tuile d'un compteur sur l'accueil. Choisie par l'utilisateur, ou
 * automatiquement : large pour l'abstinence (le chrono en gros) et pour les mesures
 * (dernière valeur et courbe) et pour les périodes (le chrono), haute pour un petit objectif (les bâtons), normale sinon.
 */
export function tileSize(tracker: Pick<Tracker, 'tile' | 'display_mode' | 'goal_count' | 'span'>, fieldCount: number): TileSize {
  if (tracker.tile && TILE_SIZES.includes(tracker.tile)) return tracker.tile;
  if (tracker.display_mode === 'abstinence' || tracker.span === 1 || fieldCount > 0) return 'wide';
  if (tracker.goal_count && tracker.goal_count > 0 && tracker.goal_count <= TALLY_MAX) return 'tall';
  return 'normal';
}
