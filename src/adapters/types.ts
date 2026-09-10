/**
 * The reader shell must not know what it is reading.
 *
 * Three real implementations: PDF, image, EPUB. Scanned PDFs are NOT a fourth
 * case — PdfAdapter runs OCR and emits the same TextItem shape, so selection,
 * search and definitions never branch on "is this OCR".
 */

import type { TextItem } from '../lib/types.ts'
import type { ViewportLike } from '../lib/coords.ts'

/**
 * A page's transform at scale 1, plus its CSS-pixel size at that scale.
 *
 * This is the whole geometry contract: layers position everything by handing
 * page-unit quads to coords.ts along with this, and scale the result with a
 * single CSS variable. pdf.js's PageViewport satisfies it as-is.
 */
export interface PageGeometry extends ViewportLike {
  width: number
  height: number
  /**
   * page units -> scale-1 CSS px as a raw [a,b,c,d,e,f] matrix. Rects go
   * through quadToScreen; ink is a path of hundreds of points, so it is drawn
   * by handing this straight to an SVG transform. Same transform, exactly —
   * including rotation and the y-flip — just applied by the renderer.
   */
  transform: number[]
}

export interface DocAdapter {
  readonly pageCount: number

  /** The page↔screen transform at scale 1. */
  getViewport(pageIndex: number): Promise<PageGeometry>

  /**
   * Rasterise a page into the given canvas. `scale` is the CSS scale — the
   * adapter applies devicePixelRatio and CSS-sizes the canvas back down itself,
   * because it is the only thing that knows the page's intrinsic size.
   */
  renderPage(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<void>

  /** Positioned text for selection, search and the band magnifier. */
  getTextItems(pageIndex: number): Promise<TextItem[]>

  /** Release pdf.js / epub.js handles. */
  destroy(): void
}
