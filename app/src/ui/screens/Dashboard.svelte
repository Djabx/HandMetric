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
  import { cubicOut } from 'svelte/easing';
  import { tileSize } from '../../lib/domain/tile';
  import { moveTo, slotAt, type Slot } from '../../lib/domain/reorder';
  import { haptic, prefersReducedMotion } from '../../lib/haptics';
  import type { LifeEvent } from '../../lib/types';

  let lifted = $state<string | null>(null);
  let liveOrder = $state<string[]>([]);
  /** Ordre gardé à l'écran le temps que l'enregistrement revienne (pas de saut). */
  let settling = $state(false);
  const allViews = $derived(app.trackers.map((tr) => viewOf(tr, clock.now)));
  /** Pendant un glisser-déposer, les tuiles suivent l'ordre en cours. */
  const views = $derived(
    lifted || settling ? liveOrder.map((id) => allViews.find((v) => v.tracker.id === id)).filter((v) => v !== undefined) : allViews,
  );
  let logging = $state<{ view: TrackerView; mode?: 'done' | 'plan' | 'stop'; event?: LifeEvent } | null>(null);

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

  // ---------- home grid drag and drop: long press, then drag ----------
  const HOLD_MS = 400;
  /** Movement allowed during the long press: beyond it, the finger is scrolling. */
  const SLOP = 10;
  /** Distance from the top/bottom of the screen where the page scrolls by itself. */
  const EDGE = 72;
  const reduceMotion = prefersReducedMotion();
  const FLIP_MS = reduceMotion ? 0 : 220;
  const DROP_MS = reduceMotion ? 0 : 200;

  let grid = $state<HTMLElement>();
  let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout>; pointer: number } | null = null;
  /** The tile being held, before the long press completes (it sinks a little). */
  let pressing = $state<string | null>(null);
  /** Floating copy of the lifted tile that follows the pointer (fixed position, in px). */
  let ghost = $state<{ x: number; y: number; w: number; h: number; dropping: boolean } | null>(null);
  /** Where the pointer grabbed the tile, from the tile's top-left corner. */
  let grabOffset = { x: 0, y: 0 };
  let pointer = { x: 0, y: 0 };
  /** Last tile we swapped with: no swap back until the pointer leaves it (no flicker between tiles of different sizes). */
  let lastSwap: string | null = null;
  let scrollFrame = 0;
  /** Keeps the release after a move from opening the tracker. */
  let swallowClick = false;
  const liftedView = $derived(lifted ? allViews.find((v) => v.tracker.id === lifted) : undefined);

  function cellOf(id: string): HTMLElement | undefined {
    return grid?.querySelector<HTMLElement>(`.cell[data-cell="${CSS.escape(id)}"]`) ?? undefined;
  }

  /** Layout boxes of the cells, ignoring the running FLIP transforms, in viewport px. */
  function slots(): Slot[] {
    if (!grid) return [];
    const box = grid.getBoundingClientRect();
    return [...grid.querySelectorAll<HTMLElement>('.cell[data-cell]')].map((el) => ({
      id: el.dataset.cell!,
      left: box.left + el.offsetLeft,
      top: box.top + el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
  }

  function tileDown(e: PointerEvent) {
    if (e.button !== 0 || lifted) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell;
    if (!id) return;
    const pointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
    pressing = id;
    press = { id, x: e.clientX, y: e.clientY, pointer: pointerId, timer: setTimeout(() => lift(pointerId), HOLD_MS) };
  }

  function lift(pointerId: number) {
    if (!press) return;
    const id = press.id;
    const cell = cellOf(id);
    press = null;
    pressing = null;
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    grabOffset = { x: pointer.x - r.left, y: pointer.y - r.top };
    ghost = { x: r.left, y: r.top, w: r.width, h: r.height, dropping: false };
    liveOrder = app.trackers.map((tr) => tr.id);
    lastSwap = null;
    lifted = id;
    haptic(15);
    try { grid?.setPointerCapture(pointerId); } catch { /* the finger is already gone */ }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function tileMove(e: PointerEvent) {
    pointer = { x: e.clientX, y: e.clientY };
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
    if (!lifted || !ghost || ghost.dropping) return;
    ghost.x = e.clientX - grabOffset.x;
    ghost.y = e.clientY - grabOffset.y;
    retarget();
  }

  /** Moves the placeholder to the tile under the pointer. */
  function retarget() {
    if (!lifted) return;
    const over = slotAt(slots(), pointer.x, pointer.y);
    if (over !== lastSwap) lastSwap = null;
    if (!over || over === lifted || over === lastSwap) return;
    const next = moveTo(liveOrder, lifted, over);
    if (next === liveOrder) return;
    liveOrder = next;
    lastSwap = over;
    haptic(5);
  }

  /** Scrolls the page while the tile is held near the top or bottom edge. */
  function autoScroll() {
    if (!lifted || ghost?.dropping) return;
    const h = window.innerHeight;
    const dy = pointer.y < EDGE ? -(EDGE - pointer.y) : pointer.y > h - EDGE ? pointer.y - (h - EDGE) : 0;
    if (dy) {
      window.scrollBy(0, Math.round(dy / 4));
      retarget();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
    pressing = null;
  }

  async function tileUp() {
    cancelPress();
    if (!lifted || !ghost || ghost.dropping) return;
    cancelAnimationFrame(scrollFrame);
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 400);
    const ids = $state.snapshot(liveOrder);
    // The floating tile glides into its new place, then the real one shows again.
    const slot = slots().find((s) => s.id === lifted);
    if (slot) Object.assign(ghost, { x: slot.left, y: slot.top, dropping: true });
    if (DROP_MS) await new Promise((r) => setTimeout(r, DROP_MS));
    settling = true;
    lifted = null;
    ghost = null;
    haptic(10);
    try {
      if (ids.some((id, i) => id !== app.trackers[i]?.id)) await db.write('reorderTrackers', ids);
    } finally {
      settling = false;
    }
  }

  // While a tile is lifted, the finger no longer scrolls the page.
  $effect(() => {
    const el = grid;
    if (!el) return;
    const block = (e: TouchEvent) => { if (lifted) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  });

  $effect(() => () => { cancelPress(); cancelAnimationFrame(scrollFrame); });

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
    <p class="banner warn">
      {memoryWarning(app.storageProblem, sync.mode === 'server' && !!sync.user)}
      {#if app.storageProblem?.issue === 'locked'}<button class="btn small retry" onclick={() => location.reload()}>{t('storage.retry')}</button>{/if}
    </p>
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
        <div
          class="cell {tileSize(v.tracker, v.fields.length)}"
          class:placeholder={lifted === v.tracker.id}
          class:pressing={pressing === v.tracker.id}
          data-cell={v.tracker.id}
          style:--c={v.tracker.color ?? 'var(--accent)'}
          animate:flip={{ duration: FLIP_MS, easing: cubicOut }}
        >
          <TrackerCard view={v} now={clock.now} onlog={(view, mode, event) => (logging = { view, mode, event })} />
        </div>
      {/each}
    </div>
    {#if ghost && liftedView}
      <div
        class="ghost"
        class:dropping={ghost.dropping}
        style:width="{ghost.w}px"
        style:height="{ghost.h}px"
        style:transform="translate3d({ghost.x}px, {ghost.y}px, 0)"
        style:--drop-ms="{DROP_MS}ms"
        aria-hidden="true"
      >
        <TrackerCard view={liftedView} now={clock.now} onlog={() => {}} lifted />
      </div>
    {/if}
    {#if views.length > 1}<p class="small muted hint">{t('dash.dragHint')}</p>{/if}
  {/if}
</div>

{#if !reordering}
{#if views.length}<button class="fab btn primary" onclick={() => go('new')}>＋ {t('dash.new')}</button>{/if}
{/if}

{#if logging}
  <EventDialog tracker={logging.view.tracker} fields={logging.view.fields} mode={logging.mode} event={logging.event ?? null} typical={logging.view.span?.avgMs ?? undefined}
    usualStart={logging.view.span?.avgStart ?? null} onclose={() => (logging = null)} />
{/if}

<style>
  /* 6 colonnes : petite tuile = 2, normale ou haute = 3, large = toute la ligne. 12 sur grand écran. */
  /* position: relative makes the grid the offsetParent of its cells (see slots()). */
  .grid { position: relative; display: grid; gap: 12px; grid-template-columns: repeat(6, minmax(0, 1fr)); grid-auto-flow: row dense; }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(12, minmax(0, 1fr)); } }
  .grid.dragging { touch-action: none; }
  /* Tailles des tuiles : 6 colonnes (12 sur grand écran). */
  .cell { grid-column: span 3; display: grid; min-width: 0; }
  .cell.small { grid-column: span 2; }
  .cell.wide { grid-column: 1 / -1; }
  .cell.tall { grid-row: span 2; }
  @media (min-width: 760px) { .cell.wide { grid-column: span 6; } }
  /* Long press in progress: the tile sinks a little, then lifts. */
  .cell > :global(.tracker) { transition: transform 0.15s, opacity 0.15s; }
  .cell.pressing > :global(.tracker) { transform: scale(0.96); transition: transform 0.4s ease-out; }
  /* The empty slot where the lifted tile will land. */
  .cell.placeholder { position: relative; }
  .cell.placeholder > :global(.tracker) { opacity: 0; }
  .cell.placeholder::after {
    content: ''; position: absolute; inset: 0; border-radius: var(--radius);
    border: 2px dashed color-mix(in srgb, var(--c) 55%, transparent);
    background: color-mix(in srgb, var(--c) 10%, transparent);
  }
  /* The lifted tile, floating above the page under the finger. */
  .ghost { position: fixed; left: 0; top: 0; z-index: 50; display: grid; pointer-events: none; will-change: transform; }
  .ghost.dropping { transition: transform var(--drop-ms) cubic-bezier(0.2, 0.8, 0.2, 1); }
  .ghost > :global(.tracker) { animation: lift 0.18s ease-out both; }
  .ghost.dropping > :global(.tracker) { animation: none; transform: none; box-shadow: none; transition: transform var(--drop-ms), box-shadow var(--drop-ms); }
  @keyframes lift { from { transform: none; box-shadow: none; } }
  @media (prefers-reduced-motion: reduce) {
    .cell.pressing > :global(.tracker) { transform: none; }
    .ghost > :global(.tracker) { animation: none; }
  }
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
