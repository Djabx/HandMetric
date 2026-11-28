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
 * l'ancienneté, complétée par l'unité juste en dessous si elle n'est pas nulle
 * (années et mois, mois et jours, jours et heures, heures et minutes).
 * Ex. « 20 ans », « 1 mois et 3 jours », « 3 jours et 4 heures », « 12 minutes ».
 * short : the main unit only (« 1 mois »).
 */
export function humanDuration(from: number, to: number, short = false): string {
  const b = breakdown(from, to);
  const units: [number, Key, Key][] = [
    [b.years, 'dur.year', 'dur.years'],
    [b.months, 'dur.month', 'dur.months'],
    [b.days, 'dur.day', 'dur.days'],
    [b.hours, 'dur.hour', 'dur.hours'],
    [b.minutes, 'dur.minute', 'dur.minutes'],
  ];
  const i = units.findIndex(([n]) => n > 0);
  if (i < 0) return t('dur.lessThanMinute');
  const top = unit(...units[i]);
  const next = units[i + 1];
  return !short && next && next[0] > 0 ? `${top} ${t('dur.and')} ${unit(...next)}` : top;
}

/**
 * Countdown to a planned event. The same day: « dans 3 heures » ; then calendar days
 * (« demain », « dans 5 jours », whatever the hour) ; from a month on, the human duration
 * (« dans 1 mois et 3 jours »). `short` keeps the main unit only (« dans 1 mois ») and
 * `bare` also drops « dans » (« 1 mois », « 5 jours »), for the smallest tiles.
 */
export function untilLabel(at: number, now: number, size: 'full' | 'short' | 'bare' = 'full'): string {
  if (at - now < 60_000) return t('up.soon');
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const days = day(at) - day(now);
  if (days === 1) return t('up.tomorrow');
  const b = breakdown(now, at);
  const d =
    days > 0 && b.years === 0 && b.months === 0
      ? unit(days, 'dur.day', 'dur.days')
      : humanDuration(now, at, size !== 'full');
  return size === 'bare' ? d : t('up.in', { d });
}

/** Short date of a planned event: « sam. 26 déc. », with the year when it is not this year. */
export function fmtShortDate(ms: number, now = Date.now()): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(ms);
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
