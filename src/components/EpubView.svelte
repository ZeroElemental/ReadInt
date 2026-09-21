<script lang="ts">
  /**
   * The reflowable surface: one element epub.js renders its iframe into, and a
   * chapter/progress footer.
   *
   * Deliberately NOT a variant of PageView. That component is six layers over a
   * rasterised page, positioned in page units and scaled by one custom
   * property; none of it means anything here, where the "page" is a column
   * epub.js computes from the window size and the font size, and recomputes
   * when either changes.
   *
   * Invariant 4 — layer conflicts resolved by tool, not z-index — is not in
   * play either. There are no competing layers to route between: epub.js owns
   * the inside of the iframe, and the tool only decides what a selection MEANS
   * when one is made.
   *
   * Marks are drawn by epub.js's own annotations API rather than by us. It
   * reapplies them on every reflow, resize and font-size change for free;
   * rebuilding that from `getRange(cfi).getClientRects()` would buy the PDF's
   * marker look and cost us repaint correctness forever after.
   */
  import { onMount } from 'svelte'
  import {
    reader,
    addAnnotation,
    newAnnotation,
    removeAnnotation,
    updateAnnotation,
  } from '../lib/reader.svelte.ts'
  import { getDocument, touchDocument } from '../lib/storage.ts'
  import { flattenSection } from '../lib/epub-search.ts'
  import type { Annotation } from '../lib/types.ts'
  import type { Rendition } from 'epubjs'

  interface Props {
    /** Reflowable selections are invisible to the top document; hand them over. */
    ondefine: (
      term: string,
      rect: DOMRect,
      sectionText: string,
      sectionIndex: number,
      focus: boolean,
    ) => void
  }
  let { ondefine }: Props = $props()

  let host = $state<HTMLDivElement | null>(null)
  let rendition: Rendition | null = null
  /** Which spine item is showing, for annotations and search context. */
  let sectionIndex = $state(0)
  /** Non-null while the locations index is being built on first open. */
  let indexing = $state(false)
  /**
   * The note being edited, if any.
   *
   * A PDF note is a box dragged onto a point on the page. There is no such
   * point here — the text moves — so a note anchors to a RANGE, shows as a
   * marker in the prose, and opens in a popover keyed to that marker.
   */
  let editing = $state<{ id: string; text: string; x: number; y: number } | null>(null)
  let noteBox = $state<HTMLTextAreaElement | null>(null)

  // Focus follows the editor. It opens in response to a selection made inside
  // the iframe, so focus is left on <body>: a keyboard or screen-reader user
  // would have no way to know a dialog appeared, let alone reach it. Keyed on
  // the note's id so it fires when an editor OPENS, not on every keystroke.
  $effect(() => {
    if (editing?.id) noteBox?.focus()
  })

  const epub = $derived(reader.epub)

  /**
   * Marks already applied to the rendition, by annotation id.
   *
   * epub.js keys its own annotations by CFI and type, so re-adding one is not
   * idempotent — it stacks. This is what makes reapplying after a chapter
   * change safe.
   */
  const applied = new Set<string>()

  let settle: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    let dead = false
    let teardown: (() => void) | undefined

    void (async () => {
      const book = reader.epub
      const el = host
      const rec = reader.docId
      if (!book || !el || !rec) return

      const view = book.renderTo(el)
      if (dead) return
      rendition = view


      // Where we stopped, or the beginning. A CFI rather than a page index
      // because it survives a font-size change, which is the whole argument
      // for CFIs in the first place.
      const saved = await getDocument(rec)
      if (dead) return

      await view.display(saved?.lastCfi ?? undefined)
      if (dead) return

      view.on('relocated', onRelocated)
      view.on('rendered', onRendered)
      view.on('selected', onSelected)

      teardown = () => {
        view.off('relocated', onRelocated)
        view.off('rendered', onRendered)
        view.off('selected', onSelected)
        view.destroy()
      }

      // The index parses every section, so it is paid once and read back from
      // Dexie after that — the pattern Phase 5 established for OCR.
      indexing = !saved?.locations
      try {
        const serialised = await book.locations(saved?.locations)
        if (!dead && !saved?.locations) {
          await touchDocument(rec, { locations: serialised })
        }
      } catch (err) {
        // A missing index costs a progress percentage, not the book.
        console.error('locations index failed', err)
      } finally {
        if (!dead) indexing = false
      }
    })()

    return () => {
      dead = true
      clearTimeout(settle)
      teardown?.()
      rendition = null
    }
  })

  /** epub.js reports where it landed after every turn, jump and reflow. */
  function onRelocated(location: { start: { cfi: string; index: number } }) {
    const book = reader.epub
    const cfi = location?.start?.cfi
    if (!book || !cfi) return

    sectionIndex = location.start.index
    reader.epubAt = {
      cfi,
      percentage: book.percentage(cfi),
      chapter: book.chapterAt(location.start.index),
    }
    // Position is bookkeeping, not document data — persisted as you read,
    // exactly like `lastPageIndex` on the paged path, and never part of a save.
    if (reader.docId) void touchDocument(reader.docId, { lastCfi: cfi })

    redraw()
  }

  /**
   * Recompute the marks on the section in view.
   *
   * epub.js repaints its marks pane when the VIEW resizes — but a font-size
   * change reflows the content INSIDE a view that is exactly the same size, so
   * the pane keeps the rectangles it measured at the old size. Measured: after
   * two zoom steps a highlight sat 656px left and 39px above the words it
   * marks, at the old width. Removing and re-adding forces the rects to be
   * derived from the CFI again, which is the only thing that is still true.
   *
   * Hung on `relocated` because that is what fires once a reflow has settled,
   * whatever caused it. Scoped to the current section so a page turn costs a
   * couple of operations rather than one per mark in the book.
   */
  function redraw() {
    if (!rendition) return
    for (const a of reader.annotations) {
      if (!a.cfi || a.pageIndex !== sectionIndex || !applied.has(a.id)) continue
      rendition.annotations.remove(a.cfi, a.type === 'note' ? 'mark' : a.type)
      applied.delete(a.id)
      apply(a)
    }
  }

  /** A newly rendered section carries none of our marks until we put them back. */
  function onRendered() {
    for (const a of reader.annotations) apply(a)
  }

  /**
   * A selection inside the iframe.
   *
   * Which tool is live decides what it means — a mark, or a lookup — and that
   * is the same rule the text layer follows on the paged path (invariant 4's
   * reasoning, if not its mechanism).
   */
  function onSelected(cfiRange: string, contents: { window: Window }) {
    const tool = reader.tool
    if (tool === 'highlight' || tool === 'underline') {
      const mark = newAnnotation(tool, sectionIndex, {
        cfi: cfiRange,
        color:
          tool === 'highlight'
            ? reader.settings.highlightColor
            : reader.settings.inkColor,
      })
      addAnnotation(mark)
      apply(mark)
      contents.window.getSelection()?.removeAllRanges()
      return
    }

    if (tool === 'note') {
      const sel = contents.window.getSelection()
      // Measured before the selection is cleared, or there is nothing to
      // measure.
      const inner = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
      const note = newAnnotation('note', sectionIndex, {
        cfi: cfiRange,
        text: '',
        color: reader.settings.highlightColor,
      })
      addAnnotation(note)
      apply(note)
      sel?.removeAllRanges()
      openNote(note, contents, inner)
      return
    }

    if (tool !== 'select') return
    void define(cfiRange, contents)
  }

  /**
   * A rect measured inside the iframe, expressed in OUR viewport.
   *
   * `getBoundingClientRect` in there is relative to the iframe's own viewport;
   * every piece of chrome we position — the note editor, the definition card —
   * lives out here. Forgetting the offset puts them near the top-left corner of
   * the window and looks like a positioning bug rather than a coordinate one.
   */
  function viewportRect(contents: { window: Window }, inner: DOMRect): DOMRect {
    const frame = (
      contents.window.frameElement as HTMLElement | null
    )?.getBoundingClientRect()
    return new DOMRect(
      inner.left + (frame?.left ?? 0),
      inner.top + (frame?.top ?? 0),
      inner.width,
      inner.height,
    )
  }

  /** Place the note editor over the text it marks. */
  function openNote(note: Annotation, contents: { window: Window }, inner: DOMRect | null) {
    const rect = inner ? viewportRect(contents, inner) : new DOMRect(0, 0, 0, 0)
    editing = { id: note.id, text: note.text ?? '', x: rect.left, y: rect.bottom }
  }

  /**
   * Hand a selection to the definition popup.
   *
   * The rect has to be translated out of the iframe: `getBoundingClientRect`
   * inside it is relative to ITS viewport, and the card is positioned against
   * ours. The section's text goes along so the popup can cut its own context
   * sentence — the 300-character cap stays that component's, because it is the
   * only thing in the app that talks off-device.
   */
  async function define(
    cfiRange: string,
    contents: { window: Window },
    focus = false,
  ) {
    const book = reader.epub
    const sel = contents.window.getSelection()
    const term = sel?.toString().replace(/\s+/g, ' ').trim()
    if (!book || !sel || !term || sel.rangeCount === 0) return

    const rect = viewportRect(contents, sel.getRangeAt(0).getBoundingClientRect())

    const doc = contents.window.document
    const text = flattenSection(doc.body ?? doc.documentElement).text
    ondefine(term, rect, text, sectionIndex, focus)
  }

  /**
   * The keyboard route in: define whatever is selected inside the iframe.
   * Its selection is invisible to the top document, which is why the shell
   * cannot just ask `getSelection()` the way it does for a PDF.
   */
  export function defineSelection() {
    const win = host?.querySelector('iframe')?.contentWindow
    if (win) void define('', { window: win }, true)
  }

  /** Draw one mark through epub.js, which then owns keeping it in place. */
  function apply(a: Annotation) {
    if (!rendition || !a.cfi || applied.has(a.id)) return

    if (a.type === 'note') {
      rendition.annotations.mark(a.cfi, { id: a.id }, (ev: MouseEvent) => {
        if (reader.tool === 'erase') {
          rendition?.annotations.remove(a.cfi!, 'mark')
          applied.delete(a.id)
          removeAnnotation(a.id)
          return
        }
        // Read the text from the STORE, not from the annotation this closure
        // captured. Svelte 5 state is a deep proxy: `addAnnotation` put a proxy
        // of `a` into the array and every later edit went to that, while this
        // closure still holds the plain object it was built from. Same trap as
        // the save bug in Phase 3, from the other direction.
        const live = reader.annotations.find((x) => x.id === a.id)
        editing = { id: a.id, text: live?.text ?? '', x: ev.clientX, y: ev.clientY }
      })
      applied.add(a.id)
      return
    }

    if (a.type !== 'highlight' && a.type !== 'underline') return

    const styles =
      a.type === 'highlight'
        ? { fill: a.color, 'fill-opacity': '0.35' }
        : { stroke: a.color, 'stroke-opacity': '0.9' }

    rendition.annotations[a.type](
      a.cfi,
      { id: a.id },
      // Erase is a click on the mark itself. There is no uniform hit layer to
      // build here — epub.js already owns the element.
      () => {
        if (reader.tool !== 'erase') return
        rendition?.annotations.remove(a.cfi!, a.type)
        applied.delete(a.id)
        removeAnnotation(a.id)
      },
      // undefined, not '': epub.js's class name is a DEFAULT PARAMETER, and an
      // empty string satisfies it, leaving the mark with `ref=""` and no class
      // to style or find it by.
      undefined,
      styles,
    )
    applied.add(a.id)
  }

  /**
   * Zoom means font size here, and that is the honest translation.
   *
   * An iframe cannot be rasterised to a canvas, so the magnifier's 1:1 blit has
   * nothing to blit. Making the text bigger and letting it reflow is what every
   * e-reader does, and the toolbar's existing −/+ already drive `reader.zoom`.
   */
  $effect(() => {
    const zoom = reader.zoom
    const view = rendition
    if (!view) return

    view.themes.fontSize(`${Math.round(zoom * 100)}%`)

    // ponytail: a timer, because epub.js offers no "reflow finished" signal.
    // `relocated` fires while the columns are still settling, so a redraw hung
    // on it re-measures the old layout; the iframe's box does not change size
    // either — only its scroll width — so a ResizeObserver sees nothing. If a
    // slow machine ever redraws too early, this is the number to raise.
    clearTimeout(settle)
    settle = setTimeout(redraw, 350)
  })

  /** A chosen search hit is a CFI; displaying it IS the navigation. */
  $effect(() => {
    const hit = reader.hits[reader.activeHit]
    if (hit?.cfi) void rendition?.display(hit.cfi)
  })

  /** Marks made or restored while a section is already on screen. */
  $effect(() => {
    for (const a of reader.annotations) apply(a)
  })

  export function turn(delta: number) {
    void (delta > 0 ? rendition?.next() : rendition?.prev())
  }

  function updateNote(text: string) {
    if (!editing) return
    editing.text = text
    updateAnnotation(editing.id, { text })
  }

  export function goToChapter(href: string) {
    void rendition?.display(href)
  }
</script>

<div class="epub">
  <div class="surface" bind:this={host}></div>

  {#if indexing}
    <p class="indexing" role="status">Indexing this book…</p>
  {/if}

  {#if editing}
    <!-- Escape closes it, as it does every other dialog here. The note is
         saved as you type, so closing loses nothing. -->
    <div
      class="note"
      style:left="{editing.x}px"
      style:top="{editing.y}px"
      role="dialog"
      aria-label="Note"
      tabindex="-1"
      onkeydown={(e) => e.key === 'Escape' && (editing = null)}
    >
      <textarea
        bind:this={noteBox}
        value={editing.text}
        oninput={(e) => updateNote(e.currentTarget.value)}
        placeholder="Note"
        aria-label="Note text"
      ></textarea>
      <button onclick={() => (editing = null)}>Done</button>
    </div>
  {/if}

  <footer>
    <select
      aria-label="Chapter"
      value=""
      onchange={(e) => {
        const href = e.currentTarget.value
        if (href) goToChapter(href)
        e.currentTarget.value = ''
      }}
    >
      <option value="">{reader.epubAt?.chapter || 'Contents'}</option>
      {#each epub?.toc ?? [] as item (item.id)}
        <option value={item.href}>{item.label}</option>
      {/each}
    </select>

    <span class="progress">
      {reader.epubAt ? `${Math.round(reader.epubAt.percentage * 100)}%` : '—'}
    </span>
  </footer>
</div>

<style>
  .epub {
    /*
     * ReaderShell's grid is `auto auto 1fr`, and the draft-recovery banner is
     * conditional — so without it this element auto-places into the second
     * `auto` row and has no height to give its child. A page of leaves has
     * intrinsic height and survives that; a rendition asked to fill its parent
     * collapses to nothing. Pin it to the 1fr row instead of depending on how
     * many siblings happen to be above it.
     */
    grid-row: 3;
    display: flex;
    flex-direction: column;
    /* Lets the surface shrink inside the row rather than overflowing it. */
    min-height: 0;
    width: min(64rem, 100%);
    height: 100%;
    margin: 0 auto;
    padding: 1.5rem 1rem;
    box-sizing: border-box;
  }
  .surface {
    flex: 1;
    min-height: 0;
    background: var(--paper);
    border-radius: 6px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
    overflow: hidden;
  }
  /*
   * A note's marker.
   *
   * epub.js creates this <a> with the IFRAME's document but appends it to the
   * view's wrapper in OURS, so a theme rule injected into the iframe never
   * reaches it — this has to be our stylesheet. `:global` because the element
   * is epub.js's and carries none of Svelte's scoping attributes. It has no
   * size of its own either; without this a note is invisible and the reader
   * has no way to know one is there.
   */
  .epub :global(a[ref='epubjs-mk']) {
    display: block;
    width: 9px;
    height: 9px;
    margin-left: -14px;
    border-radius: 50%;
    background: #e8a33d;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    text-decoration: none;
  }
  .note {
    position: fixed;
    z-index: 16;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: 15rem;
    padding: 0.5rem;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  }
  .note textarea {
    font: inherit;
    font-size: 0.8rem;
    min-height: 5rem;
    resize: vertical;
    border: 1px solid var(--rule);
    border-radius: 5px;
    padding: 0.35rem;
    background: transparent;
    color: inherit;
  }
  .note button {
    align-self: flex-end;
    font: inherit;
    font-size: 0.75rem;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--muted);
  }
  .indexing {
    margin: 0.5rem 0 0;
    text-align: center;
    color: var(--muted);
    font-size: 0.75rem;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.6rem 0 0;
  }
  select {
    font: inherit;
    font-size: 0.8rem;
    max-width: 18rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
    color: inherit;
  }
  .progress {
    color: var(--muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    min-width: 2.5rem;
    text-align: center;
  }
</style>
