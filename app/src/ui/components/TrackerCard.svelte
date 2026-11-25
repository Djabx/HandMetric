<script lang="ts">
  import { db } from '../../lib/db/client';
  import { humanDuration, sinceLabel, t } from '../../lib/i18n/index.svelte';
  import { toast, type TrackerView } from '../../lib/state.svelte';
  import { go } from '../../lib/router.svelte';
  import GoalBar from './GoalBar.svelte';
  import Tally from './Tally.svelte';

  let { view, now, onlog }: { view: TrackerView; now: number; onlog: (v: TrackerView) => void } = $props();
  const tr = $derived(view.tracker);
  const s = $derived(view.stats);
  const wide = $derived(tr.display_mode === 'abstinence');
  /** Petits objectifs : on les montre en bâtons plutôt qu'en barre. */
  const tally = $derived(view.goal && view.goal.target > 0 && view.goal.target <= 15 ? view.goal : null);
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

<article class="tracker" class:wide style:--c={tr.color ?? 'var(--accent)'}>
  <button class="body" onclick={() => go(`t/${tr.id}`)} aria-label={tr.name}>
    <span class="head">
      <span class="icon" aria-hidden="true">{tr.icon ?? '•'}</span>
      <span class="name">{tr.name}</span>
    </span>
    {#if wide}
      <span class="big">{humanDuration(s.currentGapFrom, now)}</span>
      <span class="sub">{sinceLabel(s.currentGapFrom, now, s.count === 0)}</span>
    {:else if tally}
      <Tally current={tally.current} target={tally.target} color="var(--c)" overColor="var(--bad)" label={tallyLabel} />
      <span class="sub">{tallyLabel}</span>
    {:else}
      <span class="big">{t('dash.today', { n: s.today })}</span>
      <span class="sub">
        {t('dash.week', { n: s.thisWeek })}{#if s.currentStreak > 1} · 🔥 {t('dash.streak', { n: s.currentStreak })}{/if}
      </span>
    {/if}
    {#if view.goal && !tally}
      <GoalBar goal={view.goal} compact />
    {/if}
  </button>
  <button class="log" onclick={log} aria-label="{t('dash.log')} {tr.name}">{t('dash.log')}</button>
</article>

<style>
  .tracker {
    --tint: color-mix(in srgb, var(--c) 16%, var(--surface));
    display: grid; grid-template-rows: 1fr auto; gap: 10px; padding: 14px;
    border-radius: var(--radius); background: var(--tint);
    transition: transform 0.15s;
  }
  .tracker.wide { grid-column: span 2; grid-template-rows: none; grid-template-columns: 1fr auto; align-items: center; }
  @media (max-width: 340px) { .tracker.wide { grid-column: auto; } }
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
