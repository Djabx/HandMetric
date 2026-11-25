<script lang="ts">
  /** Écran de connexion, affiché avant tout le reste quand l'app est servie par un serveur LifeLog. */
  import { t } from '../../lib/i18n/index.svelte';
  import SignIn from '../components/SignIn.svelte';

  const host = location.host;
</script>

<div class="page login">
  <header class="brand">
    <img src="./favicon.svg" alt="" width="56" height="56" />
    <h1>{t('app.name')}</h1>
    <p class="muted">{t('app.tagline')}</p>
  </header>
  <p>{t('login.intro', { host })}</p>
  <SignIn />
  <p class="small muted"><a href="#/about">{t('about.more')}</a></p>
</div>

<style>
  .login { max-width: 420px; padding-top: 48px; display: grid; gap: 16px; }
  .brand { display: grid; justify-items: center; gap: 6px; text-align: center; }
  .brand img { border-radius: 14px; }
  .brand h1 { margin: 0; }
  .brand p { margin: 0; }
</style>
