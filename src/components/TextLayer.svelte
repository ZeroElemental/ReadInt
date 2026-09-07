<script lang="ts">
  /**
   * Layer 4: transparent, positioned text over the rasterised page.
   *
   * Carries three jobs at once — native selection (so highlight, underline and
   * the definition popup all work with zero custom hit-testing), search hit
   * mapping, and line boxes for the band magnifier.
   *
   * STATUS: skeleton — Phase 1.
   */
  import type { TextItem } from '../lib/types.ts'

  interface Props {
    pageIndex: number
    /** True for the select tool; false lets pointer events fall through to ink. */
    interactive: boolean
  }
  let { pageIndex, interactive }: Props = $props()

  let items = $state<TextItem[]>([])

  $effect(() => {
    void pageIndex
    // TODO(phase-1): adapter.getTextItems(pageIndex), cached in Dexie.
    items = []
  })
</script>

<div class="text-layer" class:interactive>
  {#each items as item, i (i)}
    <!-- TODO(phase-1): position + scaleX each span onto its quad. -->
    <span data-line={item.lineId}>{item.str}</span>
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
