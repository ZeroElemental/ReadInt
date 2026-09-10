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
  import { reader } from '../lib/reader.svelte.ts'
  import { quadToScreen } from '../lib/coords.ts'
  import { getPageText, putPageText } from '../lib/storage.ts'
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

  let layer = $state<HTMLDivElement | null>(null)
  let items = $state<TextItem[]>([])

  /** Spans in scale-1 CSS px: everything needed to place one, computed once. */
  const placed = $derived(
    vp
      ? items.map((item) => ({ item, box: quadToScreen(item.quad, vp) }))
      : [],
  )

  $effect(() => {
    const adapter = reader.adapter
    const docId = reader.docId
    if (!adapter || !docId) return

    let stale = false
    const index = pageIndex

    ;(async () => {
      const cached = await getPageText(docId, index)
      if (cached) {
        if (!stale) items = cached.items
        return
      }
      const fresh = await adapter.getTextItems(index)
      // Cache before the staleness check: the work is done either way, and the
      // next visit to this page should not repeat it.
      await putPageText({ docId, pageIndex: index, items: fresh, source: 'native' })
      if (!stale) items = fresh
    })().catch((err) => console.error(`page ${index} text extraction failed`, err))

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

<div bind:this={layer} class="text-layer" class:interactive>
  {#each placed as { item, box }, i (i)}
    <span
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
