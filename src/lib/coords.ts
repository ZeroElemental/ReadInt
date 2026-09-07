/**
 * The load-bearing module.
 *
 * Every annotation is stored in page units (PDF user space, origin bottom-left).
 * Everything drawn on screen is in CSS pixels relative to the page element's
 * top-left. These functions are the ONLY place that conversion happens.
 *
 * Get this wrong and every feature built on top inherits the bug: highlights
 * drift when you zoom, change spread mode, or move to a different-DPI monitor.
 */

import type { Quad } from './types.ts'

/**
 * The slice of pdf.js's PageViewport we depend on. Declared structurally so
 * this module is testable without loading pdf.js.
 */
export interface ViewportLike {
  /** page units -> CSS px relative to the page's top-left. */
  convertToViewportPoint(x: number, y: number): number[]
  /** CSS px relative to the page's top-left -> page units. */
  convertToPdfPoint(x: number, y: number): number[]
  scale: number
}

/** A rectangle in CSS pixels, relative to the page element's top-left. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Page units -> screen. Both corners are converted and then normalised, because
 * the viewport transform flips the y-axis (and may rotate the page), so the
 * converted "bottom-left" can land below or right of the "top-right".
 */
export function quadToScreen(q: Quad, vp: ViewportLike): ScreenRect {
  const [ax, ay] = vp.convertToViewportPoint(q.x, q.y)
  const [bx, by] = vp.convertToViewportPoint(q.x + q.w, q.y + q.h)
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  }
}

/** Screen -> page units. Inverse of quadToScreen. */
export function screenToQuad(r: ScreenRect, vp: ViewportLike): Quad {
  const [ax, ay] = vp.convertToPdfPoint(r.left, r.top)
  const [bx, by] = vp.convertToPdfPoint(r.left + r.width, r.top + r.height)
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  }
}

/** A single point, screen -> page units. Used by ink and note placement. */
export function screenToPoint(
  x: number,
  y: number,
  vp: ViewportLike,
): { x: number; y: number } {
  const [px, py] = vp.convertToPdfPoint(x, y)
  return { x: px, y: py }
}

/**
 * DOM rects from `Range.getClientRects()` are viewport-absolute; annotations
 * need them relative to the page element before conversion to page units.
 */
export function relativeTo(rect: DOMRect, pageEl: DOMRect): ScreenRect {
  return {
    left: rect.left - pageEl.left,
    top: rect.top - pageEl.top,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * Text selections produce one rect per line fragment, often several per line
 * with sub-pixel gaps. Merging them keeps a highlight looking like one stroke
 * of a marker rather than a row of tiles.
 */
export function mergeQuadsByLine(quads: Quad[], tolerance = 1.5): Quad[] {
  if (quads.length === 0) return []

  const lines: Quad[][] = []
  for (const q of [...quads].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l[0].y - q.y) <= tolerance)
    if (line) line.push(q)
    else lines.push([q])
  }

  return lines.map((line) => {
    const left = Math.min(...line.map((q) => q.x))
    const right = Math.max(...line.map((q) => q.x + q.w))
    const bottom = Math.min(...line.map((q) => q.y))
    const top = Math.max(...line.map((q) => q.y + q.h))
    return { x: left, y: bottom, w: right - left, h: top - bottom }
  })
}
