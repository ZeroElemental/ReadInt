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
   * MEMORY: the hi-res canvas exists only for the focused page, is built lazily
   * on first hover, and is released on page change. At 2.5x an A4 page is ~20MB
   * — one page is fine, every page is not. This rule is load-bearing.
   *
   * STATUS: skeleton — Phase 2.
   */
  import { reader } from '../lib/reader.svelte.ts'

  interface Props {
    pageIndex: number
    canvas: HTMLCanvasElement | null
  }
  let { pageIndex, canvas }: Props = $props()

  let lens = $state<HTMLCanvasElement | null>(null)
  let hiRes: HTMLCanvasElement | null = null
  let frame = 0

  const mode = $derived(reader.settings.magnifier)

  $effect(() => {
    void pageIndex
    // TODO(phase-2): build hiRes lazily on first track(); release here on page
    // change so only one hi-res canvas is ever alive.
    return () => {
      cancelAnimationFrame(frame)
      hiRes = null
    }
  })

  /**
   * Called by PageView on pointermove — PageView owns the pointer because this
   * overlay is pointer-events:none, and it already knows the page geometry.
   * Coordinates are CSS px relative to the page's top-left.
   */
  export function track(_x: number, _y: number) {
    // TODO(phase-2): throttle to rAF, compute srcRect from mode, drawImage.
    void canvas
    void lens
  }

  export function clear() {
    cancelAnimationFrame(frame)
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
  }
  .lens {
    position: absolute;
    pointer-events: none;
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
    left: 0;
    right: 0;
  }
</style>
