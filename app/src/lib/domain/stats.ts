import type { ChartPeriod, LifeEvent, Period, Tracker, TrackerField } from '../types';
import { DAY, addMonths, dayKey, dayNumber, keyFromDayNumber, periodKey, previousPeriod } from './time';

export interface Gap {
  from: number;
  to: number;
  /** Écart en cours (jusqu'à maintenant). */
  current: boolean;
}

export interface TrackerStats {
  count: number;
  lastAt: number | null;
  /** Début de l'écart en cours (dernier événement, ou création du compteur). */
  currentGapFrom: number;
  longestGap: Gap | null;
  gaps: Gap[];
  currentStreak: number;
  longestStreak: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  /** Comptes par jour local "AAAA-MM-JJ". */
  perDay: Map<string, number>;
}

const evMs = (e: LifeEvent) => Date.parse(e.occurred_at);
export const evDay = (e: LifeEvent) => dayKey(evMs(e), e.tz_offset);

/** Statistiques d'un compteur. `events` : non supprimés, dans n'importe quel ordre. */
export function computeStats(tracker: Tracker, events: LifeEvent[], now: number, tzOffset: number): TrackerStats {
  const sorted = [...events].sort((a, b) => evMs(a) - evMs(b));
  const times = sorted.map(evMs);
  const created = Date.parse(tracker.created_at);

  // Écarts entre événements consécutifs (et depuis la création si elle précède le premier).
  const gaps: Gap[] = [];
  let prev: number | null = times.length && created < times[0] ? created : null;
  for (const t of times) {
    if (prev !== null && t > prev) gaps.push({ from: prev, to: t, current: false });
    prev = t;
  }
  const currentGapFrom = times.length ? times[times.length - 1] : created;
  if (now > currentGapFrom) gaps.push({ from: currentGapFrom, to: now, current: true });
  const longestGap = gaps.reduce<Gap | null>((m, g) => (!m || g.to - g.from > m.to - m.from ? g : m), null);

  // Comptes par jour local.
  const perDay = new Map<string, number>();
  for (const e of sorted) perDay.set(evDay(e), (perDay.get(evDay(e)) ?? 0) + 1);

  // Séries de jours consécutifs.
  const days = [...perDay.keys()].map(dayNumber).sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }
  const todayKey = dayKey(now, tzOffset);
  const todayN = dayNumber(todayKey);
  let currentStreak = 0;
  // La série reste en cours si le dernier jour est aujourd'hui ou hier.
  let cursor = perDay.has(todayKey) ? todayN : todayN - 1;
  while (perDay.has(keyFromDayNumber(cursor))) {
    currentStreak++;
    cursor--;
  }

  const count = (p: ChartPeriod) => countInPeriod(sorted, periodKey(todayKey, p), p);

  return {
    count: sorted.length,
    lastAt: times.length ? times[times.length - 1] : null,
    currentGapFrom,
    longestGap,
    gaps,
    currentStreak,
    longestStreak,
    today: count('day'),
    thisWeek: count('week'),
    thisMonth: count('month'),
    thisYear: count('year'),
    perDay,
  };
}

export function countInPeriod(events: LifeEvent[], key: string, period: ChartPeriod): number {
  let n = 0;
  for (const e of events) if (periodKey(evDay(e), period) === key) n++;
  return n;
}

/**
 * Comptes de N périodes consécutives, de la plus ancienne à la plus récente.
 * offset = nombre de fenêtres de N périodes à remonter (0 : la fenêtre finit sur la période en cours).
 */
export function periodSeries(
  events: LifeEvent[],
  period: ChartPeriod,
  n: number,
  now: number,
  tzOffset: number,
  offset = 0,
): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const k = periodKey(evDay(e), period);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: { key: string; count: number }[] = [];
  let k = periodKey(dayKey(now, tzOffset), period);
  for (let i = 0; i < offset * n; i++) k = previousPeriod(k, period);
  for (let i = 0; i < n; i++) {
    out.unshift({ key: k, count: counts.get(k) ?? 0 });
    k = previousPeriod(k, period);
  }
  return out;
}

// ---------- objectifs ----------

export interface GoalStatus {
  kind: 'max' | 'min';
  target: number;
  period: Period;
  current: number;
  /** max : encore sous la limite ; min : objectif déjà atteint. */
  met: boolean;
  /** Périodes terminées consécutives où l'objectif a été tenu. */
  streak: number;
  bestStreak: number;
}

export function goalStatus(tracker: Tracker, events: LifeEvent[], now: number, tzOffset: number): GoalStatus | null {
  const { goal_kind: kind, goal_count: target, goal_period: period } = tracker;
  if (!kind || target === null || target === undefined || !period) return null;
  const counts = new Map<string, number>();
  for (const e of events) {
    const k = periodKey(evDay(e), period);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const ok = (n: number) => (kind === 'max' ? n <= target : n >= target);
  const currentKey = periodKey(dayKey(now, tzOffset), period);
  const current = counts.get(currentKey) ?? 0;

  // Périodes terminées, depuis la création du compteur (ou le premier événement).
  const created = Date.parse(tracker.created_at);
  const first = events.reduce((m, e) => Math.min(m, evMs(e)), created);
  const startKey = periodKey(dayKey(first, tzOffset), period);
  const keys: string[] = [];
  let k = previousPeriod(currentKey, period);
  while (k >= startKey && keys.length < 5000) {
    keys.unshift(k);
    k = previousPeriod(k, period);
  }
  let bestStreak = 0;
  let run = 0;
  for (const key of keys) {
    run = ok(counts.get(key) ?? 0) ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }
  return { kind, target, period, current, met: ok(current), streak: run, bestStreak };
}

// ---------- mesures ----------

export interface FieldSummary {
  field: TrackerField;
  last: number | null;
  total: number;
  average: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

export function fieldSummaries(fields: TrackerField[], events: LifeEvent[]): FieldSummary[] {
  const sorted = [...events].sort((a, b) => evMs(a) - evMs(b));
  return fields.map((field) => {
    const values = sorted.map((e) => e.measures?.[field.id]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const total = values.reduce((s, v) => s + v, 0);
    return {
      field,
      last: values.length ? values[values.length - 1] : null,
      total,
      average: values.length ? total / values.length : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      count: values.length,
    };
  });
}

/** Calendrier des N derniers jours (heatmap). */
export function heatmap(perDay: Map<string, number>, now: number, tzOffset: number, days = 371): { key: string; count: number }[] {
  const today = dayNumber(dayKey(now, tzOffset));
  // Aligne la première colonne sur un lundi.
  let start = today - days + 1;
  start -= (new Date(start * DAY).getUTCDay() + 6) % 7;
  const out: { key: string; count: number }[] = [];
  for (let n = start; n <= today; n++) {
    const key = keyFromDayNumber(n);
    out.push({ key, count: perDay.get(key) ?? 0 });
  }
  return out;
}

export { addMonths };

/** Événements dont la période (au sens de `period`) tombe entre deux clés incluses. */
export function eventsInRange(events: LifeEvent[], period: ChartPeriod, firstKey: string, lastKey: string): LifeEvent[] {
  return events.filter((e) => {
    const k = periodKey(evDay(e), period);
    return k >= firstKey && k <= lastKey;
  });
}

export interface MeasurePoint {
  key: string;
  /** Moyenne des valeurs de la période, null s'il n'y en a pas. */
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

/** Moyenne d'une mesure par période, alignée sur les clés d'une série de périodes. */
export function measureSeries(events: LifeEvent[], fieldId: string, period: ChartPeriod, keys: string[]): MeasurePoint[] {
  const byKey = new Map<string, number[]>();
  for (const e of events) {
    const v = e.measures?.[fieldId];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const k = periodKey(evDay(e), period);
    const list = byKey.get(k);
    if (list) list.push(v);
    else byKey.set(k, [v]);
  }
  return keys.map((key) => {
    const values = byKey.get(key) ?? [];
    if (!values.length) return { key, avg: null, min: null, max: null, count: 0 };
    return {
      key,
      avg: values.reduce((s, v) => s + v, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
  });
}
