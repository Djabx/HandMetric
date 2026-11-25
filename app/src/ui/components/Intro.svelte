<script lang="ts">
  /** Présentation de LifeLog : l'idée, et où sont les données ici. Écran de connexion, accueil vide, À propos. */
  import { app } from '../../lib/state.svelte';
  import { sync } from '../../lib/sync/sync.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  let { more = true }: { more?: boolean } = $props();

  const host = location.host;
  const current = $derived(
    !app.persistent
      ? sync.mode === 'server'
        ? t('about.now.memoryServer', { host })
        : t('about.now.memory')
      : sync.mode === 'server'
        ? sync.user
          ? t('about.now.server', { host })
          : t('about.now.serverSignedOut', { host })
        : t('about.now.solo'),
  );
</script>

<div class="intro">
  <p>{t('about.idea')}</p>
  <ul>
    <li>{t('about.idea.trackers')}</li>
    <li>{t('about.idea.since')}</li>
    <li>{t('about.idea.trophies')}</li>
  </ul>
  <p class="banner" class:warn={!app.persistent} style="margin:0">🔒 {current}</p>
  {#if more}<p class="small" style="margin:0"><a href="#/about">{t('about.more')}</a></p>{/if}
</div>

<style>
  .intro { display: grid; gap: 10px; text-align: left; }
  .intro p { margin: 0; }
  ul { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; }
</style>
