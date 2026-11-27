import { describe, expect, it } from 'vitest';
import type { LifeEvent, Tracker } from '../types';
import { computeStats, goalStatus, periodSeries } from './stats';
import { achievements, yearMilestones } from './achievements';
import { DAY, breakdown, periodKey, addMonths } from './time';

const T0 = Date.parse('2026-01-01T12:00:00Z');

function tracker(over: Partial<Tracker> = {}): Tracker {
  return {
    id: 't', name: 'x', icon: null, color: null, polarity: 'bad', display_mode: 'abstinence',
    goal_kind: null, goal_count: null, goal_period: null, sort_order: 0, archived_at: null,
    created_at: new Date(T0).toISOString(), updated_at: '', deleted_at: null, device_id: 'd', ...over,
  };
}
const ev = (ms: number, tz = 60): LifeEvent => ({
  id: String(ms), tracker_id: 't', occurred_at: new Date(ms).toISOString(), tz_offset: tz, measures: null, note: null,
  created_at: '', updated_at: '', deleted_at: null, device_id: 'd',
});

describe('time', () => {
  it('calcule les semaines ISO et les mois calendaires', () => {
    expect(periodKey('2026-11-25', 'week')).toBe('2026-11-23');
    expect(periodKey('2026-11-23', 'week')).toBe('2026-11-23');
    expect(new Date(addMonths(Date.parse('2026-01-31T00:00:00Z'), 1)).toISOString().slice(0, 10)).toBe('2026-02-28');
    const b = breakdown(Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-07-03T05:00:00Z'));
    expect(b).toMatchObject({ years: 0, months: 6, days: 2, hours: 5 });
  });
});

describe('stats', () => {
  it('écart en cours, record, succès d\'abstinence', () => {
    const t = tracker();
    const events = [ev(T0 + 1 * DAY), ev(T0 + 2 * DAY), ev(T0 + 40 * DAY)];
    const now = T0 + 50 * DAY;
    const s = computeStats(t, events, now, 60);
    expect(s.count).toBe(3);
    expect(s.currentGapFrom).toBe(T0 + 40 * DAY);
    expect(s.longestGap!.to - s.longestGap!.from).toBe(38 * DAY);
    const a = achievements(t, s, null);
    const m1 = a.find((x) => x.id === 'abstinence-1m')!;
    expect(m1.unlocked).toBe(true);
    expect(m1.active).toBe(false);
    expect(a.find((x) => x.id === 'abstinence-7d')!.active).toBe(true);
    expect(a.find((x) => x.id === 'abstinence-3m')!.unlocked).toBe(false);
  });

  it('séries de jours et jour local', () => {
    const t = tracker({ display_mode: 'frequency', polarity: 'good' });
    // 23h30 UTC = 00h30 à Paris : compte pour le lendemain.
    const base = Date.parse('2026-03-01T23:30:00Z');
    const events = [ev(base), ev(base + DAY), ev(base + 2 * DAY), ev(base + 5 * DAY)];
    const s = computeStats(t, events, base + 5 * DAY + 3600_000, 60);
    expect([...s.perDay.keys()][0]).toBe('2026-03-02');
    expect(s.longestStreak).toBe(3);
    expect(s.currentStreak).toBe(1);
    expect(s.today).toBe(1);
  });

  it('objectifs : max par semaine, série de semaines tenues', () => {
    const created = Date.parse('2026-11-02T08:00:00Z'); // lundi
    const t = tracker({ created_at: new Date(created).toISOString(), goal_kind: 'max', goal_count: 2, goal_period: 'week' });
    const events = [
      ev(created + 1 * DAY), ev(created + 2 * DAY), ev(created + 3 * DAY), // semaine 1 : 3 > 2
      ev(created + 8 * DAY), // semaine 2 : ok
      // semaine 3 : 0, ok
      ev(created + 22 * DAY), // semaine 4 (en cours) : 1
    ];
    const g = goalStatus(t, events, created + 23 * DAY, 60)!;
    expect(g.current).toBe(1);
    expect(g.met).toBe(true);
    expect(g.streak).toBe(2);
    expect(g.bestStreak).toBe(2);
    expect(periodSeries(events, 'week', 4, created + 23 * DAY, 60).map((p) => p.count)).toEqual([3, 1, 0, 1]);
  });
});

describe('périodes affichées', () => {
  it("compte par année et remonte dans le passé", async () => {
    const { periodSeries } = await import('./stats');
    const ev = (iso: string) => ({ id: iso, tracker_id: 't', occurred_at: iso, tz_offset: 0, measures: {}, note: '', created_at: iso, updated_at: '', device_id: '', deleted_at: null });
    const events = [ev('2006-03-12T10:00:00Z'), ev('2006-07-01T10:00:00Z'), ev('2025-01-01T10:00:00Z')];
    const now = Date.parse('2026-11-25T12:00:00Z');
    const recent = periodSeries(events as never, 'year', 10, now, 0);
    expect(recent.map((d) => d.key)).toEqual(['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
    expect(recent.find((d) => d.key === '2025')?.count).toBe(1);
    const older = periodSeries(events as never, 'year', 10, now, 0, 2);
    expect(older[0].key).toBe('1997');
    expect(older.find((d) => d.key === '2006')?.count).toBe(2);
    const months = periodSeries(events as never, 'month', 12, now, 0, 1);
    expect(months.map((d) => d.key)[0]).toBe('2024-12');
    expect(months[1].count).toBe(1); // janvier 2025
  });
});

describe('mesures par période', () => {
  it('moyenne par période et résumé sur la plage', async () => {
    const { measureSeries, eventsInRange, fieldSummaries } = await import('./stats');
    const ev = (iso: string, sys: number, dia: number) => ({ id: iso, tracker_id: 't', occurred_at: iso, tz_offset: 0, measures: { sys, dia }, note: '', created_at: iso, updated_at: '', device_id: '', deleted_at: null });
    const events = [ev('2026-09-03T08:00:00Z', 130, 85), ev('2026-09-20T08:00:00Z', 120, 80), ev('2026-11-02T08:00:00Z', 118, 76)];
    const s = measureSeries(events as never, 'sys', 'month', ['2026-09', '2026-10', '2026-11']);
    expect(s.map((p) => p.avg)).toEqual([125, null, 118]);
    const inRange = eventsInRange(events as never, 'month', '2026-10', '2026-11');
    expect(inRange).toHaveLength(1);
    const [dia] = fieldSummaries([{ id: 'dia', tracker_id: 't', name: 'Dia', unit: null, sort_order: 0 }] as never, inRange);
    expect(dia.average).toBe(76);
  });
});

describe('trophées', () => {
  it('jamais pour une occurrence d\'un mauvais compteur', () => {
    const t = tracker();
    const s = computeStats(t, [ev(T0 + 3_600_000)], T0 + 7_200_000, 60);
    const a = achievements(t, s, null);
    expect(a.some((x) => x.kind === 'count' || x.kind === 'streak')).toBe(false);
    expect(a.some((x) => x.unlocked)).toBe(false);
  });

  it('désactivés par défaut pour un compteur neutre, activables', () => {
    const t = tracker({ polarity: 'neutral', display_mode: 'frequency' });
    const s = computeStats(t, [ev(T0 + DAY)], T0 + 2 * DAY, 60);
    expect(achievements(t, s, null)).toEqual([]);
    expect(achievements({ ...t, achievements: 1 }, s, null).length).toBe(0);
    const good = tracker({ polarity: 'good', display_mode: 'frequency' });
    expect(achievements(good, s, null).length).toBeGreaterThan(0);
    expect(achievements({ ...good, achievements: 0 }, s, null)).toEqual([]);
  });

  it('paliers espacés au-delà d\'un an', () => {
    expect(yearMilestones(0)).toEqual([2]);
    expect(yearMilestones(4)).toEqual([2, 3, 5]);
    expect(yearMilestones(20)).toEqual([2, 3, 5, 10, 15, 20, 25]);
  });
});
