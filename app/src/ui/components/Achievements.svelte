<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import type { Achievement } from '../../lib/domain/achievements';
  import { achievementLabel } from '../../lib/labels';

  let { list }: { list: Achievement[] } = $props();
</script>

<ul class="ach">
  {#each list as a (a.id)}
    <li class:unlocked={a.unlocked} class:active={a.active}>
      <span class="medal" aria-hidden="true">{a.unlocked ? (a.active ? '🏆' : '🏅') : '🔒'}</span>
      <span class="txt">
        <span class="name">{achievementLabel(a)}</span>
        <span class="state">{a.active ? t('ach.active') : a.unlocked ? t('ach.done') : t('ach.locked')}</span>
        {#if !a.unlocked}
          <span class="progress"><div style:width="{a.progress * 100}%"></div></span>
        {/if}
      </span>
    </li>
  {/each}
</ul>

<style>
  .ach { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); opacity: 0.6; }
  li.unlocked { opacity: 1; }
  li.active { border-color: var(--good); }
  .medal { font-size: 1.6rem; }
  .txt { display: grid; gap: 2px; flex: 1; min-width: 0; }
  .name { font-weight: 600; font-size: 0.95rem; }
  .state { font-size: 0.75rem; color: var(--muted); }
  .progress { height: 4px; margin-top: 2px; }
</style>
