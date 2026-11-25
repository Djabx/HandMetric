<script lang="ts">
  /** Courbes de moyennes par période (une par mesure), avec des trous là où il n'y a pas de valeur. */
  import type { MeasurePoint } from '../../lib/domain/stats';

  let { series, labelOf, fmt }: {
    series: { name: string; color: string; points: MeasurePoint[] }[];
    labelOf: (key: string) => string;
    fmt: (n: number) => string;
  } = $props();

  const W = 320;
  const H = 150;
  const PAD = { top: 10, right: 8, bottom: 18, left: 34 };

  const n = $derived(series[0]?.points.length ?? 0);
  const values = $derived(series.flatMap((s) => s.points.flatMap((p) => (p.avg === null ? [] : [p.avg]))));
  const bounds = $derived.by(() => {
    if (!values.length) return { lo: 0, hi: 1 };
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.1 || 1;
      hi += Math.abs(hi) * 0.1 || 1;
    }
    const margin = (hi - lo) * 0.1;
    return { lo: lo - margin, hi: hi + margin };
  });
  const step = $derived(Math.ceil(n / 6));

  const x = (i: number) => PAD.left + (n <= 1 ? (W - PAD.left - PAD.right) / 2 : (i * (W - PAD.left - PAD.right)) / (n - 1));
  const y = (v: number) => PAD.top + (1 - (v - bounds.lo) / (bounds.hi - bounds.lo)) * (H - PAD.top - PAD.bottom);

  /** Segments continus (sans valeur manquante) d'une série. */
  function segments(points: MeasurePoint[]): string[] {
    const out: string[] = [];
    let cur: string[] = [];
    points.forEach((p, i) => {
      if (p.avg === null) {
        if (cur.length > 1) out.push(cur.join(' '));
        cur = [];
      } else cur.push(`${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`);
    });
    if (cur.length > 1) out.push(cur.join(' '));
    return out;
  }
</script>

{#if values.length}
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={series.map((s) => s.name).join(', ')}>
    <line class="grid" x1={PAD.left} x2={W - PAD.right} y1={y(bounds.hi)} y2={y(bounds.hi)} />
    <line class="grid" x1={PAD.left} x2={W - PAD.right} y1={y(bounds.lo)} y2={y(bounds.lo)} />
    <text class="axis" x={PAD.left - 4} y={y(bounds.hi) + 3} text-anchor="end">{fmt(bounds.hi)}</text>
    <text class="axis" x={PAD.left - 4} y={y(bounds.lo) + 3} text-anchor="end">{fmt(bounds.lo)}</text>
    {#each series as s (s.name)}
      {#each segments(s.points) as pts, i (i)}
        <polyline points={pts} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      {/each}
      {#each s.points as p, i (p.key)}
        {#if p.avg !== null}
          <circle cx={x(i)} cy={y(p.avg)} r="3" fill={s.color}>
            <title>{s.name} · {labelOf(p.key)} : {fmt(p.avg)}{p.count > 1 ? ` (${fmt(p.min ?? 0)} – ${fmt(p.max ?? 0)})` : ''}</title>
          </circle>
        {/if}
      {/each}
    {/each}
    {#each series[0]?.points ?? [] as p, i (p.key)}
      {#if (n - 1 - i) % step === 0}
        <text class="axis" x={x(i)} y={H - 4} text-anchor="middle">{labelOf(p.key)}</text>
      {/if}
    {/each}
  </svg>
  {#if series.length > 1}
    <div class="legend">
      {#each series as s (s.name)}
        <span><i style:background={s.color}></i>{s.name}</span>
      {/each}
    </div>
  {/if}
{:else}
  <p class="empty muted small">—</p>
{/if}

<style>
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid { stroke: var(--border); stroke-dasharray: 3 3; }
  .axis { font-size: 9px; fill: var(--muted); }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; font-size: 0.8rem; color: var(--muted); margin-top: 4px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  .empty { text-align: center; padding: 48px 0; }
</style>
