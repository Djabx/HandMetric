import { SqliteSql, type Sql } from './sql';
import { Store, readJsonExport, readSqliteExport } from './store';
import { toCsv } from '../io/csv';
import type { ChangeSet, EventInput, FieldInput, TrackerInput } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sqlite3 = any;

export interface SyncState {
  cursor: number;
  pushedHlc: string;
  lastSyncAt: string | null;
  userId: string | null;
}

/** API exposée par le worker de base de données (appelée par RPC depuis l'UI). */
export interface StorageProblem {
  issue: 'locked' | 'unsupported' | 'error';
  detail: string;
}

export function createApi(sqlite3: Sqlite3, sql: Sql, persistent: boolean, problem: StorageProblem | null = null) {
  const store = new Store(sql);
  store.purgeExpiredTrash();
  return {
    info: () => ({ deviceId: store.deviceId, persistent, problem }),
    listTrackers: (includeArchived = false) => store.listTrackers({ includeArchived }),
    getTracker: (id: string) => store.getTracker(id),
    listFields: (trackerId?: string) => store.listFields(trackerId),
    saveTracker: (input: TrackerInput, fields: FieldInput[]) => store.saveTracker(input, fields),
    setArchived: (id: string, archived: boolean) => store.setArchived(id, archived),
    deleteTracker: (id: string) => store.deleteTracker(id),
    listDeletedTrackers: () => store.listDeletedTrackers(),
    restoreTracker: (id: string) => store.restoreTracker(id),
    purgeTracker: (id: string) => store.purgeTracker(id),
    reorderTrackers: (ids: string[]) => store.reorderTrackers(ids),
    listEvents: (trackerId: string, limit?: number) => store.listEvents(trackerId, { limit }),
    listAllEvents: () => store.listAllEvents(),
    saveEvent: (input: EventInput) => store.saveEvent(input),
    deleteEvent: (id: string) => store.deleteEvent(id),
    listDeletedEvents: () => store.listDeletedEvents(),
    restoreEvent: (id: string) => store.restoreEvent(id),
    purgeEvent: (id: string) => store.purgeEvent(id),
    getMeta: (key: string) => store.getMeta(key),
    setMeta: (key: string, value: string) => store.setMeta(key, value),

    exportSqlite: (): Uint8Array => {
      const file = SqliteSql.memory(sqlite3);
      try {
        store.writeExport(file);
        return file.serialize();
      } finally {
        file.close();
      }
    },
    exportJson: () => store.exportJson(),
    exportCsv: () => toCsv(store.listTrackers({ includeArchived: true }), store.listFields(), store.listAllEvents()),

    /** Importe un fichier (SQLite ou JSON) par fusion. */
    importFile: (bytes: Uint8Array) => {
      const isSqlite = new TextDecoder().decode(bytes.slice(0, 15)) === 'SQLite format 3';
      let changes: ChangeSet;
      if (isSqlite) {
        const src = SqliteSql.fromBytes(sqlite3, bytes);
        try {
          changes = readSqliteExport(src);
        } finally {
          src.close();
        }
      } else {
        let data: unknown;
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new Error('Format de fichier non reconnu : choisis un export LifeLog (.lifelog.sqlite ou .json).');
        }
        changes = readJsonExport(data);
      }
      return store.merge(changes);
    },

    // Synchronisation
    changesSince: (hlc: string) => store.changesSince(hlc),
    maxHlc: () => store.maxHlc(),
    merge: (changes: ChangeSet) => store.merge(changes),
    getSyncState: () => {
      const raw = store.getMeta('sync_state');
      return raw ? (JSON.parse(raw) as SyncState) : ({ cursor: 0, pushedHlc: '', lastSyncAt: null, userId: null } as SyncState);
    },
    setSyncState: (s: SyncState) => store.setMeta('sync_state', JSON.stringify(s)),
  };
}

export type Api = ReturnType<typeof createApi>;
