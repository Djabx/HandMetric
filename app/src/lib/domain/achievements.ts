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

  if (tracker.display_mode === 'abstinence') {
    // Paliers fixes, puis chaque année supplémentaire au-delà du record.
    const longest = stats.longestGap;
    const years = longest ? Math.floor((longest.to - longest.from) / (365.25 * DAY)) : 0;
    const thresholds = [...ABSTINENCE];
    for (let y = 2; y <= Math.max(2, years + 1); y++) thresholds.push({ value: y, unit: 'year' });
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

  for (const n of COUNTS) {
    out.push({ id: `count-${n}`, kind: 'count', value: n, unit: 'event', unlocked: stats.count >= n, active: false, progress: Math.min(1, stats.count / n) });
  }

  if (tracker.display_mode === 'frequency') {
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
