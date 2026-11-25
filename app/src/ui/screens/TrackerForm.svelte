<script lang="ts">
  import { app } from '../../lib/state.svelte';
  import { db } from '../../lib/db/client';
  import { t } from '../../lib/i18n/index.svelte';
  import { back, go, replace } from '../../lib/router.svelte';
  import { PALETTE, TEMPLATES } from '../../lib/templates';
  import EmojiPicker from '../components/EmojiPicker.svelte';
  import UnitInput from '../components/UnitInput.svelte';
  import { toast } from '../../lib/state.svelte';
  import type { DisplayMode, GoalKind, Period, Polarity, TileSize } from '../../lib/types';
  import { TILE_SIZES, tileSize } from '../../lib/domain/tile';
  import { achievementsEnabled } from '../../lib/domain/achievements';

  let { id = null, template = null }: { id?: string | null; template?: string | null } = $props();

  // svelte-ignore state_referenced_locally
  const existing = id ? (app.trackers.find((x) => x.id === id) ?? app.archived.find((x) => x.id === id) ?? null) : null;
  // svelte-ignore state_referenced_locally
  const tpl = template ? TEMPLATES.find((x) => x.id === template) : undefined;

  let name = $state(existing?.name ?? (tpl ? t(tpl.name) : ''));
  let icon = $state(existing?.icon ?? tpl?.icon ?? '');
  let color = $state(existing?.color ?? tpl?.color ?? PALETTE[5]);
  let polarity = $state<Polarity>(existing?.polarity ?? tpl?.polarity ?? 'good');
  let mode = $state<DisplayMode>(existing?.display_mode ?? tpl?.display_mode ?? 'frequency');
  let goalKind = $state<GoalKind | ''>(existing?.goal_kind ?? tpl?.goal?.kind ?? '');
  let goalCount = $state<number>(existing?.goal_count ?? tpl?.goal?.count ?? 1);
  let goalPeriod = $state<Period>(existing?.goal_period ?? tpl?.goal?.period ?? 'week');
  // svelte-ignore state_referenced_locally
  let fields = $state(
    existing
      ? app.fields.filter((f) => f.tracker_id === existing.id).map((f) => ({ id: f.id as string | undefined, name: f.name, unit: f.unit ?? '' }))
      : (tpl?.fields ?? []).map((f) => ({ id: undefined as string | undefined, name: t(f.name), unit: f.unit })),
  );
  /** Trophées : null = selon le type (désactivés pour un compteur neutre). */
  let trophies = $state<number | null>(existing?.achievements ?? tpl?.achievements ?? null);
  const trophiesOn = $derived(achievementsEnabled({ achievements: trophies, polarity }));
  /** Taille de la tuile : null = automatique. */
  let tile = $state<TileSize | null>(existing?.tile ?? null);
  const autoTile = $derived(tileSize({ tile: null, display_mode: mode, goal_count: goalKind ? goalCount : null }, fields.length));
  /** Schéma 6 × 2 de chaque taille : cases remplies. */
  const MINI: Record<TileSize | 'auto', number[]> = {
    auto: [], small: [0, 1], normal: [0, 1, 2], wide: [0, 1, 2, 3, 4, 5], tall: [0, 1, 2, 6, 7, 8],
  };
  let busy = $state(false);


  function setPolarity(p: Polarity) {
    polarity = p;
    if (!existing) mode = p === 'bad' ? 'abstinence' : 'frequency';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const tr = await db.write(
        'saveTracker',
        {
          id: existing?.id,
          name,
          icon: icon.trim() || null,
          color,
          polarity,
          display_mode: mode,
          goal_kind: goalKind || null,
          goal_count: goalKind ? goalCount : null,
          achievements: trophies,
          tile,
          goal_period: goalKind ? goalPeriod : null,
        },
        $state.snapshot(fields).map((f) => ({ id: f.id, name: f.name, unit: f.unit || null })),
      );
      if (existing) back();
      else replace(`t/${tr.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function archive() {
    if (!existing) return;
    await db.write('setArchived', existing.id, !existing.archived_at);
    go('');
  }

  async function remove() {
    if (!existing || !confirm(t('form.deleteConfirm', { name: existing.name }))) return;
    const { id, name } = existing;
    await db.write('deleteTracker', id);
    toast(t('form.deleted', { name }), { icon: '🗑️', action: { label: t('common.undo'), run: () => void db.write('restoreTracker', id) } }, 8000);
    replace('');
  }
</script>

<div class="page">
  <header class="topbar">
    <button class="icon-btn" onclick={back} aria-label={t('common.back')}>←</button>
    <h1>{existing ? t('form.editTitle') : t('form.newTitle')}</h1>
  </header>

  {#if !existing}
    <section class="templates" aria-labelledby="tpl-title">
      <h2 id="tpl-title">{t('form.templates')}</h2>
      <p class="small muted">{t('form.templatesHelp')}</p>
      <div class="row">
        <a class="btn small" href="#/new" aria-current={!template} onclick={(e) => { e.preventDefault(); replace('new'); }}>✏️ {t('form.templateBlank')}</a>
        {#each TEMPLATES as tp (tp.id)}
          <a class="btn small" href="#/new/{tp.id}" aria-current={template === tp.id} onclick={(e) => { e.preventDefault(); replace(`new/${tp.id}`); }}>{tp.icon} {t(tp.name)}</a>
        {/each}
      </div>
    </section>
  {/if}

  {#key template}
    <form onsubmit={save}>
      <label class="field">
        <span>{t('form.name')}</span>
        <input type="text" bind:value={name} required maxlength="80" placeholder={t('form.namePlaceholder')} />
      </label>

      <div class="field">
        <span>{t('form.icon')}</span>
        <EmojiPicker bind:value={icon} />
      </div>

      <div class="field">
        <span>{t('form.color')}</span>
        <div class="row">
          {#each PALETTE as c (c)}
            <button type="button" class="swatch" style:background={c} aria-pressed={color === c} aria-label={c} onclick={() => (color = c)}></button>
          {/each}
        </div>
      </div>

      <div class="field">
        <span>{t('form.polarity')}</span>
        <div class="segmented">
          {#each ['good', 'bad', 'neutral'] as const as p (p)}
            <button type="button" aria-pressed={polarity === p} onclick={() => setPolarity(p)}>{t(`form.polarity.${p}`)}</button>
          {/each}
        </div>
      </div>

      <div class="field">
        <span>{t('form.mode')}</span>
        <div class="segmented">
          {#each ['abstinence', 'frequency'] as const as m (m)}
            <button type="button" aria-pressed={mode === m} onclick={() => (mode = m)}>{t(`form.mode.${m}`)}</button>
          {/each}
        </div>
      </div>

      <div class="field">
        <span>{t('form.goal')}</span>
        <div class="segmented">
          <button type="button" aria-pressed={goalKind === ''} onclick={() => (goalKind = '')}>{t('form.goal.none')}</button>
          <button type="button" aria-pressed={goalKind === 'max'} onclick={() => (goalKind = 'max')}>{t('form.goal.max')}</button>
          <button type="button" aria-pressed={goalKind === 'min'} onclick={() => (goalKind = 'min')}>{t('form.goal.min')}</button>
        </div>
        {#if goalKind}
          <div class="row">
            <input type="number" min="0" max="10000" bind:value={goalCount} style="width:96px" aria-label={t('form.goal')} />
            <span>{t('form.goal.times')}</span>
            <select bind:value={goalPeriod} style="width:auto">
              <option value="day">{t('period.day')}</option>
              <option value="week">{t('period.week')}</option>
              <option value="month">{t('period.month')}</option>
            </select>
          </div>
        {/if}
      </div>

      <div class="field">
        <span>{t('form.trophies')}</span>
        <div class="segmented">
          <button type="button" aria-pressed={trophiesOn} onclick={() => (trophies = polarity === 'neutral' ? 1 : null)}>{t('form.trophies.on')}</button>
          <button type="button" aria-pressed={!trophiesOn} onclick={() => (trophies = polarity === 'neutral' ? null : 0)}>{t('form.trophies.off')}</button>
        </div>
        <span class="small muted">{t(polarity === 'bad' ? 'form.trophies.helpBad' : polarity === 'good' ? 'form.trophies.helpGood' : 'form.trophies.helpNeutral')}</span>
      </div>

      <div class="field">
        <span>{t('form.tile')}</span>
        <div class="sizes">
          {#each [null, ...TILE_SIZES] as sz (sz ?? 'auto')}
            <button type="button" class="size" aria-pressed={tile === sz} onclick={() => (tile = sz)}>
              <span class="mini" aria-hidden="true">
                {#each { length: 12 } as _, i (i)}<b class:x={MINI[sz ?? autoTile].includes(i)}></b>{/each}
              </span>
              {t(`form.tile.${sz ?? 'auto'}`)}
            </button>
          {/each}
        </div>
        <span class="small muted">{tile ? t('form.tile.help') : t('form.tile.autoHelp', { size: t(`form.tile.${autoTile}`).toLowerCase() })}</span>
      </div>

      <div class="field">
        <span>{t('form.fields')}</span>
        <span class="small muted" style="font-weight:400">{t('form.fieldsHelp')}</span>
        {#each fields as f, i (i)}
          <div class="field-row">
            <input type="text" bind:value={f.name} placeholder={t('form.fieldName')} aria-label={t('form.fieldName')} />
            <UnitInput bind:value={f.unit} />
            <button type="button" class="icon-btn" aria-label={t('common.delete')} onclick={() => fields.splice(i, 1)}>✕</button>
          </div>
        {/each}
        <div><button type="button" class="btn small" onclick={() => fields.push({ id: undefined, name: '', unit: '' })}>＋ {t('form.addField')}</button></div>
      </div>

      <div class="row" style="margin-top:24px">
        <button type="submit" class="btn primary" disabled={busy}>{t('common.save')}</button>
        <button type="button" class="btn" onclick={back}>{t('common.cancel')}</button>
      </div>
    </form>
  {/key}

  {#if existing}
    <div class="section actions">
      <div class="action">
        <button class="btn" onclick={archive}>📦 {existing.archived_at ? t('form.unarchive') : t('form.archive')}</button>
        <p class="small muted">{existing.archived_at ? t('form.unarchiveHelp') : t('form.archiveHelp')}</p>
      </div>
      <div class="action">
        <button class="btn danger" onclick={remove}>🗑️ {t('form.deleteTracker')}</button>
        <p class="small muted">{t('form.deleteHelp')}</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .actions { display: grid; gap: 12px; }
  .sizes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
  .size {
    display: grid; justify-items: center; gap: 6px; padding: 10px 2px 8px; cursor: pointer;
    border: 2px solid var(--border); border-radius: 14px; background: var(--surface); color: inherit; font: inherit; font-size: 0.8rem; font-weight: 600;
  }
  .size[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
  .mini { display: grid; grid-template-columns: repeat(6, 6px); grid-template-rows: repeat(2, 8px); gap: 2px; }
  .mini b { border-radius: 2px; background: var(--border); }
  .mini b.x { background: var(--muted); }
  .size[aria-pressed='true'] .mini b.x { background: var(--accent); }
  .action p { margin: 4px 0 0; }
  .field-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: start; }
  .templates { background: var(--surface-2); border: 1px dashed var(--border); border-radius: 16px; padding: 12px 14px; margin-bottom: 20px; }
  .templates h2 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .templates p { margin: 4px 0 10px; }
  a.btn[aria-current='true'] { border-color: var(--accent); outline: 2px solid var(--accent); }
  .swatch { width: 36px; height: 36px; border-radius: 50%; border: 3px solid var(--bg); outline: 1px solid var(--border); cursor: pointer; }
  .swatch[aria-pressed='true'] { outline: 3px solid var(--text); }
  a.btn { text-decoration: none; color: inherit; }
  a.btn[aria-current='true'] { border-color: var(--accent); }
</style>
