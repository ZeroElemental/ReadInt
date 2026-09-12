# ReadInt — Roadmap

Every phase, what it covers, what is done, and what is left. `PROGRESS.md` is
the working checklist you tick as you go; this is the map you read first when
picking the work back up.

**Where things stand:** Phases 0–4 are built, with the Phase-4 **deploy still
outstanding** — it needs a Firebase project and a Gemini key, which are yours to
create. **Phase 5 is next.**

| Phase | Covers | State |
|---|---|---|
| 0 | Skeleton: types, coords, storage, store, stubs | ✅ Done |
| 1 | Shell + PDF render + text layer | ✅ Done |
| 2 | Magnifier (lens + band) | ✅ Done |
| 3 | Annotations + explicit save | ✅ Done |
| 4 | Definitions, in-document search, first deploy | 🟡 Built; deploy pending |
| 5 | OCR for scanned PDFs and images | ⬜ **Next** |
| 6 | EPUB | ⬜ Not started |
| — | Deferred: sync, AI study layer, export, analytics | ⬜ Needs a backend |

The order is deliberate. Each phase depends on the one before it being *proven*,
not merely written — Phase 1 gates everything because a coordinate bug there
would silently corrupt every feature built on top.

---

## Phase 0 — Skeleton ✅

Domain types with all geometry in page units, `coords.ts` plus its round-trip
test, the Dexie schema with a separate drafts table, the runes store, the
keyboard map, the `DocAdapter` interface with three stubs, and all nine
components stubbed so the shell renders.

---

## Phase 1 — Shell + PDF render ✅

Proves the coordinate system before anything is built on it.

`PdfAdapter` with promise-cached page proxies, render cancellation, and
`getTextContent()` mapped to page-unit quads with line ids. pdf.js is reached
only through `await import()`, which both code-splits it and keeps the module
importable under `node --test`. Text layer, spread geometry, focus side,
LTR/RTL, page-turn animation, fit-to-height on open, and position restore.

**Interface change made here:** `DocAdapter.getPageSize` became
`getViewport(pageIndex): Promise<PageGeometry>`. `getPage` is async, and every
layer above the canvas needs the full transform — rotation and the y-flip — not
just a width and height.

**Proven by:** a generated PDF that draws a box at the debug quad's exact
coordinates. With zoom divided out the rect measured `x=72 y=218 w=200 h=24` at
48–228% zoom, spread↔single, LTR↔RTL, resize, and a live DPR change from 1.5 to
1.0. Open `/?debug` in dev to bring the rect back.

---

## Phase 2 — Magnifier ✅

The focused page is rasterised once to an off-DOM canvas at `zoom × magFactor`;
each frame is a single `drawImage` crop. Because the hi-res page is rendered at
exactly the magnification shown, both modes are a **1:1 device-pixel blit** —
`drawImage` never resamples, which is why one crop path serves both geometries.

Lens centres on the cursor. Band pins to the hovered line, spans the page width,
follows the cursor along the line, and hides in the gaps. Line detection uses
the `lineId` assigned during extraction, collapsed by `lineBoxes()`.

**Proven by:** 240 pointer moves drew 240 frames at p50 0 ms / p95 0.1 ms
against a 16.7 ms budget. Magnification measured exactly 2.5× against the test
PDF's known 16 pt line pitch. Never more than one `.mag-surface` mounted.

---

## Phase 3 — Annotations + persistence ✅

Highlight, underline, freehand ink, sticky notes, erase, a colour and thickness
palette, explicit save with a dirty indicator and `beforeunload` guard, and a
30 s draft autosave that is **offered** on reopen rather than merged.

Layers route by tool in markup, not by z-index. Erase is one uniform layer of
buttons over each mark's bounds rather than handlers on three shapes.

**Proven by:** all four types created, saved, hard-reloaded and reopened with
byte-identical geometry; marks measure `x=72.2 y=216.17 w=221.38` at 0.64×, 1.0×
and 1.95× alike; the autosave wrote a draft of 4 while the saved table stayed at
5 untouched.

---

## Phase 4 — Definitions, search, first deploy 🟡

- [x] Selection → popup, positioned from the range rect
- [x] dictionaryapi.dev for single words
- [x] `/api/define` — Cloud Functions gen2, Gemini Flash, term + surrounding
      sentence (**written, not deployed**)
- [x] Dexie lookup cache keyed `(term, docId)`
- [x] `SearchPanel` — normalise case/diacritics/ligatures/hyphen-at-line-break
- [x] Search hits → quads, prev/next navigation
- [x] `firebase.json`: SPA rewrite + `/api/**` → function
- [x] `maxInstances: 3`, per-IP rate limit
- [ ] **Deploy.** Needs a Firebase project, and therefore you:

```
firebase login
firebase projects:create            # or use an existing one
firebase use --add
firebase functions:secrets:set GEMINI_API_KEY
npm run build && firebase deploy
```

- [ ] `$1` budget alert on the project (Billing → Budgets & alerts). Not in
      `firebase.json` — it is a Cloud Billing setting, not a deploy artifact.

**No framework in the function, and that is deliberate.** This said Hono; for
one POST route Hono turned out to be a dependency plus a real hazard —
`firebase-functions` consumes the request stream to populate `req.body`, so a
fetch-style adapter mounted on top of it waits forever for a body that has
already been read. `onRequest` hands over a parsed body directly. Add a router
when there is a second route to justify one.

**Verify:** "the" → dictionary. A technical phrase → AI fallback with the
document's sense. Same phrase again → cache hit, no network request. Search a
hyphenated line break and find it.

**The privacy boundary is now invariant 11 in `AGENTS.md`**, and it is code
rather than prose: `sentenceAround`'s `MAX_CONTEXT` caps what is assembled, and
the function refuses anything longer instead of truncating it, so the client and
the server cannot drift apart.

---

## Phase 5 — OCR ⬜ **Next**

- [ ] `workers/ocr.worker.ts` — tesseract.js in a Web Worker
- [ ] Scanned detection: < ~20 chars/page on a sample → queue OCR
- [ ] Word boxes → `TextItem[]` in page units, persisted (`ocrDone`)
- [ ] `ImageAdapter` — one image as a one-page document
- [ ] Per-page progress UI

**Verify:** a scanned PDF and a photo of a page both become selectable, and
search + definitions work on them with no OCR-specific code path.

**Notes.** The hook is already in place: `PdfAdapter.getTextItems` carries a
`TODO(phase-5)` next to `SCANNED_CHAR_THRESHOLD`. Invariant 2 is the whole point
here — OCR results must be normalised into the same `TextItem` shape so nothing
downstream can tell which path ran. `ImageAdapter` is a stub implementing the
current interface; its `getViewport` should report the image's natural pixel
size with a y-up flip.

---

## Phase 6 — EPUB ⬜

- [ ] `EpubAdapter` — epub.js paginated + spread
- [ ] CFI-based annotations (`Annotation.cfi`)
- [ ] Band magnifier only; lens disabled for reflowable text
- [ ] Chapter navigation

**Verify:** highlight, reopen, highlight restored via CFI.

**Notes.** Genuinely a different shape of problem, which is why it is last:
reflowable text has no fixed page geometry, so `Annotation.cfi` replaces quads
and `PageGeometry` is not meaningful. Staged here so a slip cannot block the PDF
experience.

---

## Deferred — needs a real backend

Not scoped. Recorded so the architecture stays ready: stable annotation ids and
`updatedAt`, a single storage module, and the `DocAdapter` abstraction are all
in place for it.

- Accounts + cross-device sync (Firebase Auth + Firestore + Cloud Storage)
- AI study layer: ask-this-document (RAG), summaries, flashcards from highlights
  — brute-force cosine over Firestore-stored embeddings stays free for a single
  document; a vector store is only needed for library-wide semantic search
- Server OCR (Cloud Vision) and page tiling for 500MB+ scans
- Export: flattened annotated PDF, notes to Markdown/Anki
- Reading analytics + spaced repetition on highlights

---

## Known limitations

- **Two tabs on one document share a `drafts` row** and overwrite each other's
  autosave. Out of scope while the app is single-device; wants a tab lock or a
  per-tab draft id when sync arrives.
- **Notes are placed by pointer only.** Placing something at an arbitrary point
  has no sensible keyboard equivalent; the marks themselves are reachable, and
  erase targets are real focusable buttons.
- **Line grouping uses a fixed 1.5 pt baseline tolerance.** Fine for body text;
  a document mixing very large and very small type on one line could split it.
- **A search hit is sliced proportionally across its run**, so its box assumes
  every glyph in that run is the same width. Within a glyph on body text.
  Exact slicing needs per-character advances, which `TextItem` does not carry.
- **The first search of a document extracts every page's text**, which is the
  slow scan you see in the panel. `pageText` caches it in Dexie, so it is paid
  once per document, and hits stream in as pages are done rather than at the end.
- **Definitions are English-only** — that is what dictionaryapi.dev covers. A
  non-English term falls through to `/api/define`, which handles it fine.

## How to verify anything here

```
npm test         # node --test, no framework
npm run check    # svelte-check: types + a11y, expected 0 errors 0 warnings
npm run build    # production build
npm run dev      # then /?debug for the Phase 1 coordinate rect
```

There is a generated 4-page test PDF used throughout — it prints text at known
page coordinates and draws a box at exactly the debug quad, so geometry can be
checked against a rasterised target instead of by eye. It is not committed;
regenerate it when needed.
