/**
 * Run with: npm test
 *
 * Guards the DOM -> string -> DOM round trip, which is where an off-by-one
 * sends a search hit to the wrong paragraph without anything throwing. The walk
 * reads nodeType numerically and never touches a DOM global, so node can run
 * this against a plain object tree.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenSection, locate, type NodeLike } from './epub-search.ts'
import { findAll, sentenceAround } from './search.ts'

const text = (value: string): NodeLike => ({ nodeType: 3, nodeValue: value })
const el = (nodeName: string, ...childNodes: NodeLike[]): NodeLike => ({
  nodeType: 1,
  nodeName,
  childNodes,
})

/** Two paragraphs, the second with an inline element splitting a sentence. */
const section = () =>
  el(
    'body',
    el('p', text('The quick brown fox.')),
    el('p', text('It jumped over the '), el('em', text('lazy')), text(' dog.')),
  )

test('text comes out in reading order', () => {
  const flat = flattenSection(section())

  assert.match(flat.text, /The quick brown fox\./)
  assert.match(flat.text, /It jumped over the lazy dog\./)
  assert.ok(
    flat.text.indexOf('quick') < flat.text.indexOf('jumped'),
    'document order is preserved',
  )
})

test('an inline element does not break a word or insert a space', () => {
  // <em> is not a block, so "the lazy dog" has to read as one phrase — an
  // inline tag mid-sentence is exactly the case that would otherwise show up
  // as "the lazydog" or "the  lazy  dog" in a search.
  const flat = flattenSection(section())

  assert.equal(findAll(flat.text, 'the lazy dog').length, 1)
})

test('a block boundary separates words that would otherwise join', () => {
  // Without the separator this flattens to "fox.It" and a reader searching
  // "foxit" would get a hit across a paragraph break they cannot see.
  const flat = flattenSection(section())

  assert.equal(findAll(flat.text, 'foxit').length, 0)
  assert.equal(findAll(flat.text, 'fox').length, 1)
})

test('script and style content never reaches the reader', () => {
  const flat = flattenSection(
    el('body', el('style', text('p { color: red }')), el('p', text('Real prose.'))),
  )

  assert.equal(findAll(flat.text, 'color').length, 0)
  assert.equal(findAll(flat.text, 'real prose').length, 1)
})

test('a hit maps back to the node and character that produced it', () => {
  const root = section()
  const flat = flattenSection(root)
  const [hit] = findAll(flat.text, 'lazy')

  const start = locate(flat, hit.start)!
  assert.equal(start.node.nodeValue, 'lazy', 'the <em> text node, not its neighbour')
  assert.equal(start.offset, 0)

  const end = locate(flat, hit.end, 'end')!
  assert.equal(end.node.nodeValue, 'lazy')
  assert.equal(end.offset, 4, 'exclusive bound, which is what a Range wants')
})

test('an end boundary prefers the trailing edge over the next node', () => {
  // (lazy, 4) and (' dog.', 0) are the SAME DOM position and a Range takes
  // either. The first keeps the range inside <em>; the second drags a sibling
  // into the CFI for no reason.
  const flat = flattenSection(section())
  const [hit] = findAll(flat.text, 'lazy')

  assert.equal(locate(flat, hit.end)!.node.nodeValue, ' dog.', 'start bias')
  assert.equal(locate(flat, hit.end, 'end')!.node.nodeValue, 'lazy', 'end bias')
})

test('a hit spanning two text nodes resolves both ends', () => {
  const root = section()
  const flat = flattenSection(root)
  const [hit] = findAll(flat.text, 'lazy dog')

  assert.equal(locate(flat, hit.start)!.node.nodeValue, 'lazy')
  assert.equal(locate(flat, hit.end, 'end')!.node.nodeValue, ' dog.')
})

test('an offset landing on an inserted separator clamps to real text', () => {
  const flat = flattenSection(section())
  // The newline between the two paragraphs belongs to no node.
  const sep = flat.text.indexOf('.\n') + 1
  const at = locate(flat, sep)!

  assert.equal(at.node.nodeValue, 'The quick brown fox.')
  assert.equal(at.offset, 20, 'the end of the run before the gap')
})

test('the context sentence is the same code the PDF path uses', () => {
  const flat = flattenSection(section())
  const [hit] = findAll(flat.text, 'lazy')

  // Not a new cap for EPUB: MAX_CONTEXT is invariant 11, and this is the proof
  // that one function enforces it on both paths.
  const sentence = sentenceAround(flat.text, hit.start, hit.end)
  assert.match(sentence, /jumped over the lazy dog/)
  assert.ok(sentence.length <= 300)
})

test('an empty section yields nothing rather than throwing', () => {
  const flat = flattenSection(el('body'))

  assert.equal(flat.runs.length, 0)
  assert.equal(locate(flat, 0), null)
})
