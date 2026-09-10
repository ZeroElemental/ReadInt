<script lang="ts">
  /**
   * One page = one stack of six layers, bottom to top:
   *
   *   1 canvas          pdf.js render at dpr x zoom
   *   2 highlights      mix-blend-mode: multiply, so glyphs show through
   *   3 ink             SVG paths
   *   4 text layer      transparent spans - selection, search, line boxes
   *   5 notes           positioned contenteditable boxes
   *   6 magnifier       lens / band crop
   *
   * Layer 4 sits above 2 and 3 because selection has to be on top. The conflict
   * with drawing is resolved by TOOL, not z-index: pointer-events is switched
   * so exactly one layer is live at a time.
   *
   * Geometry contract for every layer above the canvas: positions are computed
   * ONCE in scale-1 CSS px from the page's viewport, and `--z` on this element
   * scales them. A zoom change is then one custom-property write, not a relayout
   * of every span.
   */
  import { reader, activeLayer } from '../lib/reader.svelte.ts'
  import { quadToScreen } from '../lib/coords.ts'
  import type { PageGeometry } from '../adapters/types.ts'
  import AnnotationLayer from './AnnotationLayer.svelte'
  import TextLayer from './TextLayer.svelte'
  import Magnifier from './Magnifier.svelte'

  interface Props {
    pageIndex: number
    side: 'left' | 'right'
    focused: boolean
  }
  let { pageIndex, side, focused }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  let canvas = $state<HTMLCanvasElement | null>(null)
  let magnifier = $state<ReturnType<typeof Magnifier> | null>(null)
  let vp = $state<PageGeometry | null>(null)

  const inRange = $derived(pageIndex >= 0 && pageIndex < reader.pageCount)
  const layer = $derived(activeLayer())
  const selecting = $derived(layer === 'text')
  const magnifying = $derived(focused && reader.settings.magnifier !== 'off')

  /**
   * The phase-1 verification instrument: a rect at fixed page coordinates that
   * must stay on the same glyphs through every zoom, spread and DPI change.
   * Dev-only, and off unless you ask for it.
   */
  const DEBUG_QUAD = { x: 72, y: 600, w: 200, h: 24 }
  const debug =
    import.meta.env.DEV &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('debug')
  const debugRect = $derived(vp && debug ? quadToScreen(DEBUG_QUAD, vp) : null)

  $effect(() => {
    const adapter = reader.adapter
    if (!adapter || !inRange) {
      vp = null
      return
    }
    let stale = false
    adapter.getViewport(pageIndex).then((v) => {
      if (!stale) vp = v
    })
    return () => {
      stale = true
    }
  })

  // Re-rasterise on zoom AND on devicePixelRatio change — an upscaled canvas at
  // a new DPI is the difference between crisp and soft type.
  $effect(() => {
    const adapter = reader.adapter
    const target = canvas
    void reader.zoom
    void reader.dpr
    if (!adapter || !target || !vp) return
    adapter.renderPage(pageIndex, target, reader.zoom).catch((err) => {
      console.error(`page ${pageIndex} failed to render`, err)
    })
  })

  // Listener attached imperatively, not declaratively: this is a 60fps path, so
  // it wants a passive listener rather than Svelte's event delegation.
  $effect(() => {
    if (!el || !magnifying) return
    const node = el
    // Re-runs on zoom / page change so the cached box below cannot go stale.
    void reader.zoom
    void pageIndex

    /**
     * The page's box, cached. Measuring per pointermove would force a layout
     * every frame — the single most expensive thing this path could do.
     *
     * `projection` divides out the leaf's 3D rotation and the focused leaf's
     * scale, turning a viewport coordinate into the page's own layout space,
     * which is what every quad on this page is expressed in.
     */
    let box: DOMRect | null = null
    let projection = 1
    const measure = () => {
      box = node.getBoundingClientRect()
      projection = box.width / (node.offsetWidth || 1)
    }
    const invalidate = () => (box = null)

    const move = (ev: PointerEvent) => {
      if (!box) measure()
      magnifier?.track(
        (ev.clientX - box!.left) / projection,
        (ev.clientY - box!.top) / projection,
      )
    }
    const leave = () => magnifier?.clear()

    node.addEventListener('pointermove', move, { passive: true })
    node.addEventListener('pointerleave', leave, { passive: true })
    node.addEventListener('pointerenter', measure, { passive: true })
    // The book scrolls when zoomed past the window, so a scroll moves the page.
    addEventListener('scroll', invalidate, { passive: true, capture: true })
    addEventListener('resize', invalidate, { passive: true })
    return () => {
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerleave', leave)
      node.removeEventListener('pointerenter', measure)
      removeEventListener('scroll', invalidate, { capture: true })
      removeEventListener('resize', invalidate)
    }
  })
</script>

<div
  bind:this={el}
  class="page"
  class:focused
  data-side={side}
  hidden={!inRange}
  style:--z={reader.zoom}
  style:--pw={vp?.width ?? 0}
  style:--ph={vp?.height ?? 0}
>
  <canvas bind:this={canvas}></canvas>

  <AnnotationLayer {pageIndex} {vp} {layer} />
  <TextLayer {pageIndex} {vp} interactive={selecting} />

  {#if debugRect}
    <div
      class="debug-quad"
      style:left="calc({debugRect.left} * var(--z) * 1px)"
      style:top="calc({debugRect.top} * var(--z) * 1px)"
      style:width="calc({debugRect.width} * var(--z) * 1px)"
      style:height="calc({debugRect.height} * var(--z) * 1px)"
    ></div>
  {/if}

  {#if magnifying}
    <Magnifier bind:this={magnifier} {pageIndex} {vp} />
  {/if}
</div>

<style>
  .page {
    position: relative;
    /* Sized from the page's own geometry, so the leaf never flashes at the
       wrong aspect while the canvas is still rasterising. */
    width: calc(var(--pw) * var(--z) * 1px);
    height: calc(var(--ph) * var(--z) * 1px);
    background: var(--paper);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
    /* NOT preserve-3d. The leaf's own rotateY works from .book's perspective;
       preserve-3d would only put THIS element's children into a 3D context,
       and doing so puts each layer on its own plane — which silently kills the
       highlight layer's mix-blend-mode, turning every highlight into an opaque
       block over the text it is supposed to show through. */
    transform-style: flat;
    /* Unfocused leaves recede slightly; the focused one comes forward. */
    transition: transform 0.28s ease, filter 0.28s ease, opacity 0.28s ease;
    filter: brightness(0.94);
    opacity: 0.88;
  }
  .page[data-side='left'] {
    transform: rotateY(1.6deg);
    transform-origin: right center;
  }
  .page[data-side='right'] {
    transform: rotateY(-1.6deg);
    transform-origin: left center;
  }
  .focused {
    filter: none;
    opacity: 1;
    transform: rotateY(0deg) scale(1.02);
    z-index: 1;
  }
  canvas {
    display: block;
    /* Rendered at dpr x zoom; the adapter CSS-sizes it back down. */
  }
  .debug-quad {
    position: absolute;
    z-index: 7;
    pointer-events: none;
    outline: 1px solid #e0245e;
    background: rgba(224, 36, 94, 0.14);
  }
</style>
