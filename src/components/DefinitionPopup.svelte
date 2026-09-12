<script lang="ts">
  /**
   * Selection -> meaning, in a small card above the selection.
   *
   *   1. cache        -> Dexie, by (folded term, docId). A repeat lookup never
   *                      touches the network again.
   *   2. single word  -> dictionaryapi.dev straight from the browser
   *                      (keyless, CORS-open, instant)
   *   3. miss/phrase  -> POST /api/define with the term AND its surrounding
   *                      sentence, so the model explains the term the way this
   *                      document uses it
   *
   * THE PRIVACY BOUNDARY RUNS THROUGH THIS FILE. It is the only place in the
   * app that talks to anything off-device. Two things may leave, both of them
   * assembled here: the selected term, and one sentence of context capped by
   * `sentenceAround`'s default. The document itself never leaves — not the
   * blob, not a page's text, not the annotations.
   */
  import { reader } from '../lib/reader.svelte.ts'
  import { getLookup, putLookup } from '../lib/storage.ts'
  import { pageText } from '../adapters/index.ts'
  import { findAll, flattenPage, normalize, sentenceAround } from '../lib/search.ts'

  interface Props {
    /** "Find in document" hands the term to the search panel. */
    onfind: (term: string) => void
  }
  let { onfind }: Props = $props()

  /** Longer than this is a passage, not a term, and nothing is sent. */
  const MAX_TERM = 120
  const DICTIONARY = 'https://api.dictionaryapi.dev/api/v2/entries/en/'
  /**
   * A lookup that has not answered by now never will, usefully. Without this a
   * request that hangs rather than fails — a captive portal, a dead tunnel,
   * an offline machine — leaves the card saying "Looking up…" indefinitely.
   */
  const NET_TIMEOUT_MS = 8000
  /** Half the card's max-width, so it can be kept fully on screen. */
  const HALF = 180
  /** Below this much room above the selection, the card flips underneath it. */
  const HEADROOM = 150

  type Answer = { meaning: string; source: 'dictionary' | 'ai' }

  let term = $state('')
  let meaning = $state('')
  let source = $state<Answer['source'] | null>(null)
  let loading = $state(false)
  let anchor = $state<{ x: number; y: number; below: boolean } | null>(null)
  let card = $state<HTMLDivElement | null>(null)

  let inflight: AbortController | null = null

  /** The user's cancel, plus a deadline. Whichever fires first wins. */
  const deadline = (signal: AbortSignal) =>
    AbortSignal.any([signal, AbortSignal.timeout(NET_TIMEOUT_MS)])

  function dismiss() {
    inflight?.abort()
    inflight = null
    anchor = null
    term = ''
    meaning = ''
    source = null
    loading = false
  }

  // A page turn moves the text the card is pointing at, so the card goes too.
  $effect(() => {
    void reader.spreadStart
    dismiss()
  })

  /**
   * pointerup, not selectionchange: a selection is only final once the gesture
   * ends. Same reasoning, and same trigger, as TextLayer.commitSelection.
   */
  function onpointerup(ev: PointerEvent) {
    // Highlight and underline consume the selection themselves; this would be
    // a second thing reacting to the same gesture.
    if (reader.tool !== 'select') return
    if (card?.contains(ev.target as Node)) return

    const sel = getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return dismiss()

    const range = sel.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement
    const page = el?.closest('.page') as HTMLElement | null
    if (!page) return dismiss()

    const selected = sel.toString().replace(/\s+/g, ' ').trim()
    if (!selected || selected.length > MAX_TERM) return dismiss()

    // The RANGE rect, not a quad: the card is viewport-fixed and never needs
    // page units, so no conversion — and therefore no drift — is involved.
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return dismiss()

    const below = rect.top < HEADROOM
    term = selected
    anchor = {
      x: Math.min(Math.max(rect.left + rect.width / 2, HALF), innerWidth - HALF),
      y: below ? rect.bottom : rect.top,
      below,
    }
    void lookUp(selected, Number(page.dataset.page))
  }

  async function lookUp(selected: string, pageIndex: number) {
    const docId = reader.docId
    if (!docId) return

    inflight?.abort()
    const ctl = new AbortController()
    inflight = ctl

    // Folded, so "The", "the" and "thé" are one cache row rather than three.
    const key = normalize(selected).text
    loading = true
    meaning = ''
    source = null

    try {
      const cached = await getLookup(key, docId)
      if (ctl.signal.aborted) return
      if (cached) {
        meaning = cached.meaning
        source = cached.source
        return
      }

      // A single word has a dictionary entry; a phrase never does.
      const word = /^[\p{L}][\p{L}'-]*$/u.test(selected)
      let answer = word ? await fromDictionary(selected, ctl.signal) : null
      if (ctl.signal.aborted) return

      if (!answer) {
        const fallback = await fromModel(selected, pageIndex, docId, ctl.signal)
        if (ctl.signal.aborted) return
        if (fallback === 'unavailable') {
          meaning = 'Definition service not available yet.'
          return
        }
        answer = fallback
      }

      if (!answer) {
        meaning = 'No definition found.'
        return
      }

      meaning = answer.meaning
      source = answer.source
      // Written on success ONLY. Caching a failure would turn one bad moment
      // on the network into a permanently wrong answer for this document.
      await putLookup({
        term: key,
        docId,
        meaning: answer.meaning,
        source: answer.source,
        fetchedAt: Date.now(),
      })
    } catch (err) {
      const name = (err as Error)?.name
      // AbortError = a newer selection superseded this one; say nothing.
      if (name === 'AbortError') return
      console.error('lookup failed', err)
      meaning = name === 'TimeoutError' ? 'Lookup timed out.' : 'Lookup failed.'
    } finally {
      if (inflight === ctl) loading = false
    }
  }

  /** Only the word leaves. A 404 here means "not a word I know", not an error. */
  async function fromDictionary(word: string, signal: AbortSignal): Promise<Answer | null> {
    let res: Response
    try {
      res = await fetch(DICTIONARY + encodeURIComponent(word), { signal: deadline(signal) })
    } catch (err) {
      // Only a real cancellation stops the lookup. Offline, blocked or simply
      // too slow is not fatal here — the model fallback is the next step, and
      // it is the one that can answer without a dictionary.
      if ((err as Error)?.name === 'AbortError') throw err
      console.warn('dictionary unreachable', err)
      return null
    }
    if (!res.ok) return null

    const entry = (await res.json())?.[0]?.meanings?.[0]
    const definition = entry?.definitions?.[0]?.definition
    if (!definition) return null

    return {
      meaning: entry.partOfSpeech ? `(${entry.partOfSpeech}) ${definition}` : definition,
      source: 'dictionary',
    }
  }

  /**
   * The term plus one sentence. 'unavailable' rather than null when the
   * endpoint does not answer at all — until the function is deployed, the dev
   * server hands back index.html for /api/define, and that is worth saying out
   * loud instead of reporting as "no definition".
   */
  async function fromModel(
    selected: string,
    pageIndex: number,
    docId: string,
    signal: AbortSignal,
  ): Promise<Answer | 'unavailable' | null> {
    const sentence = await context(selected, pageIndex, docId)
    try {
      const res = await fetch('/api/define', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ term: selected, sentence }),
        signal: deadline(signal),
      })
      const data = await res.json()
      if (res.ok && data?.meaning) return { meaning: data.meaning, source: 'ai' }
      if (res.ok) return null
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
    }
    return 'unavailable'
  }

  /**
   * The one sentence of page content allowed off the device.
   *
   * sentenceAround's default cap IS the boundary — do not pass a larger one
   * here, and do not join sentences to "give the model more to work with".
   */
  async function context(selected: string, pageIndex: number, docId: string): Promise<string> {
    const adapter = reader.adapter
    if (!adapter) return ''
    try {
      const items = await pageText(adapter, docId, pageIndex)
      const flat = flattenPage(items)
      const [hit] = findAll(flat, selected)
      return hit ? sentenceAround(flat.text, hit.start, hit.end) : ''
    } catch {
      // Context is a nicety; the term alone still gets a usable definition.
      return ''
    }
  }

  function find() {
    const q = term
    dismiss()
    onfind(q)
  }

  function web() {
    open(`https://duckduckgo.com/?q=${encodeURIComponent(term)}`, '_blank', 'noopener')
  }
</script>

<svelte:document {onpointerup} />
<svelte:window
  onkeydown={(e) => e.key === 'Escape' && dismiss()}
  onpointerdown={(e) => !card?.contains(e.target as Node) && dismiss()}
/>

{#if anchor}
  <div
    bind:this={card}
    class="popup"
    class:below={anchor.below}
    style:left="{anchor.x}px"
    style:top="{anchor.y}px"
    role="dialog"
    aria-label="Definition"
  >
    <strong>{term}</strong>
    {#if source}<span class="badge">{source === 'ai' ? 'AI' : 'dictionary'}</span>{/if}
    {#if loading}
      <p class="muted">Looking up…</p>
    {:else}
      <p>{meaning}</p>
    {/if}
    <footer>
      <button onclick={find}>Find in document</button>
      <button onclick={web}>Search the web</button>
    </footer>
  </div>
{/if}

<style>
  .popup {
    position: fixed;
    z-index: 20;
    transform: translate(-50%, calc(-100% - 10px));
    max-width: 22rem;
    padding: 0.6rem 0.75rem;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    font-size: 0.85rem;
  }
  /* No room above the selection: the card hangs below it instead. */
  .popup.below {
    transform: translate(-50%, 10px);
  }
  .popup p {
    margin: 0.35rem 0 0.5rem;
  }
  .muted {
    color: var(--muted);
  }
  .badge {
    margin-left: 0.4rem;
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    color: var(--muted);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  footer {
    display: flex;
    gap: 0.4rem;
  }
  footer button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 5px;
    background: none;
    cursor: pointer;
  }
  footer button:hover {
    background: var(--raise);
  }
</style>
