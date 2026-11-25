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
  if (abs < 60) return t('time.justNow');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function unit(n: number, one: Key, many: Key) {
  return t(n === 1 ? one : many, { n });
}

/**
 * Durée à l'échelle humaine : jamais de secondes. L'unité principale dépend de
 * l'ancienneté, complétée par l'unité juste en dessous si elle n'est pas nulle.
 * Ex. « 20 ans », « 6 mois et 2 semaines », « 3 jours et 4 heures », « 12 minutes ».
 */
export function humanDuration(from: number, to: number): string {
  const b = breakdown(from, to);
  const units: [number, Key, Key][] = [
    [b.years, 'dur.year', 'dur.years'],
    [b.months, 'dur.month', 'dur.months'],
    [b.weeks, 'dur.week', 'dur.weeks'],
    [b.days, 'dur.day', 'dur.days'],
    [b.hours, 'dur.hour', 'dur.hours'],
    [b.minutes, 'dur.minute', 'dur.minutes'],
  ];
  const i = units.findIndex(([n]) => n > 0);
  if (i < 0) return t('dur.lessThanMinute');
  const top = unit(...units[i]);
  const next = units[i + 1];
  return next && next[0] > 0 ? `${top} ${t('dur.and')} ${unit(...next)}` : top;
}

/**
 * Point de départ d'une durée : « depuis le 12 mars 2006 », ou « depuis 14:05 » le jour même.
 * fromCreation : le compteur n'a encore aucun événement, la durée part de sa création.
 */
export function sinceLabel(from: number, now: number, fromCreation = false): string {
  if (now - from < 86_400_000 && new Date(from).toDateString() === new Date(now).toDateString()) {
    const time = new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(from);
    return t(fromCreation ? 'dur.createdTime' : 'dur.sinceTime', { time });
  }
  const date = new Intl.DateTimeFormat(locale(), { dateStyle: 'long' }).format(from);
  return t(fromCreation ? 'dur.createdDate' : 'dur.sinceDate', { date });
}
