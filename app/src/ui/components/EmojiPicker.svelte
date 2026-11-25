<script lang="ts">
  /**
   * Choix d'une icône : champ libre (clavier emoji du système, notamment sur mobile)
   * + sélecteur complet avec recherche (emoji-picker-element), données embarquées
   * dans l'application pour fonctionner hors ligne.
   */
  import 'emoji-picker-element';
  import type { EmojiClickEvent } from 'emoji-picker-element/shared';
  import frI18n from 'emoji-picker-element/i18n/fr.js';
  import frData from 'emoji-picker-element-data/fr/emojibase/data.json?url';
  import enData from 'emoji-picker-element-data/en/emojibase/data.json?url';
  import { i18n, t } from '../../lib/i18n/index.svelte';

  let { value = $bindable() }: { value: string } = $props();

  let open = $state(false);
  let host: HTMLElement | undefined = $state();

  const fr = $derived(i18n.lang === 'fr');

  $effect(() => {
    const el = host as (HTMLElement & Record<string, unknown>) | undefined;
    if (!el) return;
    el.dataSource = fr ? frData : enData;
    el.locale = fr ? 'fr' : 'en';
    if (fr) el.i18n = frI18n;
    const onClick = (e: Event) => {
      value = (e as EmojiClickEvent).detail.unicode ?? value;
      open = false;
    };
    el.addEventListener('emoji-click', onClick);
    return () => el.removeEventListener('emoji-click', onClick);
  });
</script>

<div class="picker">
  <div class="row">
    <input class="current" type="text" bind:value maxlength="8" aria-label={t('form.icon')} />
    <button type="button" class="btn small" aria-expanded={open} onclick={() => (open = !open)}>
      {open ? t('form.iconClose') : t('form.iconChoose')}
    </button>
  </div>
  <span class="small muted">{t('form.iconHelp')}</span>
  {#if open}
    <emoji-picker bind:this={host}></emoji-picker>
  {/if}
</div>

<style>
  .picker { display: grid; gap: 8px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .current { width: 72px !important; text-align: center; font-size: 1.4rem; }
  emoji-picker {
    width: 100%;
    --num-columns: 8;
    --emoji-size: 1.5rem;
    --background: var(--surface);
    --border-color: var(--border);
    --input-border-color: var(--border);
    --input-font-color: var(--text);
    --button-active-background: var(--surface-2);
    --button-hover-background: var(--surface-2);
    --indicator-color: var(--accent);
    --outline-color: var(--accent);
    --category-font-color: var(--muted);
  }
</style>
