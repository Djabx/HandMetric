<script lang="ts">
  import { db } from '../../lib/db/client';
  import { t } from '../../lib/i18n/index.svelte';
  import { unitLabel } from '../../lib/templates';
  import type { LifeEvent, Tracker, TrackerField } from '../../lib/types';
  import { toast } from '../../lib/state.svelte';
  import DateTimeInput from './DateTimeInput.svelte';

  let {
    tracker,
    fields,
    event = null,
    onclose,
  }: { tracker: Tracker; fields: TrackerField[]; event?: LifeEvent | null; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;

  // svelte-ignore state_referenced_locally
  let when = $state(event ? Date.parse(event.occurred_at) : Date.now());
  // svelte-ignore state_referenced_locally
  let note = $state(event?.note ?? '');
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.id, event?.measures?.[f.id] !== undefined ? String(event.measures[f.id]) : ''])),
  );
  let busy = $state(false);

  $effect(() => {
    dialog.showModal();
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const measures: Record<string, number> = {};
      for (const f of fields) {
        const v = values[f.id]?.replace(',', '.').trim();
        if (v) {
          const n = Number(v);
          if (Number.isFinite(n)) measures[f.id] = n;
        }
      }
      const date = new Date(when);
      await db.write('saveEvent', {
        id: event?.id,
        tracker_id: tracker.id,
        occurred_at: date.toISOString(),
        tz_offset: -date.getTimezoneOffset(),
        measures,
        note,
      });
      if (!event) toast(t('dash.logged', { name: tracker.name }), { icon: tracker.icon ?? undefined });
      close();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!event || !confirm(t('common.confirmDelete'))) return;
    await db.write('deleteEvent', event.id);
    close();
  }

  function close() {
    dialog.close();
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="event-title">
  <form class="dialog-body" onsubmit={save}>
    <h2 id="event-title" style="margin-top:0">
      {tracker.icon ?? ''} {event ? t('event.title') : t('event.newTitle')} · {tracker.name}
    </h2>
    <div class="field">
      <span>{t('event.when')}</span>
      <div class="row">
        <DateTimeInput bind:value={when} label={t('event.when')} />
        <button type="button" class="btn small" onclick={() => (when = Date.now())}>{t('event.now')}</button>
      </div>
    </div>
    {#each fields as f (f.id)}
      <label class="field">
        <span>{f.name}{f.unit ? ` (${unitLabel(f.unit)})` : ''}</span>
        <input type="text" inputmode="decimal" bind:value={values[f.id]} autocomplete="off" />
      </label>
    {/each}
    <label class="field">
      <span>{t('event.note')}</span>
      <textarea bind:value={note} placeholder={t('event.notePlaceholder')}></textarea>
    </label>
    <div class="dialog-actions">
      {#if event}
        <button type="button" class="btn danger" onclick={remove}>{t('common.delete')}</button>
        <span class="grow"></span>
      {/if}
      <button type="button" class="btn" onclick={close}>{t('common.cancel')}</button>
      <button type="submit" class="btn primary" disabled={busy}>{t('common.save')}</button>
    </div>
  </form>
</dialog>
