<script lang="ts">
  import { app, clock, viewOf } from '../../lib/state.svelte';
  import { fmtDate, fmtDateTime, fmtNumber, humanDuration, locale, sinceLabel, t } from '../../lib/i18n/index.svelte';
  import { back, go } from '../../lib/router.svelte';
  import { evDay, fieldSummaries, heatmap, periodSeries } from '../../lib/domain/stats';
  import { periodKey } from '../../lib/domain/time';
  import { localOffset } from '../../lib/db/store';
  import { unitLabel } from '../../lib/templates';
  import { db } from '../../lib/db/client';
  import { toast } from '../../lib/state.svelte';
  import type { ChartPeriod, LifeEvent } from '../../lib/types';
  import GoalBar from '../components/GoalBar.svelte';
  import Heatmap from '../components/Heatmap.svelte';
  import BarChart from '../components/BarChart.svelte';
  import Achievements from '../components/Achievements.svelte';
  import EventDialog from '../components/EventDialog.svelte';

  let { id }: { id: string } = $props();

  const tracker = $derived(app.trackers.find((x) => x.id === id) ?? app.archived.find((x) => x.id === id));
  const view = $derived(tracker ? viewOf(tracker, clock.now) : null);
  const color = $derived(tracker?.color ?? 'var(--accent)');

  let chartPeriod = $state<ChartPeriod>('week');
  /** Nombre de fenêtres remontées dans le passé (0 = jusqu'à la période en cours). */
  let chartOffset = $state(0);
  $effect.pre(() => {
    if (tracker?.goal_period) chartPeriod = tracker.goal_period;
  });
  const WINDOW: Record<ChartPeriod, number> = { day: 14, week: 12, month: 12, year: 10 };
  const series = $derived(view ? periodSeries(view.events, chartPeriod, WINDOW[chartPeriod], clock.now, localOffset(), chartOffset) : []);
  const seriesTotal = $derived(series.reduce((n, d) => n + d.count, 0));
  /** Il reste des événements avant la fenêtre affichée. */
  const hasOlder = $derived(!!view && !!series.length && view.events.some((e) => periodKey(evDay(e), chartPeriod) < series[0].key));
  function setPeriod(p: ChartPeriod) {
    chartPeriod = p;
    chartOffset = 0;
  }
  /** « 3 – 16 nov. 2026 », « déc. 2025 – nov. 2026 », « 2017 – 2026 ». */
  function rangeLabel(): string {
    if (!series.length) return '';
    const first = series[0].key;
    const last = series[series.length - 1].key;
    if (chartPeriod === 'year') return `${first} – ${last}`;
    const fmt = (k: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), o).format(new Date((k.length === 7 ? k + '-15' : k) + 'T12:00:00Z'));
    if (chartPeriod === 'month') return `${fmt(first, { month: 'short', year: 'numeric' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`;
    // Semaine : du lundi de la première au dimanche de la dernière.
    const end = chartPeriod === 'week' ? new Date(Date.parse(last + 'T12:00:00Z') + 6 * 86_400_000).toISOString().slice(0, 10) : last;
    return `${fmt(first, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  const cells = $derived(view ? heatmap(view.stats.perDay, clock.now, localOffset()) : []);
  const measures = $derived(view ? fieldSummaries(view.fields, view.events) : []);
  const history = $derived(view ? [...view.events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) : []);
  let shown = $state(30);
  let allAch = $state(false);
  /** Succès obtenus + les 3 prochains de chaque famille. */
  const visibleAch = $derived.by(() => {
    if (!view) return [];
    const next = new Map<string, number>();
    return view.achievements.filter((a) => {
      if (a.unlocked) return true;
      const n = next.get(a.kind) ?? 0;
      next.set(a.kind, n + 1);
      return n < 1;
    });
  });
  let editing = $state<LifeEvent | null | undefined>(undefined);

  function periodLabel(key: string): string {
    if (chartPeriod === 'year') return key;
    if (chartPeriod === 'month') return new Intl.DateTimeFormat(locale(), { month: 'short' }).format(new Date(key + '-15T12:00:00Z'));
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'numeric' }).format(new Date(key + 'T12:00:00Z'));
  }

  async function quickLog() {
    if (!tracker) return;
    if (view?.fields.length) {
      editing = null;
      return;
    }
    const ev = await db.write('saveEvent', { tracker_id: tracker.id });
    toast(t('dash.logged', { name: tracker.name }), {
      icon: tracker.icon ?? undefined,
      action: { label: t('common.undo'), run: () => void db.write('deleteEvent', ev.id) },
    });
  }

  function measureText(e: LifeEvent): string {
    if (!view || !e.measures) return '';
    return view.fields
      .filter((f) => e.measures?.[f.id] !== undefined)
      .map((f) => `${f.name} ${fmtNumber(e.measures![f.id])}${f.unit ? ' ' + unitLabel(f.unit) : ''}`)
      .join(' · ');
  }
</script>

{#if !tracker || !view}
  <div class="page">
    <header class="topbar"><button class="icon-btn" onclick={back} aria-label={t('common.back')}>←</button></header>
    <p class="muted">{app.ready ? '404' : t('common.loading')}</p>
  </div>
{:else}
  <div class="page" style:--c={color}>
    <header class="topbar">
      <button class="icon-btn" onclick={back} aria-label={t('common.back')}>←</button>
      <h1>{tracker.icon ?? ''} {tracker.name}</h1>
      <button class="icon-btn" onclick={() => go(`t/${tracker.id}/edit`)} aria-label={t('common.edit')} title={t('common.edit')}>✏️</button>
    </header>

    <section class="hero card">
      {#if tracker.display_mode === 'abstinence'}
        <div class="big">{humanDuration(view.stats.currentGapFrom, clock.now)}</div>
        <div class="muted">{sinceLabel(view.stats.currentGapFrom, clock.now, view.stats.count === 0)}</div>
      {:else}
        <div class="big">{t('dash.today', { n: view.stats.today })}</div>
        <div class="muted">{t('dash.week', { n: view.stats.thisWeek })}</div>
      {/if}
      <button class="btn primary log" onclick={quickLog}>{t('dash.log')}</button>
    </section>

    <section class="section">
      <div class="stats-grid">
        {#if tracker.display_mode === 'abstinence' && view.stats.longestGap}
          <div class="stat">
            <div class="label">{t('detail.record')}</div>
            <div class="value">{humanDuration(view.stats.longestGap.from, view.stats.longestGap.to)}</div>
          </div>
        {/if}
        <div class="stat"><div class="label">{t('detail.total')}</div><div class="value">{view.stats.count}</div></div>
        <div class="stat"><div class="label">{t('detail.thisWeek')}</div><div class="value">{view.stats.thisWeek}</div></div>
        <div class="stat"><div class="label">{t('detail.thisMonth')}</div><div class="value">{view.stats.thisMonth}</div></div>
        <div class="stat"><div class="label">{t('detail.thisYear')}</div><div class="value">{view.stats.thisYear}</div></div>
        <div class="stat"><div class="label">{t('detail.streak')}</div><div class="value">{t('detail.days', { n: view.stats.currentStreak })}</div></div>
        <div class="stat"><div class="label">{t('detail.bestStreak')}</div><div class="value">{t('detail.days', { n: view.stats.longestStreak })}</div></div>
      </div>
    </section>

    {#if view.goal}
      <section class="section">
        <h2>{t('detail.goal')}</h2>
        <div class="card">
          <strong>{t(view.goal.kind === 'max' ? 'detail.goal.max' : 'detail.goal.min', { n: view.goal.target, period: t(`period.${view.goal.period}`) })}</strong>
          <GoalBar goal={view.goal} />
          <p class="small muted" style="margin:8px 0 0">{t('detail.goal.streak', { n: view.goal.streak, best: view.goal.bestStreak })}</p>
        </div>
      </section>
    {/if}

    {#if measures.length}
      <section class="section">
        <h2>{t('detail.measures')}</h2>
        <div class="stats-grid">
          {#each measures as m (m.field.id)}
            <div class="stat">
              <div class="label">{m.field.name}{m.field.unit ? ` (${unitLabel(m.field.unit)})` : ''}</div>
              <div class="value">{m.last !== null ? fmtNumber(m.last) : '–'}</div>
              {#if m.count}
                <div class="small muted">
                  {t('detail.measure.avg')} {fmtNumber(m.average ?? 0)} · {t('detail.measure.total')} {fmtNumber(m.total)}<br />
                  {t('detail.measure.minmax')} {fmtNumber(m.min ?? 0)} / {fmtNumber(m.max ?? 0)}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="section">
      <div class="row" style="justify-content:space-between">
        <h2 class="h2" style="margin:0">{t('detail.chart', { period: t(`period.${chartPeriod}`) })}</h2>
        <div class="segmented">
          {#each ['day', 'week', 'month', 'year'] as const as p (p)}
            <button aria-pressed={chartPeriod === p} onclick={() => setPeriod(p)}>{t(`period.${p}`)}</button>
          {/each}
        </div>
      </div>
      <div class="card" style="margin-top:8px">
        <div class="row chart-nav">
          <button class="icon-btn" disabled={!hasOlder} onclick={() => chartOffset++} aria-label={t('detail.chart.older')} title={t('detail.chart.older')}>‹</button>
          <div class="grow range">
            <div>{rangeLabel()}</div>
            <div class="small muted">{t('detail.chart.total', { n: seriesTotal })}</div>
            {#if chartOffset > 0}
              <button class="linkish small" onclick={() => (chartOffset = 0)}>{t('detail.chart.latest')}</button>
            {/if}
          </div>
          <button class="icon-btn" disabled={chartOffset === 0} onclick={() => chartOffset--} aria-label={t('detail.chart.newer')} title={t('detail.chart.newer')}>›</button>
        </div>
        <BarChart data={series} {color} target={view.goal?.period === chartPeriod ? view.goal.target : null} labelOf={periodLabel} />
      </div>
    </section>

    <section class="section">
      <h2>{t('detail.calendar')}</h2>
      <div class="card"><Heatmap {cells} {color} /></div>
    </section>

    <section class="section">
      <h2>{t('detail.achievements')}</h2>
      <Achievements list={allAch ? view.achievements : visibleAch} />
      {#if !allAch && visibleAch.length < view.achievements.length}
        <button class="btn small" style="margin-top:8px" onclick={() => (allAch = true)}>{t('detail.more')}</button>
      {/if}
    </section>

    <section class="section">
      <h2>{t('detail.history')}</h2>
      {#if history.length === 0}
        <p class="muted">{t('detail.noEvents')}</p>
      {:else}
        <ul class="list card" style="padding:0 16px">
          {#each history.slice(0, shown) as e (e.id)}
            <li>
              <button class="ev" onclick={() => (editing = e)}>
                <span>{fmtDateTime(e.occurred_at)}</span>
                {#if measureText(e)}<span class="small">{measureText(e)}</span>{/if}
                {#if e.note}<span class="small muted">{e.note}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if history.length > shown}
          <button class="btn" style="margin-top:8px" onclick={() => (shown += 50)}>{t('detail.more')}</button>
        {/if}
      {/if}
    </section>
    <p class="small muted">{fmtDate(tracker.created_at)}</p>
  </div>

  {#if editing !== undefined}
    <EventDialog {tracker} fields={view.fields} event={editing} onclose={() => (editing = undefined)} />
  {/if}
{/if}

<style>
  .h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .hero { display: grid; gap: 4px; border-left: 6px solid var(--c); }
  .big { font-size: 2rem; font-weight: 800; line-height: 1.15; }
  .chart-nav { margin-bottom: 8px; flex-wrap: nowrap; }
  .chart-nav .range { text-align: center; font-weight: 600; }
  .chart-nav .linkish { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
  .chart-nav .icon-btn:disabled { opacity: 0.3; cursor: default; }
  .log { justify-self: start; margin-top: 8px; min-width: 120px; font-size: 1.1rem; }
  .ev { display: grid; gap: 2px; width: 100%; text-align: left; padding: 10px 0; border: 0; background: none; cursor: pointer; }
</style>
