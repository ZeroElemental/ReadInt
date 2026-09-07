import type { DocAdapter } from './types.ts'
import type { DocFormat } from '../lib/types.ts'
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
