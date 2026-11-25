<script lang="ts">
  import { sync } from '../../lib/sync/sync.svelte';
  import { t } from '../../lib/i18n/index.svelte';
</script>

<section class="section">
  <h2>{t('sync.title')}</h2>
  {#if sync.mode === 'solo'}
    <p class="card small muted" style="margin:0">{t('sync.solo')}</p>
  {/if}
</section>
