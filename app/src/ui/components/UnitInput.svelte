<script lang="ts">
  /** Choix d'une unité : liste classée (codes UCUM), ou saisie libre avec « Autre… ». */
  import { ALL_UNITS, UNIT_GROUPS } from '../../lib/catalog';
  import { t } from '../../lib/i18n/index.svelte';
  import { unitLabel } from '../../lib/templates';

  let { value = $bindable() }: { value: string } = $props();

  const OTHER = '__other__';
  // svelte-ignore state_referenced_locally
  let custom = $state(!!value && !ALL_UNITS.some((u) => u.code === value));
  const selected = $derived(custom ? OTHER : value);

  function choose(v: string) {
    if (v === OTHER) {
      custom = true;
      value = '';
    } else {
      custom = false;
      value = v;
    }
  }
</script>

<div class="unit">
  <select aria-label={t('form.fieldUnit')} value={selected} onchange={(e) => choose(e.currentTarget.value)}>
    <option value="">{t('unit.none')}</option>
    {#each UNIT_GROUPS as g (g.name)}
      <optgroup label={t(g.name)}>
        {#each g.units as u (u.code)}
          <option value={u.code}>{unitLabel(u.code)}</option>
        {/each}
      </optgroup>
    {/each}
    <option value={OTHER}>{t('unit.other')}</option>
  </select>
  {#if custom}
    <input type="text" bind:value placeholder={t('unit.otherPlaceholder')} aria-label={t('unit.other')} />
  {/if}
</div>

<style>
  .unit { display: grid; gap: 4px; width: 130px; }
</style>
