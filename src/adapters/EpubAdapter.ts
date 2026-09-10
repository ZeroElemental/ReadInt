/**
 * EPUB via epub.js.
 *
 * Genuinely a different shape of problem: reflowable text has no fixed page
 * geometry, so there is no canvas to rasterise and no stable coordinate to pin
 * an annotation to. Annotations here are CFI ranges (Annotation.cfi), and the
 * lens magnifier degrades to band mode.
 *
 * Staged last on purpose so a slip here cannot block the PDF experience.
 *
 * STATUS: skeleton — Phase 6.
 */

import type { DocAdapter, PageGeometry } from './types.ts'
import type { TextItem } from '../lib/types.ts'

export class EpubAdapter implements DocAdapter {
  readonly pageCount = 0

  private constructor() {}

  static async open(_file: Blob): Promise<EpubAdapter> {
    // TODO(phase-6): ePub(buffer).renderTo(el, { flow: 'paginated', spread: 'auto' })
    throw new Error('EpubAdapter.open not implemented')
  }

  async getViewport(_pageIndex: number): Promise<PageGeometry> {
    // TODO(phase-6): reflowable text has no intrinsic page geometry — this is
    // the rendered viewport's size, and annotations here are CFIs instead.
    throw new Error('EpubAdapter.getViewport not implemented')
  }

  async renderPage(): Promise<void> {
    // No-op by design: epub.js owns its own iframe rendering.
  }

  async getTextItems(_pageIndex: number): Promise<TextItem[]> {
    // TODO(phase-6): walk the rendered iframe's text nodes for line boxes.
    throw new Error('EpubAdapter.getTextItems not implemented')
  }

  destroy(): void {}
}
