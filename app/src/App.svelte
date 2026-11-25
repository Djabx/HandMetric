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

{#if !app.ready}
  <div class="page"><p class="muted" style="padding-top:40px;text-align:center">{t('common.loading')}</p></div>
{:else if app.error}
  <div class="page"><p class="banner warn" style="margin-top:40px">{app.error}</p></div>
{:else if router.route.name === 'tracker'}
  {#key router.route.id}<TrackerDetail id={router.route.id} />{/key}
{:else if router.route.name === 'edit'}
  {#key router.route.id}<TrackerForm id={router.route.id} />{/key}
{:else if router.route.name === 'new'}
  {#key router.route.template}<TrackerForm template={router.route.template ?? null} />{/key}
{:else if router.route.name === 'settings'}
  <Settings />
{:else if router.route.name === 'about'}
  <About />
{:else}
  <Dashboard />
{/if}

<Toasts />
