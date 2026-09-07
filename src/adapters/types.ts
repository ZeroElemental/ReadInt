/**
 * The reader shell must not know what it is reading.
 *
 * Three real implementations: PDF, image, EPUB. Scanned PDFs are NOT a fourth
 * case — PdfAdapter runs OCR and emits the same TextItem shape, so selection,
 * search and definitions never branch on "is this OCR".
 */

import type { TextItem } from '../lib/types.ts'

export interface DocAdapter {
  readonly pageCount: number

  /** Page size in page units. */
  getPageSize(pageIndex: number): { w: number; h: number }

  /** Rasterise a page into the given canvas at `scale`. */
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
