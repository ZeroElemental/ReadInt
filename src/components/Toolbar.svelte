<script lang="ts">
  import { closeDoc, reader, setSpread, setZoom } from '../lib/reader.svelte.ts'
  import type { Tool } from '../lib/types.ts'

  interface Props {
    onsave: () => void
    onsearch: () => void
    /** Owned by ReaderShell so keyboard and buttons animate the same turn. */
    onturn: (delta: number) => void
  }
  let { onsave, onsearch, onturn }: Props = $props()

  const TOOLS: { id: Tool; label: string; key: string }[] = [
    { id: 'select', label: 'Select', key: 'S' },
    { id: 'highlight', label: 'Highlight', key: 'H' },
    { id: 'underline', label: 'Underline', key: 'U' },
    { id: 'pen', label: 'Pen', key: 'P' },
    { id: 'note', label: 'Note', key: 'N' },
    { id: 'erase', label: 'Erase', key: 'E' },
  ]
</script>

<header class="toolbar">
  <button onclick={closeDoc}>← Library</button>

  <div class="tools" role="toolbar" aria-label="Annotation tools">
    {#each TOOLS as t (t.id)}
      <button
        class:active={reader.tool === t.id}
        onclick={() => (reader.tool = t.id)}
        title="{t.label} ({t.key})"
      >
        {t.label}
      </button>
    {/each}
  </div>

  <label class="swatch" title="Highlight colour">
    <input type="color" bind:value={reader.settings.highlightColor} />
    <span aria-hidden="true" style:background={reader.settings.highlightColor}></span>
  </label>
  <label class="swatch" title="Ink colour">
    <input type="color" bind:value={reader.settings.inkColor} />
    <span aria-hidden="true" style:background={reader.settings.inkColor}></span>
  </label>
  <label class="thickness" title="Stroke thickness">
    <input type="range" min="0.5" max="8" step="0.5" bind:value={reader.settings.thickness} />
  </label>

  <div class="spacer"></div>

  <button onclick={() => onturn(-1)} aria-label="Previous page">‹</button>
  <span class="pages">{reader.spreadStart + 1} / {reader.pageCount || '—'}</span>
  <button onclick={() => onturn(1)} aria-label="Next page">›</button>

  <button onclick={() => setZoom(reader.zoom / 1.25)} aria-label="Zoom out">−</button>
  <span class="zoom">{Math.round(reader.zoom * 100)}%</span>
  <button onclick={() => setZoom(reader.zoom * 1.25)} aria-label="Zoom in">+</button>

  <button
    class:active={reader.settings.spread}
    onclick={() => setSpread(!reader.settings.spread)}
    title="Two-page spread"
  >
    {reader.settings.spread ? 'Spread' : 'Single'}
  </button>

  <button
    onclick={() =>
      (reader.settings.readingDirection =
        reader.settings.readingDirection === 'ltr' ? 'rtl' : 'ltr')}
    title="Reading direction"
  >
    {reader.settings.readingDirection.toUpperCase()}
  </button>

  <select bind:value={reader.settings.magnifier} aria-label="Magnifier mode">
    <option value="off">No magnifier</option>
    <option value="lens">Lens</option>
    <option value="band">Line band</option>
  </select>

  <button onclick={onsearch}>Search</button>
  <button class="save" class:dirty={reader.dirty} onclick={onsave}>
    {reader.dirty ? 'Save *' : 'Saved'}
  </button>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
    font-size: 0.8rem;
  }
  .tools {
    display: flex;
    gap: 0.15rem;
    margin-left: 0.75rem;
  }
  .spacer {
    flex: 1;
  }
  button,
  select {
    font: inherit;
    padding: 0.3rem 0.55rem;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    cursor: pointer;
  }
  button:hover,
  select:hover {
    background: var(--raise);
  }
  .active {
    background: var(--raise);
    border-color: var(--rule);
    font-weight: 600;
  }
  .pages,
  .zoom {
    color: var(--muted);
    min-width: 3.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  /* The native colour input is the picker; the span is what you actually see. */
  .swatch {
    position: relative;
    width: 1.4rem;
    height: 1.4rem;
    cursor: pointer;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .swatch span {
    display: block;
    width: 100%;
    height: 100%;
    border: 1px solid var(--rule);
    border-radius: 4px;
  }
  .swatch:focus-within span {
    outline: 2px solid #3b6ea5;
    outline-offset: 1px;
  }
  .thickness input {
    width: 4.5rem;
    vertical-align: middle;
  }
  .save {
    border-color: var(--rule);
  }
  .save.dirty {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
</style>
