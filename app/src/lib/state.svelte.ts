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
  /** Corbeille : compteurs supprimés, restaurables. */
  deleted: [] as (Tracker & { event_count: number })[],
  fields: [] as TrackerField[],
  events: [] as LifeEvent[],
});

/** Horloge partagée, rafraîchie chaque seconde. */
export const clock = $state({ now: Date.now() });
// Rien ne s'affiche à la seconde : un rafraîchissement toutes les 15 s suffit.
setInterval(() => (clock.now = Date.now()), 15_000);

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
let onUnlock: ((tracker: Tracker, a: Achievement, others: number) => void) | null = null;

export function onAchievement(fn: (tracker: Tracker, a: Achievement, others: number) => void) {
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
  // Union : un succès déjà annoncé ne l'est pas de nouveau (compteur restauré depuis la corbeille, événement supprimé puis recréé).
  unlocked = new Set([...(unlocked ?? []), ...current]);
  // Un seul toast par compteur : le dernier palier atteint, et le nombre des autres
  // (sinon un événement antidaté de 20 ans débloque une vingtaine de toasts d'un coup).
  const byTracker = new Map<string, { tr: Tracker; list: Achievement[] }>();
  for (const [tr, a] of fresh) {
    const entry = byTracker.get(tr.id) ?? { tr, list: [] };
    entry.list.push(a);
    byTracker.set(tr.id, entry);
  }
  for (const { tr, list } of byTracker.values()) {
    // Les paliers sont dans l'ordre croissant ; la durée sans l'emporte sur les autres types.
    const best = [...list].reverse().find((a) => a.kind === 'abstinence') ?? list[list.length - 1];
    onUnlock?.(tr, best, list.length - 1);
  }
}

export async function refresh(notify = true) {
  const [trackers, all, fields, events, deleted] = await Promise.all([
    db.call('listTrackers', false),
    db.call('listTrackers', true),
    db.call('listFields'),
    db.call('listAllEvents'),
    db.call('listDeletedTrackers'),
  ]);
  app.deleted = deleted;
  clock.now = Date.now(); // l'horloge ne tique que toutes les 15 s : un compteur tout juste créé doit déjà être « dans le passé »
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
