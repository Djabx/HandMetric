import type { LifeEvent, TrackerField } from '../types';

/** A minute of slack: an event dated « now » is never a planned one. */
export const PLANNED_SLACK = 60_000;

/** Planned: dated in the future. It only counts once its time comes. */
export function isPlanned(e: Pick<LifeEvent, 'occurred_at'>, now: number): boolean {
  return Date.parse(e.occurred_at) > now;
}

/**
 * A planned event whose time has come but whose measures are still missing: it was
 * written down before it happened (created before its date), so its numbers (km,
 * duration…) could not be known yet. It counts like any other event, and asks to be
 * completed.
 */
export function needsCompletion(e: LifeEvent, fields: Pick<TrackerField, 'id'>[], now: number): boolean {
  if (!fields.length) return false;
  const at = Date.parse(e.occurred_at);
  if (at > now || Date.parse(e.created_at) >= at) return false;
  return fields.some((f) => typeof e.measures?.[f.id] !== 'number');
}
