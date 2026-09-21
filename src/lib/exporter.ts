/**
 * The export, end to end: gather what the document has, hand it to the pure
 * builders, and put the result in the reader's downloads.
 *
 * Everything format-specific is here and nowhere else. `export.ts` and
 * `export-pdf.ts` take plain data; this is the one place that knows a PDF's marks
 * are quads over positioned text and an EPUB's are CFI ranges in a DOM.
 *
 * Exports the marks AS THEY ARE NOW, saved or not. Someone exporting mid-session
 * expects to get what is on screen, and the alternative — quietly exporting the
 * last save and leaving out this afternoon — is the kind of surprise that is
 * discovered too late.
 */

import { annotationsSnapshot, reader } from './reader.svelte.ts'
import { getDocument } from './storage.ts'
import { pageText } from '../adapters/index.ts'
import {
  buildMarkdown,
  exportName,
  markedText,
  pagedOrder,
  type ExportMark,
} from './export.ts'
import type { TextItem } from './types.ts'

export type ExportKind = 'markdown' | 'pdf'

export const NOTHING = 'Nothing to export yet — make a highlight, underline or note first.'

/** The original file can be annotated only if it is a PDF (scans included). */
export const canAnnotatePdf = () => reader.format === 'pdf'

/** Marks in reading order, each with the text it sits on. */
async function collectMarks(): Promise<{
  marks: ExportMark[]
  groupLabel: (pageIndex: number) => string
}> {
  const all = annotationsSnapshot()

  const epub = reader.epub
  if (epub) {
    // A reflowable mark has no page: it is a CFI, and "before" means what
    // epub.js says it means.
    const ordered = all
      .filter((a) => a.cfi)
      .sort((a, b) => a.pageIndex - b.pageIndex || epub.compareCfi(a.cfi!, b.cfi!))
    const marks = await Promise.all(
      ordered.map(async (annotation) => ({
        annotation,
        text: annotation.type === 'ink' ? '' : await epub.textOf(annotation.cfi!),
      })),
    )
    return { marks, groupLabel: (i) => epub.chapterAt(i) || `Section ${i + 1}` }
  }

  const adapter = reader.adapter
  const docId = reader.docId
  if (!adapter || !docId) return { marks: [], groupLabel: () => '' }

  // A page's text is asked for once however many marks it carries; and it is
  // already cached in Dexie, so this is cheap after the first visit.
  const pages = new Map<number, Promise<TextItem[]>>()
  const itemsOn = (p: number) => {
    let job = pages.get(p)
    if (!job) pages.set(p, (job = pageText(adapter, docId, p)))
    return job
  }

  const marks = await Promise.all(
    pagedOrder(all).map(async (annotation) => ({
      annotation,
      text: annotation.quads?.length
        ? markedText(await itemsOn(annotation.pageIndex), annotation.quads)
        : '',
    })),
  )
  return { marks, groupLabel: (i) => `Page ${i + 1}` }
}

/** Hand a blob to the browser as a download. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Not immediately: some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Runs one export; the returned string is what to tell the reader. */
export async function runExport(kind: ExportKind): Promise<string> {
  const docId = reader.docId
  if (!docId) return NOTHING

  if (kind === 'markdown') {
    const { marks, groupLabel } = await collectMarks()
    if (marks.length === 0) return NOTHING

    const text = buildMarkdown({
      title: reader.docName.replace(/\.[^./\\]+$/, '') || reader.docName,
      exportedAt: new Date(),
      marks,
      groupLabel,
    })
    download(
      new Blob([text], { type: 'text/markdown;charset=utf-8' }),
      exportName(reader.docName, '-marks.md'),
    )
    return `Exported ${marks.length} ${marks.length === 1 ? 'mark' : 'marks'} as Markdown.`
  }

  const marks = annotationsSnapshot()
  if (marks.length === 0) return NOTHING

  const rec = await getDocument(docId)
  if (!rec) return 'The original file is no longer in this browser, so it cannot be annotated.'

  // Loaded only now: pdf-lib is half a megabyte nobody pays for until they ask.
  const { annotatedPdf } = await import('./export-pdf.ts')
  download(await annotatedPdf(rec.blob, marks), exportName(reader.docName, '-annotated.pdf'))
  return `Exported the PDF with ${marks.length} ${marks.length === 1 ? 'mark' : 'marks'} on it.`
}
