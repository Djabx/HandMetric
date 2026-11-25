<script lang="ts">
  import { app, clock, viewOf, type TrackerView } from '../../lib/state.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { go } from '../../lib/router.svelte';
  import { TEMPLATES } from '../../lib/templates';
  import TrackerCard from '../components/TrackerCard.svelte';
  import EventDialog from '../components/EventDialog.svelte';
  import SyncBadge from '../components/SyncBadge.svelte';

  const views = $derived(app.trackers.map((tr) => viewOf(tr, clock.now)));
  let logging = $state<TrackerView | null>(null);
</script>

<div class="page">
  <header class="topbar">
    <h1 class="brand"><img src="./favicon.svg" alt="" width="28" height="28" />{t('app.name')}</h1>
    <SyncBadge />
    <button class="icon-btn" onclick={() => go('settings')} aria-label={t('dash.settings')} title={t('dash.settings')}>⚙️</button>
  </header>

  {#if !app.persistent}
    <p class="banner warn">{t('settings.storage.memory')}</p>
  {/if}

  {#if views.length === 0}
    <section class="empty">
      <h2>{t('dash.empty.title')}</h2>
      <p class="muted">{t('dash.empty.body')}</p>
      <div class="templates">
        {#each TEMPLATES as tpl (tpl.id)}
          <button class="btn" onclick={() => go(`new/${tpl.id}`)}>{tpl.icon} {t(tpl.name)}</button>
        {/each}
      </div>
    </section>
  {:else}
    <div class="grid">
      {#each views as v (v.tracker.id)}
        <TrackerCard view={v} now={clock.now} onlog={(x) => (logging = x)} />
      {/each}
    </div>
  {/if}
</div>

<button class="fab btn primary" onclick={() => go('new')}>＋ {t('dash.new')}</button>

{#if logging}
  <EventDialog tracker={logging.tracker} fields={logging.fields} onclose={() => (logging = null)} />
{/if}

<style>
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { border-radius: 8px; }
  .templates { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 16px; }
  .fab {
    position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom));
    border-radius: 999px; box-shadow: 0 6px 20px color-mix(in srgb, var(--accent) 40%, transparent); min-height: 56px; padding: 0 22px; font-family: var(--font-display); font-size: 1.05rem;
  }
</style>
