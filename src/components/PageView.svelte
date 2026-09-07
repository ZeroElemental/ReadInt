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
   */
  import { reader } from '../lib/reader.svelte.ts'
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

  const inRange = $derived(pageIndex >= 0 && pageIndex < Math.max(1, reader.pageCount))
  const selecting = $derived(reader.tool === 'select')
  const magnifying = $derived(focused && reader.settings.magnifier !== 'off')

  $effect(() => {
    if (!canvas || !reader.adapter || !inRange) return
    // TODO(phase-1): renderPage(pageIndex, canvas, zoom * devicePixelRatio),
    // cancelling any in-flight render for this page first.
  })

  // Listener attached imperatively, not declaratively: this is a 60fps path, so
  // it wants a passive listener rather than Svelte's event delegation.
  $effect(() => {
    if (!el || !magnifying) return
    const node = el

    const move = (ev: PointerEvent) => {
      const box = node.getBoundingClientRect()
      magnifier?.track(ev.clientX - box.left, ev.clientY - box.top)
    }
    const leave = () => magnifier?.clear()

    node.addEventListener('pointermove', move, { passive: true })
    node.addEventListener('pointerleave', leave, { passive: true })
    return () => {
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerleave', leave)
    }
  })
</script>

<div bind:this={el} class="page" class:focused data-side={side} hidden={!inRange}>
  <canvas bind:this={canvas}></canvas>

  <AnnotationLayer {pageIndex} interactive={!selecting} />
  <TextLayer {pageIndex} interactive={selecting} />

  {#if magnifying}
    <Magnifier bind:this={magnifier} {pageIndex} {canvas} />
  {/if}
</div>

<style>
  .page {
    position: relative;
    background: var(--paper);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
    transform-style: preserve-3d;
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
    /* Canvas is rendered at dpr x zoom, then CSS-sized back down. */
    width: 100%;
    height: 100%;
  }
</style>
