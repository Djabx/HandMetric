import type { Key } from './i18n/fr';
import type { DisplayMode, GoalKind, Period, Polarity } from './types';

export interface Template {
  id: string;
  name: Key;
  icon: string;
  color: string;
  polarity: Polarity;
  display_mode: DisplayMode;
  goal?: { kind: GoalKind; count: number; period: Period };
  fields?: { name: Key; unit: string }[];
}

export const PALETTE = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d8d'];

export const TEMPLATES: Template[] = [
  { id: 'cigarette', name: 'tpl.cigarette', icon: '🚬', color: '#e5484d', polarity: 'bad', display_mode: 'abstinence' },
  { id: 'alcohol', name: 'tpl.alcohol', icon: '🍷', color: '#d6409f', polarity: 'bad', display_mode: 'abstinence' },
  {
    id: 'run', name: 'tpl.run', icon: '🏃', color: '#46a758', polarity: 'good', display_mode: 'frequency',
    goal: { kind: 'min', count: 3, period: 'week' },
    fields: [{ name: 'tpl.distance', unit: 'km' }, { name: 'tpl.duration', unit: 'min' }],
  },
  { id: 'water', name: 'tpl.water', icon: '💧', color: '#0090ff', polarity: 'good', display_mode: 'frequency', goal: { kind: 'min', count: 8, period: 'day' } },
  {
    id: 'bp', name: 'tpl.bp', icon: '🩺', color: '#6e56cf', polarity: 'neutral', display_mode: 'frequency',
    fields: [{ name: 'tpl.systolic', unit: 'mm[Hg]' }, { name: 'tpl.diastolic', unit: 'mm[Hg]' }],
  },
  { id: 'sleep', name: 'tpl.sleep', icon: '😴', color: '#12a594', polarity: 'neutral', display_mode: 'frequency', fields: [{ name: 'tpl.duration', unit: 'h' }] },
  { id: 'weight', name: 'tpl.weight', icon: '⚖️', color: '#8d8d8d', polarity: 'neutral', display_mode: 'frequency', fields: [{ name: 'tpl.weight', unit: 'kg' }] },
  { id: 'meditation', name: 'tpl.meditation', icon: '🧘', color: '#6e56cf', polarity: 'good', display_mode: 'frequency', goal: { kind: 'min', count: 1, period: 'day' }, fields: [{ name: 'tpl.duration', unit: 'min' }] },
  { id: 'coffee', name: 'tpl.coffee', icon: '☕', color: '#f76b15', polarity: 'neutral', display_mode: 'frequency', goal: { kind: 'max', count: 3, period: 'day' } },
  { id: 'reading', name: 'tpl.reading', icon: '📚', color: '#0090ff', polarity: 'good', display_mode: 'frequency', fields: [{ name: 'tpl.pages', unit: '{page}' }] },
];

export const UNIT_SUGGESTIONS = ['km', 'm', 'min', 'h', 's', 'kg', 'g', 'L', 'mL', 'mm[Hg]', 'kcal', '/min', '%'];

/** Affichage lisible d'une unité UCUM. */
export function unitLabel(u: string | null): string {
  if (!u) return '';
  return u.replace('mm[Hg]', 'mmHg').replace('[', '').replace(']', '');
}
