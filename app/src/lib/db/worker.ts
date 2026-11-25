/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteSql } from './sql';
import { createApi, type Api } from './api';

type Req = { id: number; method: keyof Api; args: unknown[] };

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'lifelog-pool' });
    const db = new pool.OpfsSAHPoolDb('/lifelog.sqlite3');
    return createApi(sqlite3, new SqliteSql(sqlite3, db), true);
  } catch (e) {
    console.warn('[LifeLog] OPFS indisponible, base en mémoire uniquement.', e);
    return createApi(sqlite3, SqliteSql.memory(sqlite3), false);
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
