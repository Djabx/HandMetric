<script lang="ts">
  /** Présentation de LifeLog : l'idée. Écran de connexion et À propos. */
  import { t } from '../../lib/i18n/index.svelte';

  let { more = true }: { more?: boolean } = $props();

</script>

<div class="intro">
  <p>{t('about.idea')}</p>
  <ul>
    <li>{t('about.idea.trackers')}</li>
    <li>{t('about.idea.since')}</li>
    <li>{t('about.idea.trophies')}</li>
  </ul>
  {#if more}<p class="small" style="margin:0"><a href="#/about">{t('about.more')}</a></p>{/if}
</div>

<style>
  .intro { display: grid; gap: 10px; text-align: left; }
  .intro p { margin: 0; }
  ul { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; }
</style>
