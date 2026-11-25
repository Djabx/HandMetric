<script lang="ts">
  import { sync } from '../../lib/sync/sync.svelte';
  import { t, fmtRelative } from '../../lib/i18n/index.svelte';
  import { go } from '../../lib/router.svelte';
  import { clock } from '../../lib/state.svelte';

  const title = $derived(
    sync.status === 'error'
      ? t('sync.error', { msg: sync.error })
      : sync.status === 'syncing'
        ? t('sync.syncing')
        : !sync.online
          ? t('sync.offline')
          : sync.lastSyncAt
            ? t('sync.last', { when: fmtRelative(Date.parse(sync.lastSyncAt), clock.now) })
            : t('sync.never'),
  );
</script>

{#if sync.mode === 'server' && sync.user}
  <button class="icon-btn" onclick={() => go('settings')} {title} aria-label={title}>
    {#if sync.status === 'syncing'}⏳{:else if sync.status === 'error'}⚠️{:else if !sync.online}📴{:else}☁️{/if}
  </button>
{/if}
