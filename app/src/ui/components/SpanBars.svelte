<script lang="ts">
  /**
   * The last periods of a span tracker, one row each, placed on a shared time of day axis:
   * nights line up from bedtime to waking up, and an unusual night stands out.
   */
  import { barPlace, barWindow, durationOf, type SpanBar } from '../../lib/domain/span';
  import { clockDuration, fmtMinuteOfDay, locale } from '../../lib/i18n/index.svelte';

  let { bars, color, onpick }: { bars: SpanBar[]; color: string; onpick?: (b: SpanBar) => void } = $props();

  const win = $derived(barWindow(bars));
  const span = $derived(win ? win.to - win.from : 1);
  /** Hour marks along the axis: about four of them. */
  const ticks = $derived.by(() => {
    if (!win) return [];
    const hours = span / 60;
    const step = hours <= 8 ? 2 : hours <= 16 ? 4 : hours <= 24 ? 6 : 12;
    const out: number[] = [];
    for (let m = win.from; m <= win.to; m += step * 60) out.push(m);
    return out;
  });
  const dayLabel = (b: SpanBar) =>
    new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric' }).format(new Date(b.day + 'T12:00:00Z'));
</script>

{#if win}
  <div class="bars" style:--c={color}>
    <div class="row axis" aria-hidden="true">
      <span></span>
      <div class="scale">
        {#each ticks as m (m)}<span style:left="{((m - win.from) / span) * 100}%">{fmtMinuteOfDay(m)}</span>{/each}
      </div>
      <span></span>
    </div>
    {#each bars as b (b.event.id)}
      {@const p = barPlace(b)}
      <button class="row" onclick={() => onpick?.(b)}>
        <span class="day">{dayLabel(b)}</span>
        <span class="track">
          <span class="bar" style:left="{((p.start - win.from) / span) * 100}%" style:width="{Math.max(1, ((p.end - p.start) / span) * 100)}%"></span>
        </span>
        <b class="len">{clockDuration(durationOf(b.event))}</b>
      </button>
    {/each}
  </div>
{/if}

<style>
  .bars { display: grid; gap: 6px; }
  .row { display: grid; grid-template-columns: 58px minmax(0, 1fr) 58px; align-items: center; gap: 8px; font: inherit; font-size: 0.8rem; color: inherit; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; }
  .axis { cursor: default; color: var(--muted); font-size: 0.7rem; height: 16px; }
  .scale { position: relative; height: 100%; }
  .scale span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .scale span:first-child { transform: none; }
  .scale span:last-child { transform: translateX(-100%); }
  .day { color: var(--muted); white-space: nowrap; }
  .track { position: relative; height: 16px; border-radius: 8px; background: var(--surface-2); }
  .bar { position: absolute; top: 0; bottom: 0; border-radius: 8px; background: var(--c); }
  .len { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
