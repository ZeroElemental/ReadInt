/**
 * The original PDF, with the reader's marks drawn onto its pages.
 *
 * The file is LOADED and MODIFIED, not re-rendered, which is the whole reason
 * this uses pdf-lib rather than the no-dependency route of rasterising each page
 * and wrapping the images: that would have thrown away the text layer, leaving an
 * export that could not be searched or selected. Here a native PDF keeps every
 * word it had; a scan keeps exactly what it had, which is pixels.
 *
 * No coordinate conversion happens, and that is not luck. Marks are stored in
 * page units — PDF user space, origin bottom-left, y up (invariant 1) — and that
 * is precisely the space pdf-lib draws in. The same rule that lets a highlight
 * survive a zoom lets it land on the right glyphs in a different reader.
 *
 * pdf-lib is reached ONLY through `await import()`, like every other heavy
 * dependency here: it costs nothing until someone clicks Export.
 */

import type { Annotation } from './types.ts'

/** A highlight is drawn multiplied, as it is on screen, so the glyphs show through. */
const HIGHLIGHT_OPACITY = 0.4
const UNDERLINE_DEFAULT = 1.5
const NOTE_FONT = 11
const NOTE_PAD = 6

/**
 * Negate every y in an ink path.
 *
 * Ink is stored as `M x y Q x y x y … Z` in PDF user space (y up). pdf-lib's
 * `drawSvgPath` expects SVG space (y down) and flips it back on the way in, so
 * feeding it our coordinates as they are would mirror every stroke. Numbers in
 * that path are always x/y pairs — only absolute M and Q are ever emitted — so
 * the odd-numbered ones are the y's.
 */
export function flipPath(path: string): string {
  let n = 0
  return path
    .split(/\s+/)
    .map((tok) => {
      if (tok === '' || Number.isNaN(Number(tok))) return tok
      const isY = n++ % 2 === 1
      return isY ? String(-Number(tok) || 0) : tok
    })
    .join(' ')
}

/** `#rrggbb` or `#rgb` -> 0..1 channels. Anything else falls back to highlighter yellow. */
export function parseColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 0.88, 0.4]
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}

/** Greedy word wrap against a measuring function; a word wider than the line stays whole. */
export function wrapText(
  text: string,
  maxWidth: number,
  width: (s: string) => number,
): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && width(next) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

export async function annotatedPdf(source: Blob, annotations: Annotation[]): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb, BlendMode } = await import('pdf-lib')

  // updateMetadata off: exporting should not rewrite the file's Producer and
  // ModDate as though it had been authored here.
  const doc = await PDFDocument.load(await source.arrayBuffer(), { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  /**
   * A standard font is WinAnsi: it throws on a character outside it, and a
   * reader's note can be in any script. Swapped for '?' one character at a time
   * so one stray glyph does not cost the whole note.
   */
  const encodable = (s: string) =>
    [...s]
      .map((ch) => {
        try {
          font.encodeText(ch)
          return ch
        } catch {
          return '?'
        }
      })
      .join('')

  for (const a of annotations) {
    const page = pages[a.pageIndex]
    if (!page) continue
    const [r, g, b] = parseColor(a.color)
    const color = rgb(r, g, b)

    if (a.type === 'highlight') {
      for (const q of a.quads ?? []) {
        page.drawRectangle({
          x: q.x, y: q.y, width: q.w, height: q.h,
          color, opacity: HIGHLIGHT_OPACITY, blendMode: BlendMode.Multiply,
        })
      }
    } else if (a.type === 'underline') {
      for (const q of a.quads ?? []) {
        page.drawLine({
          start: { x: q.x, y: q.y },
          end: { x: q.x + q.w, y: q.y },
          thickness: a.thickness ?? UNDERLINE_DEFAULT,
          color,
        })
      }
    } else if (a.type === 'ink' && a.path) {
      page.drawSvgPath(flipPath(a.path), { x: 0, y: 0, color, borderWidth: 0 })
    } else if (a.type === 'note' && a.box) {
      const { x, y, w, h } = a.box
      page.drawRectangle({ x, y, width: w, height: h, color, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.5 })

      const lineHeight = NOTE_FONT * 1.35
      const lines = wrapText(
        encodable(a.text ?? ''),
        w - NOTE_PAD * 2,
        (s) => font.widthOfTextAtSize(s, NOTE_FONT),
      )
      // As many lines as fit; the box is the reader's, and text past its edge
      // would be drawn over the page rather than inside the note.
      const fit = Math.max(1, Math.floor((h - NOTE_PAD * 2) / lineHeight))
      lines.slice(0, fit).forEach((line, i) => {
        page.drawText(line, {
          x: x + NOTE_PAD,
          y: y + h - NOTE_PAD - NOTE_FONT - i * lineHeight,
          size: NOTE_FONT,
          font,
          color: rgb(0.1, 0.1, 0.1),
        })
      })
    }
  }

  const bytes = await doc.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
