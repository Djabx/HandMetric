<script lang="ts">
  /**
   * Saisie date + heure qui suit la langue de l'application (jour/mois/année, 24 h),
   * et non la langue du navigateur comme <input type="datetime-local">.
   * value : instant en millisecondes, interprété en heure locale.
   */
  import { locale, t } from '../../lib/i18n/index.svelte';

  let { value = $bindable(), label }: { value: number; label: string } = $props();

  const pad = (n: number) => String(n).padStart(2, '0');

  // Champs texte (pour pouvoir saisir librement), recalculés quand value change de l'extérieur.
  let day = $state(''), month = $state(''), year = $state(''), hour = $state(''), minute = $state('');
  let last = NaN;
  function show(v: number) {
    const d = new Date(v);
    day = String(d.getDate());
    month = String(d.getMonth() + 1);
    year = String(d.getFullYear());
    hour = pad(d.getHours());
    minute = pad(d.getMinutes());
    last = v;
  }
  $effect(() => {
    if (value !== last) show(value);
  });

  /** Ordre jour / mois / année selon la langue. */
  const order = $derived(
    new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
      .formatToParts(new Date(2000, 0, 31))
      .map((p) => p.type)
      .filter((p): p is 'day' | 'month' | 'year' => p === 'day' || p === 'month' || p === 'year'),
  );

  const months = $derived(
    Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale(), { month: 'long' }).format(new Date(2000, i, 1))),
  );

  function commit() {
    const y = Number(year), mo = Number(month), h = Number(hour), mi = Number(minute);
    let d = Number(day);
    if (![y, mo, d, h, mi].every(Number.isInteger) || y < 1900 || y > 2999) return;
    const maxDay = new Date(y, mo, 0).getDate();
    d = Math.min(Math.max(d, 1), maxDay);
    const next = new Date(y, mo - 1, d, Math.min(Math.max(h, 0), 23), Math.min(Math.max(mi, 0), 59)).getTime();
    last = next;
    value = next;
  }

  function normalize() {
    commit();
    show(value); // réaffiche les valeurs corrigées (jour 31 → 30, heure 7 → 07…)
  }
</script>

<fieldset class="dt" aria-label={label}>
  <div class="date">
    {#each order as part (part)}
      {#if part === 'day'}
        <input class="day" type="text" inputmode="numeric" maxlength="2" aria-label={t('dt.day')} bind:value={day} oninput={commit} onblur={normalize} />
      {:else if part === 'month'}
        <select class="month" aria-label={t('dt.month')} bind:value={month} onchange={commit}>
          {#each months as name, i (i)}
            <option value={String(i + 1)}>{name}</option>
          {/each}
        </select>
      {:else}
        <input class="year" type="text" inputmode="numeric" maxlength="4" aria-label={t('dt.year')} bind:value={year} oninput={commit} onblur={normalize} />
      {/if}
    {/each}
  </div>
  <div class="time">
    <input type="text" inputmode="numeric" maxlength="2" aria-label={t('dt.hour')} bind:value={hour} oninput={commit} onblur={normalize} />
    <span aria-hidden="true">:</span>
    <input type="text" inputmode="numeric" maxlength="2" aria-label={t('dt.minute')} bind:value={minute} oninput={commit} onblur={normalize} />
  </div>
</fieldset>

<style>
  .dt { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .date, .time { display: flex; gap: 6px; align-items: center; }
  .date { flex: 1 1 220px; }
  input { text-align: center; font-variant-numeric: tabular-nums; padding-inline: 4px; }
  .day { width: 3.2em; }
  .year { width: 4.6em; }
  .month { flex: 1; min-width: 7em; }
  .time input { width: 3.2em; }
</style>
