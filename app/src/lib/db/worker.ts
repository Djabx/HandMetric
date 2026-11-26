/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteSql } from './sql';
import { createApi, type Api } from './api';
import { DISPLACED } from './displaced';

type Req = { id: number; method: keyof Api; args: unknown[] };

/** Pourquoi la base n'a pas pu s'ouvrir sur l'appareil. */
export type StorageIssue = 'locked' | 'unsupported' | 'error';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Canal entre les onglets LifeLog de cette adresse. Un seul onglet à la fois peut ouvrir la base
 * sur l'appareil (OPFS) : le nouvel onglet demande la main (« claim ») et celui qui la tient la
 * lui cède (voir `handOver`), au lieu de laisser l'utilisateur chercher l'onglet fautif.
 */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lifelog-db');

/**
 * Ouvre la base sur l'appareil. Si un autre onglet la tient, on lui demande de la céder et on
 * réessaie quelques secondes (le temps qu'il la ferme, ou que l'onglet précédent finisse de se
 * fermer au rechargement). Un onglet en veille peut ne pas répondre : on abandonne alors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openPool(sqlite3: any) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({ name: 'lifelog-pool', forceReinitIfPreviouslyFailed: true });
    } catch (e) {
      if (!isLocked(e) || attempt >= 8) throw e;
      if (attempt === 0) channel?.postMessage('claim');
      await sleep(400);
    }
  }
}

const isLocked = (e: unknown) => e instanceof DOMException && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError');

function issueOf(e: unknown): StorageIssue {
  if (isLocked(e)) return 'locked';
  if (!self.isSecureContext || !navigator.storage?.getDirectory || String(e).includes('Missing required OPFS')) return 'unsupported';
  return 'error';
}

/** Vrai quand cet onglet a cédé la base à un autre : il ne peut plus rien lire ni écrire. */
let displaced = false;

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await openPool(sqlite3);
    const db = new pool.OpfsSAHPoolDb('/lifelog.sqlite3');
    if (channel) channel.onmessage = (m) => m.data === 'claim' && handOver(db, pool);
    return createApi(sqlite3, new SqliteSql(sqlite3, db), true);
  } catch (e) {
    console.warn('[LifeLog] OPFS indisponible, base en mémoire uniquement.', e);
    return createApi(sqlite3, SqliteSql.memory(sqlite3), false, { issue: issueOf(e), detail: String(e) });
  }
})();

/** Un autre onglet vient d'ouvrir LifeLog : on ferme la base pour la lui laisser. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handOver(db: any, pool: any) {
  if (displaced) return;
  displaced = true;
  try {
    db.close();
    pool.pauseVfs();
  } catch (e) {
    console.warn('[LifeLog] Fermeture de la base incomplète.', e);
  }
  self.postMessage({ event: 'displaced' });
}

self.onmessage = async (msg: MessageEvent<Req>) => {
  const { id, method, args } = msg.data;
  try {
    const api = await ready;
    if (displaced) throw new Error(DISPLACED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (api[method] as any)(...args);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
