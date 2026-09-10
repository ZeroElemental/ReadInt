/**
 * Run with: npm test
 *
 * The thing worth guarding here is that a stroke stays in PAGE UNITS. If these
 * numbers ever come back in screen pixels, ink drifts on zoom exactly the way
 * a mis-stored highlight would, and the cause is a long way from the symptom.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { strokePath, strokeBounds } from './ink.ts'

/** A short stroke, in page units, drawn left to right. */
const stroke = [
  [100, 500, 0.5],
  [110, 502, 0.6],
  [120, 501, 0.7],
  [130, 499, 0.5],
]

test('an empty stroke produces no path at all', () => {
  assert.equal(strokePath([], 2), '')
})

test('a stroke becomes a closed filled outline', () => {
  const d = strokePath(stroke, 2)

  assert.match(d, /^M /, 'starts with a moveto')
  assert.match(d, / Z$/, 'closes, because it is an outline to fill, not a line')
  assert.ok(d.includes('Q'), 'segments are smoothed')
})

test('the outline stays in the page units it was given', () => {
  const d = strokePath(stroke, 2)
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
  const xs = nums.filter((_, i) => i % 2 === 0)
  const ys = nums.filter((_, i) => i % 2 === 1)

  // Generously bounded: the outline is the input inflated by roughly the size,
  // so it must sit near the input, not at some screen-pixel multiple of it.
  assert.ok(Math.min(...xs) > 90 && Math.max(...xs) < 140, 'x left page units')
  assert.ok(Math.min(...ys) > 490 && Math.max(...ys) < 512, 'y left page units')
})

test('a single point still marks the page', () => {
  const d = strokePath([[100, 500, 0.5]], 4)

  assert.notEqual(d, '', 'a tap is a dot, not nothing')
})

test('bounds cover every point, padded by the stroke width', () => {
  const b = strokeBounds(stroke, 4)

  assert.equal(b.x, 98) // 100 - 4/2
  assert.equal(b.y, 497) // 499 - 4/2
  assert.equal(b.w, 34) // 130 - 100 + 4
  assert.equal(b.h, 7) // 502 - 499 + 4
})

test('bounds of nothing are empty, not NaN', () => {
  assert.deepEqual(strokeBounds([], 2), { x: 0, y: 0, w: 0, h: 0 })
})
