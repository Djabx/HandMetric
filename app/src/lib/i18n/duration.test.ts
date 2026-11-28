import { describe, expect, it } from 'vitest';
import { humanDuration, i18n, untilLabel } from './index.svelte';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('humanDuration', () => {
  i18n.lang = 'fr';
  const from = new Date(2006, 2, 12, 9, 30).getTime();

  it('ne descend jamais aux secondes', () => {
    expect(humanDuration(from, from + 42_000)).toBe("moins d'une minute");
    expect(humanDuration(from, from + 12 * MIN + 59_000)).toBe('12 minutes');
  });

  it("garde l'unité principale et la suivante", () => {
    expect(humanDuration(from, from + 3 * DAY + 4 * HOUR + 12 * MIN)).toBe('3 jours et 4 heures');
    expect(humanDuration(from, from + 16 * DAY + 5 * HOUR)).toBe('16 jours et 5 heures');
  });

  it('affiche les jours après les mois, en mois calendaires', () => {
    const start = new Date(2026, 9, 24, 8, 0).getTime();
    expect(humanDuration(start, new Date(2026, 10, 27, 11, 17).getTime())).toBe('1 mois et 3 jours');
    expect(humanDuration(start, new Date(2026, 10, 24, 11, 17).getTime())).toBe('1 mois');
    expect(humanDuration(start, new Date(2027, 1, 7, 11, 17).getTime())).toBe('3 mois et 14 jours');
  });

  it("n'affiche pas d'unité trop fine pour une longue durée", () => {
    expect(humanDuration(from, new Date(2026, 2, 12, 17, 3).getTime())).toBe('20 ans');
    expect(humanDuration(from, new Date(2026, 4, 20).getTime())).toBe('20 ans et 2 mois');
    expect(humanDuration(from, new Date(2007, 2, 15).getTime())).toBe('1 an');
  });
});

describe('humanDuration (en)', () => {
  it('shows days after months', () => {
    i18n.lang = 'en';
    try {
      const start = new Date(2026, 9, 24, 8, 0).getTime();
      expect(humanDuration(start, new Date(2026, 10, 27, 11, 17).getTime())).toBe('1 month and 3 days');
      expect(humanDuration(start, new Date(2026, 9, 25, 11, 17).getTime())).toBe('1 day and 3 hours');
    } finally {
      i18n.lang = 'fr';
    }
  });
});

describe('untilLabel', () => {
  i18n.lang = 'fr';
  const now = new Date(2026, 10, 28, 10, 0).getTime();
  const at = (mo: number, d: number, h = 20, mi = 0) => new Date(2026, mo, d, h, mi).getTime();

  it('counts hours and minutes on the same day', () => {
    expect(untilLabel(now + 20_000, now)).toBe('dans un instant');
    expect(untilLabel(at(10, 28, 10, 25), now)).toBe('dans 25 minutes');
    expect(untilLabel(at(10, 28, 20, 30), now)).toBe('dans 10 heures et 30 minutes');
  });

  it('counts calendar days within a month, whatever the hour', () => {
    expect(untilLabel(at(10, 29, 8), now)).toBe('demain');
    expect(untilLabel(at(11, 3, 9, 15), now)).toBe('dans 5 jours');
    expect(untilLabel(at(11, 27, 9), now)).toBe('dans 29 jours');
  });

  it('switches to months, and keeps only the main unit when short', () => {
    expect(untilLabel(at(11, 31, 20, 30), now)).toBe('dans 1 mois et 3 jours');
    expect(untilLabel(at(11, 31, 20, 30), now, 'short')).toBe('dans 1 mois');
    expect(untilLabel(at(11, 3, 9, 15), now, 'bare')).toBe('5 jours');
    expect(untilLabel(new Date(2028, 0, 2).getTime(), now, 'short')).toBe('dans 1 an');
  });
});

describe('clockDuration', () => {
  it('reads periods on a clock, in hours and minutes', async () => {
    const { clockDuration } = await import('./index.svelte');
    expect(clockDuration(445 * 60_000)).toBe('7 h 25');
    expect(clockDuration(7 * 3_600_000)).toBe('7 h');
    expect(clockDuration(45 * 60_000)).toBe('45 min');
    expect(clockDuration(65 * 60_000)).toBe('1 h 05');
    expect(clockDuration(36 * 3_600_000)).toBe('36 h');
  });
});
