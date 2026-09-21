/**
 * Run with: npm test
 *
 * The pure helpers, plus one round trip through real pdf-lib to prove the
 * export is still a PDF and — the reason this exists — still HAS its text.
 * Whether the marks land on the right glyphs is a pixel question, and is checked
 * in a browser against pdf.js rather than asserted here.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { annotatedPdf, flipPath, parseColor, wrapText } from './export-pdf.ts'
import type { Annotation } from './types.ts'

test('flipPath negates every y and leaves every x and command alone', () => {
  assert.equal(flipPath('M 10 20 Q 30 40 50 60 Z'), 'M 10 -20 Q 30 -40 50 -60 Z')
})

test('flipPath does not turn a zero into negative zero', () => {
  assert.equal(flipPath('M 5 0 Z'), 'M 5 0 Z')
})

test('flipPath is its own inverse', () => {
  const p = 'M 1.5 2.25 Q 3 4 5.5 6 Z'
  assert.equal(flipPath(flipPath(p)), p)
})

test('colours parse in both hex forms, and fall back rather than throw', () => {
  assert.deepEqual(parseColor('#ff0000'), [1, 0, 0])
  assert.deepEqual(parseColor('#0f0'), [0, 1, 0])
  assert.equal(parseColor('rebeccapurple').length, 3, 'a name is not hex; still a usable colour')
})

test('wrapText breaks on width, respects newlines, and keeps an over-long word whole', () => {
  const w = (s: string) => s.length // one unit per character
  assert.deepEqual(wrapText('aaa bbb ccc', 7, w), ['aaa bbb', 'ccc'])
  assert.deepEqual(wrapText('one\ntwo', 20, w), ['one', 'two'])
  assert.deepEqual(wrapText('unbreakablewordhere', 5, w), ['unbreakablewordhere'])
})

const mark = (type: Annotation['type'], extra: Partial<Annotation>): Annotation => ({
  id: 'a', docId: 'd', pageIndex: 0, type, color: '#ffe066', createdAt: 0, updatedAt: 0, ...extra,
})

test('an annotated PDF is still a PDF, keeps its pages and its text, and skips a page that is not there', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')

  const src = await PDFDocument.create()
  const font = await src.embedFont(StandardFonts.Helvetica)
  src.addPage([612, 792]).drawText('ORIGINAL TEXT', { x: 72, y: 600, size: 14, font })
  const original = new Blob([(await src.save()) as BlobPart])

  const out = await annotatedPdf(original, [
    mark('highlight', { quads: [{ x: 72, y: 598, w: 100, h: 16 }] }),
    mark('underline', { quads: [{ x: 72, y: 598, w: 100, h: 16 }], thickness: 2 }),
    mark('ink', { path: 'M 100 100 Q 110 110 120 100 Z' }),
    mark('note', { box: { x: 300, y: 300, w: 150, h: 60 }, text: 'a note — with an em dash and 日本' }),
    mark('highlight', { pageIndex: 7, quads: [{ x: 0, y: 0, w: 1, h: 1 }] }),
  ])

  const reloaded = await PDFDocument.load(await out.arrayBuffer())
  assert.equal(reloaded.getPageCount(), 1)
  assert.equal(out.type, 'application/pdf')
  assert.ok(out.size > original.size, 'the marks added content')

  // The text layer survives, asserted the only way that means anything: open
  // the EXPORT with a real PDF reader and ask it for the words. (The streams are
  // compressed, so looking for the string in the raw bytes would prove nothing.)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // verbosity 0: pdf.js warns about a standard font it was not handed a data URL
  // for, which has no bearing on extracting text.
  const task = getDocument({ data: new Uint8Array(await out.arrayBuffer()), verbosity: 0 })
  const { items } = await (await (await task.promise).getPage(1)).getTextContent()
  const text = items.map((it) => ('str' in it ? it.str : '')).join(' ')

  assert.match(text, /ORIGINAL TEXT/, 'the original words are still selectable in the export')
  await task.destroy()
})

test('an empty mark list still round-trips the file', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.create()
  src.addPage([100, 100])
  const out = await annotatedPdf(new Blob([(await src.save()) as BlobPart]), [])

  assert.equal((await PDFDocument.load(await out.arrayBuffer())).getPageCount(), 1)
})
