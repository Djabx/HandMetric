import { t } from './i18n/index.svelte';
import { fr, type Key } from './i18n/fr';
import type { Achievement } from './domain/achievements';

/** Singulier (clé « .one ») quand n = 1 et que la clé existe. */
function plural(key: Key, n: number): string {
  const one = `${key}.one`;
  return t(n === 1 && one in fr ? (one as Key) : key, { n });
}

export function achievementLabel(a: Achievement): string {
  switch (a.kind) {
    case 'abstinence':
      return plural(a.unit === 'day' ? 'ach.abstinence.day' : a.unit === 'month' ? 'ach.abstinence.month' : 'ach.abstinence.year', a.value);
    case 'count':
      return plural('ach.count', a.value);
    case 'streak':
      return t('ach.streak', { n: a.value });
    case 'goal':
      return plural('ach.goal', a.value);
  }
}
