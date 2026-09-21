/**
 * /api/define — the only server ReadInt has.
 *
 * It receives a term and, at most, one sentence of context. It never receives
 * the document, a page of text, or anything identifying. That is the whole
 * contract, and it is enforced on BOTH sides: the client caps the sentence in
 * DefinitionPopup.svelte, and this rejects anything longer regardless.
 *
 * NO FRAMEWORK. The roadmap said Hono, and for one POST route that turned out
 * to be a dependency plus a real hazard: firebase-functions consumes the
 * request stream to populate `req.body`, so a fetch-style adapter mounted on
 * top of it waits forever for a body that has already been read. `onRequest`
 * hands over a parsed body directly. Reach for a router when there is a second
 * route to justify it.
 */

import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { defineTerm } from './gemini.js'

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY')

/** The privacy boundary, restated server-side. Must match the client's caps. */
const MAX_TERM = 120
const MAX_SENTENCE = 300

const WINDOW_MS = 60_000
const PER_WINDOW = 20
/** How many IPs to track before the table is dumped and rebuilt. */
const MAX_TRACKED = 5000

/**
 * ponytail: rate limiting in a plain Map, so the limit is PER INSTANCE — with
 * maxInstances 3 the real ceiling is 3x PER_WINDOW. That is fine for a $1
 * budget on a single-user app and stops a runaway loop cold. Move it to
 * Firestore or Redis if this ever serves real traffic.
 */
const seen = new Map<string, number[]>()

function allowed(ip: string): boolean {
  const now = Date.now()
  // A cold instance starts empty anyway; this just bounds a warm one's memory.
  if (seen.size > MAX_TRACKED) seen.clear()

  const recent = (seen.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  seen.set(ip, recent)
  return recent.length <= PER_WINDOW
}

/** Behind Hosting the socket is Google's, so the client is in the header. */
function clientIp(forwarded: string | undefined, fallback: string | undefined): string {
  return forwarded?.split(',')[0]?.trim() || fallback || 'unknown'
}

export const api = onRequest(
  {
    region: 'asia-south1',
    // Cost control, not capacity planning: this is what keeps a bug from
    // becoming a bill. Paired with a $1 budget alert on the project.
    maxInstances: 3,
    memory: '256MiB',
    timeoutSeconds: 20,
    secrets: [GEMINI_API_KEY],
    cors: true,
  },
  async (req, res) => {
    // Hosting rewrites /api/** here with the path intact.
    if (!req.path.endsWith('/define')) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' })
      return
    }
    if (!allowed(clientIp(req.get('x-forwarded-for'), req.ip))) {
      res.status(429).json({ error: 'slow down' })
      return
    }

    const { term, sentence } = (req.body ?? {}) as Record<string, unknown>

    if (typeof term !== 'string' || !term.trim() || term.length > MAX_TERM) {
      res.status(400).json({ error: 'term must be a string of 1-120 characters' })
      return
    }
    if (sentence !== undefined && typeof sentence !== 'string') {
      res.status(400).json({ error: 'sentence must be a string' })
      return
    }
    if (typeof sentence === 'string' && sentence.length > MAX_SENTENCE) {
      // Refused rather than truncated: the caller sending too much is a bug on
      // the side of the boundary that matters, and it should hear about it.
      res.status(400).json({ error: `sentence must be at most ${MAX_SENTENCE} characters` })
      return
    }

    const prompt = [
      'You explain a term to someone reading a document.',
      'Define the term as it is used in the sentence below.',
      'Answer in one or two plain sentences. No preamble, no markdown, no restating the question.',
      '',
      `Term: ${term}`,
      sentence
        ? `Sentence it appears in: ${sentence}`
        : 'No surrounding sentence was available; define the term generally.',
    ].join('\n')

    try {
      const out = await defineTerm(prompt, GEMINI_API_KEY.value())

      if (!out.ok) {
        console.error('gemini rejected the request', out.model, out.upstream)
        // The status and Google's own reason go back with the 502. A retired
        // model used to be a bare "upstream failed" whose real cause lived only
        // in the function logs; now the person reading the network tab sees it.
        const empty = out.upstream.reason === 'no definition returned'
        res.status(502).json({
          error: empty ? 'no definition returned' : 'upstream failed',
          upstream: out.upstream,
        })
        return
      }

      res.json({ meaning: out.meaning })
    } catch (err) {
      console.error('define failed', err)
      res.status(502).json({ error: 'upstream failed' })
    }
  },
)
