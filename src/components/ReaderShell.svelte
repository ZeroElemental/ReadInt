<script lang="ts">
  /**
   * The book. Two leaves, a gutter, and a perspective so the spread curves.
   * Owns geometry and input; knows nothing about PDF vs EPUB.
   */
  import {
    reader,
    acceptDraft,
    annotationsSnapshot,
    focusedPage,
    markSaved,
    setZoom,
    turnPage,
    watchDevicePixelRatio,
  } from '../lib/reader.svelte.ts'
  import { handleKey } from '../lib/keys.ts'
  import { discardDraft, putDraft, saveAnnotations, touchDocument } from '../lib/storage.ts'
  import PageView from './PageView.svelte'
  import Toolbar from './Toolbar.svelte'
  import SearchPanel from './SearchPanel.svelte'
  import DefinitionPopup from './DefinitionPopup.svelte'

  const TURN_MS = 280
  /** Autosave cadence. Writes a DRAFT, never the saved state — invariant 6. */
  const DRAFT_MS = 30_000
  /** Matches the 2rem padding on .book, top and bottom. */
  const BOOK_PADDING = 64

  let searchOpen = $state(false)
  let turning = $state<'fwd' | 'back' | null>(null)
  let book = $state<HTMLDivElement | null>(null)

  const rtl = $derived(reader.settings.readingDirection === 'rtl')
  const focused = $derived(focusedPage())

  $effect(() => watchDevicePixelRatio())

  /**
   * Fit the spread to the window once per document. At scale 1 an A4 spread is
   * ~1190px wide and would open scrolled off the screen.
   */
  $effect(() => {
    const adapter = reader.adapter
    if (!adapter) return
    let stale = false
    adapter.getViewport(0).then((v) => {
      if (stale || v.height <= 0) return
      const avail = (book?.clientHeight ?? window.innerHeight) - BOOK_PADDING
      setZoom(avail / v.height)
    })
    return () => {
      stale = true
    }
  })

  // Where you stopped reading, remembered without a save.
  $effect(() => {
    const id = reader.docId
    const page = reader.spreadStart
    if (id) void touchDocument(id, { lastPageIndex: page })
  })

  /** Every turn goes through here so keyboard and toolbar animate alike. */
  let timer: ReturnType<typeof setTimeout> | undefined
  function turn(delta: number) {
    const before = reader.spreadStart
    turnPage(delta)
    if (reader.spreadStart === before) return // already at an end
    turning = delta > 0 ? 'fwd' : 'back'
    clearTimeout(timer)
    timer = setTimeout(() => (turning = null), TURN_MS)
  }

  $effect(() => () => clearTimeout(timer))

  let saving = $state(false)

  async function save() {
    const id = reader.docId
    if (!id || saving) return
    saving = true
    try {
      // Snapshotted before the await: the user can keep marking while it writes,
      // and Dexie needs plain objects rather than Svelte's reactive proxies.
      const marks = annotationsSnapshot()
      const gone = [...reader.deletedIds]
      await saveAnnotations(id, marks, gone)
      markSaved()
    } catch (err) {
      console.error('save failed', err)
      // Deliberately NOT clearing dirty: a failed save must keep saying unsaved.
    } finally {
      saving = false
    }
  }

  /**
   * The 30s autosave. It writes to the drafts table, which is never merged into
   * the saved state on its own — otherwise "saved" would stop meaning anything.
   */
  $effect(() => {
    const id = reader.docId
    if (!id) return
    const timer = setInterval(() => {
      if (reader.dirty) void putDraft(id, annotationsSnapshot())
    }, DRAFT_MS)
    return () => clearInterval(timer)
  })

  function dismissDraft() {
    const id = reader.docId
    reader.draft = null
    if (id) void discardDraft(id)
  }
</script>

<svelte:window
  onkeydown={(e) =>
    handleKey(e, {
      save,
      turn,
      search: () => (searchOpen = true),
      escape: () => (searchOpen = false),
    })}
/>

<div class="reader" class:rtl>
  <Toolbar onsave={save} onturn={turn} onsearch={() => (searchOpen = !searchOpen)} />

  {#if reader.draft}
    <div class="recover" role="status">
      <span>
        Unsaved marks from
        {new Date(reader.draft.savedAt).toLocaleString()}
        were recovered ({reader.draft.annotations.length}).
      </span>
      <button onclick={acceptDraft}>Restore them</button>
      <button onclick={dismissDraft}>Discard</button>
    </div>
  {/if}

  <div bind:this={book} class="book" data-turning={turning}>
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
    grid-template-rows: auto auto 1fr;
    background: var(--desk);
    overflow: hidden;
  }
  .book {
    display: flex;
    /* `safe` matters: a centred flex item that overflows its scroll container
       cannot otherwise be scrolled back to its start edge, so zooming past the
       window would put the top-left of the page permanently out of reach. */
    align-items: safe center;
    justify-content: safe center;
    overflow: auto;
    gap: 0;
    /* The curve that makes a flat screen read as a bound book. */
    perspective: 2400px;
    perspective-origin: center;
    padding: 2rem;
  }
  .rtl .book {
    flex-direction: row-reverse;
  }
  .recover {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #fff4d6;
    border-bottom: 1px solid var(--rule);
    font-size: 0.8rem;
  }
  .recover button {
    font: inherit;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
    cursor: pointer;
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

  /* The incoming leaf swings in on the gutter. Each keyframe set declares only
     `from` on purpose: the implicit `to` is the leaf's own resting transform,
     so a focused leaf lands on its scale and an unfocused one on its tilt,
     with no snap at the end. The transform-origins are already the hinges. */
  .book[data-turning='fwd'] :global(.page[data-side='left']) {
    animation: leaf-in-fwd 0.28s ease-out;
  }
  .book[data-turning='back'] :global(.page[data-side='right']) {
    animation: leaf-in-back 0.28s ease-out;
  }
  @keyframes leaf-in-fwd {
    from {
      transform: rotateY(76deg);
      opacity: 0;
    }
  }
  @keyframes leaf-in-back {
    from {
      transform: rotateY(-76deg);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .book[data-turning] :global(.page) {
      animation: none;
    }
  }
</style>
