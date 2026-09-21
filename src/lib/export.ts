/**
 * Marks -> Markdown.
 *
 * Pure, and free of DOM and store: it takes the annotations and the text under
 * them and returns a string, so `node --test` can reach every branch. Finding the
 * text under a mark is format-specific — page geometry for a PDF, a CFI range
 * for an EPUB — and lives in exporter.ts; everything here is shared.
 */

import { flattenPage } from './search.ts'
import type { Annotation, Quad, TextItem } from './types.ts'

/** Half a page unit either side: quads come from rounded DOM rects. */
const TOLERANCE = 0.5

/**
 * The text a highlight or underline sits on, from the page's positioned runs.
 *
 * Reuses `flattenPage`, so the joining rules are the ones search already relies
 * on: a word split across a line is whole again, and a run split mid-word is not
 * given a space it does not have. Each character is placed proportionally along
 * its run and kept if its centre is inside one of the mark's quads.
 *
 * That proportional placement is an approximation — the same one search makes,
 * and for the same reason: TextItem carries a run's width, not per-glyph
 * advances. The mark's own edges came from the browser's real glyph widths, so
 * a boundary can land a character or two off, and cutting a word in half is the
 * failure a reader would actually see. Hence `snapToWords`.
 */
export function markedText(items: TextItem[], quads: Quad[]): string {
  if (items.length === 0 || quads.length === 0) return ''

  const flat = flattenPage(items)
  let first = -1
  let last = -1

  for (let i = 0; i < flat.owners.length; i++) {
    const owner = flat.owners[i]
    if (owner < 0) continue // a joiner search invented: no glyph, no geometry

    const item = items[owner]
    const cx = item.quad.x + ((flat.offsets[i] + 0.5) / (item.str.length || 1)) * item.quad.w
    const cy = item.quad.y + item.quad.h / 2

    const inside = quads.some(
      (q) =>
        cx >= q.x - TOLERANCE &&
        cx <= q.x + q.w + TOLERANCE &&
        cy >= q.y - TOLERANCE &&
        cy <= q.y + q.h + TOLERANCE,
    )
    if (inside) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return ''

  const [a, b] = snapToWords(flat.text, first, last)
  return flat.text.slice(a, b + 1).replace(/\s+/g, ' ').trim()
}

/**
 * Move a range's edges to word boundaries, by majority.
 *
 * A boundary that lands inside a word takes the whole word if the range covers
 * more than half of it, and drops it otherwise. A mismatch of a character or two
 * therefore cannot leave half a word in, or drag a neighbour in: a five-letter
 * word the reader really did mark is covered at least 60% however the edge
 * drifts, and one the edge merely brushed is covered 40% at most.
 */
export function snapToWords(text: string, first: number, last: number): [number, number] {
  const isSpace = (i: number) => /\s/.test(text[i])
  const wordAt = (i: number): [number, number] => {
    let s = i
    let e = i
    while (s > 0 && !isSpace(s - 1)) s--
    while (e < text.length - 1 && !isSpace(e + 1)) e++
    return [s, e]
  }

  // A range with no word IN it has no word to snap to. Left as found, it reads
  // back as empty rather than quoting a neighbour the mark never touched.
  if (!/\S/.test(text.slice(first, last + 1))) return [first, last]

  if (isSpace(first)) first += text.slice(first).search(/\S/)
  if (isSpace(last)) {
    while (last > first && isSpace(last)) last--
  }

  const [fs, fe] = wordAt(first)
  const [ls, le] = wordAt(last)

  // One word, however much of it was touched: it is the mark's whole content.
  if (fs === ls) return [fs, fe]

  const startCoverage = (fe - first + 1) / (fe - fs + 1)
  const endCoverage = (last - ls + 1) / (le - ls + 1)

  let a = startCoverage >= 0.5 ? fs : fe + 1
  let b = endCoverage >= 0.5 ? le : ls - 1
  while (a <= b && isSpace(a)) a++
  while (b >= a && isSpace(b)) b--
  return a <= b ? [a, b] : [fs, le]
}

/** The topmost edge of a mark, in page units; drawings have none we can name. */
function top(a: Annotation): number {
  if (a.quads?.length) return Math.max(...a.quads.map((q) => q.y + q.h))
  if (a.box) return a.box.y + a.box.h
  return -Infinity
}

function left(a: Annotation): number {
  if (a.quads?.length) return Math.min(...a.quads.map((q) => q.x))
  return a.box?.x ?? 0
}

/**
 * Reading order for a paged document: by page, then top to bottom, then left to
 * right. Page units grow UPWARD, so "top to bottom" is descending y. Drawings
 * have no line to sit on and go last on their page.
 */
export function pagedOrder(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort(
    (a, b) => a.pageIndex - b.pageIndex || top(b) - top(a) || left(a) - left(b),
  )
}

export interface ExportMark {
  annotation: Annotation
  /** The text the mark sits on. Empty for a free note or a drawing. */
  text: string
}

export interface MarkdownInput {
  title: string
  exportedAt: Date
  /** Already in reading order. */
  marks: ExportMark[]
  /** "Page 3", or an EPUB chapter. */
  groupLabel: (pageIndex: number) => string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Backslash-escape what Markdown would otherwise read as formatting.
 *
 * The marked text is prose lifted from somebody else's document, so a stray `*`
 * or `_` in it is far likelier to be literal than emphasis. A leading `#` would
 * turn a quoted line into a heading.
 */
export function escapeMarkdown(s: string): string {
  return s.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^#/, '\\#')
}

export function buildMarkdown(input: MarkdownInput): string {
  const { marks } = input
  const count = (type: Annotation['type']) =>
    marks.filter((m) => m.annotation.type === type).length

  const summary = [
    [count('highlight'), 'highlight'],
    [count('underline'), 'underline'],
    [count('note'), 'note'],
    [count('ink'), 'drawing'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => plural(n as number, word as string))
    .join(', ')

  const out: string[] = [
    `# ${escapeMarkdown(input.title)}`,
    '',
    `*Marks exported from ReadInt on ${input.exportedAt.toISOString().slice(0, 10)}` +
      (summary ? ` \u2014 ${summary}` : '') +
      '*',
  ]

  let group: number | null = null
  let drawings = 0
  const flushDrawings = () => {
    if (drawings > 0) {
      out.push('', `*${plural(drawings, 'freehand drawing')} here, not included in this export.*`)
    }
    drawings = 0
  }

  for (const { annotation: a, text } of marks) {
    if (a.pageIndex !== group) {
      flushDrawings()
      group = a.pageIndex
      out.push('', `## ${escapeMarkdown(input.groupLabel(a.pageIndex))}`)
    }

    if (a.type === 'ink') {
      drawings++
      continue
    }

    if (a.type === 'note' && !text) {
      // A free note on a PDF: its own words are the whole content.
      out.push('', noteLine(a.text))
      continue
    }

    const quoted = text
      ? escapeMarkdown(text) + (a.type === 'underline' ? ' *(underlined)*' : '')
      : '*(the marked text could not be extracted)*'
    out.push('', `> ${quoted}`)

    // A note that IS anchored to text (an EPUB note) reads as a reply to it.
    if (a.type === 'note') out.push('', noteLine(a.text))
  }
  flushDrawings()

  return out.join('\n') + '\n'
}

function noteLine(text: string | undefined): string {
  const body = (text ?? '').trim()
  if (!body) return '**Note:** *(empty)*'
  // Continuation lines are indented so a multi-line note stays one paragraph.
  return `**Note:** ${escapeMarkdown(body).replace(/\n+/g, '  \n')}`
}

/** A safe filename stem: the document's name, minus its extension and any path characters. */
export function exportName(docName: string, suffix: string): string {
  const stem = docName.replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim()
  return `${stem || 'document'}${suffix}`
}
