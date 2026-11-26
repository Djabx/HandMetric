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
  import { flip } from 'svelte/animate';
  import { tileSize } from '../../lib/domain/tile';

  let lifted = $state<string | null>(null);
  let liveOrder = $state<string[]>([]);
  /** Ordre gardé à l'écran le temps que l'enregistrement revienne (pas de saut). */
  let settling = $state(false);
  const allViews = $derived(app.trackers.map((tr) => viewOf(tr, clock.now)));
  /** Pendant un glisser-déposer, les tuiles suivent l'ordre en cours. */
  const views = $derived(
    lifted || settling ? liveOrder.map((id) => allViews.find((v) => v.tracker.id === id)).filter((v) => v !== undefined) : allViews,
  );
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

  // ---------- glisser-déposer des tuiles : appui long puis glisser ----------
  const HOLD_MS = 450;
  /** Tolérance avant l'appui long : au-delà, c'est un défilement. */
  const SLOP = 10;
  let grid = $state<HTMLElement>();
  let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout>; pointer: number } | null = null;
  /** Évite que le relâchement après un déplacement ouvre le compteur. */
  let swallowClick = false;

  function tileDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;
    const pointer = e.pointerId;
    press = {
      id, x: e.clientX, y: e.clientY, pointer,
      timer: setTimeout(() => {
        if (!press) return;
        lifted = press.id;
        liveOrder = app.trackers.map((tr) => tr.id);
        navigator.vibrate?.(15);
        try { grid?.setPointerCapture(pointer); } catch { /* le doigt est déjà parti */ }
      }, HOLD_MS),
    };
  }

  function tileMove(e: PointerEvent) {
    if (press && !lifted && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
    if (!lifted) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!over || over === lifted) return;
    const next = liveOrder.filter((x) => x !== lifted);
    next.splice(liveOrder.indexOf(over), 0, lifted);
    liveOrder = next;
  }

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  async function tileUp() {
    cancelPress();
    if (!lifted) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 400);
    const ids = $state.snapshot(liveOrder);
    settling = true;
    lifted = null;
    try {
      if (ids.some((id, i) => id !== app.trackers[i]?.id)) await db.write('reorderTrackers', ids);
    } finally {
      settling = false;
    }
  }

  // Pendant le déplacement, le doigt ne fait plus défiler la page.
  $effect(() => {
    const el = grid;
    if (!el) return;
    const block = (e: TouchEvent) => { if (lifted) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  });

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
    <!-- svelte-ignore a11y_no_static_element_interactions (le clavier passe par ↕️ Réorganiser) -->
    <div
      class="grid"
      class:dragging={lifted}
      bind:this={grid}
      onpointerdown={tileDown}
      onpointermove={tileMove}
      onpointerup={tileUp}
      onpointercancel={tileUp}
      oncontextmenu={(e) => { if (press || lifted) e.preventDefault(); }}
      onclickcapture={(e) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } }}
    >
      {#each views as v (v.tracker.id)}
        <div class="cell {tileSize(v.tracker, v.fields.length)}" animate:flip={{ duration: 180 }}>
          <TrackerCard view={v} now={clock.now} onlog={(x) => (logging = x)} lifted={lifted === v.tracker.id} />
        </div>
      {/each}
    </div>
    {#if views.length > 1}<p class="small muted hint">{t('dash.dragHint')}</p>{/if}
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
  .grid.dragging { touch-action: none; }
  /* Tailles des tuiles : 6 colonnes (12 sur grand écran). */
  .cell { grid-column: span 3; display: grid; min-width: 0; }
  .cell.small { grid-column: span 2; }
  .cell.wide { grid-column: 1 / -1; }
  .cell.tall { grid-row: span 2; }
  @media (min-width: 760px) { .cell.wide { grid-column: span 6; } }
  .hint { text-align: center; margin: 16px 0 0; }
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
