/**
 * Run with: npm test   (node --test, no framework)
 *
 * This guards the one invariant the whole app rests on: an annotation stored in
 * page units must land on the same glyphs at any zoom level or DPI.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  quadToScreen,
  screenToQuad,
  mergeQuadsByLine,
  groupByLine,
  lineBoxes,
} from './coords.ts'
import type { ViewportLike } from './coords.ts'

/** Mimics pdf.js PageViewport: scales, and flips the y-axis. */
function fakeViewport(scale: number, pageHeight = 800): ViewportLike {
  return {
    scale,
    convertToViewportPoint: (x, y) => [x * scale, (pageHeight - y) * scale],
    convertToPdfPoint: (vx, vy) => [vx / scale, pageHeight - vy / scale],
  }
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

test('quad survives a screen round-trip at every zoom level', () => {
  const quad = { x: 100, y: 600, w: 200, h: 20 }

  for (const scale of [0.5, 1, 1.5, 2, 3, 4.75]) {
    const vp = fakeViewport(scale)
    const back = screenToQuad(quadToScreen(quad, vp), vp)

    assert.ok(close(back.x, quad.x), `x drifted at scale ${scale}`)
    assert.ok(close(back.y, quad.y), `y drifted at scale ${scale}`)
    assert.ok(close(back.w, quad.w), `w drifted at scale ${scale}`)
    assert.ok(close(back.h, quad.h), `h drifted at scale ${scale}`)
  }
})

test('the y-axis flip is normalised away, never negative', () => {
  const r = quadToScreen({ x: 100, y: 600, w: 200, h: 20 }, fakeViewport(2))

  assert.ok(r.width > 0 && r.height > 0, 'flipped axis leaked a negative size')
  // y=600 with h=20 is 180pt from the top of an 800pt page, doubled.
  assert.equal(r.top, 360)
  assert.equal(r.left, 200)
})

test('doubling the zoom doubles the screen rect', () => {
  const quad = { x: 10, y: 700, w: 50, h: 12 }
  const a = quadToScreen(quad, fakeViewport(1))
  const b = quadToScreen(quad, fakeViewport(2))

  assert.equal(b.width, a.width * 2)
  assert.equal(b.height, a.height * 2)
})

test('fragments on one line merge into a single marker stroke', () => {
  const merged = mergeQuadsByLine([
    { x: 10, y: 500, w: 40, h: 12 },
    { x: 51, y: 500.4, w: 30, h: 12 }, // same line, sub-pixel baseline wobble
    { x: 10, y: 480, w: 60, h: 12 }, // next line down
  ])

  assert.equal(merged.length, 2)
  assert.equal(merged[0].x, 10)
  assert.equal(merged[0].y, 500)
  assert.equal(merged[0].w, 71) // spans 10 -> 81, gap included
  assert.ok(close(merged[0].h, 12.4))
  assert.equal(merged[1].y, 480)
})

test('merging nothing yields nothing', () => {
  assert.deepEqual(mergeQuadsByLine([]), [])
})

test('lines are numbered top-down, fragments on one baseline share an id', () => {
  //                       bottom line      top line, 2 fragments
  const ids = groupByLine([
    { x: 10, y: 480, w: 60, h: 12 },
    { x: 51, y: 500.4, w: 30, h: 12 },
    { x: 10, y: 500, w: 40, h: 12 },
  ])

  assert.deepEqual(ids, [1, 0, 0], 'ids must be parallel to the input order')
})

test('a baseline further off than the tolerance starts a new line', () => {
  const ids = groupByLine([
    { x: 10, y: 500, w: 40, h: 12 },
    { x: 60, y: 498, w: 40, h: 12 },
  ])

  assert.deepEqual(ids, [0, 1])
})

test('line boxes span each line and come back top-down', () => {
  const item = (str: string, x: number, y: number, w: number, lineId: number) => ({
    str, lineId, quad: { x, y, w, h: 12 },
  })
  // Handed over in a jumbled order, as a text stream may well arrive.
  const boxes = lineBoxes([
    item('world', 60, 500, 40, 0),
    item('second line', 10, 480, 90, 1),
    item('hello', 10, 500, 45, 0),
  ])

  assert.equal(boxes.length, 2)
  assert.equal(boxes[0].y, 500, 'line 0 is the upper line')
  assert.equal(boxes[0].x, 10)
  assert.equal(boxes[0].w, 90, 'spans "hello" through "world", gap included')
  assert.equal(boxes[1].y, 480)
  assert.equal(boxes[1].w, 90)
})

test('a line holds together even when its runs sit off the baseline', () => {
  // A superscript shares its lineId but sits well above the baseline; it must
  // not be split off, which is why lineBoxes ignores the tolerance.
  const boxes = lineBoxes([
    { str: 'x', lineId: 0, quad: { x: 10, y: 500, w: 20, h: 12 } },
    { str: '2', lineId: 0, quad: { x: 30, y: 506, w: 6, h: 7 } },
  ])

  assert.equal(boxes.length, 1)
  assert.equal(boxes[0].y, 500)
  assert.equal(boxes[0].h, 13, 'the box covers baseline through superscript top')
})
