import type { LifeEvent, Tracker, TrackerField } from '../types';

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Heure locale de l'événement au format ISO avec décalage, ex. 2026-11-25T09:58:00+01:00. */
export function localIso(e: Pick<LifeEvent, 'occurred_at' | 'tz_offset'>): string {
  const ms = Date.parse(e.occurred_at) + e.tz_offset * 60_000;
  const sign = e.tz_offset >= 0 ? '+' : '-';
  const abs = Math.abs(e.tz_offset);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return new Date(ms).toISOString().slice(0, 19) + off;
}

/** Export CSV « lecture seule » : une ligne par événement, une colonne par mesure. */
export function toCsv(trackers: Tracker[], fields: TrackerField[], events: LifeEvent[]): string {
  const byId = new Map(trackers.map((t) => [t.id, t]));
  const cols = fields.filter((f) => byId.has(f.tracker_id));
  const header = ['tracker', 'local_time', 'utc_time', 'note', ...cols.map((f) => `${byId.get(f.tracker_id)!.name} / ${f.name}${f.unit ? ` (${f.unit})` : ''}`)];
  const lines = [header.map(cell).join(',')];
  for (const e of events) {
    const t = byId.get(e.tracker_id);
    if (!t) continue;
    lines.push(
      [t.name, localIso(e), e.occurred_at, e.note, ...cols.map((f) => (f.tracker_id === e.tracker_id ? e.measures?.[f.id] : null))]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}
