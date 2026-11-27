<script lang="ts">
  import { db } from '../../lib/db/client';
  import { fmtNumber, fmtRelative, humanDuration, sinceLabel, t } from '../../lib/i18n/index.svelte';
  import { TALLY_MAX, tileSize } from '../../lib/domain/tile';
  import { unitLabel } from '../../lib/templates';
  import { toast, type TrackerView } from '../../lib/state.svelte';
  import { go } from '../../lib/router.svelte';
  import GoalBar from './GoalBar.svelte';
  import Tally from './Tally.svelte';

  let { view, now, onlog, lifted = false }: { view: TrackerView; now: number; onlog: (v: TrackerView) => void; lifted?: boolean } = $props();
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
  const tally = $derived(view.goal && view.goal.target > 0 && view.goal.target <= TALLY_MAX ? view.goal : null);
  const tallyLabel = $derived(
    tally ? t('detail.goal.progress', { current: tally.current, target: tally.target, when: t(`period.this.${tally.period}`) }) : '',
  );

  async function log(e: MouseEvent) {
    e.stopPropagation();
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

<article class="tracker {size}" class:lifted data-id={tr.id} style:--c={tr.color ?? 'var(--accent)'}>
  <button class="body" onclick={() => go(`t/${tr.id}`)} aria-label={tr.name}>
    <span class="head">
      <span class="icon" aria-hidden="true">{tr.icon ?? '•'}</span>
      <span class="name">{tr.name}</span>
    </span>
    {#if size === 'small'}
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
      <span class="sub">{t(`period.this.${tally.period}`)}{#if s.currentStreak > 1} · 🔥 {t('dash.streak', { n: s.currentStreak })}{/if}</span>
    {:else}
      <span class="big">{t('dash.today', { n: s.today })}</span>
      <span class="sub">
        {t('dash.week', { n: s.thisWeek })}{#if s.currentStreak > 1} · 🔥 {t('dash.streak', { n: s.currentStreak })}{/if}
      </span>
    {/if}
    {#if view.goal && !tally && size !== 'small'}
      <GoalBar goal={view.goal} compact />
    {/if}
  </button>
  <button class="log" onclick={log} aria-label="{t('dash.log')} {tr.name}">{t('dash.log')}</button>
</article>

<style>
  .tracker {
    --tint: color-mix(in srgb, var(--c) 16%, var(--surface));
    display: grid; grid-template-rows: 1fr auto; gap: 10px; padding: 14px; min-width: 0;
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
  .sub { color: var(--muted); font-size: 0.8rem; }
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
