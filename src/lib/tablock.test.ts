/**
 * Run with: npm test
 *
 * A fake LockManager with the one semantic that matters: `ifAvailable` hands the
 * callback null when the name is already held, and a held lock stays held until
 * the callback's promise settles.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { lockDocument, type LocksLike } from './tablock.ts'

function fakeLocks(): LocksLike {
  const held = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()

  const grant = async (name: string, callback: (lock: unknown) => unknown) => {
    held.add(name)
    try {
      return await callback({ name })
    } finally {
      held.delete(name)
      waiting.get(name)?.shift()?.() // hand it to the next in line
    }
  }

  return {
    async request(name, options, callback) {
      if (!held.has(name)) return grant(name, callback)
      if (options.ifAvailable) return callback(null)

      // Queue behind the holder, and let an abort take us back out of the line.
      return new Promise((resolve, reject) => {
        const turn = () => resolve(grant(name, callback))
        const line = waiting.get(name) ?? []
        line.push(turn)
        waiting.set(name, line)
        options.signal?.addEventListener('abort', () => {
          waiting.set(name, (waiting.get(name) ?? []).filter((t) => t !== turn))
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    },
  }
}

const settle = () => new Promise((r) => setImmediate(r))

test('the first tab on a document holds the lock; the second does not', async () => {
  const locks = fakeLocks()
  const a = await lockDocument('doc-1', locks)
  const b = await lockDocument('doc-1', locks)

  assert.equal(a.held, true)
  assert.equal(b.held, false)
})

test('different documents never contend', async () => {
  const locks = fakeLocks()
  const a = await lockDocument('doc-1', locks)
  const b = await lockDocument('doc-2', locks)

  assert.ok(a.held && b.held)
})

test('releasing frees the document for the next tab', async () => {
  const locks = fakeLocks()
  const a = await lockDocument('doc-1', locks)
  a.release()
  await settle()

  const b = await lockDocument('doc-1', locks)
  assert.equal(b.held, true)
})

test('a tab that never held the lock cannot release someone else\'s', async () => {
  const locks = fakeLocks()
  const a = await lockDocument('doc-1', locks)
  const b = await lockDocument('doc-1', locks)
  b.release()
  await settle()

  assert.equal((await lockDocument('doc-1', locks)).held, false, 'a still holds it')
  a.release()
})

test('no Web Locks means the old behaviour: this tab autosaves', async () => {
  const lock = await lockDocument('doc-1', undefined)

  assert.equal(lock.held, true)
})

test('a waiting tab is promoted the moment the holder lets go', async () => {
  const locks = fakeLocks()
  let promoted = 0
  const a = await lockDocument('doc-1', locks)
  const b = await lockDocument('doc-1', locks, () => promoted++)

  assert.equal(b.held, false)
  assert.equal(promoted, 0, 'not promoted while a still holds it')

  a.release()
  await settle()

  assert.equal(promoted, 1, 'the other tab closing hands b the lock')
})

test('a tab that gives up while waiting is never promoted', async () => {
  // Closing a document must not leave a phantom waiter that later becomes owner
  // of a lock nobody is using — that would strand the real next tab behind it.
  const locks = fakeLocks()
  let promoted = 0
  const a = await lockDocument('doc-1', locks)
  const b = await lockDocument('doc-1', locks, () => promoted++)

  b.release()
  a.release()
  await settle()

  assert.equal(promoted, 0)
  assert.equal((await lockDocument('doc-1', locks)).held, true, 'the lock is free')
})

test('promotion is one-shot per waiter, in arrival order', async () => {
  const locks = fakeLocks()
  const order: string[] = []
  const a = await lockDocument('doc-1', locks)
  const b = await lockDocument('doc-1', locks, () => order.push('b'))
  await lockDocument('doc-1', locks, () => order.push('c'))

  a.release()
  await settle()
  assert.deepEqual(order, ['b'], 'only the first waiter is promoted')

  b.release()
  await settle()
  assert.deepEqual(order, ['b', 'c'])
})
