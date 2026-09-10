/**
 * A single image treated as a one-page document. Canvas is the image itself,
 * text comes entirely from OCR.
 *
 * STATUS: skeleton — Phase 5.
 */

import type { DocAdapter, PageGeometry } from './types.ts'
import type { TextItem } from '../lib/types.ts'

export class ImageAdapter implements DocAdapter {
  readonly pageCount = 1

  private constructor() {}

  static async open(_file: Blob): Promise<ImageAdapter> {
    // TODO(phase-5): createImageBitmap(file); page units = natural pixel size.
    throw new Error('ImageAdapter.open not implemented')
  }

  async getViewport(_pageIndex: number): Promise<PageGeometry> {
    // TODO(phase-5): page units = the image's natural pixel size, y-up.
    throw new Error('ImageAdapter.getViewport not implemented')
  }

  async renderPage(
    _pageIndex: number,
    _canvas: HTMLCanvasElement,
    _scale: number,
  ): Promise<void> {
    // TODO(phase-5): drawImage at scale * devicePixelRatio.
    throw new Error('ImageAdapter.renderPage not implemented')
  }

  async getTextItems(_pageIndex: number): Promise<TextItem[]> {
    // TODO(phase-5): OCR worker -> word boxes -> TextItem[] in page units.
    throw new Error('ImageAdapter.getTextItems not implemented')
  }

  destroy(): void {}
}
