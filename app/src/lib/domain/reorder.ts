/** Pure helpers for the home grid drag and drop (see Dashboard.svelte). */

export interface Slot {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The slot under a point, in the same coordinates as the slots. */
export function slotAt(slots: Slot[], x: number, y: number): string | null {
  for (const s of slots) {
    if (x >= s.left && x < s.left + s.width && y >= s.top && y < s.top + s.height) return s.id;
  }
  return null;
}

/** Moves `id` to the place `target` holds now; the others shift by one. */
export function moveTo(order: string[], id: string, target: string): string[] {
  const to = order.indexOf(target);
  if (to < 0 || !order.includes(id) || id === target) return order;
  const next = order.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}
