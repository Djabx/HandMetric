import type { ChartPeriod } from '../types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Jour local "AAAA-MM-JJ" d'un instant, selon un décalage en minutes. */
export function dayKey(ms: number, tzOffset: number): string {
  return new Date(ms + tzOffset * MINUTE).toISOString().slice(0, 10);
}

/** Numéro de jour (entier) d'une clé "AAAA-MM-JJ" (jours depuis l'epoch). */
export function dayNumber(key: string): number {
  return Math.round(Date.parse(key + 'T00:00:00Z') / DAY);
}

export function keyFromDayNumber(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

/** Clé de période d'une clé de jour : jour, semaine ISO (lundi), mois. */
export function periodKey(day: string, period: ChartPeriod): string {
  if (period === 'day') return day;
  if (period === 'year') return day.slice(0, 4);
  if (period === 'month') return day.slice(0, 7);
  const n = dayNumber(day);
  const weekday = (new Date(n * DAY).getUTCDay() + 6) % 7; // lundi = 0
  return keyFromDayNumber(n - weekday);
}

/** Période précédente (clé). */
export function previousPeriod(key: string, period: ChartPeriod): string {
  if (period === 'year') return String(Number(key) - 1);
  if (period === 'day') return keyFromDayNumber(dayNumber(key) - 1);
  if (period === 'week') return keyFromDayNumber(dayNumber(key) - 7);
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** Ajoute des mois calendaires (le 31 janvier + 1 mois = fin février). */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

/** Décomposition calendaire d'un intervalle : années, mois, jours, heures, minutes, secondes. */
export interface Breakdown {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalDays: number;
}

export function breakdown(from: number, to: number): Breakdown {
  const span = Math.max(0, to - from);
  let months = 0;
  while (addMonths(from, months + 1) <= to) months++;
  const afterMonths = addMonths(from, months);
  let rest = Math.max(0, to - afterMonths);
  const days = Math.floor(rest / DAY);
  rest -= days * DAY;
  const hours = Math.floor(rest / HOUR);
  rest -= hours * HOUR;
  const minutes = Math.floor(rest / MINUTE);
  rest -= minutes * MINUTE;
  return {
    years: Math.floor(months / 12),
    months: months % 12,
    days,
    hours,
    minutes,
    seconds: Math.floor(rest / 1000),
    totalDays: Math.floor(span / DAY),
  };
}
