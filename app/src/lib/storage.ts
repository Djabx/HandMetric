import { t } from './i18n/index.svelte';
import type { StorageProblem } from './db/api';

/**
 * Avertissement quand la base n'a pas pu s'ouvrir sur l'appareil (elle est alors en mémoire).
 * Sur un serveur, avec un compte connecté, les saisies partent quand même au serveur.
 */
export function memoryWarning(problem: StorageProblem | null, onServer: boolean): string {
  const host = location.host;
  const locked = problem?.issue === 'locked';
  if (onServer) return t(locked ? 'settings.storage.lockedServer' : 'settings.storage.memoryServer', { host });
  return t(locked ? 'settings.storage.locked' : 'settings.storage.memory');
}
