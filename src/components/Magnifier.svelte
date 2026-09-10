<script lang="ts">
  /**
   * One pipeline, two geometries.
   *
   * Re-rendering pdf.js on every pointermove is far too slow. Instead the
   * focused page is rendered ONCE to an off-DOM canvas at zoom x magFactor,
   * and each frame does a single drawImage crop out of it.
   *
   *   lens  -> srcRect centred on the cursor, drawn into a round lens
   *   band  -> srcRect is the hovered line's full-width box, drawn into a strip
   *
   * Band mode is NOT a CSS scale on the text layer: those glyphs are
   * transparent, the real ones live in the canvas.
   *
   * Both modes end up as a 1:1 device-pixel blit. The hi-res page is rasterised
   * at exactly the magnification the lens shows, so drawImage never resamples —
   * that is what keeps the frame cheap, and it is why both geometries can share
   * one crop path instead of two.
   *
   * MEMORY: the hi-res canvas exists only for the focused page, is built lazily
   * on first hover, and is released on page change. At 2.5x an A4 page is ~20MB
   * — one page is fine, every page is not. The rule is structural here, because
   * PageView only mounts this component for the focused page.
   *
   * SPEED: nothing on the pointer path reads or writes reactive state. The
   * effect snapshots zoom/magFactor/dpr into plain locals; the frame touches
   * only those, the canvas, and style.transform.
   */
  import { reader } from '../lib/reader.svelte.ts'
  import { lineBoxes, quadToScreen } from '../lib/coords.ts'
  import { pageText } from '../adapters/index.ts'
  import type { PageGeometry } from '../adapters/types.ts'
  import type { ScreenRect } from '../lib/coords.ts'

  interface Props {
    pageIndex: number
    /** The page's transform at scale 1, the same one the text layer uses. */
    vp: PageGeometry | null
  }
  let { pageIndex, vp }: Props = $props()

  /** Lens diameter in CSS px. A constant until someone actually wants a knob. */
  const LENS = 190
  /** Breathing room above and below a magnified line, in page units. */
  const LINE_PAD = 2

  let lens = $state<HTMLCanvasElement | null>(null)

  // Deliberately NOT $state: these are read and written at pointer rate.
  let hiRes: HTMLCanvasElement | null = null
  let lines: ScreenRect[] = []
  let frame = 0
  let cx = 0
  let cy = 0

  // Snapshots taken when the effect runs, so a frame never touches a rune.
  let zoomNow = 1
  let magNow = 2.5
  let dprNow = 1
  let pageW = 0
  let bandMode = false

  const mode = $derived(reader.settings.magnifier)

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  /**
   * Build the hi-res page (and, for band mode, the line boxes), and tear both
   * down when the page, zoom, magnification or DPI changes. Releasing is the
   * point: sizing the canvas to 0x0 drops the backing store now, rather than
   * whenever GC happens to notice.
   */
  $effect(() => {
    const adapter = reader.adapter
    const docId = reader.docId
    const geometry = vp
    const zoom = reader.zoom
    const mag = reader.settings.magFactor
    const dpr = reader.dpr
    const band = mode === 'band'

    hiRes = null
    lines = []
    if (lens) lens.hidden = true
    if (!adapter || !docId || !geometry) return

    zoomNow = zoom
    magNow = mag
    dprNow = dpr
    pageW = geometry.width
    bandMode = band

    let stale = false
    const target = document.createElement('canvas')

    Promise.all([
      adapter.renderPage(pageIndex, target, zoom * mag),
      band
        ? pageText(adapter, docId, pageIndex).then((items) =>
            lineBoxes(items).map((q) => quadToScreen(q, geometry)),
          )
        : Promise.resolve<ScreenRect[]>([]),
    ])
      .then(([, boxes]) => {
        if (stale) return
        hiRes = target
        lines = boxes
      })
      .catch((err) => console.error(`magnifier failed on page ${pageIndex}`, err))

    return () => {
      stale = true
      cancelAnimationFrame(frame)
      frame = 0
      hiRes = null
      lines = []
      // Explicit release: this is the ~20MB the invariant is about.
      target.width = 0
      target.height = 0
    }
  })

  /** The line under the cursor, as a scale-1 box. Null in the gaps between. */
  function lineAt(y: number): ScreenRect | null {
    for (const box of lines) {
      const top = (box.top - LINE_PAD) * zoomNow
      const height = (box.height + LINE_PAD * 2) * zoomNow
      if (y >= top && y <= top + height) return box
    }
    return null
  }

  function size(out: HTMLCanvasElement, w: number, h: number) {
    const dw = Math.round(w * dprNow)
    const dh = Math.round(h * dprNow)
    if (out.width === dw && out.height === dh) return
    out.width = dw
    out.height = dh
    out.style.width = `${w}px`
    out.style.height = `${h}px`
  }

  function draw() {
    frame = 0
    const out = lens
    const src = hiRes
    if (!out || !src) return

    const ctx = out.getContext('2d')
    if (!ctx) return

    /** On-screen page CSS px -> hi-res device px. Independent of zoom. */
    const k = magNow * dprNow

    if (bandMode) {
      const line = lineAt(cy)
      if (!line) {
        out.hidden = true
        return
      }
      const lineTop = (line.top - LINE_PAD) * zoomNow
      const lineH = (line.height + LINE_PAD * 2) * zoomNow
      const bandW = pageW * zoomNow
      const bandH = lineH * magNow

      size(out, bandW, bandH)

      // 1:1 blit, so the source window is the strip shrunk by magFactor. It
      // follows the cursor along the line and stops at the page edges.
      const sw = out.width
      const sh = out.height
      const sx = clamp(cx * k - sw / 2, 0, Math.max(0, src.width - sw))
      const sy = lineTop * k

      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
      // Centred on the line it magnifies, so the eye never hunts for it.
      out.style.transform = `translate(0px, ${lineTop + lineH / 2 - bandH / 2}px)`
      out.hidden = false
      return
    }

    size(out, LENS, LENS)
    const d = out.width

    // Near a page edge the source window runs off the canvas; drawImage clips
    // it to the intersection and shrinks the destination to match, so the lens
    // shows blank paper there instead of the wrong part of the page.
    ctx.clearRect(0, 0, d, d)
    ctx.drawImage(src, cx * k - d / 2, cy * k - d / 2, d, d, 0, 0, d, d)
    out.style.transform = `translate(${cx - LENS / 2}px, ${cy - LENS / 2}px)`
    out.hidden = false
  }

  /**
   * Called by PageView on pointermove — PageView owns the pointer because this
   * overlay is pointer-events:none, and it already knows the page geometry.
   * Coordinates are CSS px relative to the page's top-left, in layout space.
   */
  export function track(x: number, y: number) {
    cx = x
    cy = y
    if (!hiRes || frame) return
    frame = requestAnimationFrame(draw)
  }

  export function clear() {
    cancelAnimationFrame(frame)
    frame = 0
    if (lens) lens.hidden = true
  }
</script>

<div class="mag-surface" data-mode={mode} aria-hidden="true">
  <canvas bind:this={lens} class="lens" hidden></canvas>
</div>

<style>
  .mag-surface {
    position: absolute;
    inset: 0;
    z-index: 6;
    /* Transparent to clicks — it only needs to observe the cursor. */
    pointer-events: none;
    overflow: hidden;
  }
  .lens {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    background: var(--paper);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    will-change: transform;
  }
  [data-mode='lens'] .lens {
    border-radius: 50%;
    /* Soft edge so it reads as glass on paper, not a pasted rectangle. */
    mask-image: radial-gradient(circle, #000 62%, transparent 100%);
  }
  [data-mode='band'] .lens {
    border-radius: 4px;
  }
</style>
