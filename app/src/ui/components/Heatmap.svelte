<script lang="ts">
  import { fmtDate } from '../../lib/i18n/index.svelte';

  let { cells, color }: { cells: { key: string; count: number }[]; color: string } = $props();
  const max = $derived(Math.max(1, ...cells.map((c) => c.count)));
  const level = (n: number) => (n === 0 ? 0 : Math.ceil((n / max) * 4));
</script>

<div class="wrap">
  <div class="heat" style:--c={color} role="img" aria-label="Calendrier">
    {#each cells as c (c.key)}
      <span class="cell l{level(c.count)}" title="{fmtDate(c.key + 'T12:00:00Z')} : {c.count}"></span>
    {/each}
  </div>
</div>

<style>
  .wrap { overflow-x: auto; padding-bottom: 4px; direction: rtl; }
  .heat {
    direction: ltr; display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 12px);
    grid-auto-columns: 12px; gap: 3px; width: max-content;
  }
  .cell { border-radius: 3px; background: var(--heat-0); }
  .l1 { background: color-mix(in srgb, var(--c) 30%, var(--heat-0)); }
  .l2 { background: color-mix(in srgb, var(--c) 55%, var(--heat-0)); }
  .l3 { background: color-mix(in srgb, var(--c) 78%, var(--heat-0)); }
  .l4 { background: var(--c); }
</style>
