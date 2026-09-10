/**
 * The entire global store. Svelte 5 runes in a .svelte.ts module give us a
 * reactive singleton — no Zustand, no Redux, no context providers.
 *
 * Note what is NOT in here: cursor position, in-flight ink points, magnifier
 * crop rects. Those change at 60fps and are written straight to the DOM/canvas
 * by their component. Routing them through reactive state would be the one
 * mistake that makes this app feel slow.
 */

import type { Annotation, DocumentRecord, Settings, Tool } from './types.ts'
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

  /**
   * Device pixel ratio. Not 60fps state — it changes only on a browser-zoom or
   * monitor change, and the canvas must re-rasterise when it does or the page
   * turns soft.
   */
  dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,

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

/**
 * In spread mode the left leaf is always even, so a spread never straddles two
 * different pairs. Aligning AFTER the range clamp matters: clamping first can
 * land on an odd last page.
 */
function clampSpreadStart(n: number): number {
  const bounded = Math.max(0, Math.min(n, Math.max(0, reader.pageCount - 1)))
  return reader.settings.spread ? bounded - (bounded % 2) : bounded
}

/** Toggling spread re-aligns the left leaf, which single-page mode may have left odd. */
export function setSpread(on: boolean) {
  reader.settings.spread = on
  reader.spreadStart = clampSpreadStart(reader.spreadStart)
}

export function turnPage(delta: number) {
  const step = reader.settings.spread ? 2 : 1
  reader.spreadStart = clampSpreadStart(reader.spreadStart + delta * step)
}

/** Enter the reader. The adapter is already open; this just adopts it. */
export function openDoc(rec: DocumentRecord, adapter: DocAdapter) {
  reader.adapter = adapter
  reader.pageCount = adapter.pageCount
  reader.docId = rec.id
  reader.docName = rec.name
  reader.annotations = []
  reader.deletedIds = []
  reader.dirty = false
  reader.focusSide = 'left'
  reader.spreadStart = clampSpreadStart(rec.lastPageIndex)
}

/**
 * Back to the library. Destroying the adapter is the point — a PDFDocumentProxy
 * holds a worker and every rendered page it has cached.
 */
export function closeDoc() {
  reader.adapter?.destroy()
  reader.adapter = null
  reader.docId = null
  reader.docName = ''
  reader.pageCount = 0
  reader.spreadStart = 0
  reader.annotations = []
  reader.deletedIds = []
  reader.dirty = false
}

/** Fires on browser zoom / monitor change. Returns its own teardown. */
export function watchDevicePixelRatio(): () => void {
  let media: MediaQueryList | null = null
  const sync = () => {
    reader.dpr = window.devicePixelRatio || 1
    media?.removeEventListener('change', sync)
    // The query only matches the CURRENT ratio, so it has to be re-armed each
    // time — this is the standard way to observe devicePixelRatio.
    media = window.matchMedia(`(resolution: ${reader.dpr}dppx)`)
    media.addEventListener('change', sync)
  }
  sync()
  return () => media?.removeEventListener('change', sync)
}

export function setZoom(z: number) {
  reader.zoom = Math.min(6, Math.max(0.25, z))
}
