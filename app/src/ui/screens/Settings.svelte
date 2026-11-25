<script lang="ts">
  import { app, toast } from '../../lib/state.svelte';
  import { db } from '../../lib/db/client';
  import { fmtDate, i18n, setLang, t, type Lang } from '../../lib/i18n/index.svelte';
  import { back, go } from '../../lib/router.svelte';
  import { download, stamp } from '../../lib/io/download';
  import { APP_VERSION, TRASH_DAYS } from '../../lib/db/store';
  import SyncPanel from '../components/SyncPanel.svelte';
  import { sync } from '../../lib/sync/sync.svelte';

  let busy = $state(false);
  let persisted = $state<boolean | null>(null);
  const host = location.host;
  /** Où sont les données : seulement ce navigateur, ou aussi le serveur. */
  const storageMessage = $derived(
    !app.persistent
      ? t('settings.storage.memory')
      : sync.mode === 'server' && sync.user
        ? t('settings.storage.synced', { host })
        : sync.mode === 'server'
          ? t('settings.storage.signedOut', { host })
          : persisted === false
            ? t('settings.storage.notPersisted')
            : t('settings.storage.ok'),
  );
  const purgeDate = (deletedAt: string) => new Date(Date.parse(deletedAt) + TRASH_DAYS * 86_400_000).toISOString();
  $effect(() => {
    navigator.storage?.persisted?.().then((p) => (persisted = p));
  });

  async function exportAs(kind: 'sqlite' | 'json' | 'csv') {
    busy = true;
    try {
      if (kind === 'sqlite') {
        download((await db.call('exportSqlite')) as BlobPart, `lifelog-${stamp()}.lifelog.sqlite`, 'application/vnd.sqlite3');
      } else if (kind === 'json') {
        download(JSON.stringify(await db.call('exportJson'), null, 2), `lifelog-${stamp()}.json`, 'application/json');
      } else {
        download(await db.call('exportCsv'), `lifelog-${stamp()}.csv`, 'text/csv');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    try {
      const sum = await db.write('importFile', new Uint8Array(await file.arrayBuffer()));
      toast(t('settings.import.done', { inserted: sum.inserted, updated: sum.updated, ignored: sum.ignored }), {}, 8000);
      if (sum.stillDeleted) toast(t('settings.import.stillDeleted', { n: sum.stillDeleted }), { icon: '🗑️' }, 12000);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), {}, 8000);
    } finally {
      busy = false;
    }
  }
</script>

<div class="page">
  <header class="topbar">
    <button class="icon-btn" onclick={back} aria-label={t('common.back')}>←</button>
    <h1>{t('settings.title')}</h1>
  </header>

  <section class="section">
    <h2>{t('settings.language')}</h2>
    <div class="segmented">
      {#each [['fr', 'Français'], ['en', 'English']] as [code, label] (code)}
        <button aria-pressed={i18n.lang === code} onclick={() => setLang(code as Lang)}>{label}</button>
      {/each}
    </div>
  </section>

  <SyncPanel />

  <section class="section">
    <h2>{t('settings.data')}</h2>
    <div class="card">
      <p class="banner" class:warn={!app.persistent || (sync.mode === 'server' ? !sync.user : persisted === false)} style="margin-top:0">
        {storageMessage}
      </p>
      <h3>{t('settings.export')}</h3>
      <div class="row">
        <button class="btn" disabled={busy} onclick={() => exportAs('sqlite')}>{t('settings.export.sqlite')}</button>
        <button class="btn" disabled={busy} onclick={() => exportAs('json')}>{t('settings.export.json')}</button>
        <button class="btn" disabled={busy} onclick={() => exportAs('csv')}>{t('settings.export.csv')}</button>
      </div>
      <h3>{t('settings.import')}</h3>
      <p class="small muted">{t('settings.import.help')}</p>
      <input type="file" accept=".sqlite,.sqlite3,.db,.json,application/json,application/vnd.sqlite3" onchange={importFile} disabled={busy} />
    </div>
  </section>

  {#if app.archived.length}
    <section class="section">
      <h2>{t('settings.archived')}</h2>
      <p class="small muted">{t('settings.archived.help')}</p>
      <ul class="list card" style="padding:0 16px">
        {#each app.archived as tr (tr.id)}
          <li class="row" style="padding:8px 0">
            <button class="grow linkish" onclick={() => go(`t/${tr.id}`)}>{tr.icon ?? ''} {tr.name}</button>
            <button class="btn small" onclick={() => db.write('setArchived', tr.id, false)}>{t('form.unarchive')}</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if app.deleted.length}
    <section class="section">
      <h2>{t('settings.trash')}</h2>
      <p class="small muted">{t('settings.trash.help')}</p>
      <ul class="list card" style="padding:0 16px">
        {#each app.deleted as tr (tr.id)}
          <li class="row" style="padding:8px 0">
            <div class="grow">
              <div>{tr.icon ?? ''} {tr.name}</div>
              <div class="small muted">{t('settings.trash.meta', { date: fmtDate(tr.deleted_at!), n: tr.event_count, purge: fmtDate(purgeDate(tr.deleted_at!)) })}</div>
            </div>
            <div class="trash-actions">
              <button
                class="btn small"
                onclick={async () => {
                  await db.write('restoreTracker', tr.id);
                  toast(t('settings.trash.restored', { name: tr.name }), { icon: '♻️' });
                }}>{t('settings.trash.restore')}</button>
              <button
                class="btn small danger"
                onclick={async () => {
                  if (!confirm(t('settings.trash.purgeConfirm', { name: tr.name, n: tr.event_count }))) return;
                  await db.write('purgeTracker', tr.id);
                  toast(t('settings.trash.purged', { name: tr.name }), { icon: '🔥' });
                }}>{t('settings.trash.purge')}</button>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="section" id="about">
    <h2>{t('settings.about')}</h2>
    <p class="small muted">
      {t('app.tagline')} <a href="#/about">{t('about.more')}</a><br />
      {t('settings.version', { v: APP_VERSION })} · <a href="https://github.com/Djabx/lifelog" target="_blank" rel="noopener">{t('settings.source')}</a> · MIT
    </p>
  </section>
</div>

<style>
  h3 { font-size: 1rem; margin: 16px 0 8px; }
  .trash-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .linkish { text-align: left; border: 0; background: none; cursor: pointer; padding: 8px 0; }
</style>
