<script lang="ts">
  import { app, init, onAchievement, toast } from './lib/state.svelte';
  import { router } from './lib/router.svelte';
  import { t, i18n } from './lib/i18n/index.svelte';
  import { achievementLabel } from './lib/labels';
  import Dashboard from './ui/screens/Dashboard.svelte';
  import TrackerDetail from './ui/screens/TrackerDetail.svelte';
  import TrackerForm from './ui/screens/TrackerForm.svelte';
  import Settings from './ui/screens/Settings.svelte';
  import About from './ui/screens/About.svelte';
  import Login from './ui/screens/Login.svelte';
  import { sync } from './lib/sync/sync.svelte';
  import Toasts from './ui/components/Toasts.svelte';
  import { startSync } from './lib/sync/client';

  onAchievement((tr, a, others) => {
    const more = others > 0 ? ` ${t('ach.andMore', { n: others })}` : '';
    toast(`${t('ach.unlocked')} ${tr.icon ?? ''} ${tr.name} : ${achievementLabel(a)}${more}`, { icon: '🏆' }, 6000);
  });

  $effect(() => {
    document.documentElement.lang = i18n.lang;
  });

  void init().then(() => startSync());
</script>

{#if !app.ready || (!app.error && !sync.checked)}
  <div class="page"><p class="muted" style="padding-top:40px;text-align:center">{t('common.loading')}</p></div>
{:else if app.displaced}
  <div class="page">
    <section class="card displaced">
      <h1>{t('displaced.title')}</h1>
      <p class="muted">{t('displaced.body')}</p>
      <button class="btn primary" onclick={() => location.reload()}>{t('displaced.resume')}</button>
    </section>
  </div>
{:else if app.error}
  <div class="page"><p class="banner warn" style="margin-top:40px">{app.error}</p></div>
{:else if router.route.name === 'about'}
  <About />
{:else if sync.mode === 'server' && !sync.user}
  <Login />
{:else if router.route.name === 'tracker'}
  {#key router.route.id}<TrackerDetail id={router.route.id} />{/key}
{:else if router.route.name === 'edit'}
  {#key router.route.id}<TrackerForm id={router.route.id} />{/key}
{:else if router.route.name === 'new'}
  {#key router.route.template}<TrackerForm template={router.route.template ?? null} />{/key}
{:else if router.route.name === 'settings'}
  <Settings />
{:else}
  <Dashboard />
{/if}

<Toasts />

<style>
  .displaced { margin-top: 40px; text-align: center; }
  .displaced h1 { font-size: 1.2rem; margin: 0 0 8px; }
  .displaced .btn { margin-top: 12px; }
</style>
