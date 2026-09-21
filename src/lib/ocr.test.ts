/**
 * Run with: npm test
 *
 * Guards the OCR -> page-units step, which is the one place the scanned path
 * can silently diverge from the native one. A flipped or mis-scaled conversion
 * does not throw — it produces text that selects fine and highlights in the
 * wrong place, three features downstream.
 *
 * Imports only pure modules, so node runs it without a bundler or a browser.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { linesToTextItems, pageLines, type OcrLine } from './ocr.ts'
import { imageViewport } from '../adapters/ImageAdapter.ts'
import { quadToScreen, screenToQuad } from './coords.ts'

/** An 600x800 image page: page units are its pixels, y-up from bottom-left. */
const vp = imageViewport(600, 800)

const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
  text,
  bbox: { x0, y0, x1, y1 },
})

/** A line whose box is the union of its words', which is what tesseract emits. */
const line = (words: ReturnType<typeof word>[]): OcrLine => ({
  words,
  bbox: {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y1: Math.max(...words.map((w) => w.bbox.y1)),
  },
})

test('a word at the top of the raster lands near the TOP of the page', () => {
  // Tesseract measures down from the top-left; page units measure up from the
  // bottom-left. Get this backwards and every mark is mirrored vertically.
  const [item] = linesToTextItems([line([word('Title', 100, 40, 260, 70)])], 1, vp)

  assert.equal(item.quad.x, 100)
  assert.equal(item.quad.y, 730, 'y = 800 - 70, the box bottom measured upward')
  assert.equal(item.quad.w, 160)
  assert.equal(item.quad.h, 30)
  assert.ok(item.quad.y > 400, 'the top half of the page is the high half')
})

test('rasterScale divides out, so resolution never moves a word', () => {
  const at1 = linesToTextItems([line([word('word', 100, 40, 260, 70)])], 1, vp)
  const at3 = linesToTextItems([line([word('word', 300, 120, 780, 210)])], 3, vp)

  assert.deepEqual(at3[0].quad, at1[0].quad)
})

test('line ids come from tesseract, not from baseline guessing', () => {
  // The second word sits 4px below its neighbour's baseline — real skew on a
  // scan, and enough to defeat groupByLine's 1.5pt tolerance. Tesseract put
  // them on one line, so they stay on one line.
  const lines = [
    line([word('wobbly', 10, 100, 80, 130), word('baseline', 90, 104, 190, 134)]),
    line([word('next', 10, 160, 60, 190)]),
  ]
  const items = linesToTextItems(lines, 1, vp)

  assert.deepEqual(
    items.map((i) => i.lineId),
    [0, 0, 1],
  )
})

test("words on a line share the line's vertical extent, not their own ink", () => {
  // `Ay` reaches below the baseline and `no` does not. pdf.js reports a run's
  // height as the font's, uniform along a line; if OCR words kept their own
  // ink heights, groupByLine would read one line as two and a highlight over
  // the pair would come back as uneven tiles with a white gap between them.
  const items = linesToTextItems(
    [line([word('no', 10, 100, 60, 130), word('Ay', 70, 100, 120, 142)])],
    1,
    vp,
  )

  assert.equal(items[0].quad.y, items[1].quad.y)
  assert.equal(items[0].quad.h, items[1].quad.h)
  assert.equal(items[0].quad.h, 42, 'the line box, 100..142')
  // Horizontally they are still their own: only the vertical extent is shared.
  assert.equal(items[0].quad.x, 10)
  assert.equal(items[1].quad.x, 70)
})

test('empty and whitespace-only boxes are dropped', () => {
  const items = linesToTextItems(
    [line([word('', 0, 0, 5, 5), word('   ', 6, 0, 9, 5), word('real', 10, 0, 40, 5)])],
    1,
    vp,
  )

  assert.deepEqual(
    items.map((i) => i.str),
    ['real'],
  )
})

test('pageLines walks blocks -> paragraphs -> lines, and survives a blank page', () => {
  const l = (t: string) => line([word(t, 0, 0, 1, 1)])
  const page = {
    blocks: [
      { paragraphs: [{ lines: [l('a'), l('b')] }, { lines: [l('c')] }] },
      { paragraphs: [{ lines: [l('d')] }] },
    ],
  }

  assert.equal(pageLines(page).length, 4, 'flattened in reading order')
  assert.deepEqual(pageLines({ blocks: null }), [], 'a blank page yields null, not []')
})

test('an image viewport round-trips through coords.ts', () => {
  const quad = { x: 120, y: 305, w: 200, h: 24 }

  assert.deepEqual(screenToQuad(quadToScreen(quad, vp), vp), quad)
})
