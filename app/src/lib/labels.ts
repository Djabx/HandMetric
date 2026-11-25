import { t } from './i18n/index.svelte';
import type { Achievement } from './domain/achievements';

export function achievementLabel(a: Achievement): string {
  switch (a.kind) {
    case 'abstinence':
      return t(a.unit === 'day' ? 'ach.abstinence.day' : a.unit === 'month' ? 'ach.abstinence.month' : 'ach.abstinence.year', { n: a.value });
    case 'count':
      return t('ach.count', { n: a.value });
    case 'streak':
      return t('ach.streak', { n: a.value });
    case 'goal':
      return t('ach.goal', { n: a.value });
  }
}
