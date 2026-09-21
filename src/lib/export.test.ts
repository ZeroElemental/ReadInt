/**
 * Run with: npm test
 *
 * Guards the two places an export can be quietly wrong: the text lifted from
 * under a mark (a cut word, a neighbour dragged in, a hyphen left in), and the
 * Markdown around it. Pure — no DOM, no store.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMarkdown,
  escapeMarkdown,
  exportName,
  markedText,
  pagedOrder,
  snapToWords,
} from './export.ts'
import type { Annotation, Quad, TextItem } from './types.ts'

/** One run: 25 characters at 10 units each, so character i's centre is 100 + 10i + 5. */
const LINE = 'the quick brown fox jumps'
const run = (str: string, x: number, y: number, lineId = 0): TextItem => ({
  str,
  quad: { x, y, w: str.length * 10, h: 12 },
  lineId,
})
const quad = (x0: number, x1: number, y = 700): Quad => ({ x: x0, y, w: x1 - x0, h: 12 })

test('a mark on part of a run yields just that part', () => {
  // 'quick brown' is characters 4-14: x 140 to 250, exactly.
  assert.equal(markedText([run(LINE, 100, 700)], [quad(140, 250)]), 'quick brown')
})

test('an edge that drifts a character or two neither cuts nor drags a word', () => {
  const items = [run(LINE, 100, 700)]

  // Runs into the next word by one letter: 'fox' is 1/3 covered, so it stays out.
  assert.equal(markedText(items, [quad(140, 272)]), 'quick brown')
  // Stops short inside 'brown', 4 of 5 letters: the whole word goes in.
  assert.equal(markedText(items, [quad(140, 238)]), 'quick brown')
})

test('a mark inside one word is that whole word', () => {
  assert.equal(markedText([run(LINE, 100, 700)], [quad(152, 168)]), 'quick')
})

test('a mark across a line break rejoins a hyphenated word', () => {
  const items = [run('a reader should under-', 100, 700, 0), run('stand a break', 100, 686, 1)]
  const quads = [quad(100, 320, 700), quad(100, 160, 686)]

  assert.equal(markedText(items, quads), 'a reader should understand')
})

test('a mark on another line takes nothing from this one', () => {
  const items = [run(LINE, 100, 700)]

  assert.equal(markedText(items, [quad(100, 350, 500)]), '')
})

test('no text and no quads are both empty, not errors', () => {
  assert.equal(markedText([], [quad(0, 10)]), '')
  assert.equal(markedText([run(LINE, 100, 700)], []), '')
})

test('snapToWords keeps a range that is only whitespace as it found it', () => {
  assert.deepEqual(snapToWords('a   b', 1, 3), [1, 3])
})

const mark = (
  type: Annotation['type'],
  pageIndex: number,
  extra: Partial<Annotation> = {},
): Annotation => ({
  id: crypto.randomUUID(),
  docId: 'd',
  pageIndex,
  type,
  color: '#ffe066',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
})

test('marks come out in reading order: page, then top to bottom', () => {
  const low = mark('highlight', 0, { quads: [quad(0, 10, 100)] })
  const high = mark('highlight', 0, { quads: [quad(0, 10, 600)] })
  const later = mark('highlight', 1, { quads: [quad(0, 10, 700)] })
  const drawing = mark('ink', 0, { path: 'M 0 0 Z' })

  // Page units grow UPWARD, so the top of the page is the LARGER y.
  assert.deepEqual(
    pagedOrder([later, drawing, low, high]).map((a) => a.id),
    [high.id, low.id, drawing.id, later.id],
    'a drawing has no line to sit on and goes last on its page',
  )
})

const NOW = new Date('2026-09-21T10:00:00Z')
const label = (i: number) => `Page ${i + 1}`
const base = { title: 't', exportedAt: NOW, groupLabel: label }

test('the document is grouped by page, with a counted, dated summary', () => {
  const md = buildMarkdown({
    ...base,
    title: 'Alice',
    marks: [
      { annotation: mark('highlight', 0), text: 'down the rabbit-hole' },
      { annotation: mark('highlight', 0), text: 'very tired' },
      { annotation: mark('underline', 2), text: 'curiouser' },
    ],
  })

  assert.match(md, /^# Alice\n/)
  assert.match(md, /Marks exported from ReadInt on 2026-09-21 — 2 highlights, 1 underline\*/)
  assert.equal(md.match(/^## /gm)?.length, 2, 'one heading per page, not per mark')
  assert.match(md, /## Page 1\n\n> down the rabbit-hole\n\n> very tired\n\n## Page 3\n\n> curiouser/)
})

test('an underline is flagged, since a blockquote alone would read as a highlight', () => {
  const md = buildMarkdown({ ...base, marks: [{ annotation: mark('underline', 0), text: 'word' }] })

  assert.match(md, /> word \*\(underlined\)\*/)
})

test('a note anchored to text quotes it and answers below; a free note stands alone', () => {
  const md = buildMarkdown({
    ...base,
    marks: [
      { annotation: mark('note', 0, { text: 'she says this a lot' }), text: 'Duchess' },
      { annotation: mark('note', 1, { text: 'check this\nlater' }), text: '' },
    ],
  })

  assert.match(md, /> Duchess\n\n\*\*Note:\*\* she says this a lot/)
  assert.match(md, /## Page 2\n\n\*\*Note:\*\* check this {2}\nlater/, 'a multi-line note stays one paragraph')
})

test('drawings are counted per page rather than silently lost', () => {
  const md = buildMarkdown({
    ...base,
    marks: [
      { annotation: mark('ink', 0), text: '' },
      { annotation: mark('ink', 0), text: '' },
      { annotation: mark('highlight', 1), text: 'x' },
    ],
  })

  assert.match(md, /2 freehand drawings here, not included/)
  assert.match(md, /2 drawings/, 'and in the summary')
})

test('a highlight whose text could not be found says so instead of quoting nothing', () => {
  const md = buildMarkdown({ ...base, marks: [{ annotation: mark('highlight', 0), text: '' }] })

  assert.match(md, /> \*\(the marked text could not be extracted\)\*/)
})

test('lifted prose is escaped so a stray asterisk is not read as emphasis', () => {
  assert.equal(escapeMarkdown('2 * 3 = a_b'), '2 \\* 3 = a\\_b')
  assert.equal(escapeMarkdown('# not a heading'), '\\# not a heading')
})

test('an empty export still says what it is', () => {
  const md = buildMarkdown({ ...base, title: 'Empty', marks: [] })

  assert.match(md, /^# Empty\n\n\*Marks exported from ReadInt on 2026-09-21\*\n$/)
})

test('a filename loses its extension and any path characters', () => {
  assert.equal(exportName('Alice: Wonderland.epub', '-marks.md'), 'Alice- Wonderland-marks.md')
  assert.equal(exportName('', '-marks.md'), 'document-marks.md')
})
