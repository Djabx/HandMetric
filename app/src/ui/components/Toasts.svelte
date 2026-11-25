<script lang="ts">
  import { dismiss, toasts } from '../../lib/state.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.list as tst (tst.id)}
    <div class="toast">
      {#if tst.icon}<span aria-hidden="true">{tst.icon}</span>{/if}
      <span class="grow">{tst.text}</span>
      {#if tst.action}
        <button class="act" onclick={() => { tst.action!.run(); dismiss(tst.id); }}>{tst.action.label}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(84px + env(safe-area-inset-bottom));
    z-index: 50; display: grid; gap: 8px; width: min(440px, calc(100vw - 32px));
  }
  .toast {
    display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px;
    background: var(--text); color: var(--bg); box-shadow: 0 6px 24px rgb(0 0 0 / 0.25);
  }
  .act { border: 0; background: none; color: inherit; font-weight: 700; cursor: pointer; text-decoration: underline; }
</style>
