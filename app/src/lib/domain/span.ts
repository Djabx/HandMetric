import type { LifeEvent, Tracker } from '../types';
import { dayKey } from './time';

const MIN = 60_000;
const DAY_MIN = 1440;

export const isSpan = (t: Pick<Tracker, 'span'>) => t.span === 1;

/** Length of a finished period, in ms (0 for an instant event or a running period). */
export function durationOf(e: Pick<LifeEvent, 'occurred_at' | 'ended_at'>): number {
  if (!e.ended_at) return 0;
  return Math.max(0, Date.parse(e.ended_at) - Date.parse(e.occurred_at));
}

/** Local minute of the day (0 to 1439) of an instant, with the event's own time zone. */
function minuteOfDay(ms: number, tzOffset: number): number {
  return Math.floor((((ms + tzOffset * MIN) / MIN) % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/**
 * Average time of day, counted from noon so that bedtimes on either side of
 * midnight (23:10, 00:30) average to around midnight, not to midday.
 */
function averageTime(minutes: number[]): number | null {
  if (!minutes.length) return null;
  const fromNoon = minutes.map((m) => (m - 720 + DAY_MIN) % DAY_MIN);
  const avg = fromNoon.reduce((s, m) => s + m, 0) / fromNoon.length;
  return Math.round(avg + 720) % DAY_MIN;
}

export interface SpanBar {
  event: LifeEvent;
  /** Local day of the end, « YYYY-MM-DD » (a night counts for the morning it ends). */
  day: string;
  start: number;
  end: number;
}

export interface SpanStats {
  last: LifeEvent | null;
  lastMs: number;
  /** Average length of the finished periods (the last 30 at most), in ms. */
  avgMs: number | null;
  longestMs: number;
  /** Average local start and end times, in minutes after midnight. */
  avgStart: number | null;
  avgEnd: number | null;
  /** The most recent finished periods, newest first. */
  recent: SpanBar[];
}

/** Statistics of a span tracker. `events`: finished periods (and maybe instant events), any order. */
export function spanStats(events: LifeEvent[], recentCount = 7): SpanStats {
  const done = events.filter((e) => e.ended_at).sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!));
  const window = done.slice(0, 30);
  const lengths = window.map(durationOf);
  return {
    last: done[0] ?? null,
    lastMs: done[0] ? durationOf(done[0]) : 0,
    avgMs: lengths.length ? lengths.reduce((s, n) => s + n, 0) / lengths.length : null,
    longestMs: done.reduce((m, e) => Math.max(m, durationOf(e)), 0),
    avgStart: averageTime(window.map((e) => minuteOfDay(Date.parse(e.occurred_at), e.tz_offset))),
    avgEnd: averageTime(window.map((e) => minuteOfDay(Date.parse(e.ended_at!), e.tz_offset))),
    recent: done.slice(0, recentCount).map((e) => ({
      event: e,
      day: dayKey(Date.parse(e.ended_at!), e.tz_offset),
      start: Date.parse(e.occurred_at),
      end: Date.parse(e.ended_at!),
    })),
  };
}

/**
 * Time window that shows the recent periods side by side, in minutes after local midnight
 * (may go below 0 or past 1440): from the earliest start to the latest end, rounded to whole
 * hours. Starts are taken on the day before the end when they come later in the day.
 */
export function barWindow(bars: SpanBar[]): { from: number; to: number } | null {
  if (!bars.length) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const b of bars) {
    const end = minuteOfDay(b.end, b.event.tz_offset);
    const start = end - (b.end - b.start) / MIN;
    from = Math.min(from, start);
    to = Math.max(to, end);
  }
  return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
}

/** Position of a period in a window: its start and end, in minutes after local midnight of its end day. */
export function barPlace(b: SpanBar): { start: number; end: number } {
  const end = minuteOfDay(b.end, b.event.tz_offset);
  return { start: end - (b.end - b.start) / MIN, end };
}
