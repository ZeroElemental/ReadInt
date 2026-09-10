/**
 * Run with: npm test
 *
 * Guards the transform -> page-units step. This file only imports TYPES from
 * pdf.js (the runtime import lives inside PdfAdapter.open), so node can run it
 * without a bundler or a browser.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { textItemQuad } from './PdfAdapter.ts'

/** [a, b, c, d, e, f] for upright 12pt text with its baseline at (100, 600). */
const upright = [12, 0, 0, 12, 100, 600]

test('an upright run sits on its baseline and keeps its reported size', () => {
  const q = textItemQuad(upright, 80, 12)

  assert.equal(q.x, 100)
  assert.equal(q.y, 600, 'the baseline is the bottom edge, not the middle')
  assert.equal(q.w, 80)
  assert.equal(q.h, 12)
})

test('a quarter-turned run becomes its axis-aligned box', () => {
  // Rotated 90 degrees CCW: the run advances upward, the glyph body leftward.
  const q = textItemQuad([0, 12, -12, 0, 100, 600], 80, 12)

  assert.equal(q.w, 12, 'width and height swap with the run')
  assert.equal(q.h, 80)
  assert.equal(q.x, 88, 'the glyph body extends left of the origin')
  assert.equal(q.y, 600)
})

test('a degenerate text matrix still yields a usable box', () => {
  const q = textItemQuad([0, 0, 0, 0, 10, 20], 50, 10)

  assert.deepEqual(q, { x: 10, y: 20, w: 50, h: 10 })
})
