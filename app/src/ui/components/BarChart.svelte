<script lang="ts">
  let { data, color, target = null, labelOf }: {
    data: { key: string; count: number }[];
    color: string;
    target?: number | null;
    labelOf: (key: string) => string;
  } = $props();
  const step = $derived(Math.ceil(data.length / 6));
  const max = $derived(Math.max(1, target ?? 0, ...data.map((d) => d.count)));
</script>

<div class="chart" style:--c={color}>
  {#if target}
    <div class="target" style:bottom="{(target / max) * 100}%" aria-hidden="true"></div>
  {/if}
  {#each data as d, i (d.key)}
    <div class="col" title="{labelOf(d.key)} : {d.count}">
      <span class="n">{d.count || ''}</span>
      <div class="bar" style:height="{(d.count / max) * 100}%"></div>
      <span class="lbl">{(data.length - 1 - i) % step === 0 ? labelOf(d.key) : ''}</span>
    </div>
  {/each}
</div>

<style>
  .chart { position: relative; display: flex; align-items: flex-end; gap: 4px; height: 160px; padding-top: 18px; }
  .col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; }
  .bar { width: 100%; border-radius: 4px 4px 0 0; background: var(--c); min-height: 0; }
  .n { font-size: 0.7rem; color: var(--muted); }
  .lbl { font-size: 0.65rem; color: var(--muted); white-space: nowrap; height: 1em; overflow: visible; }
  .target { position: absolute; left: 0; right: 0; border-top: 2px dashed var(--muted); margin-bottom: 18px; opacity: 0.6; }
</style>
