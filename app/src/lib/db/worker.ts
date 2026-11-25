/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteSql } from './sql';
import { createApi, type Api } from './api';

type Req = { id: number; method: keyof Api; args: unknown[] };

/** Pourquoi la base n'a pas pu s'ouvrir sur l'appareil. */
export type StorageIssue = 'locked' | 'unsupported' | 'error';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ouvre la base sur l'appareil (OPFS). Un seul onglet à la fois peut l'ouvrir : si un autre
 * onglet la tient (ou l'onglet précédent n'a pas fini de se fermer au rechargement),
 * on réessaie quelques secondes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openPool(sqlite3: any) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({ name: 'lifelog-pool', forceReinitIfPreviouslyFailed: true });
    } catch (e) {
      if (!isLocked(e) || attempt >= 8) throw e;
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

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await openPool(sqlite3);
    const db = new pool.OpfsSAHPoolDb('/lifelog.sqlite3');
    return createApi(sqlite3, new SqliteSql(sqlite3, db), true);
  } catch (e) {
    console.warn('[LifeLog] OPFS indisponible, base en mémoire uniquement.', e);
    return createApi(sqlite3, SqliteSql.memory(sqlite3), false, { issue: issueOf(e), detail: String(e) });
  }
})();

self.onmessage = async (msg: MessageEvent<Req>) => {
  const { id, method, args } = msg.data;
  try {
    const api = await ready;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (api[method] as any)(...args);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
