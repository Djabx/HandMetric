<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Tuile repliable des réglages, dans le style des tuiles de l'accueil : seul le titre
   * (et un court résumé) est visible ; un clic déplie le contenu. C'est la page qui décide
   * quelle tuile est ouverte, pour n'en garder qu'une à la fois.
   */
  let {
    id,
    icon,
    title,
    summary = '',
    color,
    warn = false,
    open,
    ontoggle,
    children,
  }: {
    id: string;
    icon: string;
    title: string;
    summary?: string;
    color: string;
    warn?: boolean;
    open: boolean;
    ontoggle: () => void;
    children: Snippet;
  } = $props();

  let tile: HTMLElement;

  // En dépliant, la tuile précédente se replie en même temps : la tuile ouverte peut alors
  // remonter hors de l'écran. Une fois l'animation finie, on la ramène sous la barre du haut.
  $effect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const top = tile.getBoundingClientRect().top;
      if (top < 64 || top > innerHeight - 120) tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 280);
    return () => clearTimeout(timer);
  });
</script>

<section class="fold" class:open bind:this={tile} style:--c={color}>
  <h2>
    <button class="head" id="fold-{id}-head" aria-expanded={open} aria-controls="fold-{id}" onclick={ontoggle}>
      <span class="icon" aria-hidden="true">{icon}</span>
      <span class="text">
        <span class="title">{title}</span>
        {#if summary}<span class="summary" class:warn>{summary}</span>{/if}
      </span>
      <span class="chevron" aria-hidden="true"></span>
    </button>
  </h2>
  <!-- Le contenu reste monté une fois replié (un secret de jeton affiché n'est pas perdu),
       mais il est inerte : ni focus clavier ni lecteur d'écran. -->
  <div class="panel" id="fold-{id}" role="region" aria-labelledby="fold-{id}-head" inert={!open}>
    <div class="inner">
      <div class="content">{@render children()}</div>
    </div>
  </div>
</section>

<style>
  .fold {
    --tint: color-mix(in srgb, var(--c) 16%, var(--surface));
    border-radius: var(--radius); background: var(--tint);
    scroll-margin-top: 72px;
  }
  h2 { margin: 0; font-size: inherit; }
  .head {
    display: flex; align-items: center; gap: 12px; width: 100%;
    min-height: 68px; padding: 14px; border: 0; border-radius: var(--radius);
    background: none; text-align: left; cursor: pointer; color: inherit;
  }
  .head:hover { background: color-mix(in srgb, var(--c) 8%, transparent); }
  .head:active .icon { transform: scale(0.94); }
  .icon {
    flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
    background: var(--surface); font-size: 1.25rem; transition: transform 0.15s;
  }
  .text { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .title { font-family: var(--font-display); font-size: 1.1rem; font-weight: 800; letter-spacing: -0.01em; }
  .summary { color: var(--muted); font-size: 0.85rem; }
  .summary.warn { color: var(--warn); font-weight: 600; }
  .chevron {
    flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--surface);
    display: grid; place-items: center; transition: transform 0.25s;
  }
  .chevron::before {
    content: ''; width: 8px; height: 8px; margin-top: -4px;
    border: solid var(--c); border-width: 0 2.5px 2.5px 0; transform: rotate(45deg);
  }
  .open .chevron { transform: rotate(180deg); }

  /* Dépliage animé sans connaître la hauteur du contenu. */
  .panel { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.25s ease; }
  .open .panel { grid-template-rows: 1fr; }
  .inner { overflow: hidden; min-height: 0; }
  .content { padding: 0 14px 16px; }
  .content > :global(:first-child) { margin-top: 0; }
  @media (prefers-reduced-motion: reduce) {
    .panel, .chevron { transition: none; }
  }
</style>
