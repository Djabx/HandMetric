import { describe, expect, it } from 'vitest';
import { barPlace, barWindow, spanStats } from './span';
import { goalStatus } from './stats';
import type { LifeEvent, Tracker } from '../types';

const H = 3_600_000;
const M = 60_000;
/** A night in Paris in winter (UTC+1): local start and end on two days. */
function night(id: string, start: string, end: string): LifeEvent {
  return {
    id, tracker_id: 't', occurred_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString(), tz_offset: 60,
    measures: null, note: null, created_at: start, updated_at: start, deleted_at: null, device_id: 'd',
  };
}
const nights = [
  night('a', '2026-11-25T22:10:00Z', '2026-11-26T05:35:00Z'), // 23:10 → 06:35 local, 7 h 25
  night('b', '2026-11-26T23:30:00Z', '2026-11-27T05:30:00Z'), // 00:30 → 06:30 local, 6 h
];

describe('span trackers', () => {
  it('measures lengths and averages bedtimes across midnight', () => {
    const s = spanStats(nights);
    expect(s.last?.id).toBe('b');
    expect(s.lastMs).toBe(6 * H);
    expect(s.longestMs).toBe(7 * H + 25 * M);
    expect(s.avgMs).toBe((13 * H + 25 * M) / 2);
    // 23:10 and 00:30 average to 23:50, not to midday.
    expect(s.avgStart).toBe(23 * 60 + 50);
    expect(s.avgEnd).toBe(6 * 60 + 33);
    expect(s.recent.map((b) => b.day)).toEqual(['2026-11-27', '2026-11-26']);
  });

  it('places nights on a shared axis around midnight', () => {
    const s = spanStats(nights);
    expect(barWindow(s.recent)).toEqual({ from: -60, to: 7 * 60 });
    expect(barPlace(s.recent[1])).toEqual({ start: -50, end: 395 });
  });

  it('counts a length goal in minutes, on the day the period ends', () => {
    const tracker = {
      id: 't', span: 1, goal_kind: 'min', goal_count: 7 * 60, goal_period: 'day', created_at: '2026-11-20T00:00:00Z',
    } as unknown as Tracker;
    const g = goalStatus(tracker, nights, Date.parse('2026-11-27T10:00:00Z'), 60)!;
    expect(g.unit).toBe('minutes');
    expect(g.current).toBe(6 * 60);
    expect(g.met).toBe(false);
  });
});
