<script lang="ts">
  /**
   * The book. Two leaves, a gutter, and a perspective so the spread curves.
   * Owns geometry and input; knows nothing about PDF vs EPUB.
   */
  import { reader, focusedPage } from '../lib/reader.svelte.ts'
  import { handleKey } from '../lib/keys.ts'
  import PageView from './PageView.svelte'
  import Toolbar from './Toolbar.svelte'
  import SearchPanel from './SearchPanel.svelte'
  import DefinitionPopup from './DefinitionPopup.svelte'

  let searchOpen = $state(false)

  const rtl = $derived(reader.settings.readingDirection === 'rtl')
  const focused = $derived(focusedPage())

  function save() {
    // TODO(phase-3): saveAnnotations(docId, reader.annotations, reader.deletedIds)
  }
</script>

<svelte:window
  onkeydown={(e) =>
    handleKey(e, {
      save,
      search: () => (searchOpen = true),
      escape: () => (searchOpen = false),
    })}
/>

<div class="reader" class:rtl>
  <Toolbar onsave={save} onsearch={() => (searchOpen = !searchOpen)} />

  <div class="book" style:--zoom={reader.zoom}>
    {#if reader.settings.spread}
      <PageView pageIndex={reader.spreadStart} side="left" focused={focused === reader.spreadStart} />
      <div class="gutter" aria-hidden="true"></div>
      <PageView pageIndex={reader.spreadStart + 1} side="right" focused={focused === reader.spreadStart + 1} />
    {:else}
      <PageView pageIndex={reader.spreadStart} side="left" focused={true} />
    {/if}
  </div>

  {#if searchOpen}<SearchPanel onclose={() => (searchOpen = false)} />{/if}
  <DefinitionPopup />
</div>

<style>
  .reader {
    height: 100dvh;
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--desk);
    overflow: hidden;
  }
  .book {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    /* The curve that makes a flat screen read as a bound book. */
    perspective: 2400px;
    perspective-origin: center;
    padding: 2rem;
  }
  .rtl .book {
    flex-direction: row-reverse;
  }
  .gutter {
    width: 2px;
    align-self: stretch;
    margin: 2rem 0;
    background: linear-gradient(
      to right,
      rgba(0, 0, 0, 0.22),
      rgba(0, 0, 0, 0.06) 45%,
      rgba(0, 0, 0, 0.22)
    );
  }
</style>
