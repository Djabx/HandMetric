import { describe, expect, it } from 'vitest';
import { humanDuration, i18n } from './index.svelte';

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
    expect(humanDuration(from, from + 16 * DAY + 5 * HOUR)).toBe('2 semaines et 2 jours');
  });

  it("n'affiche pas d'unité trop fine pour une longue durée", () => {
    expect(humanDuration(from, new Date(2026, 2, 12, 17, 3).getTime())).toBe('20 ans');
    expect(humanDuration(from, new Date(2026, 4, 20).getTime())).toBe('20 ans et 2 mois');
    expect(humanDuration(from, new Date(2007, 2, 15).getTime())).toBe('1 an');
  });
});
