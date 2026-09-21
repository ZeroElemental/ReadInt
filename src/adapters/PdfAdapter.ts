/**
 * PDF via pdf.js. Also covers scanned PDFs: if the native text layer comes back
 * near-empty the page is queued for OCR, and the OCR result is normalised into
 * the same TextItem shape so nothing downstream can tell the difference.
 *
 * pdf.js is reached through a dynamic import and nothing else. That keeps it in
 * its own bundle chunk (no vite.config entry needed) and keeps this module
 * importable under `node --test`, where the only pdf.js references are types.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { DocAdapter, PageGeometry, TextItemsResult } from './types.ts'
import type { Quad, TextItem } from '../lib/types.ts'
import { groupByLine } from '../lib/coords.ts'

/** Below this many characters, a page is almost certainly a scan. */
const SCANNED_CHAR_THRESHOLD = 20

/**
 * Raster resolution for OCR, as a multiple of page units. Page units are
 * 1/72in, so 3 is 216dpi — tesseract wants 150-300 and the cost is quadratic,
 * so this is the knob to turn if accuracy on real scans disappoints.
 */
const OCR_SCALE = 3

type RenderTask = ReturnType<PDFPageProxy['render']>

/**
 * A pdf.js text run's transform [a,b,c,d,e,f] -> a quad in page units.
 *
 * e,f is the baseline origin. (a,b) points along the run, (c,d) points up the
 * glyph body, and pdf.js gives `width`/`height` as lengths in those two
 * directions. Rotated runs are reduced to their axis-aligned box: enough for
 * selection, search and the band magnifier, and it keeps every consumer of
 * Quad free of an angle it would have to understand.
 */
export function textItemQuad(
  transform: number[],
  width: number,
  height: number,
): Quad {
  const [a, b, c, d, e, f] = transform

  // Unit vectors along the run and up the glyph body, each stretched to the
  // length pdf.js reports. A degenerate matrix (zero-scale text, which is
  // invisible but still selectable) falls back to the unrotated axes.
  const along = Math.hypot(a, b)
  const up = Math.hypot(c, d)
  const ux = along ? (a / along) * width : width
  const uy = along ? (b / along) * width : 0
  const vx = up ? (c / up) * height : 0
  const vy = up ? (d / up) * height : height

  const xs = [e, e + ux, e + vx, e + ux + vx]
  const ys = [f, f + uy, f + vy, f + uy + vy]
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export class PdfAdapter implements DocAdapter {
  readonly pageCount: number

  /** Promise-cached so concurrent layers share one getPage per index. */
  private pages = new Map<number, Promise<PDFPageProxy>>()
  /**
   * Keyed by canvas, not by page: the magnifier rasterises the SAME page into
   * its own hi-res canvas, and two renders only conflict when they target one
   * canvas. Keying by page index would have the magnifier cancel the visible
   * page out from under itself.
   */
  private renders = new WeakMap<HTMLCanvasElement, RenderTask>()
  private live = new Set<RenderTask>()

  // Field declared, not a parameter property: node --test strips types rather
  // than compiling them, and parameter properties emit code.
  private doc: PDFDocumentProxy

  private constructor(doc: PDFDocumentProxy) {
    this.doc = doc
    this.pageCount = doc.numPages
  }

  static async open(file: Blob): Promise<PdfAdapter> {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    if (!GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = (
        await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ).default
    }
    const doc = await getDocument({ data: await file.arrayBuffer() }).promise
    return new PdfAdapter(doc)
  }

  /** The one place 0-based page indices become pdf.js's 1-based numbers. */
  private page(pageIndex: number): Promise<PDFPageProxy> {
    let p = this.pages.get(pageIndex)
    if (!p) {
      p = this.doc.getPage(pageIndex + 1)
      this.pages.set(pageIndex, p)
    }
    return p
  }

  async getViewport(pageIndex: number): Promise<PageGeometry> {
    return (await this.page(pageIndex)).getViewport({ scale: 1 })
  }

  async renderPage(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<void> {
    const page = await this.page(pageIndex)

    // Cancel first: setting canvas.width below wipes whatever is on it, and a
    // render still writing into a resized canvas paints garbage.
    this.renders.get(canvas)?.cancel()

    const dpr = window.devicePixelRatio || 1
    const device = page.getViewport({ scale: scale * dpr })
    const css = page.getViewport({ scale })

    canvas.width = Math.round(device.width)
    canvas.height = Math.round(device.height)
    canvas.style.width = `${css.width}px`
    canvas.style.height = `${css.height}px`

    const task = page.render({ canvas, viewport: device })
    this.renders.set(canvas, task)
    this.live.add(task)
    try {
      await task.promise
    } catch (err) {
      // The exception class comes from the dynamic import, so match on name.
      if ((err as Error)?.name !== 'RenderingCancelledException') throw err
    } finally {
      this.live.delete(task)
      if (this.renders.get(canvas) === task) this.renders.delete(canvas)
    }
  }

  async getTextItems(pageIndex: number): Promise<TextItemsResult> {
    const page = await this.page(pageIndex)
    const { items } = await page.getTextContent()

    // TextMarkedContent entries have no `str`; empty runs would be unselectable
    // spans. Whitespace runs are kept — selection needs them to yield spaces.
    const runs = items.filter(
      (it): it is Extract<typeof it, { str: string }> =>
        'str' in it && it.str !== '',
    )

    // A scan carries a page image and, at most, a stray label or a watermark.
    // Below the threshold there is nothing to select, so read the pixels
    // instead and return the result in this same shape — nothing downstream
    // may learn which path ran.
    const chars = runs.reduce((n, it) => n + it.str.trim().length, 0)
    if (chars < SCANNED_CHAR_THRESHOLD) {
      return { items: await this.ocrPage(pageIndex), source: 'ocr' }
    }

    const quads = runs.map((it) => textItemQuad(it.transform, it.width, it.height))
    const lineIds = groupByLine(quads)

    return {
      items: runs.map((it, i) => ({
        str: it.str,
        quad: quads[i],
        lineId: lineIds[i],
      })),
      source: 'native',
    }
  }

  /**
   * Rasterise a page and read it.
   *
   * The scale handed to the OCR module is MEASURED off the canvas rather than
   * assumed to be OCR_SCALE: renderPage multiplies by devicePixelRatio and
   * rounds, and a conversion that re-derives that arithmetic instead of
   * reading the result is one refactor away from putting every word in the
   * wrong place.
   */
  private async ocrPage(pageIndex: number): Promise<TextItem[]> {
    const [{ recognise }, vp] = await Promise.all([
      import('../lib/tesseract.ts'),
      this.getViewport(pageIndex),
    ])

    const canvas = document.createElement('canvas')
    try {
      await this.renderPage(pageIndex, canvas, OCR_SCALE)
      return await recognise(canvas, canvas.width / vp.width, vp, pageIndex)
    } finally {
      // A 216dpi A4 page is ~25MB of backing store. Release it now rather than
      // leaving it to GC — the same reason the magnifier zeroes its canvas.
      canvas.width = 0
      canvas.height = 0
    }
  }

  destroy(): void {
    for (const task of this.live) task.cancel()
    this.live.clear()
    this.pages.clear()
    // The loading task owns the worker; destroying the proxy alone leaks it.
    void this.doc.loadingTask.destroy()
  }
}
