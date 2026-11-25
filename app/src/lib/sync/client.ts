import { db } from '../db/client';
import { sync, type Health } from './sync.svelte';
import * as webauthn from './webauthn';
import type { ChangeSet, Row } from '../types';

declare const __LIFELOG_MODE__: 'solo' | 'auto';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, body, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* corps non JSON */
    }
    throw new HttpError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- compte ----------

export async function loadMe(): Promise<void> {
  try {
    const me = await api<{ user: { id: string; display_name: string | null }; identities: typeof sync.identities }>('/api/v1/me');
    sync.user = me.user;
    sync.identities = me.identities;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      sync.user = null;
      sync.identities = [];
    } else throw e;
  }
}

export async function passkeyLogin(): Promise<void> {
  const { key, options } = await api<{ key: string; options: unknown }>('/auth/passkey/login/start', { method: 'POST' });
  const credential = await webauthn.get(options);
  await api('/auth/passkey/login/finish', { method: 'POST', json: { key, credential } });
  await afterLogin();
}

/** Crée un compte (déconnecté) ou ajoute une passkey au compte courant (connecté). */
export async function passkeyRegister(displayName?: string, label?: string): Promise<void> {
  const { key, options } = await api<{ key: string; options: unknown }>('/auth/passkey/register/start', {
    method: 'POST',
    json: { display_name: displayName || null },
  });
  const credential = await webauthn.create(options);
  await api('/auth/passkey/register/finish', { method: 'POST', json: { key, credential, label: label || null } });
  await afterLogin();
}

export async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' });
  sync.user = null;
  sync.identities = [];
}

async function afterLogin() {
  await loadMe();
  if (sync.user) void syncNow();
}

// ---------- synchronisation ----------

const PUSH_CHUNK = 2000;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function splitChunks(c: ChangeSet): ChangeSet[] {
  type Key = 'purge' | 'tracker' | 'tracker_field' | 'event';
  const rows: [Key, Row][] = [];
  for (const t of ['purge', 'tracker', 'tracker_field', 'event'] as const) for (const r of c[t] ?? []) rows.push([t, r]);
  const out: ChangeSet[] = [];
  for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
    const chunk: Required<ChangeSet> = { purge: [], tracker: [], tracker_field: [], event: [] };
    for (const [t, r] of rows.slice(i, i + PUSH_CHUNK)) chunk[t].push(r);
    out.push(chunk);
  }
  return out;
}

async function syncOnce(): Promise<void> {
  const user = sync.user;
  if (!user) return;
  let st = await db.call('getSyncState');
  if (st.userId !== user.id) st = { cursor: 0, pushedHlc: '', lastSyncAt: null, userId: user.id };

  // 1. Push des modifications locales.
  const upTo = await db.call('maxHlc');
  if (upTo > st.pushedHlc) {
    const changes = await db.call('changesSince', st.pushedHlc);
    for (const chunk of splitChunks(changes)) {
      await api('/api/v1/changes', { method: 'POST', json: { changes: chunk } });
    }
    st.pushedHlc = upTo;
    await db.call('setSyncState', st);
  }

  // 2. Pull des modifications distantes.
  let changed = false;
  for (;;) {
    const r = await api<{ changes: ChangeSet; cursor: number; has_more: boolean }>(`/api/v1/changes?since=${st.cursor}&limit=1000`);
    const sum = await db.call('merge', r.changes);
    if (sum.inserted + sum.updated > 0) changed = true;
    st.cursor = r.cursor;
    await db.call('setSyncState', st);
    if (!r.has_more) break;
  }
  st.lastSyncAt = new Date().toISOString();
  await db.call('setSyncState', st);
  sync.lastSyncAt = st.lastSyncAt;
  if (changed) db.changed(true);
}

/** Lance une synchronisation (une seule à la fois ; relance si demandée pendant). */
export function syncNow(): Promise<void> {
  if (sync.mode !== 'server' || !sync.user) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      sync.status = 'syncing';
      try {
        await syncOnce();
        sync.status = 'idle';
        sync.error = '';
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          sync.user = null;
          sync.status = 'idle';
        } else {
          sync.status = 'error';
          sync.error = e instanceof Error ? e.message : String(e);
        }
        break;
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

/** Démarre la synchronisation si la PWA est servie par un serveur LifeLog. */
export async function startSync(): Promise<void> {
  if (typeof __LIFELOG_MODE__ !== 'undefined' && __LIFELOG_MODE__ === 'solo') return;
  try {
    const res = await fetch('/api/v1/health', { credentials: 'same-origin' });
    if (!res.ok) return;
    const health = (await res.json()) as Health;
    if (health.name !== 'lifelog') return;
    sync.health = health;
    sync.mode = 'server';
  } catch {
    // Hors ligne au démarrage : on reste en mode serveur si on l'était déjà.
    const st = await db.call('getSyncState');
    if (!st.userId) return;
    sync.mode = 'server';
    sync.user = { id: st.userId, display_name: null };
  }
  const st = await db.call('getSyncState');
  sync.lastSyncAt = st.lastSyncAt;
  try {
    await loadMe();
  } catch {
    /* hors ligne */
  }
  db.subscribe((remote) => {
    if (!remote) schedule();
  });
  window.addEventListener('online', () => {
    sync.online = true;
    schedule(200);
  });
  window.addEventListener('offline', () => (sync.online = false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(200);
  });
  setInterval(() => void syncNow(), 5 * 60_000);
  void syncNow();
}
