<script lang="ts">
  /**
   * In-document search over cached page text. No index library: a few hundred
   * pages of plain text scan in single-digit milliseconds.
   *
   * Normalisation is the part that actually matters — case, diacritics,
   * ligatures, and hyphenation at a line break, so "under-\nstand" is found by
   * searching "understand".
   *
   * STATUS: skeleton — Phase 4.
   */

  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  let query = $state('')
  let hits = $state<{ pageIndex: number; snippet: string }[]>([])
  let input = $state<HTMLInputElement | null>(null)

  // Focused on mount rather than via the autofocus attribute, so it only steals
  // focus when the user actually opened the panel.
  $effect(() => input?.focus())

  // TODO(phase-4): scan cached PageTextRecord rows, map hits back to quads.
</script>

<aside class="search">
  <header>
    <input
      bind:this={input}
      bind:value={query}
      placeholder="Search this document"
      aria-label="Search this document"
    />
    <button onclick={onclose} aria-label="Close search">×</button>
  </header>

  {#if query && !hits.length}
    <p class="muted">No matches.</p>
  {/if}

  <ul>
    {#each hits as hit (hit.pageIndex + hit.snippet)}
      <li><button>p.{hit.pageIndex + 1} — {hit.snippet}</button></li>
    {/each}
  </ul>
</aside>

<style>
  .search {
    position: fixed;
    top: 4rem;
    right: 1rem;
    z-index: 15;
    width: 20rem;
    max-height: 70dvh;
    overflow: auto;
    padding: 0.75rem;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 10px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.2);
  }
  header {
    display: flex;
    gap: 0.4rem;
  }
  input {
    flex: 1;
    font: inherit;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
  }
  header button {
    border: none;
    background: none;
    font-size: 1.2rem;
    cursor: pointer;
    line-height: 1;
  }
  ul {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
  }
  ul button {
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.4rem;
    border: none;
    border-radius: 5px;
    background: none;
    cursor: pointer;
  }
  ul button:hover {
    background: var(--raise);
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
