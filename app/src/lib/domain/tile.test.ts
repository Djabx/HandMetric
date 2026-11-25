import { describe, expect, it } from 'vitest';
import { tileSize } from './tile';

const base = { tile: null, display_mode: 'frequency' as const, goal_count: null };

describe('tileSize', () => {
  it('choisit automatiquement selon le type', () => {
    expect(tileSize({ ...base, display_mode: 'abstinence' }, 0)).toBe('wide');
    expect(tileSize(base, 2)).toBe('wide');
    expect(tileSize({ ...base, goal_count: 8 }, 0)).toBe('tall');
    expect(tileSize({ ...base, goal_count: 100 }, 0)).toBe('normal');
    expect(tileSize(base, 0)).toBe('normal');
  });
  it('respecte le choix de l’utilisateur', () => {
    expect(tileSize({ ...base, tile: 'small' }, 2)).toBe('small');
    expect(tileSize({ ...base, display_mode: 'abstinence', tile: 'normal' }, 0)).toBe('normal');
  });
});
