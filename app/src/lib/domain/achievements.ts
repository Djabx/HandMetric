import type { Tracker } from '../types';
import { DAY, addMonths } from './time';
import type { GoalStatus, TrackerStats } from './stats';

export type AchievementKind = 'abstinence' | 'count' | 'streak' | 'goal';

export interface Achievement {
  id: string;
  kind: AchievementKind;
  /** Valeur du palier (jours, mois, nombre, périodes). */
  value: number;
  unit: 'day' | 'month' | 'year' | 'event' | 'period';
  unlocked: boolean;
  /** Abstinence : palier tenu par l'écart en cours. */
  active: boolean;
  /** Progression vers le palier, entre 0 et 1. */
  progress: number;
}

type Threshold = { value: number; unit: 'day' | 'month' | 'year' };

/**
 * Trophées activés pour ce compteur ? Par défaut oui, sauf pour les compteurs
 * « neutres » (mesures comme la tension ou le poids), où ils n'ont pas de sens.
 */
export function achievementsEnabled(tracker: Pick<Tracker, 'achievements' | 'polarity'>): boolean {
  if (tracker.achievements === 0 || tracker.achievements === 1) return tracker.achievements === 1;
  return tracker.polarity !== 'neutral';
}

/**
 * Paliers d'abstinence au-delà d'un an : 2, 3, 5, 10 ans, puis tous les 5 ans
 * (pas un trophée chaque année pendant 20 ans).
 */
export function yearMilestones(upTo: number): number[] {
  const out = [2, 3, 5, 10];
  let y = 15;
  while (out[out.length - 1] <= upTo) {
    out.push(y);
    y += 5;
  }
  return out.filter((v, i) => i === 0 || out[i - 1] <= upTo);
}

const ABSTINENCE: Threshold[] = [
  { value: 1, unit: 'day' },
  { value: 3, unit: 'day' },
  { value: 7, unit: 'day' },
  { value: 14, unit: 'day' },
  { value: 1, unit: 'month' },
  { value: 3, unit: 'month' },
  { value: 6, unit: 'month' },
  { value: 1, unit: 'year' },
];
const COUNTS = [1, 10, 50, 100, 500, 1000];
const STREAKS = [7, 30, 100];
const GOAL_STREAKS = [1, 4, 12, 52];

function reached(th: Threshold, from: number, to: number): boolean {
  if (th.unit === 'day') return to - from >= th.value * DAY;
  return to >= addMonths(from, th.unit === 'month' ? th.value : th.value * 12);
}

function ratio(th: Threshold, from: number, to: number): number {
  const target = th.unit === 'day' ? from + th.value * DAY : addMonths(from, th.unit === 'month' ? th.value : th.value * 12);
  return Math.min(1, Math.max(0, (to - from) / (target - from)));
}

/** Liste des succès d'un compteur, calculés à partir des statistiques. */
export function achievements(tracker: Tracker, stats: TrackerStats, goal: GoalStatus | null): Achievement[] {
  const out: Achievement[] = [];
  if (!achievementsEnabled(tracker)) return out;
  // Compter ou enchaîner les occurrences n'est une réussite que pour un « bon » compteur :
  // fumer 10 cigarettes ou prendre sa tension 10 fois ne mérite pas de trophée.
  const good = tracker.polarity === 'good';

  if (tracker.display_mode === 'abstinence') {
    // Paliers fixes, puis 2, 3, 5, 10 ans et tous les 5 ans, jusqu'au prochain après le record.
    const longest = stats.longestGap;
    const years = longest ? Math.floor((longest.to - longest.from) / (365.25 * DAY)) : 0;
    const thresholds = [...ABSTINENCE, ...yearMilestones(years).map((value) => ({ value, unit: 'year' as const }))];
    const current = stats.gaps.find((g) => g.current);
    for (const th of thresholds) {
      const unlocked = stats.gaps.some((g) => reached(th, g.from, g.to));
      const active = !!current && reached(th, current.from, current.to);
      out.push({
        id: `abstinence-${th.value}${th.unit[0]}`,
        kind: 'abstinence',
        value: th.value,
        unit: th.unit,
        unlocked,
        active,
        progress: current ? ratio(th, current.from, current.to) : 0,
      });
    }
  }

  for (const n of good ? COUNTS : []) {
    out.push({ id: `count-${n}`, kind: 'count', value: n, unit: 'event', unlocked: stats.count >= n, active: false, progress: Math.min(1, stats.count / n) });
  }

  if (good && tracker.display_mode === 'frequency') {
    for (const n of STREAKS) {
      out.push({
        id: `streak-${n}`,
        kind: 'streak',
        value: n,
        unit: 'day',
        unlocked: stats.longestStreak >= n,
        active: stats.currentStreak >= n,
        progress: Math.min(1, stats.currentStreak / n),
      });
    }
  }

  if (goal) {
    for (const n of GOAL_STREAKS) {
      out.push({
        id: `goal-${n}`,
        kind: 'goal',
        value: n,
        unit: 'period',
        unlocked: goal.bestStreak >= n,
        active: goal.streak >= n,
        progress: Math.min(1, goal.streak / n),
      });
    }
  }
  return out;
}
