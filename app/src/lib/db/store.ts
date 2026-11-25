import { COLUMNS, DATA_SCHEMA, LOCAL_SCHEMA, SCHEMA_VERSION, SYNC_TABLES, type SyncTable } from './schema';
import { Hlc } from './hlc';
import { newDeviceId, uuidv7 } from './ids';
import type { Sql } from './sql';
import type {
  ChangeSet,
  EventInput,
  FieldInput,
  LifeEvent,
  MergeSummary,
  Row,
  Tracker,
  TrackerField,
  TrackerInput,
} from '../types';

export const APP_VERSION = '0.1.0';

/** Format JSON d'export. */
export interface JsonExport {
  format: 'lifelog';
  schema_version: number;
  exported_at: string;
  trackers: Row[];
  tracker_fields: Row[];
  events: Array<Omit<Row, 'measures'> & { measures: Record<string, number> | null }>;
}

const nowIso = () => new Date().toISOString();

/** Décalage horaire local en minutes (ex. +60 pour Paris en hiver). */
export const localOffset = (d: Date = new Date()) => -d.getTimezoneOffset();

function toEvent(r: Row): LifeEvent {
  return { ...(r as unknown as LifeEvent), measures: r.measures ? JSON.parse(String(r.measures)) : null };
}

/**
 * Accès aux données de LifeLog. Toutes les écritures passent par ici,
 * reçoivent une estampille HLC, et sont fusionnables (last-writer-wins par ligne).
 */
export class Store {
  readonly deviceId: string;
  readonly hlc: Hlc;

  constructor(private readonly sql: Sql) {
    sql.exec(DATA_SCHEMA);
    sql.exec(LOCAL_SCHEMA);
    let deviceId = this.getMeta('device_id');
    if (!deviceId) {
      deviceId = newDeviceId();
      this.setMeta('device_id', deviceId);
      this.setMeta('created_at', nowIso());
    }
    this.setMeta('schema_version', String(SCHEMA_VERSION));
    this.setMeta('app_version', APP_VERSION);
    this.deviceId = deviceId;
    this.hlc = new Hlc(deviceId);
    for (const t of SYNC_TABLES) {
      const [row] = sql.all<{ m: string | null }>(`SELECT max(updated_at) AS m FROM ${t}`);
      if (row?.m) this.hlc.receive(row.m);
    }
  }

  // ---------- meta ----------

  getMeta(key: string): string | null {
    const [row] = this.sql.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.sql.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  // ---------- compteurs ----------

  listTrackers(opts: { includeArchived?: boolean } = {}): Tracker[] {
    const where = opts.includeArchived ? 'deleted_at IS NULL' : 'deleted_at IS NULL AND archived_at IS NULL';
    return this.sql.all<Tracker>(`SELECT * FROM tracker WHERE ${where} ORDER BY sort_order, created_at`);
  }

  getTracker(id: string): Tracker | null {
    const [t] = this.sql.all<Tracker>('SELECT * FROM tracker WHERE id = ? AND deleted_at IS NULL', [id]);
    return t ?? null;
  }

  listFields(trackerId?: string): TrackerField[] {
    return trackerId
      ? this.sql.all<TrackerField>(
          'SELECT * FROM tracker_field WHERE tracker_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at',
          [trackerId],
        )
      : this.sql.all<TrackerField>('SELECT * FROM tracker_field WHERE deleted_at IS NULL ORDER BY sort_order, created_at');
  }

  /** Crée ou modifie un compteur et ses champs de mesure. */
  saveTracker(input: TrackerInput, fields: FieldInput[] = []): Tracker {
    const stamp = this.hlc.now();
    const existing = input.id ? this.getTracker(input.id) : null;
    const id = existing?.id ?? input.id ?? uuidv7();
    const goal = input.goal_kind && input.goal_count && input.goal_period;
    const t: Tracker = {
      id,
      name: input.name.trim(),
      icon: input.icon || null,
      color: input.color || null,
      polarity: input.polarity,
      display_mode: input.display_mode,
      goal_kind: goal ? input.goal_kind : null,
      goal_count: goal ? Math.max(0, Math.round(Number(input.goal_count))) : null,
      goal_period: goal ? input.goal_period : null,
      sort_order: existing?.sort_order ?? this.nextSortOrder(),
      archived_at: existing?.archived_at ?? null,
      created_at: existing?.created_at ?? nowIso(),
      updated_at: stamp,
      deleted_at: null,
      device_id: this.deviceId,
    };
    if (!t.name) throw new Error('Nom obligatoire');
    this.tx(() => {
      this.upsert('tracker', t as unknown as Row);
      const current = this.listFields(id);
      const keep = new Set<string>();
      fields.forEach((f, i) => {
        if (!f.name.trim()) return;
        const prev = f.id ? current.find((c) => c.id === f.id) : undefined;
        const row: TrackerField = {
          id: prev?.id ?? f.id ?? uuidv7(),
          tracker_id: id,
          name: f.name.trim(),
          unit: f.unit?.trim() || null,
          sort_order: i,
          created_at: prev?.created_at ?? nowIso(),
          updated_at: this.hlc.now(),
          deleted_at: null,
          device_id: this.deviceId,
        };
        keep.add(row.id);
        if (!prev || prev.name !== row.name || prev.unit !== row.unit || prev.sort_order !== row.sort_order) {
          this.upsert('tracker_field', row as unknown as Row);
        }
      });
      for (const c of current) {
        if (!keep.has(c.id)) {
          this.upsert('tracker_field', { ...c, deleted_at: nowIso(), updated_at: this.hlc.now(), device_id: this.deviceId } as unknown as Row);
        }
      }
    });
    return t;
  }

  setArchived(id: string, archived: boolean): void {
    const t = this.getTracker(id);
    if (!t) return;
    this.upsert('tracker', { ...t, archived_at: archived ? nowIso() : null, updated_at: this.hlc.now(), device_id: this.deviceId } as unknown as Row);
  }

  /** Suppression logique du compteur et de ses événements. */
  deleteTracker(id: string): void {
    const t = this.getTracker(id);
    if (!t) return;
    const at = nowIso();
    this.tx(() => {
      this.upsert('tracker', { ...t, deleted_at: at, updated_at: this.hlc.now(), device_id: this.deviceId } as unknown as Row);
      for (const f of this.listFields(id)) {
        this.upsert('tracker_field', { ...f, deleted_at: at, updated_at: this.hlc.now(), device_id: this.deviceId } as unknown as Row);
      }
      for (const e of this.sql.all<Row>('SELECT * FROM event WHERE tracker_id = ? AND deleted_at IS NULL', [id])) {
        this.upsert('event', { ...e, deleted_at: at, updated_at: this.hlc.now(), device_id: this.deviceId });
      }
    });
  }

  reorderTrackers(ids: string[]): void {
    this.tx(() => {
      ids.forEach((id, i) => {
        const t = this.getTracker(id);
        if (t && t.sort_order !== i) {
          this.upsert('tracker', { ...t, sort_order: i, updated_at: this.hlc.now(), device_id: this.deviceId } as unknown as Row);
        }
      });
    });
  }

  private nextSortOrder(): number {
    const [r] = this.sql.all<{ m: number | null }>('SELECT max(sort_order) AS m FROM tracker WHERE deleted_at IS NULL');
    return (r?.m ?? -1) + 1;
  }

  // ---------- événements ----------

  /** Événements non supprimés d'un compteur, du plus récent au plus ancien. */
  listEvents(trackerId: string, opts: { limit?: number } = {}): LifeEvent[] {
    const rows = this.sql.all<Row>(
      `SELECT * FROM event WHERE tracker_id = ? AND deleted_at IS NULL ORDER BY occurred_at DESC${opts.limit ? ' LIMIT ' + Math.floor(opts.limit) : ''}`,
      [trackerId],
    );
    return rows.map(toEvent);
  }

  /** Tous les événements non supprimés (pour le tableau de bord), du plus ancien au plus récent. */
  listAllEvents(): LifeEvent[] {
    return this.sql
      .all<Row>('SELECT * FROM event WHERE deleted_at IS NULL ORDER BY occurred_at')
      .map(toEvent);
  }

  getEvent(id: string): LifeEvent | null {
    const [r] = this.sql.all<Row>('SELECT * FROM event WHERE id = ?', [id]);
    return r ? toEvent(r) : null;
  }

  saveEvent(input: EventInput): LifeEvent {
    const existing = input.id ? this.getEvent(input.id) : null;
    const occurred = input.occurred_at ? new Date(input.occurred_at) : new Date();
    if (Number.isNaN(occurred.getTime())) throw new Error('Date invalide');
    const measures = input.measures && Object.keys(input.measures).length ? input.measures : null;
    const e: LifeEvent = {
      id: existing?.id ?? input.id ?? uuidv7(occurred.getTime() <= Date.now() ? Date.now() : occurred.getTime()),
      tracker_id: input.tracker_id,
      occurred_at: occurred.toISOString(),
      tz_offset: input.tz_offset ?? localOffset(occurred),
      measures,
      note: input.note?.trim() || null,
      created_at: existing?.created_at ?? nowIso(),
      updated_at: this.hlc.now(),
      deleted_at: null,
      device_id: this.deviceId,
    };
    this.upsert('event', { ...e, measures: measures ? JSON.stringify(measures) : null } as unknown as Row);
    return e;
  }

  /** Corbeille : compteurs supprimés, du plus récent au plus ancien. */
  listDeletedTrackers(): (Tracker & { event_count: number })[] {
    return this.sql.all<Tracker & { event_count: number }>(
      `SELECT t.*, (SELECT COUNT(*) FROM event e WHERE e.tracker_id = t.id AND e.deleted_at = t.deleted_at) AS event_count
       FROM tracker t WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC`,
    );
  }

  /**
   * Restaure un compteur supprimé, avec les champs et événements supprimés en même temps
   * (même deleted_at). Les événements supprimés un par un avant restent supprimés.
   * Les lignes reçoivent une nouvelle estampille : la restauration gagne la fusion et se synchronise.
   */
  restoreTracker(id: string): void {
    const [t] = this.sql.all<Row>('SELECT * FROM tracker WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!t) return;
    const at = t.deleted_at;
    this.tx(() => {
      this.upsert('tracker', { ...t, deleted_at: null, updated_at: this.hlc.now(), device_id: this.deviceId });
      for (const table of ['tracker_field', 'event'] as const) {
        for (const r of this.sql.all<Row>(`SELECT * FROM ${table} WHERE tracker_id = ? AND deleted_at = ?`, [id, at])) {
          this.upsert(table, { ...r, deleted_at: null, updated_at: this.hlc.now(), device_id: this.deviceId });
        }
      }
    });
  }

  deleteEvent(id: string): void {
    const [r] = this.sql.all<Row>('SELECT * FROM event WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!r) return;
    this.upsert('event', { ...r, deleted_at: nowIso(), updated_at: this.hlc.now(), device_id: this.deviceId });
  }

  // ---------- fusion (import, sync) ----------

  /** Lignes modifiées après une estampille HLC (exclue), pour la sync. */
  changesSince(hlc: string): ChangeSet {
    const out = {} as ChangeSet;
    for (const t of SYNC_TABLES) {
      out[t] = this.sql.all<Row>(`SELECT * FROM ${t} WHERE updated_at > ? ORDER BY updated_at`, [hlc]);
    }
    return out;
  }

  /** Plus grande estampille HLC connue localement. */
  maxHlc(): string {
    let max = '';
    for (const t of SYNC_TABLES) {
      const [r] = this.sql.all<{ m: string | null }>(`SELECT max(updated_at) AS m FROM ${t}`);
      if (r?.m && r.m > max) max = r.m;
    }
    return max;
  }

  /**
   * Fusionne des lignes venues d'ailleurs (fichier, serveur).
   * Règle : une ligne entrante remplace la locale si son updated_at est plus grand.
   * Idempotent et commutatif.
   */
  merge(changes: Partial<ChangeSet>): MergeSummary {
    const summary: MergeSummary = { inserted: 0, updated: 0, ignored: 0, stillDeleted: 0, byTable: {} };
    this.tx(() => {
      for (const t of SYNC_TABLES) {
        const s = { inserted: 0, updated: 0, ignored: 0 };
        for (const raw of changes[t] ?? []) {
          const row = sanitize(t, raw);
          if (!row) {
            s.ignored++;
            continue;
          }
          const [cur] = this.sql.all<{ updated_at: string; deleted_at: string | null }>(
            `SELECT updated_at, deleted_at FROM ${t} WHERE id = ?`,
            [row.id],
          );
          if (cur && cur.updated_at >= String(row.updated_at)) {
            s.ignored++;
            if (t === 'tracker' && cur.deleted_at && !row.deleted_at) summary.stillDeleted++;
            continue;
          }
          try {
            this.upsert(t, row);
          } catch {
            s.ignored++;
            continue;
          }
          this.hlc.receive(String(row.updated_at));
          if (cur) s.updated++;
          else s.inserted++;
        }
        summary.byTable[t] = s;
        summary.inserted += s.inserted;
        summary.updated += s.updated;
        summary.ignored += s.ignored;
      }
    });
    return summary;
  }

  private upsert(table: SyncTable, row: Row): void {
    const cols = COLUMNS[table];
    const set = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
    this.sql.run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${set}`,
      cols.map((c) => row[c] ?? null),
    );
  }

  private depth = 0;
  private tx(fn: () => void): void {
    if (this.depth > 0) {
      fn();
      return;
    }
    this.depth++;
    this.sql.exec('BEGIN');
    try {
      fn();
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }

  // ---------- export ----------

  /** Toutes les lignes synchronisables (y compris supprimées, pour propager les suppressions). */
  snapshot(): ChangeSet {
    return this.changesSince('');
  }

  exportJson(): JsonExport {
    const s = this.snapshot();
    return {
      format: 'lifelog',
      schema_version: SCHEMA_VERSION,
      exported_at: nowIso(),
      trackers: s.tracker,
      tracker_fields: s.tracker_field,
      events: s.event.map((e) => ({ ...e, measures: e.measures ? JSON.parse(String(e.measures)) : null })),
    };
  }

  /** Remplit une base vide (fichier d'export) avec les données. */
  writeExport(target: Sql): void {
    target.exec(DATA_SCHEMA);
    const meta = new Store.Meta(target);
    meta.set('schema_version', String(SCHEMA_VERSION));
    meta.set('app_version', APP_VERSION);
    meta.set('exported_at', nowIso());
    meta.set('device_id', this.deviceId);
    meta.set('created_at', this.getMeta('created_at') ?? nowIso());
    const s = this.snapshot();
    target.exec('BEGIN');
    for (const t of SYNC_TABLES) {
      const cols = COLUMNS[t];
      for (const row of s[t]) {
        target.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c] ?? null));
      }
    }
    target.exec('COMMIT');
  }

  private static Meta = class {
    constructor(private readonly sql: Sql) {}
    set(key: string, value: string) {
      this.sql.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    }
  };
}

/** Lit un fichier d'export SQLite ouvert en mémoire. */
export function readSqliteExport(src: Sql): ChangeSet {
  const tables = new Set(src.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
  if (!tables.has('tracker') || !tables.has('event')) throw new Error('Ce fichier n\'est pas un export LifeLog.');
  if (tables.has('meta')) {
    const [v] = src.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    if (v && Number(v.value) > SCHEMA_VERSION) throw new Error('Ce fichier vient d\'une version plus récente de LifeLog.');
  }
  const out = {} as ChangeSet;
  for (const t of SYNC_TABLES) {
    out[t] = tables.has(t) ? src.all<Row>(`SELECT * FROM ${t}`) : [];
  }
  return out;
}

/** Lit un export JSON. */
export function readJsonExport(data: unknown): ChangeSet {
  const d = data as Partial<JsonExport>;
  if (!d || d.format !== 'lifelog') throw new Error('Ce fichier n\'est pas un export LifeLog.');
  if ((d.schema_version ?? 0) > SCHEMA_VERSION) throw new Error('Ce fichier vient d\'une version plus récente de LifeLog.');
  return {
    tracker: d.trackers ?? [],
    tracker_field: d.tracker_fields ?? [],
    event: (d.events ?? []).map((e) => ({ ...e, measures: e.measures ? JSON.stringify(e.measures) : null })) as Row[],
  };
}

/** Ne garde que les colonnes connues, vérifie le minimum vital. */
function sanitize(table: SyncTable, raw: Row): Row | null {
  if (!raw || typeof raw !== 'object') return null;
  const row: Row = {};
  for (const c of COLUMNS[table]) {
    let v = raw[c];
    if (v === undefined) v = null;
    if (c === 'measures' && v !== null && typeof v === 'object') v = JSON.stringify(v);
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') return null;
    row[c] = v;
  }
  if (typeof row.id !== 'string' || !row.id) return null;
  if (typeof row.updated_at !== 'string' || !row.updated_at) return null;
  if (typeof row.device_id !== 'string') return null;
  if (table === 'tracker' && row.sort_order === null) row.sort_order = 0;
  if (table === 'tracker_field' && row.sort_order === null) row.sort_order = 0;
  if (table === 'event' && row.measures !== null) {
    try {
      const m = JSON.parse(String(row.measures));
      if (typeof m !== 'object' || Array.isArray(m)) return null;
    } catch {
      return null;
    }
  }
  return row;
}
