/** Service worker updates.

    An installed PWA (iOS above all) is rarely reloaded: it resumes from memory, so the browser
    almost never checks for a new service worker on its own. We check on launch, each time the app
    comes back to the foreground, and every hour, then offer a reload instead of forcing it (a reload
    in the middle of an entry would lose it).

    Local data lives in OPFS (SQLite) and the session in a cookie: neither is touched here. Only the
    Cache Storage (app files) is cleared by `forceReload`. */
import { t } from './i18n/index.svelte';
import { toast } from './state.svelte';

declare const __LIFELOG_COMMIT__: string;

/** Short hash of the commit the app was built from ("dev" outside a build). */
export const APP_COMMIT: string = typeof __LIFELOG_COMMIT__ !== 'undefined' ? __LIFELOG_COMMIT__ : 'dev';

const HOUR = 60 * 60 * 1000;

export const pwa = $state({
  /** A new version is installed and waiting for a reload. */
  needRefresh: false,
  checking: false,
});

let registration: ServiceWorkerRegistration | undefined;
let lastCheck = 0;
let announced = false;

export function startUpdates() {
  // Drop the cache-busting parameter left by forceReload.
  const url = new URL(location.href);
  if (url.searchParams.has('r')) {
    url.searchParams.delete('r');
    history.replaceState(history.state, '', url.toString());
  }
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
    .then((r) => {
      registration = r;
      // A version already installed during a previous visit.
      if (r.waiting && navigator.serviceWorker.controller) needRefresh();
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        // No controller: first install, nothing to replace.
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) needRefresh();
        });
      });
      void check();
      setInterval(() => void check(), HOUR);
    })
    .catch(() => {});
  document.addEventListener('visibilitychange', () => {
    // Back to the foreground: a cheap request, at most every 5 minutes.
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 5 * 60 * 1000) void check();
  });
}

function needRefresh() {
  pwa.needRefresh = true;
  if (announced) return;
  announced = true;
  toast(t('update.available'), { icon: '✨', action: { label: t('update.reload'), run: () => void reloadNow() } }, 0);
}

/** Asks the browser to fetch the service worker again. Returns true when a new version is waiting. */
export async function check(): Promise<boolean> {
  if (!registration || !navigator.onLine) return pwa.needRefresh;
  lastCheck = Date.now();
  pwa.checking = true;
  try {
    await registration.update();
    // The new worker may still be installing: wait for it (precaching can take a few seconds).
    const installing = registration.installing;
    if (installing) {
      await new Promise<void>((resolve) => {
        const done = () => installing.state !== 'installing' && resolve();
        installing.addEventListener('statechange', done);
        setTimeout(resolve, 30_000);
      });
    }
    if (registration.waiting && navigator.serviceWorker.controller) needRefresh();
  } catch {
    // Offline or server unreachable: try again later.
  } finally {
    pwa.checking = false;
  }
  return pwa.needRefresh;
}

/** Activates the waiting version and reloads the page. */
export async function reloadNow() {
  const waiting = registration?.waiting;
  if (!waiting) return location.reload();
  // Reload once the new worker controls the page (the generated worker skips waiting on this message).
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => location.reload(), 3000);
}

/** Last resort: unregisters the service worker, empties the app file caches and reloads from the
    network. Local data (OPFS, cookies, localStorage) stays. */
export async function forceReload() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in self) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    // Cache-busting query so that no HTTP cache answers for the page itself.
    const url = new URL(location.href);
    url.searchParams.set('r', String(Date.now()));
    location.replace(url.toString());
  }
}
