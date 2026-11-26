import type { Api } from './api';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Client RPC vers le worker de base de données. */
class DbClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(remote: boolean) => void>();
  /** Appelé quand un autre onglet a pris la base (cet onglet ne peut plus s'en servir). */
  onDisplaced: () => void = () => {};

  constructor() {
    // Firefox garde la page précédente en cache (bfcache) quand on la quitte, par exemple pour se
    // connecter via SSO : son worker garderait la base verrouillée et la page de retour ne pourrait
    // plus l'ouvrir (NoModificationAllowedError). On arrête donc le worker en quittant la page,
    // et on recharge si le navigateur la ressort du cache.
    addEventListener('pagehide', () => this.worker.terminate());
    addEventListener('pageshow', (e: PageTransitionEvent) => e.persisted && location.reload());
    this.worker.onmessage = (msg: MessageEvent<{ id: number; result?: unknown; error?: string; event?: string }>) => {
      if (msg.data.event === 'displaced') return this.onDisplaced();
      const p = this.pending.get(msg.data.id);
      if (!p) return;
      this.pending.delete(msg.data.id);
      if (msg.data.error !== undefined) p.reject(new Error(msg.data.error));
      else p.resolve(msg.data.result);
    };
  }

  call<M extends keyof Api>(method: M, ...args: Parameters<Api[M]>): Promise<ReturnType<Api[M]>> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  /** Appel qui modifie les données : prévient les abonnés (UI, sync). */
  async write<M extends keyof Api>(method: M, ...args: Parameters<Api[M]>): Promise<ReturnType<Api[M]>> {
    const r = await this.call(method, ...args);
    this.changed();
    return r;
  }

  /** `remote` : changements venus de la synchro (pas de nouvelle synchro, pas de toast). */
  changed(remote = false) {
    for (const l of this.listeners) l(remote);
  }

  subscribe(fn: (remote: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const db = new DbClient();
