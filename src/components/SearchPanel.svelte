<script lang="ts">
  /**
   * In-document search over cached page text. No index library: a few hundred
   * pages of plain text scan in single-digit milliseconds.
   *
   * Normalisation is the part that actually matters — case, diacritics,
   * ligatures, and hyphenation at a line break, so "under-\nstand" is found by
   * searching "understand". All of it lives in lib/search.ts, which is pure and
   * has its own tests; this file is the UI around it.
   *
   * The scan streams: hits appear page by page rather than after the last page,
   * because the first scan of a document is also what extracts its text. After
   * that `pageText` serves everything from Dexie and a re-search is instant.
   */
  import { untrack } from 'svelte'
  import { reader, clearSearch, goToHit } from '../lib/reader.svelte.ts'
  import { pageText } from '../adapters/index.ts'
  import type { DocAdapter } from '../adapters/index.ts'
  import { findAll, flattenPage, hitQuads, sentenceAround } from '../lib/search.ts'

  interface Props {
    onclose: () => void
    /** Seeded by the definition popup's "Find in document". */
    seed?: string
  }
  let { onclose, seed = '' }: Props = $props()

  /** Long enough that typing a word is one scan, not six. */
  const DEBOUNCE_MS = 150
  /** Characters of context either side of a hit in the results list. */
  const SNIPPET = 90

  // Deliberately the INITIAL value only — the box is the user's from then on.
  // ReaderShell remounts this panel when it wants to seed a different term.
  let query = $state(untrack(() => seed))
  /** The page being scanned right now; -1 when idle. */
  let scanning = $state(-1)
  let input = $state<HTMLInputElement | null>(null)

  // Focused on mount rather than via the autofocus attribute, so it only steals
  // focus when the user actually opened the panel. Selected, not just focused:
  // a seeded query should be replaceable by typing.
  $effect(() => {
    input?.focus()
    input?.select()
  })

  // Hits belong to the query, and the query dies with the panel.
  $effect(() => () => clearSearch())

  /**
   * The cancel token. A newer query bumps it, and every in-flight page check
   * compares against it and drops its result. Not an AbortController — there is
   * no fetch here to abort, only a loop to stop caring about.
   */
  let generation = 0

  $effect(() => {
    const q = query.trim()
    const adapter = reader.adapter
    const docId = reader.docId
    const mine = ++generation

    clearSearch()
    scanning = -1
    if (!q || !adapter || !docId) return

    const timer = setTimeout(() => void scan(mine, adapter, docId, q), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })

  async function scan(mine: number, adapter: DocAdapter, docId: string, q: string) {
    for (let p = 0; p < reader.pageCount; p++) {
      if (mine !== generation) return
      scanning = p

      let items
      try {
        // Cached in Dexie after the first visit, so a re-search costs nothing.
        items = await pageText(adapter, docId, p)
      } catch (err) {
        console.error(`page ${p} text extraction failed`, err)
        continue
      }
      if (mine !== generation) return

      const flat = flattenPage(items)
      const found = findAll(flat, q)
      if (found.length === 0) continue

      reader.hits.push(
        ...found.map((r) => ({
          pageIndex: p,
          quads: hitQuads(items, flat, r.start, r.end),
          snippet: tidy(sentenceAround(flat.text, r.start, r.end, SNIPPET)),
        })),
      )
      // Jump to the first hit the way every reader does, but only the first:
      // later pages must not yank the reader off the result they are on.
      if (reader.activeHit === -1) goToHit(0)
    }
    if (mine === generation) scanning = -1
  }

  /**
   * Drop the half-words the character cap leaves at each end. Display only —
   * `sentenceAround` itself is the network boundary and stays untouched. Falls
   * back to the raw text when trimming would eat the whole snippet.
   */
  function tidy(snippet: string): string {
    const trimmed = snippet.replace(/^\S+\s+/, '').replace(/\s+\S+$/, '')
    return trimmed.length > 20 ? `…${trimmed}…` : snippet
  }

  function step(delta: number) {
    const n = reader.hits.length
    if (n === 0) return
    if (reader.activeHit < 0) return goToHit(delta > 0 ? 0 : n - 1)
    goToHit((reader.activeHit + delta + n) % n)
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      step(ev.shiftKey ? -1 : 1)
    }
  }
</script>

<aside class="search">
  <header>
    <input
      bind:this={input}
      bind:value={query}
      {onkeydown}
      placeholder="Search this document"
      aria-label="Search this document"
    />
    <button onclick={() => step(-1)} disabled={!reader.hits.length} aria-label="Previous match">
      ‹
    </button>
    <button onclick={() => step(1)} disabled={!reader.hits.length} aria-label="Next match">
      ›
    </button>
    <button onclick={onclose} aria-label="Close search">×</button>
  </header>

  <p class="status" role="status">
    {#if scanning >= 0}
      Searching p.{scanning + 1}… {reader.hits.length} so far
    {:else if query.trim() && !reader.hits.length}
      No matches.
    {:else if reader.hits.length}
      {reader.activeHit + 1} of {reader.hits.length}
    {/if}
  </p>

  <ul>
    {#each reader.hits as hit, i (i)}
      <li>
        <button class:current={i === reader.activeHit} onclick={() => goToHit(i)}>
          <span class="page">p.{hit.pageIndex + 1}</span>
          {hit.snippet}
        </button>
      </li>
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
    min-width: 0;
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
    padding: 0 0.25rem;
  }
  header button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .status {
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    min-height: 1rem;
  }
  ul {
    list-style: none;
    margin: 0.4rem 0 0;
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
  ul button.current {
    background: var(--raise);
    font-weight: 600;
  }
  .page {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    margin-right: 0.3rem;
  }
</style>
