<script lang="ts">
  /** Connexion à un serveur LifeLog : passkey, fournisseurs OIDC, création de compte. */
  import { sync } from '../../lib/sync/sync.svelte';
  import { passkeyLogin, passkeyRegister } from '../../lib/sync/client';
  import { supported } from '../../lib/sync/webauthn';
  import { t } from '../../lib/i18n/index.svelte';
  import { toast } from '../../lib/state.svelte';
  import { hashParams } from '../../lib/router.svelte';

  /** Phrase d'invitation : inutile sur l'écran de connexion, qui a déjà la sienne. */
  let { intro = true }: { intro?: boolean } = $props();

  let busy = $state(false);
  let displayName = $state('');
  let authError = $state(hashParams().get('auth_error') ?? '');

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    authError = '';
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|cancel|annul|NotAllowed/i.test(msg)) toast(msg, {}, 6000);
    } finally {
      busy = false;
    }
  }
</script>

<div class="card stack">
  {#if authError}<p class="banner warn" style="margin:0">{authError}</p>{/if}
  {#if intro}<p style="margin:0">{t('sync.signedOut')}</p>{/if}
  <!-- Le fournisseur d'identité d'abord : c'est la voie normale sur un serveur qui en a un. -->
  {#each sync.health?.auth.oidc ?? [] as p (p.id)}
    <a class="btn primary" href="/auth/oidc/{p.id}/start">🔐 {t('sync.signInWith', { name: p.name })}</a>
  {/each}
  {#if sync.health?.auth.passkey && supported()}
    <button class="btn" class:primary={!sync.health?.auth.oidc.length} disabled={busy} onclick={() => run(passkeyLogin)}>🔑 {t('sync.signInPasskey')}</button>
  {/if}
  {#if sync.health?.auth.passkey_registration && supported()}
    <hr />
    <div class="row">
      <input class="grow" type="text" bind:value={displayName} placeholder={t('form.name')} aria-label={t('form.name')} style="width:auto" />
      <button class="btn" disabled={busy} onclick={() => run(() => passkeyRegister(displayName))}>{t('sync.signUpPasskey')}</button>
    </div>
  {/if}
</div>

<style>
  .stack { display: grid; gap: 10px; }
  a.btn { text-decoration: none; }
  a.btn:not(.primary) { color: inherit; }
  hr { border: 0; border-top: 1px solid var(--border); width: 100%; margin: 4px 0; }
</style>
