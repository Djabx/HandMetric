/** Start and stop buttons of span trackers (sleep, fasting): the tile and the tracker page. */
import { db } from './db/client';
import { clockDuration, t } from './i18n/index.svelte';
import { toast } from './state.svelte';
import type { LifeEvent, Tracker } from './types';

/** Starts a period now: an event without an end. */
export async function startSpan(tr: Tracker): Promise<void> {
  const ev = await db.write('saveEvent', { tracker_id: tr.id, ended_at: null });
  navigator.vibrate?.(20);
  toast(t('span.started', { name: tr.name }), {
    icon: tr.icon ?? undefined,
    action: { label: t('common.undo'), run: () => void db.write('deleteEvent', ev.id) },
  });
}

/** Ends the running period now. */
export async function stopSpan(tr: Tracker, running: LifeEvent): Promise<void> {
  const end = new Date();
  await db.write('saveEvent', { ...running, measures: running.measures, ended_at: end.toISOString() });
  navigator.vibrate?.(20);
  toast(t('span.stopped', { name: tr.name, d: clockDuration(end.getTime() - Date.parse(running.occurred_at)) }), {
    icon: tr.icon ?? undefined,
    action: { label: t('common.undo'), run: () => void db.write('saveEvent', { ...running, ended_at: null }) },
  });
}
