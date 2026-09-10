/**
 * Freehand strokes: input points -> a filled SVG outline.
 *
 * perfect-freehand does not draw a stroked line, it builds the OUTLINE of one
 * and we fill it. That is what lets pressure vary the width along a stroke,
 * and it is why `Annotation.path` is a closed polygon rather than a polyline.
 *
 * Everything here is in page units, in and out. Nothing in this file knows
 * about zoom or screen pixels — the SVG's own transform handles that.
 */

import { getStroke } from 'perfect-freehand'
import type { Quad } from './types.ts'

/** Page-unit coordinates keep two decimals; more is noise in a stored string. */
const round = (n: number) => Math.round(n * 100) / 100

/**
 * `[x, y, pressure]` triples -> an SVG path.
 *
 * `simulatePressure` is off because real pressure is passed in; a mouse reports
 * 0 and the caller substitutes a constant, which yields an even-width stroke.
 */
export function strokePath(points: number[][], size: number): string {
  if (points.length === 0) return ''

  const outline = getStroke(points, {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
  })
  if (outline.length === 0) return ''

  // Midpoint-quadratic smoothing: each segment curves to the midpoint of the
  // next, so the filled outline has no visible corners.
  const parts: (string | number)[] = ['M', round(outline[0][0]), round(outline[0][1]), 'Q']
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    parts.push(round(x0), round(y0), round((x0 + x1) / 2), round((y0 + y1) / 2))
  }
  parts.push('Z')
  return parts.join(' ')
}

/**
 * The bounding box of a stroke's input points, padded by its width.
 *
 * Erase needs it: an SVG path only takes a click on its filled body, which for
 * a thin stroke is a hard target, and search/export will want the extent too.
 */
export function strokeBounds(points: number[][], size: number): Quad {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pad = size / 2
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + size,
    h: maxY - minY + size,
  }
}
