import { fr, type Key } from './fr';
import { en } from './en';
import { breakdown } from '../domain/time';

export type Lang = 'fr' | 'en';
const dicts: Record<Lang, Record<Key, string>> = { fr, en };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lifelog.lang');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* stockage indisponible */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const i18n = $state({ lang: initialLang() as Lang });

export function setLang(lang: Lang) {
  i18n.lang = lang;
  try {
    localStorage.setItem('lifelog.lang', lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const s = dicts[i18n.lang][key] ?? fr[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

export function locale(): string {
  return i18n.lang === 'fr' ? 'fr-FR' : 'en-GB';
}

export function fmtNumber(n: number, digits = 2): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n);
}

export function fmtDateTime(iso: string | number): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function fmtDate(iso: string | number): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function fmtRelative(ms: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function unit(n: number, one: Key, many: Key) {
  return t(n === 1 ? one : many, { n });
}

/**
 * Durée humaine : les deux plus grandes unités non nulles.
 * Ex. « 6 mois et 2 jours », « 3 semaines et 2 jours », « 4 heures et 12 minutes ».
 */
export function humanDuration(from: number, to: number): string {
  const b = breakdown(from, to);
  const parts: string[] = [];
  if (b.years) parts.push(unit(b.years, 'dur.year', 'dur.years'));
  if (b.months) parts.push(unit(b.months, 'dur.month', 'dur.months'));
  if (b.weeks) parts.push(unit(b.weeks, 'dur.week', 'dur.weeks'));
  if (b.days) parts.push(unit(b.days, 'dur.day', 'dur.days'));
  if (b.hours) parts.push(unit(b.hours, 'dur.hour', 'dur.hours'));
  if (b.minutes) parts.push(unit(b.minutes, 'dur.minute', 'dur.minutes'));
  if (!parts.length) return t('dur.lessThanMinute');
  const top = parts.slice(0, 2);
  return top.length === 2 ? `${top[0]} ${t('dur.and')} ${top[1]}` : top[0];
}

/** Compteur précis : « 182 j 04:12:05 ». */
export function preciseDuration(from: number, to: number): string {
  const s = Math.max(0, Math.floor((to - from) / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${d ? `${d} ${t('dur.short.d')} ` : ''}${hh}:${mm}:${ss}`;
}
