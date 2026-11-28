<script lang="ts">
  import { clockDuration, t } from '../../lib/i18n/index.svelte';
  import type { GoalStatus } from '../../lib/domain/stats';

  let { goal, compact = false }: { goal: GoalStatus; compact?: boolean } = $props();
  const ratio = $derived(goal.target ? Math.min(1, goal.current / goal.target) : 1);
  const over = $derived(goal.kind === 'max' && goal.current > goal.target);
  const color = $derived(over ? 'var(--bad)' : goal.met ? 'var(--good)' : 'var(--accent)');
  const label = $derived(
    goal.unit === 'minutes'
      ? t('detail.goal.progress', { current: clockDuration(goal.current * 60_000), target: clockDuration(goal.target * 60_000), when: t(`period.this.${goal.period}`) })
      : t('detail.goal.progress', { current: goal.current, target: goal.target, when: t(`period.this.${goal.period}`) }),
  );
</script>

<div class="goal" class:compact>
  <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={goal.target} aria-valuenow={goal.current} aria-label={label}>
    <div style:width="{goal.target ? ratio * 100 : 100}%" style:background={color}></div>
  </div>
  <div class="txt">
    <span>{goal.kind === 'max' ? '≤' : '≥'} {label}</span>
    <span style:color>
      {over ? t('detail.goal.missed') : goal.met ? t('detail.goal.met') : t('detail.goal.todo')}
    </span>
  </div>
</div>

<style>
  .goal { display: grid; gap: 4px; margin-top: 6px; }
  .txt { display: flex; justify-content: space-between; gap: 8px; font-size: 0.8rem; color: var(--muted); }
  .compact .txt { font-size: 0.75rem; }
</style>
