# Progress

The log of what has actually been built and proven. Update this as work lands —
it is the handoff between sessions.

For the plan — every phase, what it covers, what is left — see `ROADMAP.md`.
For the architecture and its invariants, see `AGENTS.md`.

**Status:** Phases 0–3 complete, pushed to `main`. Phase 4 next.
**Last updated:** 2026-09-10

---

## Start here next session

Phase 4: definitions, in-document search, first deploy. Full checklist and
notes in `ROADMAP.md`.

First moves, in order:

1. `DefinitionPopup.svelte` and `SearchPanel.svelte` are still Phase-0 stubs —
   read them first, the shapes are already committed.
2. Selection → popup. `TextLayer.commitSelection()` already shows how to get a
   live selection and convert its rects; the popup needs the range rect for
   placement, not quads.
3. Wire dictionaryapi.dev for single words, hitting `getLookup`/`putLookup`
   (already in `storage.ts`) **before** the network.
4. The search normaliser — case, diacritics, ligatures, hyphen-at-line-break —
   is pure and fiddly. Put it in its own module with its own `node --test` file
   before wiring any UI to it.
5. `/api/define` and deploy last, once the local half works.

Careful: Phase 4 is the first thing that leaves the device. Only a term and one
sentence of context may cross the network — never the document.

Standing checks, all green as of this commit:

```
npm test      # 18 passing
npm run check # 0 errors, 0 warnings across 339 files
npm run build # clean; pdf.js splits into its own chunk
```

---

## Phase 0 — Skeleton ✅

- [x] Vite + Svelte 5 + TS config, builds clean
- [x] `lib/types.ts` — domain types, all geometry in page units
- [x] `lib/coords.ts` — page↔screen conversion + line merging
- [x] `lib/coords.test.ts` — round-trip guarded at 6 zoom levels (`npm test`)
- [x] `lib/storage.ts` — Dexie schema, explicit save, separate draft table
- [x] `lib/reader.svelte.ts` — global runes store
- [x] `lib/keys.ts` — keyboard map
- [x] `adapters/` — `DocAdapter` interface + 3 stubs + format detection
- [x] `components/` — all 9 components stubbed, shell renders
- [x] `AGENTS.md` — invariants documented

Verified: `npm run build` clean (no warnings), `npm run check` 0 errors /
0 warnings across 277 files, `npm test` 5/5 passing.

---

## Phase 1 — Shell + PDF render ✅

Proves the coordinate system before anything is built on it.

- [x] `Library.svelte`: persist the dropped file to Dexie, open the adapter
- [x] `PdfAdapter.open` — `getDocument`, hold the `PDFDocumentProxy`
- [x] `PdfAdapter.getViewport` — viewport at scale 1
- [x] `PdfAdapter.renderPage` — render at `zoom × devicePixelRatio`, CSS-size
      the canvas back down; cancel any in-flight render for that page first
- [x] `PdfAdapter.getTextItems` — `getTextContent()` → quads + `lineId`
- [x] `TextLayer.svelte` — position/scale each span onto its quad
- [x] Spread geometry, focus side, LTR/RTL, page-turn animation
- [x] Wire `reader.pageCount`, `lastPageIndex` restore
- [x] Chunk splitting — pdf.js is reached only through `await import()`, so
      rolldown splits it out on its own. No config entry was needed.

**Interface change:** `DocAdapter.getPageSize` is gone, replaced by
`getViewport(pageIndex): Promise<PageGeometry>`. `getPage` is async, and every
layer above the canvas needs the full transform (rotation and the y-flip), not
just a width and height. pdf.js's `PageViewport` satisfies `PageGeometry` as-is.

**Verified** with a 4-page PDF that draws a box at exactly the debug quad's
coordinates, so the rect has a rasterised target to be compared against. With
the zoom divided out, the rect measured `x=72 y=218 w=200 h=24` — the exact page
quad — at every one of: 48%/60%/75%/93%/117%/146%/183%/228% zoom, spread↔single,
LTR↔RTL, window resize, and a live DPR change (1.5→1.0, canvas backing store
followed). Selection over the anchor run returns `"ANCHOR AT 72,600"`, all 16
runs extract with line ids 0–15 in reading order, and reopening from the shelf
restores the page you left on.

Two things the check surfaced and fixed: the text layer measured spans that
still carried their previous `scaleX` (harmless today, a compounding error the
moment those nodes are reused), and `.book` clipped anything zoomed past the
window instead of letting it scroll.

---

## Phase 2 — Magnifier ✅

- [x] Off-DOM hi-res canvas for the focused page at `zoom × magFactor`
- [x] Lens mode — `srcRect` centred on cursor, round mask, rAF-throttled
- [x] Band mode — `srcRect` = hovered line's full-width box, drawn as a strip
- [x] Line detection from `lineId` (`lineBoxes` in `coords.ts`)
- [x] Release the hi-res canvas on page change / focus change
- [x] Settings toggle + `m` cycles off → lens → band

**Both modes are a 1:1 device-pixel blit.** The hi-res page is rasterised at
exactly the magnification being shown, so `drawImage` never resamples. That is
what makes the frame nearly free, and it is why one crop path serves both
geometries instead of two.

**`PdfAdapter` render cancellation is keyed by canvas, not by page index.** The
magnifier rasterises the same page into its own canvas; keying by page had it
cancelling the visible page out from under itself.

**Verified:** sweeping 240 pointer moves across a page drew 240 frames at a p50
of 0ms and a p95 of 0.1ms, against a 16.7ms budget — the draw path is not the
bottleneck at any plausible rate. JS heap moved 12.6MB → 12.9MB across ten page
turns with the magnifier live. Magnification measured exactly 2.5x (text row
pitch 24.18px expected, 24-25px measured), the band tracks lines to the pixel
(line 5 sits `5 × 16pt × zoom` below line 0) and hides itself between lines, `m`
cycles correctly, and `f` moves the magnifier to the newly focused leaf with
never more than one `.mag-surface` alive.

Caveat on the memory number: `usedJSHeapSize` excludes canvas backing stores, so
it is corroborating evidence, not proof. The real guarantee is structural —
`PageView` mounts this component only for the focused page, and the effect
teardown sizes the canvas to 0x0 rather than waiting for GC.

Also fixed here: `PageView` was calling `getBoundingClientRect()` on every
pointermove, forcing a layout per frame on the one path that must not. The box
is now cached and invalidated on zoom, page change, scroll and resize.

---

## Phase 3 — Annotations + persistence ✅

- [x] Highlight/underline from `getClientRects()` → `mergeQuadsByLine` → quads
- [x] Ink via perfect-freehand + `PointerEvent.pressure` → SVG path in page units
- [x] Notes — placed, resizable, contenteditable
- [x] Erase tool
- [x] Colour + thickness palette in the toolbar
- [x] Explicit save (`Ctrl+S`), dirty indicator, `beforeunload` guard
- [x] 30s draft autosave + recovery prompt on reopen

**Layers are routed by tool in markup, not by z-index.** The drawn layers are
inert and `aria-hidden`; the surface that takes a pointer only exists while its
tool is active (`activeLayer()` in the store). Highlight and underline count as
text tools — the browser's own selection is what produces their geometry.
Erase is therefore one uniform layer of buttons over each mark's bounds rather
than click handlers on three different shapes, which also solves a thin ink
stroke being nearly impossible to click.

**Ink stays in page units end to end.** A stroke is hundreds of points, so
instead of converting each one on every render the SVG is handed the viewport's
own matrix (`PageGeometry.transform`) and the path is left alone.

**Verified:** all four types created, saved with `Ctrl+S`, hard-reloaded and
reopened — every mark returned with byte-identical geometry. Measured at 0.64x,
1.0x and 1.95x zoom the marks read `x=72.2 y=216.17 w=221.38` at every one, and
a note holds exactly 150x90 page units. The 30s autosave wrote a draft of 4
while the saved table stayed at 5, untouched; reopening showed the saved 5 plus
a banner offering the draft, and Restore swapped in the 4 and went dirty.
Closing while dirty fired the `beforeunload` prompt.

### Four bugs this phase surfaced, all fixed

1. **Saving silently failed.** Svelte 5 state is a DEEP proxy, so `{...a}` still
   handed Dexie a Proxy for `quads`, `structuredClone` refused it, and every
   save threw. Everything bound for storage now goes through
   `annotationsSnapshot()` (`$state.snapshot`). The error path deliberately
   leaves `dirty` set, which is how this was caught rather than lost.
2. **Highlights were opaque blocks**, hiding the text they marked — the thing
   the layer's own comment promised they would not do. `mix-blend-mode` was on
   each rect, but `.highlights` has `z-index`, which makes it a stacking
   context, so a rect could only blend with its transparent parent. The blend
   belongs on the layer. `transform-style: preserve-3d` on `.page` was a second
   isolator and is now `flat` — the leaf's rotation comes from `.book`'s
   perspective and never needed it.
3. **Ink recorded a single point.** `getCoalescedEvents()` can return an EMPTY
   list, and `?? [ev]` only covers a missing method, so every stroke collapsed
   to a dot.
4. **A fresh document opened dirty, and notes shrank to nothing.** The resize
   observer ran while `vp` was still null, measured the 0x0 placeholder the note
   had collapsed into, and stored THAT as the user's size. Annotations no longer
   render before there is a viewport, and the observer compares against what was
   rendered (`box x zoom`, via computed style) rather than a size round-tripped
   back through the leaf's 3D projection.

**Known limitation:** two tabs open on the same document share one `drafts` row
and will overwrite each other's autosave. Out of scope while the app is
single-device; worth a tab lock or a per-tab draft id when sync arrives.

---

## Phases 4–6 and beyond

Moved to `ROADMAP.md` so the plan lives in one place and cannot drift out of
sync with this log. It carries the full checklists for definitions/search/deploy
(4), OCR (5), EPUB (6), the deferred backend work, and the known limitations.
