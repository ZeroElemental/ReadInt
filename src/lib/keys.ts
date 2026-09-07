/**
 * Keyboard map. A plain object, not a hotkey library.
 */

import { reader, setZoom, turnPage } from './reader.svelte.ts'
import type { Tool } from './types.ts'

const TOOL_KEYS: Record<string, Tool> = {
  s: 'select',
  h: 'highlight',
  u: 'underline',
  p: 'pen',
  n: 'note',
  e: 'erase',
}

export interface KeyHandlers {
  save: () => void
  search: () => void
  escape: () => void
}

export function handleKey(ev: KeyboardEvent, on: KeyHandlers): void {
  // Never steal keys from a note the user is typing in.
  const el = ev.target as HTMLElement | null
  if (el?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el?.tagName ?? '')) {
    if (ev.key === 'Escape') on.escape()
    return
  }

  const mod = ev.ctrlKey || ev.metaKey

  if (mod && ev.key === 's') {
    ev.preventDefault()
    on.save()
    return
  }
  if (mod && ev.key === 'f') {
    ev.preventDefault()
    on.search()
    return
  }
  if (mod) return

  switch (ev.key) {
    case 'ArrowLeft':
      return turnPage(reader.settings.readingDirection === 'rtl' ? 1 : -1)
    case 'ArrowRight':
      return turnPage(reader.settings.readingDirection === 'rtl' ? -1 : 1)
    case ' ':
      ev.preventDefault()
      return turnPage(ev.shiftKey ? -1 : 1)
    case 'Escape':
      return on.escape()
    case '+':
    case '=':
      return setZoom(reader.zoom * 1.25)
    case '-':
      return setZoom(reader.zoom / 1.25)
    case '0':
      return setZoom(1)
  }

  const key = ev.key.toLowerCase()

  if (key === 'f') {
    reader.focusSide = reader.focusSide === 'left' ? 'right' : 'left'
    return
  }
  if (key === 'm') {
    const cycle = ['off', 'lens', 'band'] as const
    const i = cycle.indexOf(reader.settings.magnifier)
    reader.settings.magnifier = cycle[(i + 1) % cycle.length]
    return
  }
  if (key in TOOL_KEYS) reader.tool = TOOL_KEYS[key]
}
