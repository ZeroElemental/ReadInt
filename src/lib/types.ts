/**
 * Core domain types.
 *
 * INVARIANT: every geometric value in here is in **page units** (PDF user space
 * of the unrotated page), never screen or CSS pixels. See lib/coords.ts.
 */

export type DocFormat = 'pdf' | 'image' | 'epub'

/** A rectangle in page units. Origin is the page's bottom-left, y grows upward. */
export interface Quad {
  x: number
  y: number
  w: number
  h: number
}

export interface DocumentRecord {
  id: string
  name: string
  format: DocFormat
  /** The original file. Documents never leave the device. */
  blob: Blob
  pageCount: number
  /** Set once OCR has run, so it never runs twice for the same document. */
  ocrDone: boolean
  addedAt: number
  lastOpenedAt: number
  lastPageIndex: number
}

/** One extracted word/run, positioned in page units. */
export interface TextItem {
  str: string
  quad: Quad
  /** Items sharing a lineId are on the same visual line. Drives band magnifier. */
  lineId: number
}

export interface PageTextRecord {
  docId: string
  pageIndex: number
  items: TextItem[]
  /** 'native' from the PDF text layer, 'ocr' from tesseract. */
  source: 'native' | 'ocr'
}

export type AnnotationType = 'highlight' | 'underline' | 'ink' | 'note'

export interface Annotation {
  id: string
  docId: string
  pageIndex: number
  type: AnnotationType
  color: string
  /** Stroke/underline weight, in page units so it scales with zoom. */
  thickness?: number
  /** highlight + underline: one quad per line of the selection. */
  quads?: Quad[]
  /** ink: an SVG path string in page units. */
  path?: string
  /** note: the typed text and its box. */
  text?: string
  box?: Quad
  /** EPUB only: annotations there are range-based, not coordinate-based. */
  cfi?: string
  createdAt: number
  updatedAt: number
}

/**
 * One search result. Transient — hits live in the store for as long as the
 * query does and are never persisted, which is what keeps them from being
 * confused with a highlight.
 */
export interface SearchHit {
  pageIndex: number
  /** One quad per line the hit spans, in page units. */
  quads: Quad[]
  /** Surrounding text for the results list. */
  snippet: string
}

export interface LookupRecord {
  term: string
  docId: string
  meaning: string
  source: 'dictionary' | 'ai'
  fetchedAt: number
}

export type Tool = 'select' | 'highlight' | 'underline' | 'pen' | 'note' | 'erase'
export type MagnifierMode = 'off' | 'lens' | 'band'
export type ReadingDirection = 'ltr' | 'rtl'

export interface Settings {
  readingDirection: ReadingDirection
  magnifier: MagnifierMode
  magFactor: number
  highlightColor: string
  inkColor: string
  thickness: number
  spread: boolean
}
