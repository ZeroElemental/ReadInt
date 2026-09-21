/**
 * EPUB via epub.js.
 *
 * This is NOT a `DocAdapter`, and that is the point of Phase 6. `DocAdapter` is
 * the fixed-layout contract: a viewport, a rasterised page, positioned text in
 * page units. Reflowable text has none of those — a "page" is a column epub.js
 * computes from the window size and the font size, and recomputes when either
 * changes. Pretending to implement that interface is what the old stub did, by
 * throwing from every method.
 *
 * So the shell branches once, on format, and invariant 2 narrows to what is
 * still true and still load-bearing: the shell never knows which *paged* format
 * it is reading. A scan and a digital PDF share every layer; an EPUB shares the
 * toolbar, the save contract and the search box, and nothing below them.
 *
 * epub.js is reached ONLY through `await import()`, exactly like pdf.js and
 * tesseract. A static import anywhere pulls it into the entry chunk.
 */

import type { Book, NavItem, Rendition } from 'epubjs'
import type { RenditionOptions } from 'epubjs/types/rendition'
import type Section from 'epubjs/types/section'
import { flattenSection, locate, type NodeLike } from '../lib/epub-search.ts'
import { findAll, sentenceAround } from '../lib/search.ts'

/**
 * Characters per generated location. epub.js's own default; smaller means a
 * finer progress percentage and a slower first open.
 */
const LOCATION_CHARS = 1024

/** Characters of context either side of a hit, matching SearchPanel's SNIPPET. */
const SNIPPET = 90

export interface EpubHit {
  /** Spine index. Ordering only — there is no page to turn to. */
  sectionIndex: number
  cfi: string
  snippet: string
}

export class EpubAdapter {
  private book: Book
  /** The table of contents, flat enough for a `<select>`; epub.js nests it. */
  readonly toc: NavItem[]
  /** epub.js's own CFI comparator, for putting marks in reading order. */
  private cfi: { compare(a: string, b: string): number }

  private constructor(book: Book, toc: NavItem[], cfi: { compare(a: string, b: string): number }) {
    this.book = book
    this.toc = toc
    this.cfi = cfi
  }

  static async open(file: Blob): Promise<EpubAdapter> {
    const ePub = (await import('epubjs')).default
    const book = ePub(await file.arrayBuffer())
    await book.ready
    const nav = await book.loaded.navigation
    // Reached through the default export because that is the one epub.js
    // guarantees; its typings do not declare `CFI` on it.
    const CFI = (ePub as unknown as { CFI: new () => { compare(a: string, b: string): number } }).CFI
    return new EpubAdapter(book, flattenToc(nav.toc), new CFI())
  }

  /** Reading order between two CFIs: negative when `a` comes first. */
  compareCfi(a: string, b: string): number {
    return this.cfi.compare(a, b)
  }

  /**
   * The text a CFI range covers, for export.
   *
   * Empty on any failure rather than throwing: one mark whose section will not
   * load should cost that mark's quotation, not the rest of the export.
   */
  async textOf(cfiRange: string): Promise<string> {
    try {
      const range = await this.book.getRange(cfiRange)
      return range?.toString().replace(/\s+/g, ' ').trim() ?? ''
    } catch {
      return ''
    }
  }

  /**
   * Hand epub.js an element and let it own what happens inside.
   *
   * `flow: 'paginated'` with `spread: 'auto'` gives two columns at a readable
   * width and one when the window is narrow — which is the same decision the
   * PDF path makes with its spread setting, arrived at by epub.js rather than
   * by us.
   */
  renderTo(el: HTMLElement, options: Partial<RenditionOptions> = {}): Rendition {
    return this.book.renderTo(el, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'auto',
      // epub.js defaults this off, and with it off an EPUB whose own scripts
      // are inert still renders; leaving it off is also one less thing running
      // from a file the reader dropped in.
      allowScriptedContent: false,
      ...options,
    })
  }

  /**
   * The locations index, serialised.
   *
   * Generating it parses every section in the book, so the caller passes back
   * whatever it stored last time and this reloads rather than recomputes. The
   * return value is always what should be persisted.
   */
  async locations(cached?: string): Promise<string> {
    if (cached) {
      this.book.locations.load(cached)
      return cached
    }
    await this.book.locations.generate(LOCATION_CHARS)
    return this.book.locations.save()
  }

  /** How far through the book a CFI sits, 0..1. Needs `locations` first. */
  percentage(cfi: string): number {
    try {
      return this.book.locations.percentageFromCfi(cfi) || 0
    } catch {
      // An index that failed to generate should cost a progress readout, not
      // the ability to read the book.
      return 0
    }
  }

  /** The chapter a CFI falls in, by spine index, for the progress readout. */
  chapterAt(sectionIndex: number): string {
    const section = this.book.spine.get(sectionIndex)
    const href = section?.href
    const item = href
      ? this.toc.find((t) => t.href === href || t.href.split('#')[0] === href)
      : undefined
    return item?.label.trim() ?? ''
  }

  /**
   * Search one section.
   *
   * The interesting half is what is NOT here: folding, matching and the context
   * sentence are search.ts's, unchanged, shared with the PDF path. This only
   * supplies the two ends — a section's DOM flattened to a string on the way
   * in, and a DOM Range turned into a CFI on the way out.
   */
  async searchSection(sectionIndex: number, query: string): Promise<EpubHit[]> {
    const section = this.book.spine.get(sectionIndex) as Section | undefined
    if (!section) return []

    // `load` wants the book's own request function. Its typing says Document;
    // it actually resolves to `documentElement` — the <html> ELEMENT — which
    // has no `createRange`. The owning document is where that lives.
    const root = (await section.load(
      this.book.load.bind(this.book),
    )) as unknown as Element
    const doc = root.ownerDocument
    if (!doc) return []

    try {
      // Walking from <html> takes in <head> too; SKIP drops it, along with
      // anything else that is markup rather than prose.
      const flat = flattenSection(root as unknown as NodeLike)
      const hits: EpubHit[] = []

      for (const { start, end } of findAll(flat.text, query)) {
        const a = locate(flat, start)
        const b = locate(flat, end, 'end')
        if (!a || !b) continue

        const range = doc.createRange()
        range.setStart(a.node as unknown as Node, a.offset)
        range.setEnd(b.node as unknown as Node, b.offset)

        hits.push({
          sectionIndex,
          cfi: section.cfiFromRange(range),
          snippet: sentenceAround(flat.text, start, end, SNIPPET),
        })
      }
      return hits
    } finally {
      // Every section of a long book gets loaded during a scan; holding all of
      // their documents is how a search turns into a memory problem.
      section.unload()
    }
  }

  /** Spine indices in reading order, for a scan to walk. */
  sectionIndices(): number[] {
    const out: number[] = []
    this.book.spine.each((s: Section) => out.push(s.index))
    return out
  }

  destroy(): void {
    this.book.destroy()
  }
}

/**
 * epub.js nests the TOC; a chapter list does not need the tree.
 *
 * Depth is kept as indentation in the label so a subsection still reads as one,
 * which is cheaper than a nested menu and loses nothing a reader uses.
 */
function flattenToc(items: NavItem[], depth = 0): NavItem[] {
  return items.flatMap((item) => [
    { ...item, label: `${'  '.repeat(depth)}${item.label.trim()}` },
    ...flattenToc(item.subitems ?? [], depth + 1),
  ])
}
