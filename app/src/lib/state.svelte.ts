import { db } from './db/client';
import type { LifeEvent, Tracker, TrackerField } from './types';
import { computeStats, goalStatus, type GoalStatus, type TrackerStats } from './domain/stats';
import { achievements, type Achievement } from './domain/achievements';
import { localOffset } from './db/store';

export const app = $state({
  ready: false,
  error: '' as string,
  persistent: true,
  trackers: [] as Tracker[],
  archived: [] as Tracker[],
  fields: [] as TrackerField[],
  events: [] as LifeEvent[],
});

/** Horloge partagée, rafraîchie chaque seconde. */
export const clock = $state({ now: Date.now() });
setInterval(() => (clock.now = Date.now()), 1000);

export interface TrackerView {
  tracker: Tracker;
  fields: TrackerField[];
  events: LifeEvent[];
  stats: TrackerStats;
  goal: GoalStatus | null;
  achievements: Achievement[];
}

/** Calcule la vue d'un compteur à un instant donné. */
export function viewOf(tracker: Tracker, now: number): TrackerView {
  const events = app.events.filter((e) => e.tracker_id === tracker.id);
  const fields = app.fields.filter((f) => f.tracker_id === tracker.id);
  const tz = localOffset();
  const stats = computeStats(tracker, events, now, tz);
  const goal = goalStatus(tracker, events, now, tz);
  return { tracker, fields, events, stats, goal, achievements: achievements(tracker, stats, goal) };
}

// ---------- toasts ----------

export interface Toast {
  id: number;
  text: string;
  icon?: string;
  action?: { label: string; run: () => void };
}
export const toasts = $state({ list: [] as Toast[] });
let toastId = 1;
export function toast(text: string, opts: Omit<Toast, 'id' | 'text'> = {}, ms = 4000) {
  const id = toastId++;
  toasts.list.push({ id, text, ...opts });
  setTimeout(() => dismiss(id), ms);
}
export function dismiss(id: number) {
  toasts.list = toasts.list.filter((t) => t.id !== id);
}

// ---------- chargement ----------

let unlocked: Set<string> | null = null;
let onUnlock: ((tracker: Tracker, a: Achievement) => void) | null = null;

export function onAchievement(fn: (tracker: Tracker, a: Achievement) => void) {
  onUnlock = fn;
}

/** Repère les succès nouvellement débloqués (appelé après chaque changement et chaque minute). */
export function checkAchievements(now = Date.now(), notify = true) {
  const current = new Set<string>();
  const fresh: [Tracker, Achievement][] = [];
  for (const tr of app.trackers) {
    for (const a of viewOf(tr, now).achievements) {
      if (!a.unlocked) continue;
      const key = `${tr.id}:${a.id}`;
      current.add(key);
      if (notify && unlocked && !unlocked.has(key)) fresh.push([tr, a]);
    }
  }
  unlocked = current;
  for (const [tr, a] of fresh) onUnlock?.(tr, a);
}

export async function refresh(notify = true) {
  const [trackers, all, fields, events] = await Promise.all([
    db.call('listTrackers', false),
    db.call('listTrackers', true),
    db.call('listFields'),
    db.call('listAllEvents'),
  ]);
  app.trackers = trackers;
  app.archived = all.filter((t) => t.archived_at);
  app.fields = fields;
  app.events = events;
  checkAchievements(Date.now(), notify);
}

export async function init() {
  try {
    const info = await db.call('info');
    app.persistent = info.persistent;
    await refresh();
    db.subscribe((remote) => void refresh(!remote));
    setInterval(() => checkAchievements(), 60_000);
    if (navigator.storage?.persist) void navigator.storage.persist();
  } catch (e) {
    app.error = e instanceof Error ? e.message : String(e);
  } finally {
    app.ready = true;
  }
}
