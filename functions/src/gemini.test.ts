/**
 * Run with: npm test   (Node 24 — it strips types; the deploy runtime, 22, does not)
 *
 * A fake Gemini stands in for the network, so the two branches that matter — a
 * retired model and an ordinary failure — are exercised without a key. Excluded
 * from the build in tsconfig.json: it is not part of what gets deployed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { defineTerm, describeFailure, FALLBACK_MODEL, PRIMARY_MODEL } from './gemini.ts'

const answer = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })

const failure = (status: number, message: string, code = 'NOT_FOUND') =>
  new Response(JSON.stringify({ error: { code: status, message, status: code } }), { status })

/** Records which model each call asked for, and replies from a script. */
function fake(...replies: Response[]) {
  const asked: string[] = []
  const fetchImpl = async (url: string) => {
    asked.push(url.match(/models\/([^:]+):/)![1])
    return replies.shift()!
  }
  return { asked, fetchImpl }
}

test('a healthy primary is called once and answers', async () => {
  const { asked, fetchImpl } = fake(answer('a thing'))
  const out = await defineTerm('p', 'k', fetchImpl)

  assert.deepEqual(asked, [PRIMARY_MODEL])
  assert.ok(out.ok && out.meaning === 'a thing')
})

test('a 404 retries once against the fallback and returns ITS answer', async () => {
  const { asked, fetchImpl } = fake(failure(404, 'model is no longer available'), answer('still works'))
  const out = await defineTerm('p', 'k', fetchImpl)

  assert.deepEqual(asked, [PRIMARY_MODEL, FALLBACK_MODEL])
  assert.ok(out.ok && out.model === FALLBACK_MODEL && out.meaning === 'still works')
})

test('when both are gone, the PRIMARY failure is the one reported', async () => {
  // The fallback's error is about the fallback. The primary's says what to change.
  const { fetchImpl } = fake(
    failure(404, 'gemini-3.6-flash is retired; use gemini-4-flash'),
    failure(400, 'thinkingLevel is not supported', 'INVALID_ARGUMENT'),
  )
  const out = await defineTerm('p', 'k', fetchImpl)

  assert.ok(!out.ok)
  assert.equal(out.model, PRIMARY_MODEL)
  assert.match(out.upstream.reason, /use gemini-4-flash/)
})

test('anything but a 404 is NOT retried', async () => {
  // A 429 or a 500 would fail the same way against a second model, and a retry
  // would double the load on a service that is already refusing.
  for (const status of [400, 403, 429, 500, 503]) {
    const { asked, fetchImpl } = fake(failure(status, 'no'), answer('should never be reached'))
    const out = await defineTerm('p', 'k', fetchImpl)

    assert.deepEqual(asked, [PRIMARY_MODEL], `status ${status}`)
    assert.ok(!out.ok && out.upstream.status === status)
  }
})

test("Google's status enum and message both survive, and the reason is bounded", () => {
  const { status, reason } = describeFailure(
    404,
    JSON.stringify({ error: { message: 'x'.repeat(500), status: 'NOT_FOUND' } }),
  )

  assert.equal(status, 404)
  assert.ok(reason.startsWith('NOT_FOUND: xxx'))
  assert.equal(reason.length, 200)
})

test('a non-JSON body is reported rather than swallowed', () => {
  const { reason } = describeFailure(502, '<html>\n  Bad   Gateway\n</html>')

  assert.equal(reason, '<html> Bad Gateway </html>', 'whitespace collapsed')
})

test('a 200 with no answer is reported as such, not as success', async () => {
  const empty = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] } }] }), { status: 200 })
  const out = await defineTerm('p', 'k', fake(empty).fetchImpl)

  assert.ok(!out.ok)
  assert.equal(out.upstream.reason, 'no definition returned')
})
