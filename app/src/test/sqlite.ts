import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteSql } from '../lib/db/sql';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
export async function sqlite3() {
  mod ??= await sqlite3InitModule();
  return mod;
}
export async function memorySql() {
  return SqliteSql.memory(await sqlite3());
}
