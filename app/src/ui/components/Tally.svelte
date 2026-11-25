<script lang="ts">
  /**
   * Bâtons de comptage : `target` bâtons groupés par cinq (quatre + un barré),
   * les `current` premiers pleins. Au-delà de la cible, les bâtons en trop
   * prennent la couleur `overColor`.
   */
  let { current, target, color, overColor = color, label }: {
    current: number; target: number; color: string; overColor?: string; label: string;
  } = $props();

  const STEP = 9;
  const GROUP_GAP = 8;
  const n = $derived(Math.max(current, target));
  const marks = $derived(
    Array.from({ length: n }, (_, i) => {
      const group = Math.floor(i / 5);
      const pos = i % 5;
      const x0 = group * (4 * STEP + GROUP_GAP + 6) + 4;
      const filled = i < current;
      const over = i >= target;
      const stroke = filled ? (over ? overColor : color) : color;
      return pos === 4
        ? { d: `M${x0 - 3} 17 L${x0 + 3 * STEP + 3} 5`, stroke, filled }
        : { d: `M${x0 + pos * STEP} 3 V19`, stroke, filled };
    }),
  );
  const width = $derived(Math.ceil(n / 5) * (4 * STEP + GROUP_GAP + 6));
</script>

<svg class="tally" viewBox="0 0 {width} 22" width={width} height="22" role="img" aria-label={label}>
  {#each marks as m, i (i)}
    <path d={m.d} style:stroke={m.stroke} style:stroke-opacity={m.filled ? 1 : 0.25} />
  {/each}
</svg>

<style>
  .tally { display: block; max-width: 100%; height: 22px; fill: none; stroke-width: 3.5; stroke-linecap: round; }
</style>
