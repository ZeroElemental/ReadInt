/**
 * OCR output -> TextItem[], which is the whole trick.
 *
 * Invariant 2 says nothing downstream may learn that a page was OCR'd. That
 * only holds if the conversion lands in exactly the same space the native path
 * produces, so this does NOT do its own arithmetic: a tesseract box is already
 * a rect in raster pixels measured down from the top-left, which is precisely
 * what `ScreenRect` means. Divide by the raster scale to get scale-1 CSS px and
 * `screenToQuad` supplies page units — including the y-flip and any page
 * rotation — from the same code the selection path uses.
 *
 * Pure and free of browser globals on purpose: this is the piece a test can
 * reach under `node --test`. The worker lives in ocr.svelte.ts.
 */

import { screenToQuad, type ViewportLike } from './coords.ts'
import type { TextItem } from './types.ts'

/**
 * The slice of tesseract's result we depend on, declared structurally so
 * neither this module nor its test has to load tesseract.js.
 */
export interface OcrWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}
export interface OcrLine {
  words: OcrWord[]
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Lines come from tesseract's own layout analysis rather than from
 * `groupByLine`, and that is deliberate. groupByLine clusters baselines with a
 * 1.5pt tolerance, which is right for a digital PDF where a line's baseline is
 * exact; an OCR'd scan has baselines that wobble with the paper, the skew and
 * the binarisation, and at 216dpi that wobble clears 1.5pt easily. Tesseract
 * already decided which words share a line, with far more evidence than a
 * y-coordinate. Ids ascend in reading order, which is what `lineBoxes` and
 * search.ts's line-break rule need.
 */
export function linesToTextItems(
  lines: OcrLine[],
  rasterScale: number,
  vp: ViewportLike,
): TextItem[] {
  const items: TextItem[] = []

  lines.forEach((line, lineId) => {
    // The word's OWN box horizontally, the LINE's vertically.
    //
    // A word's ink box is as tall as that word happens to be, so `system`
    // reaches lower than `coordinate` and the two sit 3pt apart. pdf.js does
    // not work that way — it reports a run's height as the font's, uniform
    // along a line — and downstream code is built on that. With ragged boxes,
    // groupByLine reads one line as several, so a highlight over a phrase
    // comes back as a row of uneven tiles with the spaces left white instead
    // of one stroke of a marker. Taking the vertical extent from the line is
    // what makes OCR output the same SHAPE, not merely the same type.
    const top = line.bbox.y0 / rasterScale
    const height = (line.bbox.y1 - line.bbox.y0) / rasterScale

    for (const word of line.words) {
      // Tesseract emits empty and whitespace-only boxes on noise. They would
      // be unselectable spans and phantom search positions.
      if (!word.text.trim()) continue

      const { x0, x1 } = word.bbox
      items.push({
        str: word.text,
        quad: screenToQuad(
          {
            left: x0 / rasterScale,
            top,
            width: (x1 - x0) / rasterScale,
            height,
          },
          vp,
        ),
        lineId,
      })
    }
  })

  return items
}

/**
 * Walk a tesseract page down to its lines.
 *
 * `data.words` was removed as a top-level convenience; words now live nested
 * under blocks -> paragraphs -> lines, and `blocks` is null when the page is
 * blank rather than an empty array.
 */
export function pageLines(page: {
  blocks?: { paragraphs: { lines: OcrLine[] }[] }[] | null
}): OcrLine[] {
  return (page.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  )
}
