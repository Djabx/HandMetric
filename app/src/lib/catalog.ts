/** Catalogue d'unités UCUM proposées dans le formulaire de compteur. */
import type { Key } from './i18n/fr';

export interface UnitDef {
  /** Code UCUM (les annotations {…} sont des unités « sans dimension » nommées). */
  code: string;
  /** Libellé affiché, s'il diffère du code. */
  label?: string | Key;
}

export interface UnitGroup {
  name: Key;
  units: UnitDef[];
}

export const UNIT_GROUPS: UnitGroup[] = [
  { name: 'unit.group.count', units: [{ code: '{steps}', label: 'unit.steps' }, { code: '{glass}', label: 'unit.glass' }, { code: '{cigarette}', label: 'unit.cigarette' }, { code: '{page}', label: 'unit.page' }, { code: '{rep}', label: 'unit.rep' }, { code: '{score}', label: 'unit.score' }] },
  { name: 'unit.group.duration', units: [{ code: 'h' }, { code: 'min' }, { code: 's' }] },
  { name: 'unit.group.distance', units: [{ code: 'km' }, { code: 'm' }, { code: 'cm' }, { code: '[mi_i]', label: 'mi' }] },
  { name: 'unit.group.mass', units: [{ code: 'kg' }, { code: 'g' }, { code: 'mg' }, { code: '[lb_av]', label: 'lb' }] },
  { name: 'unit.group.volume', units: [{ code: 'L' }, { code: 'cL' }, { code: 'mL' }] },
  { name: 'unit.group.health', units: [{ code: 'mm[Hg]', label: 'mmHg' }, { code: '/min', label: 'unit.bpm' }, { code: 'Cel', label: '°C' }, { code: 'mg/dL' }, { code: 'mmol/L' }, { code: '%' }] },
  { name: 'unit.group.energy', units: [{ code: 'kcal' }, { code: 'kJ' }, { code: 'W' }] },
  { name: 'unit.group.speed', units: [{ code: 'km/h' }, { code: 'min/km' }] },
  { name: 'unit.group.money', units: [{ code: '{EUR}', label: '€' }, { code: '{USD}', label: '$' }] },
];

export const ALL_UNITS: UnitDef[] = UNIT_GROUPS.flatMap((g) => g.units);
