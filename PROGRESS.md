# Progress

Working checklist. Update this as work lands — it's the handoff between sessions.

**Status:** skeleton complete, Phase 1 not started.
**Last updated:** 2026-09-07

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
- [x] `CLAUDE.md` — invariants documented

Verified: `npm run build` clean (no warnings), `npm run check` 0 errors /
0 warnings across 277 files, `npm test` 5/5 passing.

---

## Phase 1 — Shell + PDF render

Proves the coordinate system before anything is built on it. **Do not start
Phase 2 until the drift check below passes.**

- [ ] `Library.svelte`: persist the dropped file to Dexie, open the adapter
- [ ] `PdfAdapter.open` — `getDocument`, hold the `PDFDocumentProxy`
- [ ] `PdfAdapter.getPageSize` — viewport at scale 1
- [ ] `PdfAdapter.renderPage` — render at `zoom × devicePixelRatio`, CSS-size
      the canvas back down; cancel any in-flight render for that page first
- [ ] `PdfAdapter.getTextItems` — `getTextContent()` → quads + `lineId`
- [ ] `TextLayer.svelte` — position/scale each span onto its quad
- [ ] Spread geometry, focus side, LTR/RTL, page-turn animation
- [ ] Wire `reader.pageCount`, `lastPageIndex` restore
- [ ] Configure chunk splitting in `vite.config.ts` once pdf.js is actually
      imported (rolldown's `codeSplitting`, not the deprecated `advancedChunks`)

**Verify:** draw a debug rect at fixed page coordinates. It must stay pinned to
the same glyphs across 50%→300% zoom, spread→single, LTR→RTL, window resize,
and a browser-zoom (DPR) change. If it drifts, fix the transform — do not build
on it.

---

## Phase 2 — Magnifier

- [ ] Off-DOM hi-res canvas for the focused page at `zoom × magFactor`
- [ ] Lens mode — `srcRect` centred on cursor, round mask, rAF-throttled
- [ ] Band mode — `srcRect` = hovered line's full-width box, drawn as a strip
- [ ] Line detection from `TextLayer` `lineId`
- [ ] Release the hi-res canvas on page change / focus change
- [ ] Settings toggle + `m` cycles off → lens → band

**Verify:** DevTools performance trace while sweeping the cursor — ≥55fps, and
the heap does not grow across ten page turns.

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
