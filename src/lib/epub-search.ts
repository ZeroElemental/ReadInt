/**
 * An EPUB section's DOM -> one string, with a map back to the text node that
 * produced each character.
 *
 * This is the EPUB counterpart to `flattenPage` in search.ts, and it exists for
 * the same reason: what the reader searches is one continuous string, but what
 * the hit has to be expressed in is the document's own addressing. For a PDF
 * that meant quads in page units; here it means a DOM Range, which epub.js
 * turns into a CFI. Everything BETWEEN those two ends — folding, matching, the
 * context sentence and its 300-character cap — is search.ts's, shared by both.
 *
 * Pure, and free of DOM globals on purpose: it walks `childNodes` and reads
 * `nodeType` numerically, so `node --test` can feed it a plain object tree. The
 * Range is built by the caller, which has a real document to build it in.
 */

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** The shape this walk needs. A real DOM Node satisfies it; so can a fake. */
export interface NodeLike {
  nodeType: number
  nodeName?: string
  nodeValue?: string | null
  childNodes?: ArrayLike<NodeLike>
}

/** One text node's slice of the flattened string. `end` is exclusive. */
export interface TextRun {
  node: NodeLike
  start: number
  end: number
}

export interface SectionText {
  text: string
  runs: TextRun[]
}

/**
 * Elements whose boundaries are a break in the prose.
 *
 * Without this, `<p>the end</p><p>Start here</p>` flattens to `endStart` and a
 * search for "endstart" would hit across a paragraph break that no reader can
 * see. A newline is enough: `normalize` folds runs of whitespace to one space,
 * so the separator costs a word boundary and nothing else.
 */
const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TD', 'TH', 'TR', 'UL',
])

/** Elements whose text is markup, not prose. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'NOSCRIPT'])

const tag = (node: NodeLike) => (node.nodeName ?? '').toUpperCase()

/**
 * Walk a section's DOM into one searchable string.
 *
 * Offsets in the result index the RAW string, which is what `findAll` returns
 * and what `sentenceAround` expects, so nothing downstream has to know a DOM
 * was involved.
 */
export function flattenSection(root: NodeLike): SectionText {
  const parts: string[] = []
  const runs: TextRun[] = []
  let at = 0

  const push = (s: string) => {
    parts.push(s)
    at += s.length
  }

  const walk = (node: NodeLike) => {
    if (node.nodeType === TEXT_NODE) {
      const value = node.nodeValue ?? ''
      if (!value) return
      runs.push({ node, start: at, end: at + value.length })
      push(value)
      return
    }

    if (node.nodeType !== ELEMENT_NODE) return
    if (SKIP.has(tag(node))) return

    const block = BLOCK.has(tag(node))
    // Before AND after: a block's opening edge separates it from whatever ran
    // up to it, and its closing edge from whatever follows.
    if (block) push('\n')
    const kids = node.childNodes
    for (let i = 0; i < (kids?.length ?? 0); i++) walk(kids![i])
    if (block) push('\n')
  }

  walk(root)
  return { text: parts.join(''), runs }
}

/**
 * An offset in the flattened string -> the text node holding it, and where.
 *
 * An offset can land on a separator this module inserted, which belongs to no
 * node. Those are whitespace, so a match never starts inside one — but a
 * match's END can sit just past the last character of a run, which is exactly
 * the exclusive bound a Range wants. Both cases resolve to the nearest real
 * position rather than failing.
 */
export function locate(
  section: SectionText,
  offset: number,
  prefer: 'start' | 'end' = 'start',
): { node: NodeLike; offset: number } | null {
  const { runs } = section
  if (runs.length === 0) return null

  // Binary search for the last run starting at or before `offset`.
  let lo = 0
  let hi = runs.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid].start <= offset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  const run = runs[found]

  // A boundary between two touching runs — `<em>lazy</em> dog` — is one DOM
  // position with two spellings, and a Range accepts either. For an END
  // boundary the trailing edge of the run before it is the tidier one: ending
  // at offset 0 of the next node drags a sibling that contributes nothing into
  // the CFI range.
  const prev = runs[found - 1]
  if (prefer === 'end' && run.start === offset && prev?.end === offset) {
    return { node: prev.node, offset: prev.end - prev.start }
  }

  // Past this run's end means the offset fell in a separator after it; clamp to
  // the run's own end, which is the last real position before that gap.
  return { node: run.node, offset: Math.min(offset, run.end) - run.start }
}
