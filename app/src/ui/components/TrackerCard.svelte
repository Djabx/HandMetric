<script lang="ts">
  import { db } from '../../lib/db/client';
  import { humanDuration, preciseDuration, t } from '../../lib/i18n/index.svelte';
  import { toast, type TrackerView } from '../../lib/state.svelte';
  import { go } from '../../lib/router.svelte';
  import GoalBar from './GoalBar.svelte';

  let { view, now, onlog }: { view: TrackerView; now: number; onlog: (v: TrackerView) => void } = $props();
  const tr = $derived(view.tracker);
  const s = $derived(view.stats);

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

<article class="card tracker" style:--c={tr.color ?? 'var(--accent)'}>
  <button class="body" onclick={() => go(`t/${tr.id}`)} aria-label={tr.name}>
    <div class="head">
      <span class="icon" aria-hidden="true">{tr.icon ?? '•'}</span>
      <span class="name">{tr.name}</span>
    </div>
    {#if tr.display_mode === 'abstinence'}
      {#if s.count === 0 && !s.gaps.length}
        <div class="big">{t('dash.never')}</div>
      {:else}
        <div class="big">{humanDuration(s.currentGapFrom, now)}</div>
        <div class="sub mono">{preciseDuration(s.currentGapFrom, now)} · {t('dash.since')} {tr.icon ?? tr.name}</div>
      {/if}
    {:else}
      <div class="big">{t('dash.today', { n: s.today })}</div>
      <div class="sub">
        {t('dash.week', { n: s.thisWeek })}{#if s.currentStreak > 1} · 🔥 {t('dash.streak', { n: s.currentStreak })}{/if}
      </div>
    {/if}
    {#if view.goal}
      <GoalBar goal={view.goal} compact />
    {/if}
  </button>
  <button class="log" onclick={log} aria-label="{t('dash.log')} {tr.name}">{t('dash.log')}</button>
</article>

<style>
  .tracker {
    position: relative; display: flex; align-items: stretch; gap: 8px; padding: 0; overflow: hidden;
    border-left: 6px solid var(--c);
  }
  .body {
    flex: 1; min-width: 0; text-align: left; border: 0; background: none; cursor: pointer;
    padding: 14px 4px 14px 14px; display: grid; gap: 4px;
  }
  .head { display: flex; align-items: center; gap: 8px; }
  .icon { font-size: 1.4rem; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .big { font-size: 1.35rem; font-weight: 750; line-height: 1.2; }
  .sub { color: var(--muted); font-size: 0.875rem; }
  .mono { font-variant-numeric: tabular-nums; }
  .log {
    flex: none; width: 72px; border: 0; cursor: pointer; font-size: 1.3rem; font-weight: 800;
    background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--text);
  }
  .log:hover { background: color-mix(in srgb, var(--c) 28%, transparent); }
  .log:active { transform: scale(0.97); }
</style>
