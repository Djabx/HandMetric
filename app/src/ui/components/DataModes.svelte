<script lang="ts">
  /** « Où sont tes données ? » : les deux versions de LifeLog, celle en cours surlignée. */
  import { sync } from '../../lib/sync/sync.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  /** Textes courts (accueil, connexion) ou détaillés (À propos). */
  let { short = true }: { short?: boolean } = $props();

  const current = $derived(sync.mode === 'server' ? 'server' : 'solo');
  const modes = [
    { id: 'solo', icon: '🧭', title: 'about.solo.title', body: 'about.solo.body', brief: 'home.solo' },
    { id: 'server', icon: '🏠', title: 'about.server.title', body: 'about.server.body', brief: 'home.server' },
  ] as const;
</script>

<div class="modes">
  {#each modes as m (m.id)}
    <div class="mode" class:on={current === m.id} aria-current={current === m.id ? 'true' : undefined}>
      {#if current === m.id}<span class="here">{t('about.here')}</span>{/if}
      <h3>{m.icon} {t(m.title)}</h3>
      <p>{t(short ? m.brief : m.body)}</p>
    </div>
  {/each}
</div>

<style>
  .modes { display: grid; gap: 14px; }
  .mode { position: relative; background: var(--surface); border: 2px solid var(--border); border-radius: 18px; padding: 12px 14px; }
  .mode.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
  .here {
    position: absolute; top: -11px; right: 12px; background: var(--accent); color: var(--accent-text);
    font-size: 0.72rem; font-weight: 700; padding: 3px 9px; border-radius: 999px;
  }
  h3 { margin: 0 0 4px; font-size: 1rem; }
  p { margin: 0; font-size: 0.9rem; color: var(--muted); }
</style>
