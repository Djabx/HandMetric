<script lang="ts">
  import { app, clock, viewOf } from '../../lib/state.svelte';
  import { fmtDate, fmtDateTime, fmtNumber, humanDuration, locale, sinceLabel, t, untilLabel } from '../../lib/i18n/index.svelte';
  import { back, go } from '../../lib/router.svelte';
  import { evDay, eventsInRange, fieldSummaries, heatmap, measureSeries, periodSeries } from '../../lib/domain/stats';
  import { periodKey } from '../../lib/domain/time';
  import { localOffset } from '../../lib/db/store';
  import { PALETTE, unitLabel } from '../../lib/templates';
  import LineChart from '../components/LineChart.svelte';
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

  /** Ce que montre le graphique : le nombre d'événements, une mesure, ou toutes les mesures. */
  let chartShow = $state<'count' | 'all' | string>('count');
  const shownFields = $derived(
    !view ? [] : chartShow === 'all' ? view.fields : view.fields.filter((f) => f.id === chartShow),
  );
  /** Couleurs des courbes : celle du compteur d'abord, puis la palette. */
  const lineColors = $derived([tracker?.color ?? PALETTE[0], ...PALETTE.filter((c) => c !== tracker?.color)]);
  const lineSeries = $derived(
    shownFields.map((f, i) => ({
      name: f.name + (f.unit ? ` (${unitLabel(f.unit)})` : ''),
      color: lineColors[i % lineColors.length],
      points: measureSeries(view?.events ?? [], f.id, chartPeriod, series.map((d) => d.key)),
    })),
  );
  /** Moyenne, min, max et total de chaque mesure sur la plage affichée. */
  const rangeSummaries = $derived(
    view && series.length
      ? fieldSummaries(view.fields, eventsInRange(view.events, chartPeriod, series[0].key, series[series.length - 1].key))
      : [],
  );
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
  const history = $derived(view ? [...view.events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) : []);
  let shown = $state(10);
  /** Journal first: what is coming and what just happened, then the statistics. */
  let tab = $state<'journal' | 'stats' | 'achievements'>('journal');
  /** The entry dialog opens on « planned » (the hero's Plan button). */
  let planning = $state(false);
  const todoIds = $derived(new Set(view?.todo.map((e) => e.id) ?? []));
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

  function plan() {
    planning = true;
    editing = null;
  }

  async function quickLog() {
    if (!tracker) return;
    if (view?.fields.length) {
      planning = false;
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

    <section class="hero">
      {#if tracker.display_mode === 'abstinence'}
        <div class="big">{humanDuration(view.stats.currentGapFrom, clock.now)}</div>
        <div class="muted">{sinceLabel(view.stats.currentGapFrom, clock.now, view.stats.count === 0)}</div>
      {:else}
        <div class="big">{t('dash.today', { n: view.stats.today })}</div>
        <div class="muted">{t('dash.week', { n: view.stats.thisWeek })}</div>
      {/if}
      <div class="hero-actions">
        <button class="btn primary log" onclick={quickLog}>{t('dash.log')}</button>
        <button class="btn plan" onclick={plan}>📅 {t('up.plan')}</button>
      </div>
    </section>

    <div class="segmented tabs">
      <button aria-pressed={tab === 'journal'} onclick={() => (tab = 'journal')}>{t('tab.journal')}</button>
      <button aria-pressed={tab === 'stats'} onclick={() => (tab = 'stats')}>{t('tab.stats')}</button>
      {#if view.achievements.length}
        <button aria-pressed={tab === 'achievements'} onclick={() => (tab = 'achievements')}>{t('tab.achievements')}</button>
      {/if}
    </div>

    {#if tab === 'journal'}

    {#if view.upcoming.length}
    <section class="section">
      <h2>{t('up.title')}</h2>
      <ul class="list card upcoming" style="padding:0 16px">
        {#each view.upcoming as e (e.id)}
          <li>
            <button class="ev" onclick={() => (editing = e)}>
              <span class="until">📅 {untilLabel(Date.parse(e.occurred_at), clock.now)} <span class="badge">{t('up.badge')}</span></span>
              <span class="small">{fmtDateTime(e.occurred_at)}</span>
              {#if measureText(e)}<span class="small">{measureText(e)}</span>{/if}
              {#if e.note}<span class="small muted">{e.note}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
    {/if}

    <section class="section">
      <h2>{t('detail.recent')}</h2>
      {#if history.length === 0}
        <p class="muted">{t('detail.noEvents')}</p>
      {:else}
        <ul class="list card" style="padding:0 16px">
          {#each history.slice(0, shown) as e (e.id)}
            <li>
              <button class="ev" onclick={() => (editing = e)}>
                <span>{fmtDateTime(e.occurred_at)}{#if todoIds.has(e.id)} <span class="badge todo">✍️ {t('todo.badge')}</span>{/if}</span>
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
    {:else if tab === 'stats'}

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

    <section class="section">
      <div class="row" style="justify-content:space-between">
        <h2 class="h2" style="margin:0">{t('detail.chart', { period: t(`period.${chartPeriod}`) })}</h2>
        <div class="segmented">
          {#each ['day', 'week', 'month', 'year'] as const as p (p)}
            <button aria-pressed={chartPeriod === p} onclick={() => setPeriod(p)}>{t(`period.${p}`)}</button>
          {/each}
        </div>
      </div>
      {#if view.fields.length}
        <div class="segmented show" role="group" aria-label={t('detail.chart.show')}>
          <button aria-pressed={chartShow === 'count'} onclick={() => (chartShow = 'count')}>{t('detail.chart.count')}</button>
          {#each view.fields as f (f.id)}
            <button aria-pressed={chartShow === f.id} onclick={() => (chartShow = f.id)}>{f.name}</button>
          {/each}
          {#if view.fields.length > 1}
            <button aria-pressed={chartShow === 'all'} onclick={() => (chartShow = 'all')}>{t('detail.chart.allMeasures')}</button>
          {/if}
        </div>
      {/if}
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
        {#if chartShow === 'count' || !lineSeries.length}
          <BarChart data={series} {color} target={view.goal?.period === chartPeriod ? view.goal.target : null} labelOf={periodLabel} />
        {:else}
          <LineChart series={lineSeries} labelOf={periodLabel} fmt={(n) => fmtNumber(n, 1)} />
          <p class="small muted" style="margin:4px 0 0;text-align:center">{t('detail.chart.avgHint', { period: t(`period.${chartPeriod}`) })}</p>
        {/if}
        {#if rangeSummaries.some((m) => m.count)}
          <table class="measures">
            <thead>
              <tr>
                <th scope="col">{t('detail.measures.range')}</th>
                <th scope="col">{t('detail.measure.avg')}</th>
                <th scope="col">{t('detail.measure.minmax')}</th>
                <th scope="col">{t('detail.measure.total')}</th>
              </tr>
            </thead>
            <tbody>
              {#each rangeSummaries as m (m.field.id)}
                <tr>
                  <th scope="row">{m.field.name}{m.field.unit ? ` (${unitLabel(m.field.unit)})` : ''}</th>
                  {#if m.count}
                    <td>{fmtNumber(m.average ?? 0, 1)}</td>
                    <td>{fmtNumber(m.min ?? 0)} – {fmtNumber(m.max ?? 0)}</td>
                    <td>{fmtNumber(m.total)}</td>
                  {:else}
                    <td>–</td><td>–</td><td>–</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </section>

    <section class="section">
      <h2>{t('detail.calendar')}</h2>
      <div class="card"><Heatmap {cells} {color} /></div>
    </section>

    {:else}
    <section class="section">
      <Achievements list={allAch ? view.achievements : visibleAch} />
      {#if !allAch && visibleAch.length < view.achievements.length}
        <button class="btn small" style="margin-top:8px" onclick={() => (allAch = true)}>{t('detail.more')}</button>
      {/if}
    </section>
    {/if}

    <p class="small muted">{fmtDate(tracker.created_at)}</p>
  </div>

  {#if editing !== undefined}
    <EventDialog {tracker} fields={view.fields} event={editing} mode={planning ? 'plan' : 'done'} onclose={() => ((editing = undefined), (planning = false))} />
  {/if}
{/if}

<style>
  .h2 { font-size: 1.05rem; font-weight: 700; }
  .hero { display: grid; gap: 4px; padding: 18px; border-radius: var(--radius); background: color-mix(in srgb, var(--c) 16%, var(--surface)); }
  .big { font-family: var(--font-display); font-size: 2.4rem; font-weight: 800; line-height: 1.05; letter-spacing: -0.02em; }
  .chart-nav { margin-bottom: 8px; flex-wrap: nowrap; }
  .segmented.show { margin-top: 8px; }
  .measures { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .measures th, .measures td { padding: 6px 4px; text-align: right; border-top: 1px solid var(--border); }
  .measures thead th { color: var(--muted); font-weight: 500; border-top: 0; }
  .measures th[scope='row'], .measures thead th:first-child { text-align: left; font-weight: 600; }
  .chart-nav .range { text-align: center; font-weight: 600; }
  .chart-nav .linkish { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
  .chart-nav .icon-btn:disabled { opacity: 0.3; cursor: default; }
  .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
  .plan { background: var(--surface); }
  .tabs { margin-top: 16px; }
  .badge { font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); white-space: nowrap; }
  .badge.todo { background: #fff4d6; color: #5c3d00; }
  .log { justify-self: start; min-width: 120px; font-family: var(--font-display); font-size: 1.15rem; background: var(--c); border-color: var(--c); color: #fff; color: lch(from var(--c) calc((68 - l) * 100) 0 0); }
  .upcoming { border: 1px dashed color-mix(in srgb, var(--c) 55%, transparent); }
  .upcoming .until { font-weight: 700; }
  .ev { display: grid; gap: 2px; width: 100%; text-align: left; padding: 10px 0; border: 0; background: none; cursor: pointer; }
</style>
