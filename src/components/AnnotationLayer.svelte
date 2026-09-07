<script lang="ts">
  /**
   * Layers 2, 3 and 5: highlights, ink, notes.
   *
   * Highlights are plain divs with mix-blend-mode: multiply. That is what makes
   * a coloured rect read as a marker over the glyphs in the canvas beneath,
   * instead of a coloured box covering them.
   *
   * STATUS: skeleton — Phase 3.
   */
  import { reader } from '../lib/reader.svelte.ts'
  import type { Annotation } from '../lib/types.ts'

  interface Props {
    pageIndex: number
    /** True when a drawing tool is active, so this layer takes the pointer. */
    interactive: boolean
  }
  let { pageIndex, interactive }: Props = $props()

  const mine = $derived(
    reader.annotations.filter((a: Annotation) => a.pageIndex === pageIndex),
  )

  // TODO(phase-3): pointerdown/move/up -> perfect-freehand -> path in page units.
</script>

<div class="highlights" aria-hidden="true">
  {#each mine.filter((a) => a.type === 'highlight' || a.type === 'underline') as a (a.id)}
    <!-- TODO(phase-3): one div per quad, positioned via quadToScreen. -->
    {#each a.quads ?? [] as _quad}<i class={a.type} style:background={a.color}></i>{/each}
  {/each}
</div>

<svg class="ink" class:interactive>
  {#each mine.filter((a) => a.type === 'ink') as a (a.id)}
    <path d={a.path} fill={a.color} />
  {/each}
</svg>

<div class="notes">
  {#each mine.filter((a) => a.type === 'note') as a (a.id)}
    <div class="note" contenteditable="plaintext-only">{a.text ?? ''}</div>
  {/each}
</div>

<style>
  .highlights,
  .ink,
  .notes {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .highlights {
    z-index: 2;
  }
  .ink {
    z-index: 3;
    overflow: visible;
  }
  .notes {
    z-index: 5;
  }
  .ink.interactive {
    pointer-events: auto;
    touch-action: none; /* let the pen draw instead of scrolling the page */
  }
  .highlights i {
    position: absolute;
    display: block;
    /* The whole trick: multiply lets the glyphs beneath show through. */
    mix-blend-mode: multiply;
  }
  .highlights i.underline {
    background: none !important;
    border-bottom: var(--ul-thickness, 2px) solid currentColor;
  }
  .note {
    position: absolute;
    pointer-events: auto;
    min-width: 8rem;
    padding: 0.4rem 0.5rem;
    background: #fff8c4;
    border-radius: 3px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    font-size: 0.8rem;
    line-height: 1.35;
  }
</style>
