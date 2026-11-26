<script lang="ts">
  import { app, toast } from '../../lib/state.svelte';
  import { db } from '../../lib/db/client';
  import { fmtDate, fmtDateTime, i18n, setLang, t, type Lang } from '../../lib/i18n/index.svelte';
  import { back, go } from '../../lib/router.svelte';
  import { download, stamp } from '../../lib/io/download';
  import { APP_VERSION, TRASH_DAYS } from '../../lib/db/store';
  import SyncPanel from '../components/SyncPanel.svelte';
  import Fold from '../components/Fold.svelte';
  import { memoryWarning } from '../../lib/storage';
  import { sync } from '../../lib/sync/sync.svelte';

  let busy = $state(false);
  let persisted = $state<boolean | null>(null);
  const host = location.host;
  /** Où sont les données : seulement ce navigateur, ou aussi le serveur. */
  const storageMessage = $derived(
    !app.persistent
      ? memoryWarning(app.storageProblem, sync.mode === 'server' && !!sync.user)
      : sync.mode === 'server' && sync.user
        ? t('settings.storage.synced', { host })
        : sync.mode === 'server'
          ? t('settings.storage.signedOut', { host })
          : persisted === false
            ? t('settings.storage.notPersisted')
            : t('settings.storage.ok'),
  );
  const dataWarn = $derived(!app.persistent || (sync.mode === 'server' ? !sync.user : persisted === false));
  /** Résumés affichés sous le titre des tuiles repliées. */
  const dataSummary = $derived(
    !app.persistent
      ? t('settings.sum.atRisk')
      : sync.mode === 'server' && sync.user
        ? t('settings.sum.server', { host })
        : t('settings.sum.local'),
  );
  const syncSummary = $derived(
    sync.mode === 'solo'
      ? t('settings.sum.solo')
      : !sync.user
        ? t('settings.sum.signedOut')
        : sync.user.display_name || sync.identities.find((i) => i.label)?.label || t('sync.signedIn'),
  );

  const LANGS = [['fr', 'Français'], ['en', 'English']] as const;
  /** Une seule tuile ouverte à la fois : en ouvrir une referme la précédente. */
  let open = $state<string | null>(null);
  const fold = (id: string) => ({ open: open === id, ontoggle: () => (open = open === id ? null : id) });
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

  <div class="folds">
    <Fold id="language" icon="🌍" color="#0090ff" title={t('settings.language')} summary={LANGS.find(([c]) => c === i18n.lang)?.[1]} {...fold('language')}>
      <div class="segmented">
        {#each LANGS as [code, label] (code)}
          <button aria-pressed={i18n.lang === code} onclick={() => setLang(code as Lang)}>{label}</button>
        {/each}
      </div>
    </Fold>

    <Fold id="sync" icon="🔄" color="#6e56cf" title={t('sync.title')} summary={syncSummary} warn={sync.mode === 'server' && !sync.user} {...fold('sync')}>
      <SyncPanel />
    </Fold>

    <Fold id="data" icon="💾" color="#46a758" title={t('settings.data')} summary={dataSummary} warn={dataWarn} {...fold('data')}>
      <div class="card">
        <p class="banner" class:warn={dataWarn} style="margin-top:0">
          {storageMessage}
          {#if app.storageProblem?.issue === 'locked'}<button class="btn small retry" onclick={() => location.reload()}>{t('storage.retry')}</button>{/if}
          {#if app.storageProblem}<br /><span class="small muted">{app.storageProblem.detail}</span>{/if}
        </p>
        <h3>{t('settings.export')}</h3>
        <div class="row">
          <button class="btn" disabled={busy} onclick={() => exportAs('sqlite')}>{t('settings.export.sqlite')}</button>
          <button class="btn" disabled={busy} onclick={() => exportAs('json')}>{t('settings.export.json')}</button>
          <button class="btn" disabled={busy} onclick={() => exportAs('csv')}>{t('settings.export.csv')}</button>
        </div>
        <h3>{t('settings.import')}</h3>
        <p class="small muted">{t('settings.import.help')}</p>
        <!-- Pas d'attribut accept : iOS ne connaît pas l'extension .sqlite et grise alors le fichier
             dans son sélecteur. Le contenu est vérifié à l'import (SQLite ou JSON LifeLog). -->
        <input type="file" onchange={importFile} disabled={busy} />
      </div>
    </Fold>

    {#if app.archived.length}
      <Fold id="archived" icon="📦" color="#f76b15" title={t('settings.archived')} summary={t('settings.sum.archived', { n: app.archived.length })} {...fold('archived')}>
        <p class="small muted">{t('settings.archived.help')}</p>
        <ul class="list card" style="padding:0 16px">
          {#each app.archived as tr (tr.id)}
            <li class="row" style="padding:8px 0">
              <button class="grow linkish" onclick={() => go(`t/${tr.id}`)}>{tr.icon ?? ''} {tr.name}</button>
              <button class="btn small" onclick={() => db.write('setArchived', tr.id, false)}>{t('form.unarchive')}</button>
            </li>
          {/each}
        </ul>
      </Fold>
    {/if}

    {#if app.deleted.length || app.deletedEvents.length}
      <Fold id="trash" icon="🗑️" color="#e5484d" title={t('settings.trash')} summary={t('settings.sum.trash', { n: app.deleted.length + app.deletedEvents.length })} {...fold('trash')}>
        <p class="small muted">{t('settings.trash.help')}</p>
        <div class="card trash">
          {#if app.deleted.length}
            <h3 class="trash-sub">{t('settings.trash.trackers')} · {app.deleted.length}</h3>
            <ul class="list">
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
          {/if}
          {#if app.deletedEvents.length}
            <h3 class="trash-sub">{t('settings.trash.events')} · {app.deletedEvents.length}</h3>
            <ul class="list">
              {#each app.deletedEvents as ev (ev.id)}
                <li class="row" style="padding:8px 0">
                  <div class="grow">
                    <div>{ev.tracker_icon ?? ''} {ev.tracker_name} · {fmtDateTime(ev.occurred_at)}</div>
                    <div class="small muted">{t('settings.trash.eventMeta', { date: fmtDate(ev.deleted_at!), purge: fmtDate(purgeDate(ev.deleted_at!)) })}</div>
                  </div>
                  <div class="trash-actions">
                    <button
                      class="btn small"
                      onclick={async () => {
                        await db.write('restoreEvent', ev.id);
                        toast(t('settings.trash.eventRestored'), { icon: '♻️' });
                      }}>{t('settings.trash.restore')}</button>
                    <button
                      class="btn small danger"
                      onclick={async () => {
                        if (!confirm(t('settings.trash.eventPurgeConfirm'))) return;
                        await db.write('purgeEvent', ev.id);
                        toast(t('settings.trash.eventPurged'), { icon: '🔥' });
                      }}>{t('settings.trash.purge')}</button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </Fold>
    {/if}

    <Fold id="about" icon="💜" color="#8d8d8d" title={t('settings.about')} summary={t('settings.version', { v: APP_VERSION })} {...fold('about')}>
      <p class="small muted" style="margin-bottom:0">
        {t('app.tagline')} <a href="#/about">{t('about.more')}</a><br />
        {t('settings.version', { v: APP_VERSION })} · <a href="https://github.com/Djabx/lifelog" target="_blank" rel="noopener">{t('settings.source')}</a> · MIT
      </p>
    </Fold>
  </div>
</div>

<style>
  .folds { display: grid; gap: 12px; margin-top: 12px; }
  .trash { padding: 4px 16px 4px; }
  .trash .trash-sub {
    font-family: inherit; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 12px 0 0;
  }
  .trash ul + .trash-sub { border-top: 1px solid var(--border); padding-top: 12px; }
  h3 { font-size: 1rem; margin: 16px 0 8px; }
  .trash-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .linkish { text-align: left; border: 0; background: none; cursor: pointer; padding: 8px 0; }
</style>
