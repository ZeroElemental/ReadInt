<script lang="ts">
  import { reader, setZoom, turnPage } from '../lib/reader.svelte.ts'
  import type { Tool } from '../lib/types.ts'

  interface Props {
    onsave: () => void
    onsearch: () => void
  }
  let { onsave, onsearch }: Props = $props()

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
  <button onclick={() => (reader.docId = null)}>← Library</button>

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

  <div class="spacer"></div>

  <button onclick={() => turnPage(-1)} aria-label="Previous page">‹</button>
  <span class="pages">{reader.spreadStart + 1} / {reader.pageCount || '—'}</span>
  <button onclick={() => turnPage(1)} aria-label="Next page">›</button>

  <button onclick={() => setZoom(reader.zoom / 1.25)} aria-label="Zoom out">−</button>
  <span class="zoom">{Math.round(reader.zoom * 100)}%</span>
  <button onclick={() => setZoom(reader.zoom * 1.25)} aria-label="Zoom in">+</button>

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
  .save {
    border-color: var(--rule);
  }
  .save.dirty {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
</style>
