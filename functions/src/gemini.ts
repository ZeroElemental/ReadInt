/**
 * The Gemini call, and what to do when it fails.
 *
 * Split out of index.ts so it can be tested without a network, a secret or a
 * Firebase runtime: `fetch` is a parameter, and nothing here imports anything.
 *
 * The model id is a dependency with a support window, not a constant.
 * `gemini-2.5-flash` was closed to new projects between the line naming it being
 * written and the project being created, and answered `404`. When the id below
 * goes the same way the failure used to surface as a flat `502 upstream failed`,
 * with Google's "use this model instead" pointer thrown away into the function
 * logs. Two things fix that: the upstream status and reason now travel back in
 * the response body, and a `404` — the specific answer for "no such model" —
 * retries once against an alias that tracks the current Flash.
 */

export const PRIMARY_MODEL = 'gemini-3.6-flash'

/**
 * ponytail: `gemini-flash-latest` is an alias, so it survives the next
 * retirement without an edit — but it has NOT been exercised against this
 * project's key, and it is a different model than the one thinkingLevel
 * 'minimal' was tuned on (1.8-2.2s). If it ever fires, check the latency and
 * the answers before trusting it. One retry, not a chain: a second 404 is a
 * problem for a person, not for a loop.
 */
export const FALLBACK_MODEL = 'gemini-flash-latest'

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

/** Long enough to carry Google's own explanation; short enough to be a header's worth. */
const MAX_REASON = 200

export interface Upstream {
  status: number
  /** Google's own status text about the request — a model id, a quota, a bad field. */
  reason: string
}

export type Outcome =
  | { ok: true; meaning: string; model: string }
  | { ok: false; upstream: Upstream; model: string }

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Google answers with `{ error: { code, message, status } }`. The message is what
 * says what is wrong, and the status enum (NOT_FOUND, INVALID_ARGUMENT) is what
 * a person greps for. Neither carries the caller's text: this reports on the
 * request's shape, not its content, and it goes back only to the client that
 * sent it — invariant 11 governs what leaves the device, not what returns.
 */
export function describeFailure(status: number, body: string): Upstream {
  let reason = body
  try {
    const err = (JSON.parse(body) as { error?: { message?: string; status?: string } }).error
    if (err?.message) reason = err.status ? `${err.status}: ${err.message}` : err.message
  } catch {
    // Not JSON — an HTML error page from a proxy, say. The raw text is still
    // more use than nothing.
  }
  return { status, reason: reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON) }
}

async function ask(
  model: string,
  prompt: string,
  apiKey: string,
  fetchImpl: Fetch,
): Promise<Outcome> {
  const res = await fetchImpl(endpoint(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Thinking tokens count against this, so a tight cap returns an EMPTY
        // answer rather than a short one. Low thinking + generous ceiling; a
        // definition never comes close to spending it.
        maxOutputTokens: 800,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    }),
  })

  if (!res.ok) {
    return { ok: false, upstream: describeFailure(res.status, await res.text()), model }
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  }
  // A thinking model returns its reasoning in the same parts array, flagged
  // `thought`. The answer is the first part that is not one, which is why this
  // cannot just take parts[0].
  const meaning = data.candidates?.[0]?.content?.parts
    ?.find((part) => !part.thought && part.text?.trim())
    ?.text?.trim()

  if (!meaning) {
    return { ok: false, upstream: { status: res.status, reason: 'no definition returned' }, model }
  }
  return { ok: true, meaning, model }
}

export async function defineTerm(
  prompt: string,
  apiKey: string,
  fetchImpl: Fetch = fetch,
): Promise<Outcome> {
  const first = await ask(PRIMARY_MODEL, prompt, apiKey, fetchImpl)
  if (first.ok || first.upstream.status !== 404) return first

  // 404 is Google's answer for "no such model" — the only failure worth a retry
  // against a different one. A 429 or a 500 would fail the same way twice.
  console.warn(`${PRIMARY_MODEL} answered 404 (${first.upstream.reason}); trying ${FALLBACK_MODEL}`)
  const second = await ask(FALLBACK_MODEL, prompt, apiKey, fetchImpl)
  if (second.ok) return second

  // Report the FIRST failure when both fail: the fallback's error is about the
  // fallback, and the primary's is the one that says what to change.
  return first
}
