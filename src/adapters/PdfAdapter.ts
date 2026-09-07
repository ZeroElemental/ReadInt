/**
 * PDF via pdf.js. Also covers scanned PDFs: if the native text layer comes back
 * near-empty the page is queued for OCR, and the OCR result is normalised into
 * the same TextItem shape so nothing downstream can tell the difference.
 *
 * STATUS: skeleton — render + text extraction land in Phase 1, OCR in Phase 5.
 */

import type { DocAdapter } from './types.ts'
import type { TextItem } from '../lib/types.ts'

/** Below this many characters, a page is almost certainly a scan. */
const SCANNED_CHAR_THRESHOLD = 20

export class PdfAdapter implements DocAdapter {
  readonly pageCount = 0

  private constructor() {}

  static async open(_file: Blob): Promise<PdfAdapter> {
    // TODO(phase-1): getDocument({ data }), keep the PDFDocumentProxy.
    throw new Error('PdfAdapter.open not implemented')
  }

  getPageSize(_pageIndex: number): { w: number; h: number } {
    // TODO(phase-1): page.getViewport({ scale: 1 }) -> { width, height }.
    throw new Error('PdfAdapter.getPageSize not implemented')
  }

  async renderPage(
    _pageIndex: number,
    _canvas: HTMLCanvasElement,
    _scale: number,
  ): Promise<void> {
    // TODO(phase-1): render at scale * devicePixelRatio, CSS-size the canvas
    // back down. Cancel any in-flight render for this page first.
    throw new Error('PdfAdapter.renderPage not implemented')
  }

  async getTextItems(_pageIndex: number): Promise<TextItem[]> {
    // TODO(phase-1): getTextContent() -> quads in page units, grouped by line.
    // TODO(phase-5): if total chars < SCANNED_CHAR_THRESHOLD, hand off to OCR.
    void SCANNED_CHAR_THRESHOLD
    throw new Error('PdfAdapter.getTextItems not implemented')
  }

  destroy(): void {}
}
