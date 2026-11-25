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
});
