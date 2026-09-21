/**
 * The OCR worker, and the only thing that owns it.
 *
 * NO HAND-WRITTEN WORKER. The roadmap said `workers/ocr.worker.ts`;
 * tesseract.js's `createWorker()` already spawns and owns a Web Worker, so
 * wrapping it in one of ours would be a worker inside a worker — a postMessage
 * hop and a lifecycle to get wrong, for nothing. This module is a thin owner
 * of tesseract's worker instead.
 *
 * tesseract.js is reached ONLY through `await import()`, exactly like pdf.js in
 * PdfAdapter: that is what keeps a 5MB dependency out of the entry chunk, and
 * out of the way of every reader who never opens a scan. THIS module must stay
 * dynamically imported too — a single static import of it anywhere pulls the
 * whole thing back into the entry bundle, which is why progress lives in the
 * store rather than here, and why nothing above the adapters names this file.
 *
 * Assets are served from `public/tessdata/`, never a CDN — see the README
 * there. OCR therefore works offline, and README.md's claim that exactly two
 * things cross the network stays true.
 */

import { linesToTextItems, pageLines } from './ocr.ts'
import { reader } from './reader.svelte.ts'
import type { ViewportLike } from './coords.ts'
import type { TextItem } from './types.ts'

/**
 * Feature detection is skipped by naming a core file outright, and it has to be
 * the SINGLE-FILE build: the small loader resolves its sibling .wasm relative
 * to a script directory that is empty inside tesseract's own worker, so it dies
 * on `Failed to parse URL from tesseract-core-simd-lstm.wasm`. See the README
 * in public/tessdata.
 */
const CORE_PATH = '/tessdata/tesseract-core-simd-lstm.wasm.js'
const LANG_PATH = '/tessdata'

type TesseractWorker = import('tesseract.js').Worker

let worker: Promise<TesseractWorker> | null = null
/**
 * One worker means one page at a time whether we like it or not, so jobs are
 * queued explicitly. SearchPanel scans every page of a document; without this
 * a 200-page scan would hand tesseract 200 overlapping jobs.
 */
let queue: Promise<unknown> = Promise.resolve()
/** The page the running job belongs to. The logger has no idea. */
let current = -1

function load(): Promise<TesseractWorker> {
  worker ??= (async () => {
    const [{ createWorker }, workerPath] = await Promise.all([
      import('tesseract.js'),
      import('tesseract.js/dist/worker.min.js?url').then((m) => m.default),
    ])
    return createWorker('eng', undefined, {
      workerPath,
      corePath: CORE_PATH,
      langPath: LANG_PATH,
      logger: (m) => {
        if (m.status !== 'recognizing text') return
        reader.ocr.pageIndex = current
        reader.ocr.progress = m.progress
      },
    })
  })()
  return worker
}

/**
 * Read one page.
 *
 * `image` is a rasterised canvas for a PDF, or the original file for an image
 * document — tesseract decodes an encoded blob itself, and making ImageAdapter
 * paint one into a canvas first would be a full-size copy of pixels tesseract
 * is about to re-derive. `rasterScale` is that image's pixels per scale-1 CSS
 * pixel, and `vp` is the page's geometry at scale 1; together they are what
 * puts the words back in page units.
 */
export function recognise(
  image: HTMLCanvasElement | Blob,
  rasterScale: number,
  vp: ViewportLike,
  pageIndex: number,
): Promise<TextItem[]> {
  const job = queue.then(async () => {
    const w = await load()
    current = pageIndex
    reader.ocr.pageIndex = pageIndex
    reader.ocr.progress = 0
    try {
      const { data } = await w.recognize(image, {}, { blocks: true, text: false })
      return linesToTextItems(pageLines(data), rasterScale, vp)
    } finally {
      current = -1
      reader.ocr.pageIndex = -1
    }
  })
  // The queue must survive a failed job, or one bad page stops every page
  // behind it. The caller still sees the rejection through `job`.
  queue = job.catch(() => {})
  return job
}

/*
 * Deliberately never terminated. A tesseract worker holds a thread and its
 * wasm heap — but it is a SINGLETON, unlike the magnifier's per-page canvas
 * that had to be released because navigation would otherwise accumulate them.
 * Tearing it down when a document closes would trade a bounded ~30MB for a
 * two-second cold start every time the next scan is opened, and the tab
 * reclaims it anyway. Revisit if a profile ever says otherwise.
 */
