import { describe, expect, it } from 'vitest';
import { isPlanned, needsCompletion } from './planned';
import type { LifeEvent } from '../types';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const fields = [{ id: 'km' }, { id: 'min' }];
function ev(occurred: string, created: string, measures: Record<string, number> | null = null): LifeEvent {
  return {
    id: 'e', tracker_id: 't', occurred_at: occurred, tz_offset: 60, measures, note: null,
    created_at: created, updated_at: created, deleted_at: null, device_id: 'd',
  };
}

describe('planned events', () => {
  it('is planned while in the future', () => {
    expect(isPlanned(ev('2026-11-29T08:00:00Z', '2026-11-28T10:00:00Z'), NOW)).toBe(true);
    expect(isPlanned(ev('2026-11-28T08:00:00Z', '2026-11-28T10:00:00Z'), NOW)).toBe(false);
  });

  it('asks to complete a past planned event without its measures', () => {
    expect(needsCompletion(ev('2026-11-27T18:00:00Z', '2026-11-26T09:00:00Z'), fields, NOW)).toBe(true);
    expect(needsCompletion(ev('2026-11-27T18:00:00Z', '2026-11-26T09:00:00Z', { km: 8 }), fields, NOW)).toBe(true);
  });

  it('leaves complete, upcoming, back-dated and field-less events alone', () => {
    expect(needsCompletion(ev('2026-11-27T18:00:00Z', '2026-11-26T09:00:00Z', { km: 8, min: 47 }), fields, NOW)).toBe(false);
    expect(needsCompletion(ev('2026-11-29T18:00:00Z', '2026-11-26T09:00:00Z'), fields, NOW)).toBe(false);
    expect(needsCompletion(ev('2026-11-27T18:00:00Z', '2026-11-28T09:00:00Z'), fields, NOW)).toBe(false);
    expect(needsCompletion(ev('2026-11-27T18:00:00Z', '2026-11-26T09:00:00Z'), [], NOW)).toBe(false);
  });
});
