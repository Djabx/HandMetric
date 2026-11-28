<script lang="ts">
  import { db } from '../../lib/db/client';
  import { clockDuration, fmtNumber, fmtRelative, fmtShortDate, fmtTime, humanDuration, sinceLabel, t, untilLabel } from '../../lib/i18n/index.svelte';
  import { startSpan, stopSpan } from '../../lib/spans';
  import { TALLY_MAX, tileSize } from '../../lib/domain/tile';
  import { unitLabel } from '../../lib/templates';
  import { toast, type TrackerView } from '../../lib/state.svelte';
  import { go } from '../../lib/router.svelte';
  import GoalBar from './GoalBar.svelte';
  import Tally from './Tally.svelte';

  import type { LifeEvent } from '../../lib/types';

  let {
    view,
    now,
    onlog,
    lifted = false,
  }: {
    view: TrackerView;
    now: number;
    /** Opens the entry dialog: a new event (done or planned), or one to complete. */
    onlog: (v: TrackerView, mode?: 'done' | 'plan' | 'stop', event?: LifeEvent) => void;
    lifted?: boolean;
  } = $props();
  const tr = $derived(view.tracker);
  const s = $derived(view.stats);
  const size = $derived(tileSize(tr, view.fields.length));
  const wide = $derived(size === 'wide');
  const abstinence = $derived(tr.display_mode === 'abstinence');
  /** Dernières saisies avec mesures, de la plus ancienne à la plus récente. */
  const measured = $derived(
    view.fields.length
      ? view.events.filter((e) => e.measures && Object.keys(e.measures).length).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).slice(-12)
      : [],
  );
  const last = $derived(measured.at(-1) ?? null);
  /** Next planned event, shown as a countdown under the tile's main figure. */
  const next = $derived(view.upcoming[0] ?? null);
  /** The tile looks ahead: a countdown to the next planned event. */
  const ahead = $derived(!!tr.show_next);
  const lastAt = $derived(view.stats.lastAt);
  /** Span tracker (sleep, fasting): Start, then Stop. */
  const sp = $derived(view.span);
  const running = $derived(view.running);
  /** « 12,5 / 8 » : une valeur par mesure ; l'unité seulement si elle est commune. */
  const lastValue = $derived.by(() => {
    if (!last) return '';
    const vals = view.fields.map((f) => last.measures![f.id]).filter((n) => n !== undefined).map((n) => fmtNumber(n, 1));
    const units = new Set(view.fields.map((f) => f.unit));
    const u = units.size === 1 ? [...units][0] : null;
    return vals.join(' / ') + (u ? ` ${unitLabel(u)}` : '');
  });
  /** Une courbe par mesure : échelle commune si même unité (tension), sinon chacune la sienne. */
  const lines = $derived.by(() => {
    if (measured.length < 2) return [];
    const shared = new Set(view.fields.map((f) => f.unit)).size === 1;
    const all = measured.flatMap((e) => Object.values(e.measures!));
    return view.fields.map((f, i) => {
      const pts = measured.map((e, x) => [x, e.measures![f.id]] as const).filter(([, y]) => y !== undefined);
      const ys = shared ? all : pts.map(([, y]) => y);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      const step = 100 / (measured.length - 1);
      const d = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${(x * step).toFixed(1)} ${(hi === lo ? 20 : 36 - ((y - lo) / (hi - lo)) * 32).toFixed(1)}`).join(' ');
      return { d, faded: i > 0 };
    });
  });
  /** Petits objectifs : on les montre en bâtons plutôt qu'en barre. */
  const tally = $derived(view.goal && view.goal.unit === 'count' && view.goal.target > 0 && view.goal.target <= TALLY_MAX ? view.goal : null);
  const tallyLabel = $derived(
    tally ? t('detail.goal.progress', { current: tally.current, target: tally.target, when: t(`period.this.${tally.period}`) }) : '',
  );

  /** Planned events whose time came, still missing their measures. */
  const todo = $derived(view.todo[0] ?? null);

  // ---------- the « ▾ » menu next to +1 ----------
  let menu = $state<HTMLDialogElement>();
  let menuAt = $state({ left: 0, top: 0 });
  function openMenu(e: MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 240;
    const left = Math.max(12, Math.min(r.right - width, innerWidth - width - 12));
    // Below the button, or above it when there is no room left under it.
    const below = r.bottom + 8;
    menuAt = { left, top: below + 210 > innerHeight ? Math.max(12, r.top - 8 - 210) : below };
    menu?.showModal();
  }
  function pick(mode: 'now' | 'done' | 'plan') {
    menu?.close();
    if (mode === 'now') void log();
    else onlog(view, mode);
  }

  async function log(e?: MouseEvent) {
    e?.stopPropagation();
    if (sp) {
      // Stopping a period with measures: the dialog asks for them.
      if (running && view.fields.length) onlog(view, 'stop', running);
      else if (running) await stopSpan(tr, running);
      else await startSpan(tr);
      return;
    }
    if (view.fields.length) {
      onlog(view);
      return;
    }
    const ev = await db.write('saveEvent', { tracker_id: tr.id });
    navigator.vibrate?.(20);
    toast(t('dash.logged', { name: tr.name }), {
      icon: tr.icon ?? undefined,
      action: { label: t('common.undo'), run: () => void db.write('deleteEvent', ev.id) },
    });
  }
</script>

<article class="tracker {size}" class:has-todo={!!todo} class:lifted data-id={tr.id} style:--c={tr.color ?? 'var(--accent)'}>
  <button class="body" onclick={() => go(`t/${tr.id}`)} aria-label={tr.name}>
    <span class="head">
      <span class="icon" aria-hidden="true">{tr.icon ?? '•'}</span>
      <span class="name">{tr.name}</span>
    </span>
    {#if sp}
      {#if running}
        {@const from = Date.parse(running.occurred_at)}
        <span class="live"><span class="dot" aria-hidden="true"></span>{size === 'small' ? clockDuration(now - from) : t('span.since', { time: fmtTime(from) })}</span>
        {#if size !== 'small'}<span class="big">{clockDuration(now - from)}</span>{/if}
      {:else if sp.last}
        {#if size === 'small'}
          <span class="sub">{clockDuration(sp.lastMs)}</span>
        {:else}
          <span class="big">{clockDuration(sp.lastMs)}</span>
          <span class="sub">{t('span.last', { when: fmtRelative(Date.parse(sp.last.ended_at!), now) })}{#if sp.avgMs !== null && s.count > 1}{' · '}{t('span.avg', { d: clockDuration(sp.avgMs) })}{/if}</span>
        {/if}
      {:else}
        <span class={size === 'small' ? 'sub' : 'big none'}>{t('span.never')}</span>
      {/if}
    {:else if ahead}
      {#if next}
        {@const at = Date.parse(next.occurred_at)}
        {#if size === 'small'}
          <span class="sub"><b>{untilLabel(at, now, 'bare')}</b></span>
        {:else}
          <span class="big">{untilLabel(at, now, size === 'wide' ? 'full' : 'short')}</span>
          <span class="sub">📅 {fmtShortDate(at, now)}{#if next.note}{' · '}{next.note}{/if}</span>
        {/if}
      {:else}
        <span class={size === 'small' ? 'sub' : 'big none'}>{t('up.none')}</span>
        {#if lastAt !== null && size !== 'small'}<span class="sub">{t('up.last', { when: fmtRelative(lastAt, now) })}</span>{/if}
      {/if}
    {:else if size === 'small'}
      <span class="sub">
        {#if abstinence}{humanDuration(s.currentGapFrom, now)}{:else if last}{lastValue}{:else}{t('dash.today', { n: s.today })}{/if}
      </span>
    {:else if abstinence}
      <span class="big">{humanDuration(s.currentGapFrom, now)}</span>
      <span class="sub">{sinceLabel(s.currentGapFrom, now, s.count === 0)}</span>
    {:else if last && size !== 'normal'}
      <span class="big">{lastValue}</span>
      <span class="sub">{fmtRelative(Date.parse(last.occurred_at), now)}</span>
      {#if lines.length}
        <svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          {#each lines as l, i (i)}<path d={l.d} style:stroke-opacity={l.faded ? 0.45 : 1} />{/each}
        </svg>
      {/if}
    {:else if tally}
      <Tally current={tally.current} target={tally.target} color="var(--c)" overColor="var(--bad)" label={tallyLabel} />
      <span class="big">{tally.current} / {tally.target}</span>
      <span class="sub">{t(`period.this.${tally.period}`)}{#if s.currentStreak > 1}{' · '}🔥 {t('dash.streak', { n: s.currentStreak })}{/if}</span>
    {:else}
      <span class="big">{t('dash.today', { n: s.today })}</span>
      <span class="sub">
        {t('dash.week', { n: s.thisWeek })}{#if s.currentStreak > 1}{' · '}🔥 {t('dash.streak', { n: s.currentStreak })}{/if}
      </span>
    {/if}
    {#if view.goal && !tally && size !== 'small'}
      <GoalBar goal={view.goal} compact />
    {/if}
    {#if next && !todo && !ahead}
      {@const at = Date.parse(next.occurred_at)}
      <span class="next" title={next.note ?? undefined}>
        <span aria-hidden="true">📅</span>
        <span class="until">{untilLabel(at, now, size === 'small' ? 'bare' : 'short')}</span>{#if size !== 'small'}<span class="when"> · {next.note || fmtShortDate(at, now)}</span>{/if}
      </span>
    {/if}
  </button>
  {#if todo}
    <button class="todo" onclick={() => onlog(view, 'done', todo)} aria-label="{t('todo.chip')} · {tr.name}">
      <span aria-hidden="true">✍️</span>
      {#if size !== 'small'}<span class="until">{t('todo.chip')}</span>{/if}{#if size !== 'small'}<span class="when"> · {fmtRelative(Date.parse(todo.occurred_at), now)}</span>{/if}
    </button>
  {/if}
  <span class="split">
    {#if sp}
      <button class="log" onclick={log} aria-label="{running ? t('span.stop') : t('span.start')} · {tr.name}">{running ? '⏹' : '▶'}{#if size !== 'small'}{' '}{running ? t('span.stop') : t('span.start')}{/if}</button>
    {:else}
      <button class="log" onclick={log} aria-label="{t('dash.log')} {tr.name}">{t('dash.log')}</button>
    {/if}
    <button class="log more" onclick={openMenu} aria-label={t('menu.more', { name: tr.name })} aria-haspopup="menu">▾</button>
  </span>
</article>

<dialog bind:this={menu} class="menu" style:left="{menuAt.left}px" style:top="{menuAt.top}px" onclick={(e) => { if (e.target === menu) menu?.close(); }}>
  <div role="menu" aria-label={tr.name}>
    <button role="menuitem" onclick={() => pick('now')}><span aria-hidden="true">{sp ? (running ? '⏹' : '▶') : '⚡'}</span><span>{sp ? (running ? t('span.stop') : t('span.start')) : t('menu.now')}<small>{sp ? t('menu.now') : t('menu.nowHelp')}</small></span></button>
    <button role="menuitem" onclick={() => pick('done')}><span aria-hidden="true">🕘</span><span>{t('menu.earlier')}<small>{t('menu.earlierHelp')}</small></span></button>
    <button role="menuitem" onclick={() => pick('plan')}><span aria-hidden="true">📅</span><span>{t('menu.plan')}<small>{t('menu.planHelp')}</small></span></button>
  </div>
</dialog>

<style>
  .tracker {
    --tint: color-mix(in srgb, var(--c) 16%, var(--surface));
    display: grid; grid-template-rows: 1fr; grid-auto-rows: auto; gap: 10px; padding: 14px; min-width: 0;
    border-radius: var(--radius); background: var(--tint);
    transition: transform 0.15s;
  }
  /* Long press: a floating copy of the tile lifts and follows the finger (see Dashboard). */
  .tracker { -webkit-touch-callout: none; user-select: none; }
  .tracker.lifted {
    transform: scale(1.05) rotate(-1.5deg);
    box-shadow: 0 4px 10px rgb(20 10 60 / 0.12), 0 20px 44px color-mix(in srgb, var(--c) 45%, transparent);
  }
  /* La place dans la grille (colonnes, lignes) est donnée par Dashboard. */
  .tracker.small { padding: 12px; gap: 8px; }
  .tracker.wide { grid-template-rows: none; grid-template-columns: 1fr auto; align-items: center; }
  .wide .body { grid-column: 1; grid-row: 1; }
  .small .head { flex-direction: column; align-items: flex-start; gap: 4px; }
  .small .name { font-size: 0.9rem; max-width: 100%; }
  .small .log { min-height: 34px; min-width: 52px; padding: 0 12px; font-size: 0.9rem; }
  .tall .body { display: flex; flex-direction: column; gap: 8px; }
  .tall .body .big { margin-top: auto; }
  .tall :global(.tally) { height: 34px; }
  .spark { width: 100%; height: 40px; fill: none; stroke: var(--c); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .spark path { vector-effect: non-scaling-stroke; }
  .body {
    min-width: 0; text-align: left; border: 0; background: none; cursor: pointer; padding: 0;
    display: grid; gap: 6px; align-content: start; color: inherit;
  }
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .icon {
    flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
    background: var(--surface); font-size: 1.15rem;
  }
  .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .big { font-family: var(--font-display); font-size: 1.45rem; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; }
  .wide .big { font-size: 2rem; }
  .live { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 700; color: color-mix(in srgb, var(--c) 70%, var(--text)); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 25%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
  .big.none { font-size: 1.15rem; color: var(--muted); }
  .sub { color: var(--muted); font-size: 0.8rem; }
  .next {
    display: flex; align-items: center; gap: 6px; min-width: 0; justify-self: start; max-width: 100%;
    padding: 3px 10px 3px 8px; border-radius: 999px; font-size: 0.8rem; white-space: nowrap;
    background: color-mix(in srgb, var(--c) 14%, var(--surface)); border: 1px dashed color-mix(in srgb, var(--c) 55%, transparent);
  }
  .small .next { padding: 2px 8px 2px 6px; gap: 4px; }
  .next .until { flex: none; font-weight: 700; }
  .next .when { min-width: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
  .split { display: inline-flex; justify-self: start; align-self: end; }
  .wide .split { grid-row: 1; grid-column: 2; align-self: center; }
  .wide.has-todo .split { grid-row: 1 / span 2; }
  .split .log:first-child { border-radius: 999px 0 0 999px; padding-right: 12px; }
  .split .log.more { min-width: 0; padding: 0 12px 0 9px; border-radius: 0 999px 999px 0; border-left: 1px solid rgb(255 255 255 / 0.35); font-size: 0.85rem; }
  .small .split .log.more { min-width: 0; padding: 0 9px 0 7px; }
  .todo {
    display: flex; align-items: center; gap: 6px; min-width: 0; justify-self: start; max-width: 100%; cursor: pointer; color: inherit; font: inherit;
    padding: 3px 10px 3px 8px; border-radius: 999px; font-size: 0.8rem; white-space: nowrap;
    background: #fff4d6; border: 1px solid #f2c24b; color: #5c3d00;
  }
  .wide .todo { grid-column: 1; grid-row: 2; }
  .todo .until { flex: none; font-weight: 700; }
  .todo .when { min-width: 0; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; }
  .menu {
    position: fixed; margin: 0; width: 240px; padding: 6px; border: 0; border-radius: 18px;
    background: var(--surface); color: var(--text); box-shadow: 0 12px 40px rgb(20 10 60 / 0.25);
  }
  .menu::backdrop { background: rgb(20 10 60 / 0.25); }
  .menu button {
    display: flex; gap: 12px; align-items: center; width: 100%; padding: 11px 12px; border: 0; border-radius: 12px;
    background: none; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible { background: var(--surface-2); }
  .menu small { display: block; font-weight: 400; color: var(--muted); font-size: 0.78rem; }
  .log {
    justify-self: start; border: 0; cursor: pointer; border-radius: 999px;
    min-height: 40px; min-width: 64px; padding: 0 16px;
    background: var(--c); color: #fff; color: lch(from var(--c) calc((68 - l) * 100) 0 0); font-family: var(--font-display); font-size: 1rem; font-weight: 800;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--c) 35%, transparent);
  }
  .wide .log { min-height: 52px; min-width: 72px; font-size: 1.15rem; }
  .log:hover { filter: brightness(1.08); }
  .log:active { transform: scale(0.94); }
</style>
