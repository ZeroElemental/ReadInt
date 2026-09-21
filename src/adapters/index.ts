import type { DocAdapter } from './types.ts'
import type { DocFormat, TextItem } from '../lib/types.ts'
import { getPageText, putPageText, touchDocument } from '../lib/storage.ts'
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
 * In-flight extractions, keyed docId:pageIndex.
 *
 * The Dexie cache below only dedupes callers that arrive AFTER the first one
 * has finished, and the text layer, the band magnifier and the search panel
 * routinely ask for the same page in the same tick. On a digital PDF that cost
 * a second getTextContent(); on a scan it would cost a second OCR pass —
 * several seconds of a worker that can only do one page at a time.
 */
const inFlight = new Map<string, Promise<TextItem[]>>()

/**
 * Positioned text for a page, from the cache when it is there.
 *
 * Extraction is expensive (and, for a scan, means OCR), so the text layer and
 * the band magnifier share this one path rather than each asking the adapter
 * and each caching the answer.
 */
export function pageText(
  adapter: DocAdapter,
  docId: string,
  pageIndex: number,
): Promise<TextItem[]> {
  // A spread's trailing leaf is out of range on a document with an odd page
  // count, and every layer on it still asks for its text. Answered here rather
  // than in each caller: there is no text on a page that does not exist.
  if (pageIndex >= adapter.pageCount) return Promise.resolve([])

  const key = `${docId}:${pageIndex}`
  let job = inFlight.get(key)
  if (job) return job

  job = (async () => {
    const cached = await getPageText(docId, pageIndex)
    if (cached) return cached.items

    const { items, source } = await adapter.getTextItems(pageIndex)
    await putPageText({ docId, pageIndex, items, source })
    // Marks the document so the shelf can say it has been read by OCR, and so
    // this is answerable without walking every page's record.
    if (source === 'ocr') await touchDocument(docId, { ocrDone: true })
    return items
  })()

  inFlight.set(key, job)
  // Cleared on settle, not on success: a page that threw must be retryable,
  // and a rejected promise left in the map would fail every later caller.
  // The catch is only to keep THIS bookkeeping from raising an unhandled
  // rejection of its own; the caller still sees the original failure.
  void job.catch(() => {}).finally(() => inFlight.delete(key))
  return job
}

