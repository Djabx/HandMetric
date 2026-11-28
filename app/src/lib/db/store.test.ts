import { describe, expect, it } from 'vitest';
import { Store, readJsonExport, readSqliteExport } from './store';
import { SqliteSql } from './sql';
import { memorySql, sqlite3 } from '../../test/sqlite';

async function newStore() {
  return new Store(await memorySql());
}

describe('Store', () => {
  it('crée un compteur avec des mesures et des événements', async () => {
    const s = await newStore();
    const t = s.saveTracker(
      { name: 'Course', icon: '🏃', color: null, polarity: 'good', display_mode: 'frequency', goal_kind: 'min', goal_count: 3, goal_period: 'week' },
      [{ name: 'Distance', unit: 'km' }, { name: 'Durée', unit: 'min' }],
    );
    const fields = s.listFields(t.id);
    expect(fields.map((f) => f.name)).toEqual(['Distance', 'Durée']);
    s.saveEvent({ tracker_id: t.id, measures: { [fields[0].id]: 5.2, [fields[1].id]: 31 } });
    const [e] = s.listEvents(t.id);
    expect(e.measures).toEqual({ [fields[0].id]: 5.2, [fields[1].id]: 31 });
    expect(s.listTrackers()[0].goal_count).toBe(3);
  });

  it('supprime logiquement, et propage la suppression par la fusion', async () => {
    const a = await newStore();
    const b = await newStore();
    const t = a.saveTracker({ name: 'Cigarette', icon: '🚬', color: null, polarity: 'bad', display_mode: 'abstinence', goal_kind: null, goal_count: null, goal_period: null });
    const e = a.saveEvent({ tracker_id: t.id });
    b.merge(a.snapshot());
    expect(b.listEvents(t.id)).toHaveLength(1);
    a.deleteEvent(e.id);
    b.merge(a.changesSince(''));
    expect(b.listEvents(t.id)).toHaveLength(0);
  });

  it('fusion idempotente et commutative, le plus récent gagne', async () => {
    const a = await newStore();
    const b = await newStore();
    const t = a.saveTracker({ name: 'Eau', icon: null, color: null, polarity: 'good', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null });
    b.merge(a.snapshot());
    a.saveTracker({ ...t, name: 'Eau (A)' });
    await new Promise((r) => setTimeout(r, 5)); // sinon même milliseconde : départage par appareil
    b.saveTracker({ ...t, name: 'Eau (B)' }); // plus récent
    const sa = a.snapshot();
    const sb = b.snapshot();
    const first = a.merge(sb);
    b.merge(sa);
    expect(first.updated).toBe(1);
    expect(a.getTracker(t.id)!.name).toBe('Eau (B)');
    expect(b.getTracker(t.id)!.name).toBe('Eau (B)');
    const again = a.merge(sb);
    expect(again.inserted + again.updated).toBe(0);
  });

  it('exporte et réimporte un fichier SQLite et du JSON', async () => {
    const a = await newStore();
    const t = a.saveTracker({ name: 'Tension', icon: '🩺', color: null, polarity: 'neutral', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null }, [
      { name: 'Systolique', unit: 'mm[Hg]' },
      { name: 'Diastolique', unit: 'mm[Hg]' },
    ]);
    const [sys, dia] = a.listFields(t.id);
    a.saveEvent({ tracker_id: t.id, measures: { [sys.id]: 12.5, [dia.id]: 8 }, note: 'matin' });

    const file = await memorySql();
    a.writeExport(file);
    const bytes = file.serialize();
    expect(bytes.byteLength).toBeGreaterThan(0);

    const b = await newStore();
    const read = readSqliteExport(SqliteSql.fromBytes(await sqlite3(), bytes));
    const sum = b.merge(read);
    expect(sum.inserted).toBe(4);
    expect(b.listEvents(t.id)[0].note).toBe('matin');

    const c = await newStore();
    c.merge(readJsonExport(JSON.parse(JSON.stringify(a.exportJson()))));
    expect(c.listEvents(t.id)[0].measures).toEqual({ [sys.id]: 12.5, [dia.id]: 8 });
  });

  it('ignore les lignes invalides', async () => {
    const s = await newStore();
    const sum = s.merge({ tracker: [{ id: 'x', name: 'Bad', polarity: 'weird', display_mode: 'frequency', created_at: 'x', updated_at: '1', device_id: 'd' }] });
    expect(sum.ignored).toBe(1);
  });

  it('supprime ou garde les champs de mesure à la modification', async () => {
    const s = await newStore();
    const t = s.saveTracker({ name: 'Run', icon: null, color: null, polarity: 'good', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null }, [
      { name: 'A', unit: null },
      { name: 'B', unit: null },
    ]);
    const [fa] = s.listFields(t.id);
    s.saveTracker({ ...t }, [{ id: fa.id, name: 'A2', unit: 'km' }]);
    const fields = s.listFields(t.id);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ id: fa.id, name: 'A2', unit: 'km' });
  });

  it('restaure un compteur supprimé, même après réimport d\'un export plus ancien', async () => {
    const a = await newStore();
    const t = a.saveTracker({ name: 'Cigarette', icon: '🚬', color: null, polarity: 'bad', display_mode: 'abstinence', goal_kind: null, goal_count: null, goal_period: null });
    const kept = a.saveEvent({ tracker_id: t.id });
    const removedBefore = a.saveEvent({ tracker_id: t.id });
    a.deleteEvent(removedBefore.id);
    const backup = a.snapshot();

    await new Promise((r) => setTimeout(r, 5));
    a.deleteTracker(t.id);
    const b = await newStore();
    b.merge(a.snapshot()); // autre appareil : voit la suppression
    expect(b.getTracker(t.id)).toBeNull();
    const sum = a.merge(backup);
    expect(sum.stillDeleted).toBe(1);
    expect(a.getTracker(t.id)).toBeNull();
    expect(a.listDeletedTrackers().map((d) => [d.id, d.event_count])).toEqual([[t.id, 1]]);

    a.restoreTracker(t.id);
    expect(a.getTracker(t.id)?.name).toBe('Cigarette');
    expect(a.listEvents(t.id).map((e) => e.id)).toEqual([kept.id]); // l'événement supprimé avant reste supprimé
    expect(a.listDeletedTrackers()).toHaveLength(0);

    // La restauration gagne la fusion sur l'appareil qui avait vu la suppression.
    b.merge(a.snapshot());
    expect(b.listEvents(t.id)).toHaveLength(1);
    expect(b.getTracker(t.id)?.name).toBe('Cigarette');
  });

  it('supprime définitivement depuis la corbeille : plus rien en base, ici comme ailleurs', async () => {
    const sqlA = await memorySql();
    const sqlB = await memorySql();
    const a = new Store(sqlA);
    const b = new Store(sqlB);
    const t = a.saveTracker(
      { name: 'Tension', icon: '🩺', color: null, polarity: 'neutral', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null },
      [{ name: 'Systole', unit: 'mm[Hg]' }],
    );
    const [f] = a.listFields(t.id);
    a.saveEvent({ tracker_id: t.id, measures: { [f.id]: 12 }, note: 'secret' });
    b.merge(a.snapshot());
    const stale = b.changesSince('');
    a.deleteTracker(t.id);
    expect(a.listDeletedTrackers()).toHaveLength(1);
    a.purgeTracker(t.id);
    expect(a.listDeletedTrackers()).toHaveLength(0);
    a.restoreTracker(t.id);
    expect(a.listTrackers()).toHaveLength(0);
    b.merge(a.changesSince(''));
    const count = (sql: typeof sqlA, table: string) => sql.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
    for (const sql of [sqlA, sqlB]) {
      for (const table of ['tracker', 'tracker_field', 'event']) expect(count(sql, table)).toBe(0);
      expect(sql.all('SELECT * FROM purge')).toEqual([expect.objectContaining({ id: t.id, tbl: 'tracker' })]);
    }
    // Un appareil en retard renvoie les anciennes lignes : elles ne reviennent pas.
    const sum = a.merge(stale);
    expect(sum.inserted + sum.updated).toBe(0);
    expect(count(sqlA, 'event')).toBe(0);
    // L'export ne contient que des données.
    expect(a.snapshot()).toEqual({ tracker: [], tracker_field: [], event: [] });
  });

  it('met les événements supprimés à la corbeille, restaurables ou effaçables', async () => {
    const sqlA = await memorySql();
    const a = new Store(sqlA);
    const b = await newStore();
    const t = a.saveTracker({ name: 'Cigarette', icon: '🚬', color: null, polarity: 'bad', display_mode: 'abstinence', goal_kind: null, goal_count: null, goal_period: null });
    const e1 = a.saveEvent({ tracker_id: t.id });
    const e2 = a.saveEvent({ tracker_id: t.id });
    a.deleteEvent(e1.id);
    a.deleteEvent(e2.id);
    expect(a.listDeletedEvents().map((e) => [e.id, e.tracker_name])).toEqual([
      [e2.id, 'Cigarette'],
      [e1.id, 'Cigarette'],
    ]);
    a.restoreEvent(e1.id);
    expect(a.listEvents(t.id).map((e) => e.id)).toEqual([e1.id]);
    b.merge(a.changesSince(''));
    expect(b.listDeletedEvents()).toHaveLength(1);
    a.purgeEvent(e2.id);
    a.purgeEvent(e1.id); // pas à la corbeille : ignoré
    expect(sqlA.all('SELECT id FROM event')).toEqual([{ id: e1.id }]);
    b.merge(a.changesSince(''));
    expect(b.listDeletedEvents()).toHaveLength(0);
    expect(b.listEvents(t.id)).toHaveLength(1);
  });

  it('efface pour de bon les anciens compteurs vidés (∅)', async () => {
    const sql = await memorySql();
    const s = new Store(sql);
    const t = s.saveTracker({ name: 'Vieux', icon: null, color: null, polarity: 'good', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null });
    s.saveEvent({ tracker_id: t.id });
    sql.run("UPDATE tracker SET name = '∅', deleted_at = ?", [new Date().toISOString()]);
    expect(s.purgeExpiredTrash()).toBe(1);
    expect(sql.all('SELECT id FROM tracker')).toEqual([]);
    expect(sql.all('SELECT id FROM event')).toEqual([]);
  });

  it('vide la corbeille après 30 jours', async () => {
    const s = await newStore();
    const mk = (name: string) =>
      s.saveTracker({ name, icon: null, color: null, polarity: 'good', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null });
    const old = mk('Ancien');
    const recent = mk('Récent');
    const kept = mk('Gardé');
    s.deleteEvent(s.saveEvent({ tracker_id: kept.id }).id);
    s.deleteTracker(old.id);
    s.deleteTracker(recent.id);
    const in31days = Date.now() + 31 * 86_400_000;
    expect(s.purgeExpiredTrash(30, Date.now() + 10 * 86_400_000)).toBe(0);
    expect(s.purgeExpiredTrash(30, in31days)).toBe(3);
    expect(s.listDeletedEvents()).toHaveLength(0);
    expect(s.listTrackers()).toHaveLength(1);
    expect(s.listDeletedTrackers()).toHaveLength(0);
    expect(s.purgeExpiredTrash(30, in31days)).toBe(0);
  });

  it('ajoute la colonne des trophées à une base existante et la synchronise', async () => {
    const sql = await memorySql();
    sql.exec(`CREATE TABLE tracker (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT, polarity TEXT NOT NULL,
      display_mode TEXT NOT NULL, goal_kind TEXT, goal_count INTEGER, goal_period TEXT, sort_order REAL NOT NULL DEFAULT 0,
      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, device_id TEXT NOT NULL)`);
    const a = new Store(sql);
    const t = a.saveTracker({ name: 'Tension', icon: null, color: null, polarity: 'neutral', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null, achievements: 1 });
    expect(a.getTracker(t.id)!.achievements).toBe(1);
    const b = await newStore();
    b.merge(a.snapshot());
    expect(b.getTracker(t.id)!.achievements).toBe(1);
    a.saveTracker({ id: t.id, name: 'Tension', icon: null, color: null, polarity: 'neutral', display_mode: 'frequency', goal_kind: null, goal_count: null, goal_period: null });
    expect(a.getTracker(t.id)!.achievements).toBe(1);
    // La taille de la tuile arrive de la même façon sur une ancienne base.
    expect(a.getTracker(t.id)!.tile).toBeNull();
  });

  it('enregistre et synchronise la taille de la tuile, et ignore une valeur inconnue', async () => {
    const a = await newStore();
    const input = { name: 'Poids', icon: null, color: null, polarity: 'neutral' as const, display_mode: 'frequency' as const, goal_kind: null, goal_count: null, goal_period: null };
    const t = a.saveTracker({ ...input, tile: 'small' });
    const b = await newStore();
    b.merge(a.snapshot());
    expect(b.getTracker(t.id)!.tile).toBe('small');
    a.saveTracker({ ...input, id: t.id });
    expect(a.getTracker(t.id)!.tile).toBe('small');
    const snap = a.snapshot();
    snap.tracker[0].tile = 'géante';
    snap.tracker[0].updated_at = 'z' + snap.tracker[0].updated_at;
    b.merge(snap);
    expect(b.getTracker(t.id)!.tile).toBeNull();
  });

  it('enregistre et synchronise le compte à rebours du prochain prévu', async () => {
    const a = await newStore();
    const input = { name: 'Concert', icon: null, color: null, polarity: 'good' as const, display_mode: 'frequency' as const, goal_kind: null, goal_count: null, goal_period: null };
    const t = a.saveTracker({ ...input, show_next: 1 });
    const b = await newStore();
    b.merge(a.snapshot());
    expect(b.getTracker(t.id)!.show_next).toBe(1);
    a.saveTracker({ ...input, id: t.id });
    expect(a.getTracker(t.id)!.show_next).toBe(1);
    a.saveTracker({ ...input, id: t.id, show_next: null });
    expect(a.getTracker(t.id)!.show_next).toBeNull();
  });
});
