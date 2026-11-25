<script lang="ts">
  import { sync } from '../../lib/sync/sync.svelte';
  import { api, loadMe, logout, passkeyRegister, syncNow } from '../../lib/sync/client';
  import { supported } from '../../lib/sync/webauthn';
  import { fmtDateTime, fmtRelative, t } from '../../lib/i18n/index.svelte';
  import { app, clock, toast } from '../../lib/state.svelte';
  import SignIn from './SignIn.svelte';

  interface TokenInfo {
    id: string;
    name: string;
    scope: 'webhook' | 'events:write' | 'export:read';
    tracker_id: string | null;
    created_at: string;
    last_used_at: string | null;
  }

  let busy = $state(false);
  let tokens = $state<TokenInfo[]>([]);
  let newName = $state('');
  let newScope = $state<TokenInfo['scope']>('webhook');
  let newTracker = $state('');
  let created = $state<{ secret: string; webhook_url: string | null } | null>(null);

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|cancel|annul|NotAllowed/i.test(msg)) toast(msg, {}, 6000);
    } finally {
      busy = false;
    }
  }

  async function loadTokens() {
    if (!sync.user) return;
    try {
      tokens = (await api<{ tokens: TokenInfo[] }>('/api/v1/tokens')).tokens;
    } catch {
      /* hors ligne */
    }
  }
  $effect(() => {
    if (sync.user) void loadTokens();
  });

  async function createToken(e: SubmitEvent) {
    e.preventDefault();
    await run(async () => {
      await syncNow(); // le compteur doit exister côté serveur
      const r = await api<{ secret: string; webhook_url: string | null }>('/api/v1/tokens', {
        method: 'POST',
        json: { name: newName, scope: newScope, tracker_id: newScope === 'webhook' ? newTracker : null },
      });
      created = r;
      newName = '';
      await loadTokens();
    });
  }

  async function revoke(id: string) {
    if (!confirm(t('common.confirmDelete'))) return;
    await run(async () => {
      await api(`/api/v1/tokens/${id}`, { method: 'DELETE' });
      await loadTokens();
    });
  }

  async function removeIdentity(id: string) {
    if (!confirm(t('common.confirmDelete'))) return;
    await run(async () => {
      await api(`/api/v1/identities/${id}`, { method: 'DELETE' });
      await loadMe();
    });
  }

  const trackerName = (id: string | null) => app.trackers.find((x) => x.id === id)?.name ?? id ?? '';
  const scopeLabel = (s: TokenInfo['scope']) =>
    t(s === 'webhook' ? 'sync.token.scope.webhook' : s === 'export:read' ? 'sync.token.scope.export' : 'sync.token.scope.events');
  const linked = $derived(new Set(sync.identities.filter((i) => i.kind === 'oidc').map((i) => i.provider)));
</script>

<section class="section">
  <h2>{t('sync.title')}</h2>
  {#if sync.mode === 'solo'}
    <p class="card small muted" style="margin:0">{t('sync.solo')}</p>
  {:else if !sync.user}
    <SignIn />
  {:else}
    <div class="card stack">
      <div class="row">
        <strong class="grow">{t('sync.signedInAs', { name: sync.user.display_name ?? '—' })}</strong>
        <button class="btn small" disabled={busy} onclick={() => run(logout)}>{t('sync.signOut')}</button>
      </div>
      <div class="row">
        <span class="grow small muted">
          {#if sync.status === 'syncing'}{t('sync.syncing')}
          {:else if sync.status === 'error'}<span style="color:var(--bad)">{t('sync.error', { msg: sync.error })}</span>
          {:else if !sync.online}{t('sync.offline')}
          {:else if sync.lastSyncAt}{t('sync.last', { when: fmtRelative(Date.parse(sync.lastSyncAt), clock.now) })}
          {:else}{t('sync.never')}{/if}
        </span>
        <button class="btn small" disabled={sync.status === 'syncing'} onclick={() => syncNow()}>{t('sync.now')}</button>
      </div>
    </div>

    <h3>{t('sync.passkeys')}</h3>
    <ul class="list card" style="padding:0 16px">
      {#each sync.identities as i (i.id)}
        <li class="row" style="padding:8px 0">
          <span class="grow">
            {i.kind === 'passkey' ? '🔑' : '🌐'}
            {i.kind === 'passkey' ? (i.label ?? 'Passkey') : `${sync.health?.auth.oidc.find((p) => p.id === i.provider)?.name ?? i.provider}${i.label ? ` · ${i.label}` : ''}`}
            <span class="small muted">· {fmtDateTime(i.created_at)}</span>
          </span>
          {#if sync.identities.length > 1}
            <button class="btn small danger" disabled={busy} onclick={() => removeIdentity(i.id)}>{t('common.delete')}</button>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="row" style="margin-top:8px">
      {#if sync.health?.auth.passkey && supported()}
        <button class="btn small" disabled={busy} onclick={() => run(() => passkeyRegister(undefined, navigator.platform || undefined))}>＋ {t('sync.addPasskey')}</button>
      {/if}
      {#each (sync.health?.auth.oidc ?? []).filter((p) => !linked.has(p.id)) as p (p.id)}
        <a class="btn small" href="/auth/oidc/{p.id}/start">＋ {p.name}</a>
      {/each}
    </div>

    <h3>{t('sync.tokens')}</h3>
    <p class="small muted">{t('sync.tokens.help')}</p>
    {#if tokens.length}
      <ul class="list card" style="padding:0 16px">
        {#each tokens as tk (tk.id)}
          <li class="row" style="padding:8px 0">
            <span class="grow">
              <strong>{tk.name}</strong> · {scopeLabel(tk.scope)}{tk.tracker_id ? ` · ${trackerName(tk.tracker_id)}` : ''}<br />
              <span class="small muted">{tk.last_used_at ? t('sync.token.lastUsed', { when: fmtDateTime(tk.last_used_at) }) : t('sync.token.neverUsed')}</span>
            </span>
            <button class="btn small danger" disabled={busy} onclick={() => revoke(tk.id)}>{t('sync.token.revoke')}</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if created}
      <div class="banner" style="margin-top:8px">
        <p style="margin-top:0">{t('sync.token.created')}</p>
        <code class="secret">{created.webhook_url ?? created.secret}</code>
        {#if created.webhook_url}
          <p class="small muted">curl -X POST {created.webhook_url}</p>
        {:else}
          <p class="small muted">Authorization: Bearer {created.secret}</p>
        {/if}
        <button class="btn small" onclick={() => (created = null)}>{t('common.close')}</button>
      </div>
    {/if}
    <form class="card stack" style="margin-top:8px" onsubmit={createToken}>
      <strong>{t('sync.token.new')}</strong>
      <input type="text" bind:value={newName} required maxlength="80" placeholder={t('sync.token.name')} aria-label={t('sync.token.name')} />
      <select bind:value={newScope} aria-label="Portée">
        <option value="webhook">{t('sync.token.scope.webhook')}</option>
        <option value="events:write">{t('sync.token.scope.events')}</option>
        <option value="export:read">{t('sync.token.scope.export')}</option>
      </select>
      {#if newScope === 'webhook'}
        <select bind:value={newTracker} required aria-label={t('form.name')}>
          <option value="" disabled>—</option>
          {#each app.trackers as tr (tr.id)}<option value={tr.id}>{tr.icon ?? ''} {tr.name}</option>{/each}
        </select>
      {/if}
      <div><button class="btn primary small" disabled={busy}>{t('sync.token.new')}</button></div>
    </form>
  {/if}
</section>

<style>
  .stack { display: grid; gap: 10px; }
  a.btn { text-decoration: none; color: inherit; }
  h3 { font-size: 1rem; margin: 16px 0 8px; }
  .secret { display: block; word-break: break-all; padding: 8px; border-radius: 8px; background: var(--surface); user-select: all; }
</style>
