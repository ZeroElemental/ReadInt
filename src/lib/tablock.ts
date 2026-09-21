/**
 * One tab per document owns autosave.
 *
 * Drafts are keyed by docId, so two tabs on the same document shared a single
 * row: each tab's 30-second autosave silently replaced the other's, and a crash
 * in the first offered a recovery that was missing everything it had done. A
 * per-tab draft id would have stopped the overwrite but not the loss — recovery
 * still has to choose ONE draft to offer, and it would still be the last writer.
 * So the fix is to make there only ever be one writer.
 *
 * The Web Locks API is exactly the primitive for it: a lock is held for as long
 * as the promise handed to `request` is pending, and the browser drops it when
 * the tab closes or crashes, so there is no stale lock to clean up and no
 * heartbeat to get wrong.
 *
 * `held: false` means ANOTHER tab has this document open. Nothing is blocked —
 * explicit save still works from either tab, and marks are merged by id when
 * they reach Dexie — but the second tab does not autosave, and says so.
 *
 * That tab then QUEUES for the lock rather than giving up. Close the first tab
 * and the second is promoted to owner, `onPromoted` fires, and its notice goes
 * away — otherwise it would keep saying another tab owns autosave long after
 * there is no other tab, and stop backing up work for no reason.
 */

export interface DocLock {
  /** True when this tab is the one that autosaves. */
  held: boolean
  /**
   * Give the lock up now, rather than waiting for the tab to close. If this tab
   * is still QUEUED for it, stops waiting — a closed document must never be
   * promoted to owner of a lock nobody is using.
   */
  release: () => void
}

/** The slice of LockManager this needs, so a test can hand in a fake. */
export interface LocksLike {
  request(
    name: string,
    options: { ifAvailable?: true; signal?: AbortSignal },
    callback: (lock: unknown | null) => Promise<void> | void,
  ): Promise<unknown>
}

const NOOP = () => {}

export function lockDocument(
  docId: string,
  locks: LocksLike | undefined = globalThis.navigator?.locks,
  /** Called when a tab that started out NOT holding the lock is granted it. */
  onPromoted?: () => void,
): Promise<DocLock> {
  // No Web Locks (an old browser, or a non-secure context): behave as before.
  // Losing the guard is better than refusing to autosave at all.
  if (!locks) return Promise.resolve({ held: true, release: NOOP })

  const name = `readint:doc:${docId}`

  return new Promise((resolve) => {
    void locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock) {
        // Pending until released — that pending IS the lock.
        return new Promise<void>((free) => resolve({ held: true, release: free }))
      }

      // Someone else has it. Say so now, then wait in line behind them.
      const ctl = new AbortController()
      let free: () => void = NOOP
      resolve({
        held: false,
        release: () => {
          ctl.abort()
          free()
        },
      })
      locks
        .request(name, { signal: ctl.signal }, () => {
          onPromoted?.()
          return new Promise<void>((f) => (free = f))
        })
        // An abort rejects the queued request. That is release() doing its job.
        .catch(NOOP)
    })
  })
}
