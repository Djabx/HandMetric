<script lang="ts">
  import Welcome from '../components/Welcome.svelte';
  import { memoryWarning } from '../../lib/storage';
  import { sync } from '../../lib/sync/sync.svelte';
  import { app, clock, viewOf, type TrackerView } from '../../lib/state.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { go } from '../../lib/router.svelte';
  import { db } from '../../lib/db/client';
  import TrackerCard from '../components/TrackerCard.svelte';
  import EventDialog from '../components/EventDialog.svelte';
  import SyncBadge from '../components/SyncBadge.svelte';

  const views = $derived(app.trackers.map((tr) => viewOf(tr, clock.now)));
  let logging = $state<TrackerView | null>(null);

  // ---------- réorganisation ----------
  let reordering = $state(false);
  /** Ordre en cours d'édition (ids). */
  let order = $state<string[]>([]);
  let dragging = $state<string | null>(null);
  const byId = $derived(new Map(app.trackers.map((tr) => [tr.id, tr])));

  function startReorder() {
    order = app.trackers.map((tr) => tr.id);
    reordering = true;
  }

  async function save() {
    const current = app.trackers.map((tr) => tr.id);
    if (order.some((id, i) => id !== current[i])) await db.write('reorderTrackers', $state.snapshot(order));
  }

  async function finishReorder() {
    await save();
    reordering = false;
  }

  function move(id: string, delta: number) {
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    order = next;
    void save();
  }

  /** Glisser-déposer à la souris ou au doigt, par la poignée. */
  function grab(e: PointerEvent, id: string) {
    e.preventDefault();
    dragging = id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function drag(e: PointerEvent) {
    if (!dragging) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-id]');
    const target = over?.dataset.id;
    if (!target || target === dragging) return;
    const next = order.filter((x) => x !== dragging);
    next.splice(order.indexOf(target), 0, dragging);
    order = next;
  }

  function drop() {
    if (!dragging) return;
    dragging = null;
    void save();
  }
</script>

<div class="page">
  <header class="topbar">
    <h1 class="brand"><img src="./favicon.svg" alt="" width="28" height="28" />{t('app.name')}</h1>
    <SyncBadge />
    {#if app.trackers.length > 1}
      <button class="icon-btn" class:on={reordering} onclick={reordering ? finishReorder : startReorder} aria-pressed={reordering} aria-label={t('dash.reorder')} title={t('dash.reorder')}>↕️</button>
    {/if}
    <button class="icon-btn" onclick={() => go('settings')} aria-label={t('dash.settings')} title={t('dash.settings')}>⚙️</button>
  </header>

  {#if !app.persistent}
    <p class="banner warn">{memoryWarning(app.storageProblem, sync.mode === 'server' && !!sync.user)}</p>
  {/if}

  {#if views.length === 0}
    <Welcome />
  {:else if reordering}
    <p class="small muted">{t('dash.reorder.help')}</p>
    <ol class="reorder card" onpointermove={drag} onpointerup={drop} onpointercancel={drop}>
      {#each order as id, i (id)}
        {@const tr = byId.get(id)}
        {#if tr}
          <li data-id={id} class:dragging={dragging === id} style:--c={tr.color ?? 'var(--accent)'}>
            <span class="handle" role="button" tabindex="-1" aria-label={t('dash.reorder.drag', { name: tr.name })} onpointerdown={(e) => grab(e, id)}>⠿</span>
            <span class="icon" aria-hidden="true">{tr.icon ?? '•'}</span>
            <span class="grow name">{tr.name}</span>
            <button class="icon-btn" disabled={i === 0} onclick={() => move(id, -1)} aria-label={t('dash.reorder.up', { name: tr.name })}>↑</button>
            <button class="icon-btn" disabled={i === order.length - 1} onclick={() => move(id, 1)} aria-label={t('dash.reorder.down', { name: tr.name })}>↓</button>
          </li>
        {/if}
      {/each}
    </ol>
    <div class="row" style="margin-top:12px"><button class="btn primary" onclick={finishReorder}>{t('dash.reorder.done')}</button></div>
  {:else}
    <div class="grid">
      {#each views as v (v.tracker.id)}
        <TrackerCard view={v} now={clock.now} onlog={(x) => (logging = x)} />
      {/each}
    </div>
  {/if}
</div>

{#if !reordering}
{#if views.length}<button class="fab btn primary" onclick={() => go('new')}>＋ {t('dash.new')}</button>{/if}
{/if}

{#if logging}
  <EventDialog tracker={logging.tracker} fields={logging.fields} onclose={() => (logging = null)} />
{/if}

<style>
  /* 6 colonnes : petite tuile = 2, normale ou haute = 3, large = toute la ligne. 12 sur grand écran. */
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(6, minmax(0, 1fr)); grid-auto-flow: row dense; }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(12, minmax(0, 1fr)); } }
  .reorder { list-style: none; margin: 0; padding: 4px 12px; }
  .reorder li {
    display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border);
    border-left: 4px solid var(--c); padding-left: 8px; background: var(--surface); transition: opacity 0.1s;
  }
  .reorder li:last-child { border-bottom: 0; }
  .reorder li.dragging { opacity: 0.6; }
  .handle { cursor: grab; touch-action: none; user-select: none; font-size: 1.3rem; padding: 8px 6px; color: var(--muted); }
  .reorder .icon { font-size: 1.3rem; }
  .reorder .icon-btn:disabled { opacity: 0.25; cursor: default; }
  .reorder .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icon-btn.on { background: var(--accent); color: var(--accent-text); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { border-radius: 8px; }
  .fab {
    position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom));
    border-radius: 999px; box-shadow: 0 6px 20px color-mix(in srgb, var(--accent) 40%, transparent); min-height: 56px; padding: 0 22px; font-family: var(--font-display); font-size: 1.05rem;
  }
</style>
