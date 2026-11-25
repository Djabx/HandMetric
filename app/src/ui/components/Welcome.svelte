<script lang="ts">
  /** Accueil sans compteur : la présentation complète, où sont les données, puis les modèles. */
  import { t } from '../../lib/i18n/index.svelte';
  import { go } from '../../lib/router.svelte';
  import { TEMPLATES } from '../../lib/templates';
  import DataModes from './DataModes.svelte';
</script>

<div class="welcome">
  <section class="hero">
    <h1>{t('home.title')} <em>{t('home.titleEm')}</em>.</h1>
    <p class="muted">{t('home.sub')}</p>
  </section>

  <ul class="feat">
    <li><b>👆</b>{t('home.f.log')}</li>
    <li><b>🧘</b>{t('home.f.since')}</li>
    <li><b>🏆</b>{t('home.f.trophies')}</li>
  </ul>

  <section>
    <h2 class="label">{t('about.data')}</h2>
    <DataModes />
    <p class="small muted foot">{t('home.privacy')} <a href="#/about">{t('about.more')}</a></p>
  </section>

  <section>
    <h2 class="label">{t('home.start')}</h2>
    <div class="chips">
      {#each TEMPLATES as tpl (tpl.id)}
        <button class="btn" onclick={() => go(`new/${tpl.id}`)}>{tpl.icon} {t(tpl.name)}</button>
      {/each}
      <button class="btn primary" onclick={() => go('new')}>＋ {t('home.custom')}</button>
    </div>
  </section>
</div>

<style>
  .welcome { display: grid; gap: 22px; padding-bottom: 24px; }
  .hero { text-align: center; display: grid; gap: 8px; padding-top: 12px; }
  .hero h1 { font-size: 2rem; line-height: 1.1; margin: 0; }
  .hero em { font-style: normal; color: var(--accent); }
  .hero p { margin: 0; }
  .feat { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .feat li {
    background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
    padding: 12px 8px; text-align: center; font-size: 0.85rem;
  }
  .feat b { display: block; font-size: 1.4rem; margin-bottom: 4px; }
  .label {
    font-family: inherit; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 12px;
  }
  .foot { margin: 10px 0 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
