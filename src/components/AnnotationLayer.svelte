<script lang="ts">
  /**
   * Layers 2, 3 and 5: highlights, ink, notes.
   *
   * Highlights are plain divs with mix-blend-mode: multiply. That is what makes
   * a coloured rect read as a marker over the glyphs in the canvas beneath,
   * instead of a coloured box covering them.
   *
   * Rects are positioned the way the text layer positions spans: computed once
   * in scale-1 CSS px, scaled by `--z`. Ink is not — a stroke is hundreds of
   * points, so rather than convert each one on every render the SVG is handed
   * the viewport's own matrix and the path stays in page units.
   *
   * Output and input are separate elements here. The drawn layers are inert and
   * aria-hidden; the surfaces that take a pointer only exist while their tool is
   * active. That is invariant 4 expressed in markup rather than in z-index, and
   * it is why erase is one uniform layer of targets instead of click handlers
   * scattered across three shapes.
   */
  import {
    reader,
    addAnnotation,
    newAnnotation,
    removeAnnotation,
    updateAnnotation,
  } from '../lib/reader.svelte.ts'
  import { mergeQuadsByLine, quadToScreen, screenToPoint } from '../lib/coords.ts'
  import { strokeBounds, strokePath } from '../lib/ink.ts'
  import type { PageGeometry } from '../adapters/types.ts'
  import type { Annotation, Quad } from '../lib/types.ts'

  interface Props {
    pageIndex: number
    vp: PageGeometry | null
    /** Which layer holds the pointer. Exactly one is live — invariant 4. */
    layer: 'text' | 'ink' | 'note' | 'erase'
  }
  let { pageIndex, vp, layer }: Props = $props()

  /** Default note size, in page units. */
  const NOTE_W = 150
  const NOTE_H = 90

  let surface = $state<HTMLDivElement | null>(null)
  let live = $state<SVGPathElement | null>(null)

  const mine = $derived(
    reader.annotations.filter((a: Annotation) => a.pageIndex === pageIndex),
  )
  const marks = $derived(
    mine.filter((a) => a.type === 'highlight' || a.type === 'underline'),
  )
  const strokes = $derived(mine.filter((a) => a.type === 'ink'))
  const notes = $derived(mine.filter((a) => a.type === 'note'))
  const erasing = $derived(layer === 'erase')

  /** One erasable box per annotation, whatever shape it actually is. */
  const targets = $derived(
    erasing
      ? mine
          .map((a) => ({ a, quad: bounds(a) }))
          .filter((t): t is { a: Annotation; quad: Quad } => t.quad !== null)
      : [],
  )

  function bounds(a: Annotation): Quad | null {
    if (a.quads?.length) return mergeQuadsByLine(a.quads, Infinity)[0]
    return a.box ?? null
  }

  /** Only ever called under `{#if vp}` — see the note on placeholder sizes. */
  const box = (q: Quad) => quadToScreen(q, vp!)

  /** Pointer position -> page units, via the surface's own layout box. */
  function pagePoint(ev: { clientX: number; clientY: number }, host: HTMLElement) {
    const rect = host.getBoundingClientRect()
    // Divides out the leaf's 3D transform, then the zoom.
    const scale = (rect.width / (host.offsetWidth || 1)) * reader.zoom
    return screenToPoint(
      (ev.clientX - rect.left) / scale,
      (ev.clientY - rect.top) / scale,
      vp!,
    )
  }

  // ---- ink -----------------------------------------------------------------
  // In-flight points never reach reactive state: they accumulate in a plain
  // array and go straight onto one path element's `d`. Only the finished stroke
  // is committed. That is invariant 3.
  let points: number[][] = []
  let drawing = false
  let frame = 0

  function sample(ev: PointerEvent): number[] {
    const p = pagePoint(ev, surface!)
    // Pressure reads 0 on a mouse; perfect-freehand needs a usable constant.
    return [p.x, p.y, ev.pressure > 0 ? ev.pressure : 0.5]
  }

  function paint() {
    frame = 0
    live?.setAttribute('d', strokePath(points, reader.settings.thickness))
  }

  function inkDown(ev: PointerEvent) {
    if (!vp || !surface) return
    // Capture keeps the stroke alive if the pointer leaves the page mid-draw;
    // it throws for a pointer the element never saw, which must not abort it.
    try {
      surface.setPointerCapture(ev.pointerId)
    } catch {
      /* no capture available — drawing still works while inside the page */
    }
    drawing = true
    points = [sample(ev)]
    paint()
  }

  function inkMove(ev: PointerEvent) {
    if (!drawing) return
    // Coalesced events keep a high-rate pen faithful without a repaint each.
    // The list can come back EMPTY (untrusted events, and some browsers), and
    // an empty list silently drops the whole stroke down to its first point —
    // so fall back to the event itself on empty, not just on a missing method.
    const batch = ev.getCoalescedEvents?.() ?? []
    for (const e of batch.length ? batch : [ev]) points.push(sample(e))
    if (!frame) frame = requestAnimationFrame(paint)
  }

  function inkUp() {
    if (!drawing) return
    drawing = false
    cancelAnimationFrame(frame)
    frame = 0

    const size = reader.settings.thickness
    const d = strokePath(points, size)
    const extent = strokeBounds(points, size)
    points = []
    live?.setAttribute('d', '')
    if (!d) return

    addAnnotation(
      newAnnotation('ink', pageIndex, {
        path: d,
        // Stored so erase has a real target: a thin stroke's filled outline is
        // almost impossible to hit, and its bounding box is not.
        box: extent,
        color: reader.settings.inkColor,
        thickness: size,
      }),
    )
  }

  // ---- notes ---------------------------------------------------------------
  function placeNote(ev: PointerEvent) {
    if (!vp || !surface) return
    const p = pagePoint(ev, surface)
    addAnnotation(
      newAnnotation('note', pageIndex, {
        // The click is the note's top-left, so the box hangs below it.
        box: { x: p.x, y: p.y - NOTE_H, w: NOTE_W, h: NOTE_H },
        text: '',
        color: '#fff8c4',
      }),
    )
  }

  /**
   * Catch the user dragging a note's resize handle, and nothing else.
   *
   * The trap here is that this observes an element whose size it also controls,
   * so a measurement that is even slightly lossy becomes a feedback loop that
   * walks the note to a wrong size. Two rules keep it honest:
   *
   *  - Compare against what WE rendered (box x zoom), not against a remeasured
   *    box round-tripped back through the leaf's 3D transform.
   *  - Read the computed style, which is the used value BEFORE transforms and
   *    is fractional. getBoundingClientRect includes the projection; offsetWidth
   *    is rounded to whole pixels. Either one drifts at a fractional zoom.
   */
  function watchResize(el: HTMLElement, a: Annotation) {
    const ro = new ResizeObserver(() => {
      if (!a.box) return
      const cs = getComputedStyle(el)
      const w = parseFloat(cs.width) / reader.zoom
      const h = parseFloat(cs.height) / reader.zoom
      if (!Number.isFinite(w) || !Number.isFinite(h)) return
      // Within a pixel of what we asked for: this is our own render, not a drag.
      if (Math.abs(w - a.box.w) * reader.zoom < 1 && Math.abs(h - a.box.h) * reader.zoom < 1) return
      // y is the box's BOTTOM in page units, so growing downward moves it.
      updateAnnotation(a.id, { box: { x: a.box.x, y: a.box.y + a.box.h - h, w, h } })
    })
    ro.observe(el)
    return { destroy: () => ro.disconnect() }
  }
</script>

<!-- Drawn output. Inert: never takes a pointer, never announced.
     Nothing here renders before `vp` exists. A mark positioned at a placeholder
     size is not merely invisible — a note laid out at 0x0 collapses to its
     minimum, and the resize observer would store THAT as the user's size. -->
<div class="highlights" aria-hidden="true">
  {#each vp ? marks : [] as a (a.id)}
    {#each a.quads ?? [] as q}
      {@const r = box(q)}
      <i
        class={a.type}
        style:left="calc({r.left} * var(--z) * 1px)"
        style:top="calc({r.top} * var(--z) * 1px)"
        style:width="calc({r.width} * var(--z) * 1px)"
        style:height="calc({r.height} * var(--z) * 1px)"
        style:background={a.type === 'highlight' ? a.color : 'none'}
        style:color={a.color}
        style:--ul-thickness="calc({a.thickness ?? 1.5} * var(--z) * 1px)"
      ></i>
    {/each}
  {/each}
</div>

<!-- Page units all the way down: the viewport's own matrix does the mapping,
     so a stroke needs no per-point conversion and no re-encode on zoom. -->
<svg
  class="ink"
  aria-hidden="true"
  viewBox="0 0 {vp?.width ?? 1} {vp?.height ?? 1}"
  preserveAspectRatio="none"
>
  {#if vp}
    <g transform="matrix({vp.transform.join(' ')})">
      {#each strokes as a (a.id)}
        <path d={a.path} fill={a.color} />
      {/each}
      <path bind:this={live} fill={reader.settings.inkColor} />
    </g>
  {/if}
</svg>

<div class="notes">
  {#each vp ? notes : [] as a (a.id)}
    {@const r = box(a.box ?? { x: 0, y: 0, w: 0, h: 0 })}
    <div
      class="note"
      class:inert={erasing}
      use:watchResize={a}
      style:left="calc({r.left} * var(--z) * 1px)"
      style:top="calc({r.top} * var(--z) * 1px)"
      style:width="calc({r.width} * var(--z) * 1px)"
      style:height="calc({r.height} * var(--z) * 1px)"
      style:background={a.color}
      contenteditable={erasing ? 'false' : 'plaintext-only'}
      oninput={(e) => updateAnnotation(a.id, { text: e.currentTarget.textContent ?? '' })}
      onkeydown={(e) => e.stopPropagation()}
      role="textbox"
      aria-multiline="true"
      tabindex="0"
      aria-label="Note"
    >{a.text ?? ''}</div>
  {/each}
</div>

<!-- Input surfaces. Only the active tool's exists at all. -->
{#if layer === 'ink'}
  <div
    bind:this={surface}
    class="surface drawing"
    role="application"
    aria-label="Freehand drawing surface"
    onpointerdown={inkDown}
    onpointermove={inkMove}
    onpointerup={inkUp}
    onpointercancel={inkUp}
  ></div>
{:else if layer === 'note'}
  <div
    bind:this={surface}
    class="surface placing"
    role="application"
    aria-label="Click to place a note"
    onpointerdown={placeNote}
  ></div>
{:else if layer === 'erase'}
  <div class="surface targets">
    {#each targets as t (t.a.id)}
      {@const r = box(t.quad)}
      <button
        style:left="calc({r.left} * var(--z) * 1px)"
        style:top="calc({r.top} * var(--z) * 1px)"
        style:width="calc({r.width} * var(--z) * 1px)"
        style:height="calc({r.height} * var(--z) * 1px)"
        onclick={() => removeAnnotation(t.a.id)}
        aria-label="Erase {t.a.type}"
      ></button>
    {/each}
  </div>
{/if}

<style>
  .highlights,
  .ink,
  .notes,
  .surface {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .highlights {
    z-index: 2;
    /*
     * The blend belongs HERE, on the layer, not on the individual rects.
     * `z-index` makes this element a stacking context, so a rect inside it can
     * only blend with its parent's contents — which are transparent — and the
     * marker comes out an opaque block hiding the very text it marks. Blending
     * the whole layer instead gives it the canvas as its backdrop.
     */
    mix-blend-mode: multiply;
  }
  .ink {
    z-index: 3;
    overflow: visible;
  }
  .notes {
    z-index: 5;
  }
  /* Above the text layer (4): a live tool outranks selection. */
  .surface {
    z-index: 5;
    pointer-events: auto;
  }
  .drawing {
    touch-action: none; /* let the pen draw instead of scrolling the page */
    cursor: crosshair;
  }
  .placing {
    cursor: copy;
  }
  .targets {
    pointer-events: none;
    z-index: 6;
  }
  .highlights i {
    position: absolute;
    display: block;
  }
  .highlights i.underline {
    background: none !important;
    border-bottom: var(--ul-thickness, 2px) solid currentColor;
  }
  .note {
    position: absolute;
    pointer-events: auto;
    overflow: auto;
    resize: both;
    padding: 0.4rem 0.5rem;
    border-radius: 3px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: calc(11 * var(--z) * 1px);
    line-height: 1.35;
  }
  .note.inert {
    pointer-events: none;
  }
  .note:focus-visible {
    outline: 2px solid #3b6ea5;
  }
  .targets button {
    position: absolute;
    pointer-events: auto;
    padding: 0;
    background: rgba(224, 36, 94, 0.16);
    border: 1px solid rgba(224, 36, 94, 0.5);
    border-radius: 2px;
    cursor: not-allowed;
  }
  .targets button:hover,
  .targets button:focus-visible {
    background: rgba(224, 36, 94, 0.34);
  }
</style>
