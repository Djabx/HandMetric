import { describe, expect, it } from 'vitest';
import { moveTo, slotAt, type Slot } from './reorder';

describe('moveTo', () => {
  it('moves forward and backward', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });
  it('ignores unknown ids and self', () => {
    const order = ['a', 'b'];
    expect(moveTo(order, 'a', 'a')).toBe(order);
    expect(moveTo(order, 'x', 'a')).toBe(order);
    expect(moveTo(order, 'a', 'x')).toBe(order);
  });
});

describe('slotAt', () => {
  const slots: Slot[] = [
    { id: 'a', left: 0, top: 0, width: 100, height: 50 },
    { id: 'b', left: 112, top: 0, width: 100, height: 50 },
  ];
  it('finds the slot under the point', () => {
    expect(slotAt(slots, 10, 10)).toBe('a');
    expect(slotAt(slots, 150, 49)).toBe('b');
  });
  it('returns null in the gaps', () => {
    expect(slotAt(slots, 105, 10)).toBeNull();
    expect(slotAt(slots, 10, 60)).toBeNull();
  });
});
