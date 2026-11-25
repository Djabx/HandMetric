import type { Row } from '../types';

/** Accès SQL synchrone minimal, implémenté au-dessus de SQLite WASM. */
export interface Sql {
  all<T = Row>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): number;
  exec(sql: string): void;
  /** Sérialise la base entière en fichier SQLite. */
  serialize(): Uint8Array;
  close(): void;
}

// Typage volontairement lâche : l'API oo1 de sqlite-wasm.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sqlite3 = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Oo1Db = any;

export class SqliteSql implements Sql {
  constructor(
    private readonly sqlite3: Sqlite3,
    readonly db: Oo1Db,
  ) {
  }

  all<T = Row>(sql: string, params: unknown[] = []): T[] {
    return this.db.exec({ sql, bind: params.length ? params : undefined, rowMode: 'object', returnValue: 'resultRows' }) as T[];
  }

  run(sql: string, params: unknown[] = []): number {
    this.db.exec({ sql, bind: params.length ? params : undefined });
    return this.db.changes() as number;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  serialize(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
  }

  close(): void {
    this.db.close();
  }

  /** Base en mémoire vide. */
  static memory(sqlite3: Sqlite3): SqliteSql {
    return new SqliteSql(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'));
  }

  /** Ouvre un fichier SQLite (octets) en mémoire, pour lecture. */
  static fromBytes(sqlite3: Sqlite3, bytes: Uint8Array): SqliteSql {
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const flags =
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.byteLength, bytes.byteLength, flags);
    if (rc !== 0) {
      db.close();
      throw new Error(`Fichier SQLite illisible (code ${rc})`);
    }
    return new SqliteSql(sqlite3, db);
  }
}
