/**
 * A single image treated as a one-page document. Canvas is the image itself,
 * text comes entirely from OCR.
 */

import type { DocAdapter, PageGeometry, TextItemsResult } from './types.ts'

/**
 * Page units for an image are its natural pixels, with the origin at the
 * BOTTOM-left and y growing upward.
 *
 * The flip is not decoration. Invariant 1 says every stored quad is in page
 * units, and coords.ts is the only converter; if an image's page space were
 * y-down, a highlight would mean one thing on a PDF and another on a photo,
 * and every layer above would need to know which it was looking at. pdf.js's
 * PageViewport is the shape being matched here — a scale-1 geometry whose
 * transform carries the flip — so `getViewport` is honest for both adapters.
 *
 * Exported standalone so the geometry can be tested without a DOM.
 */
export function imageViewport(width: number, height: number): PageGeometry {
  // Its own inverse: [x, h - y] both ways.
  const flip = (x: number, y: number) => [x, height - y]
  return {
    width,
    height,
    scale: 1,
    transform: [1, 0, 0, -1, 0, height],
    convertToViewportPoint: flip,
    convertToPdfPoint: flip,
  }
}

export class ImageAdapter implements DocAdapter {
  readonly pageCount = 1

  private bitmap: ImageBitmap
  /**
   * Kept because tesseract reads an encoded blob directly. Decoding it to a
   * canvas first would cost a full-size copy to hand over pixels it is about
   * to re-derive anyway.
   */
  private file: Blob

  private constructor(bitmap: ImageBitmap, file: Blob) {
    this.bitmap = bitmap
    this.file = file
  }

  static async open(file: Blob): Promise<ImageAdapter> {
    return new ImageAdapter(await createImageBitmap(file), file)
  }

  async getViewport(_pageIndex: number): Promise<PageGeometry> {
    return imageViewport(this.bitmap.width, this.bitmap.height)
  }

  async renderPage(
    _pageIndex: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<void> {
    const dpr = window.devicePixelRatio || 1
    const css = { w: this.bitmap.width * scale, h: this.bitmap.height * scale }

    canvas.width = Math.round(css.w * dpr)
    canvas.height = Math.round(css.h * dpr)
    canvas.style.width = `${css.w}px`
    canvas.style.height = `${css.h}px`

    canvas
      .getContext('2d')
      ?.drawImage(this.bitmap, 0, 0, canvas.width, canvas.height)
  }

  async getTextItems(_pageIndex: number): Promise<TextItemsResult> {
    const { recognise } = await import('../lib/tesseract.ts')
    // rasterScale 1: page units ARE the image's pixels, and tesseract decodes
    // the file at its natural size, so the two spaces already coincide.
    const items = await recognise(
      this.file,
      1,
      imageViewport(this.bitmap.width, this.bitmap.height),
      0,
    )
    return { items, source: 'ocr' }
  }

  destroy(): void {
    this.bitmap.close()
  }
}
