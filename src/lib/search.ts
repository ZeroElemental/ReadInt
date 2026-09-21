/**
 * In-document search, and the sentence context the definition popup sends.
 *
 * Pure: TextItem[] in, character ranges and page-unit quads out. No DOM, no
 * Dexie, no network — which is why it is the one part of phase 4 that can be
 * proven by `node --test` instead of by eye.
 *
 * The whole problem is that a page's text is not a string. It is a few hundred
 * positioned runs, split wherever the font changed, wrapped across lines, with
 * words cut in half by a hyphen at the line break. Searching means flattening
 * that into one string, folding it so "Ångström" is found by typing "angstrom",
 * and then mapping a hit back to the runs it came from.
 *
 * So: flatten once (keeping who owns each character), fold with a map back to
 * the raw string, search the folded text, then walk both maps home.
 */

import type { Quad, TextItem } from './types.ts'
import { mergeQuadsByLine } from './coords.ts'

/** A page as one string, plus the provenance of every character in it. */
export interface Flat {
  text: string
  /** Which TextItem produced text[i]. -1 for a joiner this module inserted. */
  owners: number[]
  /** Where text[i] sits inside that item's own str. -1 for a joiner. */
  offsets: number[]
}

/** Folded text, plus src[i] = the index in the input that produced text[i]. */
export interface Norm {
  text: string
  src: number[]
}

/** Longest context sentence that may cross the network. See AGENTS.md. */
export const MAX_CONTEXT = 300

/**
 * Characters NFKD leaves alone but a reader expects to be interchangeable.
 * Typographic quotes and dashes, mostly — nobody types U+2019 into a search box.
 */
const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  ' ': ' ',
}

/**
 * A run ends a word when the next run starts this far past its right edge,
 * measured against the run's own height.
 *
 * Calibrated, not guessed. The case this exists for is a run split mid-word,
 * where the gap is zero or slightly negative; kerning puts the ceiling on that
 * noise at roughly 0.05. Real spaces measured across an OCR'd page of 21pt
 * serif ran 0.242 to 0.636, and the original 0.25 sat squarely inside that
 * range — close enough that one pair in twenty-four came back as `Everyquad`.
 * 0.12 is twice the kerning ceiling and half the narrowest real space seen.
 */
const GAP_RATIO = 0.12

/**
 * One page's runs as one string.
 *
 * Two joining decisions, and both of them matter:
 *
 * - **Within a line**, a space goes in only when there is a real horizontal
 *   gap. pdf.js splits a run at every font change, so a bolded syllable in the
 *   middle of a word arrives as two runs with nothing between them; joining
 *   those with a space would put a break inside a word that has none.
 * - **Across a line**, a trailing hyphen is DROPPED and the runs are joined
 *   directly, so "under-\nstand" flattens to "understand" and is found by
 *   searching for it. Anything else gets a space.
 */
/**
 * Does a space belong between these two consecutive runs?
 *
 * Exported because the text layer has to make the SAME call: a run boundary is
 * not a word boundary, and the browser's own selection concatenates adjacent
 * spans with nothing in between. On a digital PDF that rarely shows, because
 * pdf.js splits a run at a font change and both halves are usually mid-word.
 * On an OCR'd page every single word is its own run, so without this a
 * two-word selection reads `coordinatesystem` — and that is what reaches the
 * definition popup. One rule, both consumers, no chance of them disagreeing.
 */
export function needsSpace(prev: TextItem, item: TextItem): boolean {
  if (item.lineId !== prev.lineId) return true
  const gap = item.quad.x - (prev.quad.x + prev.quad.w)
  return gap > GAP_RATIO * item.quad.h
}

export function flattenPage(items: TextItem[]): Flat {
  const text: string[] = []
  const owners: number[] = []
  const offsets: number[] = []

  const push = (ch: string, owner: number, offset: number) => {
    text.push(ch)
    owners.push(owner)
    offsets.push(offset)
  }

  const drop = () => {
    text.pop()
    owners.pop()
    offsets.pop()
  }

  items.forEach((item, i) => {
    const last = text[text.length - 1]

    if (i > 0 && last !== undefined && !/\s/.test(last)) {
      const prev = items[i - 1]
      if (item.lineId !== prev.lineId) {
        // The hyphenation case. The hyphen is an artefact of the line break,
        // not a character of the word, so it leaves with its map entries.
        if (last === '-' || last === '­') drop()
        else push(' ', -1, -1)
      } else if (needsSpace(prev, item)) {
        push(' ', -1, -1)
      }
    }

    // By code unit, not by code point: these indices have to line up with the
    // joined string's own indices, and a surrogate pair is two of those.
    for (let k = 0; k < item.str.length; k++) push(item.str[k], i, k)
  })

  return { text: text.join(''), owners, offsets }
}

/**
 * Case, diacritics, ligatures and whitespace folded away, with a map home.
 *
 * Folded per character rather than over the whole string, because NFKD is not
 * length-preserving — a ligature becomes two characters, an accented letter
 * becomes one after its combining mark is stripped — and a hit is worthless if
 * it cannot be mapped back to the run it came from.
 */
export function normalize(s: string): Norm {
  const out: string[] = []
  const src: number[] = []

  for (let i = 0; i < s.length; i++) {
    const raw = s[i]

    if (/\s/.test(raw)) {
      // A run of whitespace is one space, and a leading run is nothing.
      if (out.length && out[out.length - 1] !== ' ') {
        out.push(' ')
        src.push(i)
      }
      continue
    }

    const folded = (FOLD[raw] ?? raw)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()

    for (let k = 0; k < folded.length; k++) {
      out.push(folded[k])
      src.push(i)
    }
  }

  return { text: out.join(''), src }
}

/**
 * Every occurrence of `query`, as ranges into `text` (the RAW string, not the
 * folded one — callers map those to quads and to context sentences).
 *
 * Takes a plain string rather than a `Flat` because that is all it ever read,
 * and because EPUB has no `Flat` to give it: a section's text comes from its
 * DOM, not from positioned runs. Both formats therefore share this, `normalize`
 * and `sentenceAround` — which matters most for the last one, since MAX_CONTEXT
 * is the privacy boundary in invariant 11 and two copies of it could drift.
 */
export function findAll(
  text: string,
  query: string,
): { start: number; end: number }[] {
  const needle = normalize(query)
  if (!needle.text) return []

  const hay = normalize(text)
  const hits: { start: number; end: number }[] = []

  let at = hay.text.indexOf(needle.text)
  while (at !== -1) {
    hits.push({
      start: hay.src[at],
      // The last folded character's source, +1: one raw character can fold to
      // several, so the end cannot be derived from the query's length.
      end: hay.src[at + needle.text.length - 1] + 1,
    })
    at = hay.text.indexOf(needle.text, at + needle.text.length)
  }
  return hits
}

/**
 * A hit's range -> quads to draw, one per line, in page units.
 *
 * Joiners are skipped: a space this module invented has no glyph and therefore
 * no geometry.
 */
export function hitQuads(
  items: TextItem[],
  flat: Flat,
  start: number,
  end: number,
): Quad[] {
  /** Which characters of each run the hit touches. */
  const touched = new Map<number, { from: number; to: number }>()

  for (let i = Math.max(0, start); i < Math.min(end, flat.owners.length); i++) {
    const owner = flat.owners[i]
    if (owner < 0) continue
    const off = flat.offsets[i]
    const span = touched.get(owner)
    if (!span) touched.set(owner, { from: off, to: off })
    else {
      if (off < span.from) span.from = off
      if (off > span.to) span.to = off
    }
  }

  const slices: Quad[] = []
  for (const [owner, { from, to }] of touched) {
    const { quad, str } = items[owner]
    const len = str.length || 1
    // ponytail: proportional slice, i.e. every glyph in the run is assumed to
    // be the same width. Off by a fraction of a character on body text; exact
    // slicing would need per-character advances, which TextItem does not carry.
    // Upgrade there if a hit inside a run of mixed-width glyphs looks wrong.
    slices.push({
      x: quad.x + (quad.w * from) / len,
      y: quad.y,
      w: (quad.w * (to + 1 - from)) / len,
      h: quad.h,
    })
  }

  return mergeQuadsByLine(slices)
}

/**
 * The sentence a term sits in, capped.
 *
 * This is the ONLY page content that ever leaves the device, so the cap is not
 * cosmetic — it is the privacy claim in AGENTS.md made executable. When the
 * sentence is longer than the cap the window is centred on the term, so the
 * thing being defined is never what gets cut.
 */
export function sentenceAround(
  text: string,
  start: number,
  end: number,
  max = MAX_CONTEXT,
): string {
  let a = start
  while (a > 0 && !/[.!?]/.test(text[a - 1])) a--
  let b = end
  while (b < text.length && !/[.!?]/.test(text[b])) b++
  if (b < text.length) b++ // keep the terminator

  if (b - a > max) {
    const centre = Math.floor((start + end) / 2)
    a = Math.max(a, Math.min(centre - Math.floor(max / 2), b - max))
    b = a + max
  }

  // Collapsing can only shorten, so the cap still holds after it.
  return text.slice(a, b).replace(/\s+/g, ' ').trim()
}
