<script lang="ts">
  import { db } from '../../lib/db/client';
  import { fmtDateTime, t, untilLabel } from '../../lib/i18n/index.svelte';
  import { unitLabel } from '../../lib/templates';
  import type { LifeEvent, Tracker, TrackerField } from '../../lib/types';
  import { toast } from '../../lib/state.svelte';
  import { PLANNED_SLACK, needsCompletion } from '../../lib/domain/planned';
  import DateTimeInput from './DateTimeInput.svelte';

  let {
    tracker,
    fields,
    event = null,
    mode = 'done',
    onclose,
  }: {
    tracker: Tracker;
    fields: TrackerField[];
    event?: LifeEvent | null;
    /** For a new event: already happened, or planned for later. */
    mode?: 'done' | 'plan';
    onclose: () => void;
  } = $props();

  /** A measure is a number (comma or dot). Required once the event happened, optional while it is planned. */
  const NUMBER = '\\s*-?\\d+([.,]\\d+)?\\s*';

  let dialog: HTMLDialogElement;

  /** Tomorrow, at the next full hour. */
  function defaultPlanned(): number {
    const d = new Date(Date.now() + 86_400_000);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
  }

  // svelte-ignore state_referenced_locally
  let when = $state(event ? Date.parse(event.occurred_at) : mode === 'plan' ? defaultPlanned() : Date.now());
  // svelte-ignore state_referenced_locally
  let note = $state(event?.note ?? '');
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.id, event?.measures?.[f.id] !== undefined ? String(event.measures[f.id]) : ''])),
  );
  let busy = $state(false);
  /** Picked a date in the future: the event is planned and only counts once its time comes. */
  const planned = $derived(when > Date.now() + PLANNED_SLACK);
  /** A planned event whose time has come, still missing its numbers. */
  // svelte-ignore state_referenced_locally
  const completing = event ? needsCompletion(event, fields, Date.now()) : false;

  $effect(() => {
    dialog.showModal();
  });

  function setPlanned(on: boolean) {
    if (on && !planned) when = defaultPlanned();
    if (!on && planned) when = Date.now();
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const measures: Record<string, number> = {};
    for (const f of fields) {
      const raw = values[f.id]?.trim() ?? '';
      if (!raw && planned) continue;
      const n = Number(raw.replace(',', '.') || NaN);
      if (!Number.isFinite(n)) {
        toast(t('event.measureRequired'));
        return;
      }
      measures[f.id] = n;
    }
    busy = true;
    try {
      const date = new Date(when);
      await db.write('saveEvent', {
        id: event?.id,
        tracker_id: tracker.id,
        occurred_at: date.toISOString(),
        tz_offset: -date.getTimezoneOffset(),
        measures,
        note,
      });
      if (!event)
        toast(planned ? t('up.planned', { name: tracker.name, when: untilLabel(when, Date.now()) }) : t('dash.logged', { name: tracker.name }), {
          icon: planned ? '📅' : (tracker.icon ?? undefined),
        });
      close();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!event) return;
    const id = event.id;
    await db.write('deleteEvent', id);
    toast(t(completing ? 'todo.skipped' : 'event.deleted'), { icon: '🗑️', action: { label: t('common.undo'), run: () => void db.write('restoreEvent', id) } }, 8000);
    close();
  }

  function close() {
    dialog?.close();
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="event-title">
  <form class="dialog-body" onsubmit={save}>
    <h2 id="event-title" style="margin-top:0">
      {#if completing}✍️ {t('todo.title')}{:else}{tracker.icon ?? ''} {event ? t('event.title') : planned ? t('up.planTitle') : t('event.newTitle')}{/if} · {tracker.name}
    </h2>
    {#if completing && event}
      <p class="muted intro">{t('todo.intro', { when: fmtDateTime(event.occurred_at) })}</p>
    {:else}
      <div class="segmented mode" role="group" aria-label={t('event.when')}>
        <button type="button" aria-pressed={!planned} onclick={() => setPlanned(false)}>✅ {t('up.done')}</button>
        <button type="button" aria-pressed={planned} onclick={() => setPlanned(true)}>📅 {t('up.planned.tab')}</button>
      </div>
    {/if}
    <div class="field">
      <span>{t('event.when')}</span>
      <DateTimeInput bind:value={when} label={t('event.when')} future={planned} />
      {#if planned}<p class="small muted planned">📅 {t('up.hint', { when: untilLabel(when, Date.now()) })}</p>{/if}
    </div>
    {#each fields as f (f.id)}
      <label class="field">
        <span class="measure">
          <span>{f.name}{f.unit ? ` (${unitLabel(f.unit)})` : ''}</span>
          {#if planned}<span class="small muted optional">{t('up.optional')}</span>{/if}
        </span>
        <input
          type="text"
          inputmode="decimal"
          class:later={planned}
          bind:value={values[f.id]}
          autocomplete="off"
          required={!planned}
          pattern={NUMBER}
          placeholder={planned ? t('up.later') : undefined}
          title={t('event.measureRequired')}
        />
      </label>
    {/each}
    <label class="field">
      <span>{t('event.note')}</span>
      <textarea bind:value={note} placeholder={t('event.notePlaceholder')}></textarea>
    </label>
    <div class="dialog-actions">
      {#if completing}
        <button type="button" class="btn" onclick={close}>{t('todo.later')}</button>
      {:else}
        {#if event}
          <button type="button" class="btn danger" onclick={remove}>{t('common.delete')}</button>
          <span class="grow"></span>
        {/if}
        <button type="button" class="btn" onclick={close}>{t('common.cancel')}</button>
      {/if}
      <button type="submit" class="btn primary" disabled={busy}>{planned && !event ? t('up.plan') : t('common.save')}</button>
    </div>
    {#if completing}
      <button type="button" class="skip" onclick={remove}>🚫 {t('todo.skip')}</button>
    {/if}
  </form>
</dialog>

<style>
  .planned { margin: 0; }
  .skip { display: block; margin: 12px 0 0 auto; border: 0; background: none; padding: 6px 4px; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; }
  .intro { margin: -4px 0 12px; }
  .mode { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 12px; }
  .measure { display: flex; justify-content: space-between; gap: 8px; }
  .optional { font-weight: 400; }
  input.later { border-style: dashed; background: var(--bg); }
</style>
