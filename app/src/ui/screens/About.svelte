<script lang="ts">
  /** Page « À propos » : l'idée de LifeLog et où sont les données. */
  import { t } from '../../lib/i18n/index.svelte';
  import { back } from '../../lib/router.svelte';
  import AboutContent from '../components/AboutContent.svelte';
</script>

<div class="page">
  <header class="topbar">
    <button class="icon-btn" onclick={back} aria-label={t('common.back')}>←</button>
    <h1>{t('about.title')}</h1>
  </header>

  <AboutContent />
</div>
