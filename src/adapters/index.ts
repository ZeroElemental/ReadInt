import type { DocAdapter } from './types.ts'
import type { DocFormat, TextItem } from '../lib/types.ts'
import { getPageText, putPageText } from '../lib/storage.ts'
import { PdfAdapter } from './PdfAdapter.ts'
import { ImageAdapter } from './ImageAdapter.ts'
import { EpubAdapter } from './EpubAdapter.ts'

export type { DocAdapter }

export function detectFormat(file: File): DocFormat {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type === 'application/epub+zip' || name.endsWith('.epub')) return 'epub'
  if (file.type.startsWith('image/')) return 'image'
  throw new Error(`Unsupported file: ${file.name}`)
}

export function openDocument(blob: Blob, format: DocFormat): Promise<DocAdapter> {
  switch (format) {
    case 'pdf':
      return PdfAdapter.open(blob)
    case 'image':
      return ImageAdapter.open(blob)
    case 'epub':
      return EpubAdapter.open(blob)
  }
}

/**
 * Positioned text for a page, from the cache when it is there.
 *
 * Extraction is expensive (and, for a scan, will mean OCR), so the text layer
 * and the band magnifier share this one path rather than each asking the
 * adapter and each caching the answer.
 */
export async function pageText(
  adapter: DocAdapter,
  docId: string,
  pageIndex: number,
): Promise<TextItem[]> {
  const cached = await getPageText(docId, pageIndex)
  if (cached) return cached.items

  const items = await adapter.getTextItems(pageIndex)
  await putPageText({ docId, pageIndex, items, source: 'native' })
  return items
}

