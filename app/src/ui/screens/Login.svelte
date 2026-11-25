<script lang="ts">
  /** Écran de connexion, affiché avant tout le reste quand l'app est servie par un serveur LifeLog. */
  import { t } from '../../lib/i18n/index.svelte';
  import SignIn from '../components/SignIn.svelte';
  import Intro from '../components/Intro.svelte';
  import DataModes from '../components/DataModes.svelte';

  const host = location.host;
</script>

<div class="page login">
  <header class="brand">
    <img src="./favicon.svg" alt="" width="56" height="56" />
    <h1>{t('app.name')}</h1>
    <p class="muted">{t('app.tagline')}</p>
  </header>
  <div class="server">
    <span class="small muted">{t('login.server')}</span>
    <h2>🏠 {host}</h2>
    <p class="muted">{t('login.intro')}</p>
  </div>
  <SignIn intro={false} />
  <section class="card"><Intro /></section>
  <section>
    <h2 class="label">{t('about.data')}</h2>
    <DataModes />
  </section>
</div>

<style>
  .login { max-width: 480px; padding-top: 48px; display: grid; gap: 16px; }
  .brand { display: grid; justify-items: center; gap: 6px; text-align: center; }
  .brand img { border-radius: 14px; }
  .brand h1 { margin: 0; }
  .brand p { margin: 0; }
  .label { font-family: inherit; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 8px 0 12px; }
  .server { display: grid; justify-items: center; gap: 4px; text-align: center; padding: 14px 16px; border-radius: 18px; background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .server h2 { margin: 0; font-size: 1.35rem; overflow-wrap: anywhere; }
  .server p { margin: 2px 0 0; }
</style>
