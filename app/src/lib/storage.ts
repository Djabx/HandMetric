import { fmtDateTime, t } from './i18n/index.svelte';
import type { StorageProblem } from './db/api';

const HOLDER_KEY = 'lifelog.dbHolder';

interface Holder {
  /** Quand l'onglet a ouvert la base. */
  at: string;
  /** Ouvert depuis l'app installée (écran d'accueil) plutôt qu'un onglet du navigateur. */
  installed: boolean;
}

const isInstalled = () =>
  matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Note quel onglet tient la base, pour aider à le retrouver s'il ne la cède pas (onglet en veille). */
export function rememberHolder() {
  try {
    localStorage.setItem(HOLDER_KEY, JSON.stringify({ at: new Date().toISOString(), installed: isInstalled() } satisfies Holder));
  } catch {
    // stockage indisponible : on se passera de l'indice
  }
}

function lastHolder(): Holder | null {
  try {
    const raw = localStorage.getItem(HOLDER_KEY);
    return raw ? (JSON.parse(raw) as Holder) : null;
  } catch {
    return null;
  }
}

/**
 * Avertissement quand la base n'a pas pu s'ouvrir sur l'appareil (elle est alors en mémoire).
 * Sur un serveur, avec un compte connecté, les saisies partent quand même au serveur.
 */
export function memoryWarning(problem: StorageProblem | null, onServer: boolean): string {
  const host = location.host;
  if (problem?.issue !== 'locked') return t(onServer ? 'settings.storage.memoryServer' : 'settings.storage.memory', { host });
  return [t(onServer ? 'settings.storage.lockedServer' : 'settings.storage.locked', { host }), lockedHint()].join(' ');
}

/** Où chercher l'onglet qui tient la base. */
function lockedHint(): string {
  const holder = lastHolder();
  const where = holder ? t(holder.installed ? 'storage.holder.installed' : 'storage.holder.tab', { at: fmtDateTime(holder.at) }) : '';
  return [where, t('storage.holder.how', { host: location.host })].filter(Boolean).join(' ');
}
