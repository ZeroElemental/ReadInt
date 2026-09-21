<script lang="ts">
  /**
   * Layer 4: transparent, positioned text over the rasterised page.
   *
   * Carries three jobs at once — native selection (so highlight, underline and
   * the definition popup all work with zero custom hit-testing), search hit
   * mapping, and line boxes for the band magnifier.
   *
   * Built from OUR TextItem[], never from pdf.js's own TextLayer class: that
   * one consumes pdf.js TextContent, which an OCR'd page does not have. Going
   * through the adapter is what keeps "is this OCR" from leaking downstream.
   *
   * Every span is positioned once, in scale-1 CSS px, and scaled by `--z` from
   * PageView. Zooming therefore touches one custom property instead of a
   * thousand inline styles, and font-size grows with zoom so the browser's
   * minimum-font-size clamp never distorts a run.
   */
  import { reader, addAnnotation, newAnnotation } from '../lib/reader.svelte.ts'
  import { mergeQuadsByLine, quadToScreen, relativeTo, screenToQuad } from '../lib/coords.ts'
  import { needsSpace } from '../lib/search.ts'
  import { pageText } from '../adapters/index.ts'
  import type { PageGeometry } from '../adapters/types.ts'
  import type { TextItem } from '../lib/types.ts'

  interface Props {
    pageIndex: number
    /** The page's transform at scale 1. Null until the adapter reports it. */
    vp: PageGeometry | null
    /** True for the select tool; false lets pointer events fall through to ink. */
    interactive: boolean
  }
  let { pageIndex, vp, interactive }: Props = $props()

  /**
   * Turn the live selection into a highlight or underline.
   *
   * The browser's own selection is the hit-testing: one rect per line fragment,
   * which mergeQuadsByLine collapses into one stroke of a marker per line. The
   * rects come back in viewport space with the leaf's 3D transform baked in, so
   * they are divided by zoom AND by the layer's projected/layout ratio to land
   * back in the scale-1 space every quad is expressed in.
   */
  function commitSelection() {
    const type = reader.tool
    if ((type !== 'highlight' && type !== 'underline') || !vp || !layer) return

    const sel = getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    if (!layer.contains(range.commonAncestorContainer)) return

    const host = layer.getBoundingClientRect()
    const scale = (host.width / (layer.offsetWidth || 1)) * reader.zoom
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => screenToQuad(relativeTo(r, host, scale), vp!))
    if (rects.length === 0) return

    // These quads came from the DOM, so they are rounded, and dividing by zoom
    // magnifies that: at 25% one screen pixel is four page units, and on an
    // image document a page unit is a pixel rather than a point. The fixed
    // baseline tolerance that suits exact extraction geometry then reads one
    // line as two and the stroke breaks in half. Scale it to the text's own
    // height, which is the thing a line is actually measured against.
    const quads = mergeQuadsByLine(
      rects,
      0.3 * Math.max(...rects.map((q) => q.h)),
    )
    if (quads.length === 0) return

    addAnnotation(
      newAnnotation(type, pageIndex, {
        quads,
        color: type === 'highlight' ? reader.settings.highlightColor : reader.settings.inkColor,
        thickness: reader.settings.thickness,
      }),
    )
    // Clearing is the feedback: the mark appears, the blue selection does not
    // linger on top of it.
    sel.removeAllRanges()
  }

  let layer = $state<HTMLDivElement | null>(null)
  let items = $state<TextItem[]>([])

  /**
   * Spans in scale-1 CSS px: everything needed to place one, computed once.
   *
   * `space` is a separator rendered BETWEEN spans, and it is the only thing
   * here that is not geometry. Absolutely positioned spans are adjacent to the
   * selection with nothing between them, so without it `getSelection()` runs
   * two words together — invisible on a digital PDF, constant on an OCR'd page
   * where every word is its own run. The rule is search.ts's, not a second
   * opinion, so the selected string and the searched string agree.
   *
   * It has to be a NON-BREAKING space. A plain one is the only in-flow content
   * in a layer of absolutely positioned spans, so white-space processing
   * collapses every one of them away and the selection reads exactly as it did
   * before. Selection normalises   back to a space downstream.
   */
  const placed = $derived(
    vp
      ? items.map((item, i) => ({
          item,
          box: quadToScreen(item.quad, vp),
          space: i > 0 && needsSpace(items[i - 1], item),
        }))
      : [],
  )

  $effect(() => {
    const adapter = reader.adapter
    const docId = reader.docId
    if (!adapter || !docId) return

    let stale = false
    const index = pageIndex

    pageText(adapter, docId, index)
      .then((fresh) => {
        if (!stale) items = fresh
      })
      .catch((err) => console.error(`page ${index} text extraction failed`, err))

    return () => {
      stale = true
      items = []
    }
  })

  /**
   * Stretch each span to its quad's width. Read every rect, THEN write every
   * transform — interleaving them would force a layout per span.
   *
   * The ratio is zoom-invariant (measured width and target width both scale
   * linearly with --z), so this runs once per page rather than once per zoom.
   * Dividing by the layer's own projected/layout ratio cancels the leaf's 3D
   * rotation and the focused leaf's scale, which would otherwise bias every
   * measurement.
   */
  $effect(() => {
    const node = layer
    if (!node || placed.length === 0) return

    const spans = [...node.children] as HTMLElement[]

    // Reset before measuring: these nodes can be reused across pages, and
    // measuring one that still carries its last scaleX compounds the error.
    for (const span of spans) span.style.transform = ''

    const projection = node.getBoundingClientRect().width / (node.offsetWidth || 1)

    const scales = spans.map((span, i) => {
      const measured = span.getBoundingClientRect().width / projection
      const target = placed[i].box.width * reader.zoom
      return measured > 0 && target > 0 ? target / measured : 1
    })

    spans.forEach((span, i) => {
      span.style.transform = scales[i] === 1 ? '' : `scaleX(${scales[i]})`
    })
  })
</script>

<!-- pointerup, not selectionchange: the selection is only final once the
     gesture ends, and a keyboard selection ends with a key, not a drag. -->
<svelte:document onpointerup={commitSelection} />

<div bind:this={layer} class="text-layer" class:interactive>
  {#each placed as { item, box, space }, i (i)}
    {#if space}{' '}{/if}<span
      data-line={item.lineId}
      style:left="calc({box.left} * var(--z) * 1px)"
      style:top="calc({box.top} * var(--z) * 1px)"
      style:font-size="calc({box.height} * var(--z) * 1px)">{item.str}</span
    >
  {/each}
</div>

<style>
  .text-layer {
    position: absolute;
    inset: 0;
    /* The word separators are the layer's own in-flow content; each span sets
       its own size, so zeroing this leaves the separators with no width to
       overflow with, however many words a page has. */
    font-size: 0;
    z-index: 4;
    pointer-events: none;
    user-select: none;
    /* Invisible but selectable: the real glyphs are in the canvas below. */
    color: transparent;
    line-height: 1;
    transform-origin: 0 0;
    font-family: sans-serif;
  }
  .text-layer.interactive {
    pointer-events: auto;
    user-select: text;
    cursor: text;
  }
  .text-layer span {
    position: absolute;
    white-space: pre;
    transform-origin: 0 0;
  }
  .text-layer ::selection {
    background: rgba(90, 150, 255, 0.35);
  }
</style>
