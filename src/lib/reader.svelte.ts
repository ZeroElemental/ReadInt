/**
 * The entire global store. Svelte 5 runes in a .svelte.ts module give us a
 * reactive singleton — no Zustand, no Redux, no context providers.
 *
 * Note what is NOT in here: cursor position, in-flight ink points, magnifier
 * crop rects. Those change at 60fps and are written straight to the DOM/canvas
 * by their component. Routing them through reactive state would be the one
 * mistake that makes this app feel slow.
 */

import type { Annotation, Settings, Tool } from './types.ts'
import { DEFAULT_SETTINGS } from './storage.ts'
import type { DocAdapter } from '../adapters/types.ts'

export const reader = $state({
  /** null = show the library. */
  docId: null as string | null,
  docName: '',
  adapter: null as DocAdapter | null,
  pageCount: 0,

  /** Left page of the current spread. Always even in LTR spread mode. */
  spreadStart: 0,
  /** Which half of the spread is zoomed and being read. */
  focusSide: 'left' as 'left' | 'right',

  zoom: 1,
  tool: 'select' as Tool,

  /** Live annotations for the open document. Flushed to Dexie on save. */
  annotations: [] as Annotation[],
  deletedIds: [] as string[],
  dirty: false,

  settings: { ...DEFAULT_SETTINGS } as Settings,
})

export function markDirty() {
  reader.dirty = true
}

export function addAnnotation(a: Annotation) {
  reader.annotations.push(a)
  markDirty()
}

export function removeAnnotation(id: string) {
  const i = reader.annotations.findIndex((a) => a.id === id)
  if (i === -1) return
  reader.annotations.splice(i, 1)
  reader.deletedIds.push(id)
  markDirty()
}

/** The page the user is actually reading — what the magnifier operates on. */
export function focusedPage(): number {
  if (!reader.settings.spread) return reader.spreadStart
  const rightFirst = reader.settings.readingDirection === 'rtl'
  const onRight = reader.focusSide === 'right'
  return reader.spreadStart + (onRight !== rightFirst ? 1 : 0)
}

export function turnPage(delta: number) {
  const step = reader.settings.spread ? 2 : 1
  const next = reader.spreadStart + delta * step
  reader.spreadStart = Math.max(0, Math.min(next, Math.max(0, reader.pageCount - 1)))
}

export function setZoom(z: number) {
  reader.zoom = Math.min(6, Math.max(0.25, z))
}
