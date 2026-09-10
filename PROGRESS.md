# Progress

Working checklist. Update this as work lands — it's the handoff between sessions.

**Status:** Phases 1-2 complete. Phase 3 (annotations + persistence) next.
**Last updated:** 2026-09-10

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

## Phase 3 — Annotations + persistence

- [ ] Highlight/underline from `getClientRects()` → `mergeQuadsByLine` → quads
- [ ] Ink via perfect-freehand + `PointerEvent.pressure` → SVG path in page units
- [ ] Notes — placed, resizable, contenteditable
- [ ] Erase tool
- [ ] Colour + thickness palette in the toolbar
- [ ] Explicit save (`Ctrl+S`), dirty indicator, `beforeunload` guard
- [ ] 30s draft autosave + recovery prompt on reopen

**Verify:** annotate, save, hard-reload, reopen — everything returns in place.
Repeat at a different zoom to confirm page-unit storage. Close while dirty and
confirm the prompt fires.

---

## Phase 4 — Definitions, search, first deploy

- [ ] Selection → popup, positioned from the range rect
- [ ] dictionaryapi.dev for single words
- [ ] `/api/define` — Hono on Cloud Functions gen2, Gemini Flash, term +
      surrounding sentence
- [ ] Dexie lookup cache keyed `(term, docId)`
- [ ] `SearchPanel` — normalise case/diacritics/ligatures/hyphen-at-line-break
- [ ] Search hits → quads, prev/next navigation
- [ ] `firebase.json`: SPA rewrite + `/api/**` → function; deploy
- [ ] `$1` budget alert, `maxInstances: 3`, per-IP rate limit

**Verify:** "the" → dictionary. A technical phrase → AI fallback with the
document's sense. Same phrase again → cache hit, no network request. Search a
hyphenated line break and find it.

---

## Phase 5 — OCR

- [ ] `workers/ocr.worker.ts` — tesseract.js in a Web Worker
- [ ] Scanned detection: < ~20 chars/page on a sample → queue OCR
- [ ] Word boxes → `TextItem[]` in page units, persisted (`ocrDone`)
- [ ] `ImageAdapter` — one image as a one-page document
- [ ] Per-page progress UI

**Verify:** a scanned PDF and a photo of a page both become selectable, and
search + definitions work on them with no OCR-specific code path.

---

## Phase 6 — EPUB

- [ ] `EpubAdapter` — epub.js paginated + spread
- [ ] CFI-based annotations (`Annotation.cfi`)
- [ ] Band magnifier only; lens disabled for reflowable text
- [ ] Chapter navigation

**Verify:** highlight, reopen, highlight restored via CFI.

---

## Deferred — needs a real backend

Not scoped. Recorded so the architecture stays ready for it (stable annotation
ids + `updatedAt`, single storage module, `DocAdapter` abstraction).

- Accounts + cross-device sync (Firebase Auth + Firestore + Cloud Storage)
- AI study layer: ask-this-document (RAG), summaries, flashcards from highlights
  — brute-force cosine over Firestore-stored embeddings stays free for a single
  document; a vector store is only needed for library-wide semantic search
- Server OCR (Cloud Vision) and page tiling for 500MB+ scans
- Export: flattened annotated PDF, notes to Markdown/Anki
- Reading analytics + spaced repetition on highlights
