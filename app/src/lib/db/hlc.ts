/**
 * Horloge logique hybride (HLC).
 * Format : "<ms sur 13 chiffres>-<compteur sur 4 chiffres>-<device_id>",
 * comparable comme une simple chaîne.
 */
export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    private readonly deviceId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Nouvelle estampille pour une écriture locale. */
  now(): string {
    const wall = this.clock();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.counter++;
      if (this.counter > 9999) {
        this.ms++;
        this.counter = 0;
      }
    }
    return format(this.ms, this.counter, this.deviceId);
  }

  /** Avance l'horloge après réception d'une estampille distante. */
  receive(remote: string): void {
    const parsed = parse(remote);
    if (!parsed) return;
    if (parsed.ms > this.ms || (parsed.ms === this.ms && parsed.counter > this.counter)) {
      this.ms = parsed.ms;
      this.counter = parsed.counter;
    }
  }
}

export function format(ms: number, counter: number, deviceId: string): string {
  return `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${deviceId}`;
}

export function parse(hlc: string): { ms: number; counter: number; deviceId: string } | null {
  const m = /^(\d{13})-(\d{4})-(.+)$/.exec(hlc);
  if (!m) return null;
  return { ms: Number(m[1]), counter: Number(m[2]), deviceId: m[3] };
}
