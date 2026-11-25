<script lang="ts">
  /** Page « À propos » : l'idée de LifeLog et où sont les données. */
  import { t } from '../../lib/i18n/index.svelte';
  import { back } from '../../lib/router.svelte';
  import { APP_VERSION } from '../../lib/db/store';
  import Intro from '../components/Intro.svelte';
</script>

<div class="page">
  <header class="topbar">
    <button class="icon-btn" onclick={back} aria-label={t('common.back')}>←</button>
    <h1>{t('about.title')}</h1>
  </header>

  <section class="section">
    <p class="lead">{t('app.tagline')}</p>
    <Intro more={false} />
  </section>

  <section class="section">
    <h2>{t('about.data')}</h2>
    <div class="card modes">
      <div>
        <h3>🧭 {t('about.solo.title')}</h3>
        <p>{t('about.solo.body')}</p>
      </div>
      <div>
        <h3>🏠 {t('about.server.title')}</h3>
        <p>{t('about.server.body')}</p>
      </div>
    </div>
    <p class="small muted">{t('about.privacy')}</p>
  </section>

  <section class="section">
    <h2>{t('about.export')}</h2>
    <p>{t('about.export.body')}</p>
  </section>

  <p class="small muted">
    {t('settings.version', { v: APP_VERSION })} · <a href="https://github.com/Djabx/lifelog" target="_blank" rel="noopener">{t('settings.source')}</a> · MIT
  </p>
</div>

<style>
  .lead { font-size: 1.15rem; font-weight: 600; }
  h3 { font-size: 1rem; margin: 0 0 4px; }
  .modes { display: grid; gap: 14px; }
  .modes p { margin: 0; }
</style>
