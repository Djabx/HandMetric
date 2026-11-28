<script lang="ts">
  /**
   * Sélecteur date + heure : un bouton qui affiche l'instant choisi, et qui ouvre un
   * calendrier (semaine du lundi ; les jours futurs servent aux événements prévus) et deux grilles à toucher pour
   * l'heure (00 à 23) et les minutes (de 5 en 5). Même rendu dans tous les navigateurs,
   * toujours jour/mois et 24 h, quelle que soit la langue du navigateur.
   * value : instant en millisecondes, interprété en heure locale.
   */
  import { locale, t } from '../../lib/i18n/index.svelte';

  let { value = $bindable(), label }: { value: number; label: string } = $props();

  let open = $state(false);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sel = $derived(new Date(value));
  /** Mois affiché dans le calendrier (1er du mois). */
  let shown = $state(new Date());
  $effect(() => {
    if (!open) shown = new Date(sel.getFullYear(), sel.getMonth(), 1);
  });

  const summary = $derived(
    new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(sel) +
      ` · ${pad(sel.getHours())}:${pad(sel.getMinutes())}`,
  );
  const monthTitle = $derived(new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(shown));
  /** Initiales des jours, du lundi au dimanche (5 janvier 2026 est un lundi). */
  const weekdays = $derived(
    Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale(), { weekday: 'narrow' }).format(new Date(2026, 0, 5 + i))),
  );
  const dayLabel = (d: Date) => new Intl.DateTimeFormat(locale(), { dateStyle: 'full' }).format(d);

  const today = $derived.by(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  });

  /** 6 semaines à partir du lundi qui précède (ou est) le 1er du mois. */
  const days = $derived.by(() => {
    const first = shown;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  });
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function set(y: number, mo: number, d: number, h: number, mi: number) {
    value = new Date(y, mo, d, h, mi).getTime();
  }
  function pickDay(d: Date) {
    set(d.getFullYear(), d.getMonth(), d.getDate(), sel.getHours(), sel.getMinutes());
  }
  function pickHour(h: number) {
    set(sel.getFullYear(), sel.getMonth(), sel.getDate(), h, sel.getMinutes());
  }
  function pickMinute(m: number) {
    set(sel.getFullYear(), sel.getMonth(), sel.getDate(), sel.getHours(), m);
  }
  function move(delta: number) {
    shown = new Date(shown.getFullYear(), shown.getMonth() + delta, 1);
  }
  function quick(ms: number) {
    value = ms;
    shown = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), 1);
  }
</script>

<div class="dt">
  <button type="button" class="summary" aria-expanded={open} aria-label="{label} : {summary}" onclick={() => (open = !open)}>
    <span aria-hidden="true">📅</span><span class="grow">{summary}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
  </button>

  <div class="chips">
    <button type="button" class="chip" onclick={() => quick(Date.now())}>{t('dt.now')}</button>
    <button type="button" class="chip" onclick={() => quick(Date.now() - 3_600_000)}>{t('dt.hourAgo')}</button>
    <button type="button" class="chip" onclick={() => quick(Date.now() - 86_400_000)}>{t('dt.yesterday')}</button>
  </div>

  {#if open}
    <div class="panel">
      <div class="month">
        <button type="button" class="nav" onclick={() => move(-1)} aria-label={t('dt.prevMonth')}>‹</button>
        <span>{monthTitle}</span>
        <button type="button" class="nav" onclick={() => move(1)} aria-label={t('dt.nextMonth')}>›</button>
      </div>
      <div class="cal" role="group" aria-label={monthTitle}>
        {#each weekdays as w, i (i)}<span class="wd" aria-hidden="true">{w}</span>{/each}
        {#each days as d (d.getTime())}
          <button
            type="button"
            class="day"
            class:other={d.getMonth() !== shown.getMonth()}
            class:today={d.getTime() === today}
            aria-pressed={sameDay(d, sel)}
            aria-label={dayLabel(d)}
            onclick={() => pickDay(d)}>{d.getDate()}</button>
        {/each}
      </div>

      <p class="lbl">{t('dt.hour')}</p>
      <div class="hours" role="group" aria-label={t('dt.hour')}>
        {#each { length: 24 } as _, h (h)}
          <button type="button" aria-pressed={sel.getHours() === h} onclick={() => pickHour(h)}>{pad(h)}</button>
        {/each}
      </div>
      <p class="lbl">{t('dt.minute')}</p>
      <div class="minutes" role="group" aria-label={t('dt.minute')}>
        {#each { length: 12 } as _, i (i)}
          <button type="button" aria-pressed={sel.getMinutes() === i * 5} onclick={() => pickMinute(i * 5)}>:{pad(i * 5)}</button>
        {/each}
      </div>
      <div class="done"><button type="button" class="btn small primary" onclick={() => (open = false)}>{t('dt.done')}</button></div>
    </div>
  {/if}
</div>

<style>
  .dt { display: grid; gap: 8px; min-width: 0; }
  .summary {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; cursor: pointer; text-align: left;
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: inherit; font: inherit; font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .summary[aria-expanded='true'] { border: 2px solid var(--accent); padding: 9px 11px; }
  .grow { flex: 1; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; cursor: pointer;
    background: var(--surface); color: inherit; font: inherit; font-size: 0.85rem; font-weight: 600;
  }
  .panel { border: 1px solid var(--border); border-radius: 16px; padding: 10px; display: grid; gap: 6px; }
  .month { display: flex; align-items: center; justify-content: space-between; font-family: var(--font-display); font-weight: 700; text-transform: capitalize; }
  .nav {
    width: 36px; height: 36px; border-radius: 50%; border: 0; cursor: pointer; font-size: 1.2rem;
    background: var(--surface-2); color: inherit;
  }
  .nav:disabled { opacity: 0.35; cursor: default; }
  .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; text-align: center; }
  .wd { color: var(--muted); font-size: 0.72rem; font-weight: 700; padding: 4px 0; text-transform: uppercase; }
  .day {
    aspect-ratio: 1; max-height: 44px; border: 0; border-radius: 50%; cursor: pointer; justify-self: center; width: 100%; max-width: 44px;
    background: none; color: inherit; font: inherit; font-variant-numeric: tabular-nums;
  }
  .day.other { color: var(--muted); opacity: 0.6; }
  .day.today { outline: 2px solid var(--accent); outline-offset: -2px; }
  .day:disabled { opacity: 0.3; cursor: default; }
  .day[aria-pressed='true'] { background: var(--accent); color: #fff; font-weight: 700; opacity: 1; }
  .lbl { margin: 6px 0 0; font-size: 0.8rem; font-weight: 700; color: var(--muted); }
  .hours, .minutes { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; }
  .hours button, .minutes button {
    border: 1px solid var(--border); border-radius: 10px; padding: 8px 0; cursor: pointer;
    background: var(--surface); color: inherit; font: inherit; font-size: 0.9rem; font-variant-numeric: tabular-nums;
  }
  .hours button[aria-pressed='true'], .minutes button[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .done { display: flex; justify-content: flex-end; margin-top: 4px; }
</style>
