/**
 * Run with: npm test   (node --test, no framework)
 *
 * Search is the one part of phase 4 with real logic, and all of it is here:
 * the joining rules that decide where words begin and end, the folding that
 * lets a plain keyboard find typeset text, and the map back from a hit to the
 * runs it came from. If a search finds nothing it should have, or lights up
 * the wrong glyphs, it is one of these.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { findAll, flattenPage, hitQuads, normalize, sentenceAround } from './search.ts'
import type { TextItem } from './types.ts'

/** A run at a known place. Height 12 throughout, so the gap rule is 3pt. */
const run = (
  str: string,
  x: number,
  lineId = 0,
  w = str.length * 6,
  y = 700 - lineId * 14,
): TextItem => ({ str, quad: { x, y, w, h: 12 }, lineId })

/** The text a search actually runs against. */
const flatOf = (items: TextItem[]) => flattenPage(items).text

test('a hyphen at a line break is dropped, so the word is whole again', () => {
  const items = [run('under-', 72, 0), run('stand', 72, 1)]

  assert.equal(flatOf(items), 'understand')
  assert.equal(findAll(flattenPage(items), 'understand').length, 1)
})

test('a line break without a hyphen still separates two words', () => {
  const items = [run('reading', 72, 0), run('platform', 72, 1)]

  assert.equal(flatOf(items), 'reading platform')
  assert.equal(findAll(flattenPage(items), 'readingplatform').length, 0)
})

test('runs split mid-word are joined without a space; a real gap keeps one', () => {
  // pdf.js splits at every font change, so "under|stand" arrives as two runs
  // that touch. Inserting a space there would break a word that has none.
  const touching = [run('under', 72, 0), run('stand', 102, 0)]
  assert.equal(flatOf(touching), 'understand')

  // 8pt of daylight against a 12pt line: a word boundary.
  const spaced = [run('under', 72, 0), run('stand', 110, 0)]
  assert.equal(flatOf(spaced), 'under stand')
})

test('case, diacritics and ligatures all fold away', () => {
  const cases: [string, string][] = [
    ['Ångström', 'angstrom'],
    ['CAFÉ', 'cafe'],
    ['ﬁnal', 'final'],
    ['naïve', 'naive'],
    ['Don’t', "don't"],
    ['em—dash', 'em-dash'],
  ]

  for (const [typeset, typed] of cases) {
    const flat = flattenPage([run(typeset, 72)])
    assert.equal(findAll(flat, typed).length, 1, `"${typed}" did not find "${typeset}"`)
  }
})

test('folding maps every character back to the one that produced it', () => {
  // "ﬁ" is one source character and two folded ones; the map has to say so, or
  // every hit after a ligature lands one glyph to the left.
  const n = normalize('aﬁb')

  assert.equal(n.text, 'afib')
  assert.deepEqual(n.src, [0, 1, 1, 2])
})

test('a hit maps back to a proportional slice of its run', () => {
  const items = [run('abcdefghij', 100, 0, 100)]
  const flat = flattenPage(items)
  const [hit] = findAll(flat, 'cde')

  assert.deepEqual(hit, { start: 2, end: 5 })

  const [quad] = hitQuads(items, flat, hit.start, hit.end)
  // 3 of 10 characters, starting at the third: 30pt wide, 20pt in.
  assert.equal(quad.x, 120)
  assert.equal(quad.w, 30)
})

test('a hit spanning a line break draws one quad per line', () => {
  const items = [run('under-', 72, 0), run('stand', 72, 1)]
  const flat = flattenPage(items)
  const [hit] = findAll(flat, 'understand')

  const quads = hitQuads(items, flat, hit.start, hit.end)
  assert.equal(quads.length, 2, 'a wrapped hit must not merge into one box')
  // Top line first, and the dropped hyphen is not part of the mark.
  assert.ok(quads[0].y > quads[1].y)
  assert.ok(quads[0].w < items[0].quad.w, 'the hyphen was included in the mark')
})

test('the context sentence stops at sentence boundaries', () => {
  const text = 'First one. The term is here. Last one.'
  const at = text.indexOf('term')

  assert.equal(sentenceAround(text, at, at + 4), 'The term is here.')
})

test('an over-long sentence is capped around the term, never past it', () => {
  const filler = 'word '.repeat(200)
  const text = `${filler}TERM ${filler}`
  const at = text.indexOf('TERM')

  const out = sentenceAround(text, at, at + 4)

  assert.ok(out.length <= 300, `context leaked at ${out.length} chars`)
  assert.ok(out.includes('TERM'), 'the cap cut out the term itself')
})
