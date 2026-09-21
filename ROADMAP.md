# ReadInt — Roadmap

Every phase, what it covers, what is done, and what is left. `PROGRESS.md` is
the working checklist you tick as you go; this is the map you read first when
picking the work back up.

**Where things stand:** every phase is done, pushed and deployed at
<https://readint-6b7d2.web.app>. Phase 7 is three of four; what remains after
that is export, then the deferred backend work.

| Phase | Covers | State |
|---|---|---|
| 0 | Skeleton: types, coords, storage, store, stubs | ✅ Done |
| 1 | Shell + PDF render + text layer | ✅ Done |
| 2 | Magnifier (lens + band) | ✅ Done |
| 3 | Annotations + explicit save | ✅ Done |
| 4 | Definitions, in-document search, first deploy | ✅ Done |
| 5 | OCR for scanned PDFs and images | ✅ Done |
| 6 | EPUB | ✅ Done |
| 7 | Release hardening | ◐ 3 of 4 built — the rate limit waits on a Firestore decision |
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

## Phase 4 — Definitions, search, first deploy ✅

- [x] Selection → popup, positioned from the range rect
- [x] dictionaryapi.dev for single words
- [x] `/api/define` — Cloud Functions gen2, Gemini Flash, term + surrounding
      sentence
- [x] Dexie lookup cache keyed `(term, docId)`
- [x] `SearchPanel` — normalise case/diacritics/ligatures/hyphen-at-line-break
- [x] Search hits → quads, prev/next navigation
- [x] `firebase.json`: SPA rewrite + `/api/**` → function
- [x] `maxInstances: 3`, per-IP rate limit
- [x] **Deployed** to `readint-6b7d2`, function `api` in `asia-south1`, with a
      $1 budget alert and a 1-day artifact cleanup policy.
      **Full checklist in [`DEPLOY.md`](DEPLOY.md)** — kept there rather than
      duplicated here, so the steps have one home and cannot drift.

**No framework in the function, and that is deliberate.** This said Hono; for
one POST route Hono turned out to be a dependency plus a real hazard —
`firebase-functions` consumes the request stream to populate `req.body`, so a
fetch-style adapter mounted on top of it waits forever for a body that has
already been read. `onRequest` hands over a parsed body directly. Add a router
when there is a second route to justify one.

**Verify:** "the" → dictionary. A technical phrase → AI fallback with the
document's sense. Same phrase again → cache hit, no network request. Search a
hyphenated line break and find it.

**The deploy taught more than the code did.** `gemini-2.5-flash` turned out to
be closed to new projects, 3.x Flash cannot switch thinking off, thinking
tokens are charged against `maxOutputTokens` — so the original 200-token cap
would have returned empty answers — and `thinkingLevel` moved a lookup from
4.5 s to 2.0 s. Full account in `PROGRESS.md`.

**The privacy boundary is now invariant 11 in `AGENTS.md`**, and it is code
rather than prose: `sentenceAround`'s `MAX_CONTEXT` caps what is assembled, and
the function refuses anything longer instead of truncating it, so the client and
the server cannot drift apart.

---

## Phase 5 — OCR ✅

- [x] `lib/tesseract.ts` — one shared tesseract worker, queued, with progress
- [x] Scanned detection: < 20 chars/page → rasterise at 216dpi and read it
- [x] Word boxes → `TextItem[]` in page units, persisted (`source`, `ocrDone`)
- [x] `ImageAdapter` — one image as a one-page document
- [x] Per-page progress pill
- [x] `public/tessdata/` — self-hosted core and model; OCR works offline

**Two deviations from what this file asked for**, both recorded in
`PROGRESS.md` with the reasoning:

1. **No `workers/ocr.worker.ts`.** `createWorker()` already spawns and owns a
   Web Worker, so ours would have been a worker inside a worker. `ocr.ts` is
   the pure box-to-quad conversion and `tesseract.ts` is a thin owner of
   tesseract's own worker.
2. **The wasm core and language model are served from `public/tessdata/`**, not
   from tesseract's default CDN. Self-hosting costs ~5.8MB in the repo and buys
   offline OCR plus a privacy claim that stays literally true: the README says
   exactly two things cross the network, and a third host downloading a model
   would have made that a footnote.

**Proven by:** an image-only PDF that pdf.js reports 0 text runs for. All 31
words read, `ANCHOR` landed within 0.74pt of its predicted page quad with 22.8%
ink coverage inside it and 0 a line above, search found "understand" across a
hyphenated line break with no search-side changes, and a highlight survived a
reload matching to 0.2pt at three zooms. A PNG of the same page opens as a
one-page document; its y-flip was checked against the raster rather than
against itself.

---

## Phase 6 — EPUB ✅

- [x] `EpubAdapter` — epub.js paginated, its own spread, NOT a `DocAdapter`
- [x] CFI-based annotations: highlight, underline, notes, erase
- [x] Chapter navigation, progress percentage, position memory
- [x] In-document search and selection → definition
- [x] Font size in place of the magnifier

**Three deviations from what this file asked for**, all recorded in
`PROGRESS.md` with the reasoning:

1. **Invariant 2 narrowed** to *the shell never knows which PAGED format it is
   reading*. A separate surface means the shell must know, and the old wording
   was only true because `EpubAdapter` threw on open.
2. **No band magnifier.** An iframe cannot be rasterised to a canvas, so the
   1:1 blit has nothing to blit. Zoom drives `themes.fontSize` instead, which
   is what an e-reader does.
3. **No ink.** A stroke has no stable point to pin to in reflowing text, so the
   tool is disabled rather than allowed to drift.

**Proven by:** a highlight measured dx 0, dy 0, dw 0 against its words at 16px,
24.96px and 12.8px — tracking the text through a reflow, which is the thing a
quad cannot do. Plus a 6-hit case-folded search across chapters, a reload that
restored both the mark and the reading position, and a definition request whose
body was exactly `{term, sentence}`.

---

## Phase 7 — Release hardening ◐

Four real defects, no new features.

- [x] **A retired Gemini model no longer hides behind a flat `502`** —
      [#2](https://github.com/ZeroElemental/ReadInt/issues/2). Google's status
      and reason travel back in the response body, and a `404` retries once
      against `gemini-flash-latest`. **Built, not deployed, and the fallback has
      never run against the project's real key** — the issue stays open until
      it has.
- [x] **One autosaving tab per document**, by Web Lock. A second tab still saves
      explicitly, says it is not backed up, and takes over if the first closes.
- [x] **Keyboard access:** `D` defines the current selection and moves focus into
      the card; the EPUB note editor takes focus and closes on Escape.
- [ ] **The rate limit is still per instance.** Moving it to Firestore means
      creating a database in the live project — provisioning, IAM and a billing
      surface — so it is held for an explicit decision rather than done as a
      side effect of a hardening pass.

**Proven by:** seven tests driving a fake Gemini through the retired-model and
ordinary-failure branches; eight tests on the lock's queueing and abort
semantics; and two real browser tabs on one document, where the draft written
after both went dirty held only the first tab's highlight and none of the
second's underline, and closing the owner cleared the other's notice.

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

- **OCR is English-only, needs SIMD, and reads one page at a time.** The full
  list, with the reasoning for each, is in `PROGRESS.md` under Phase 5.
- **EPUB generates a locations index on first open**, searches by loading every
  section, and redraws its marks on a timer after a font change because epub.js
  offers no "reflow finished" signal. Full list under Phase 6.
- **Some things are still pointer-only.** Placing a note on a PDF has no sensible
  keyboard equivalent (the marks themselves are reachable, and erase targets are
  real focusable buttons); an EPUB mark can be erased only by clicking it, since
  epub.js owns the element; and making a selection at all needs caret browsing
  (F7) or a pointer. `D` then defines it from the keyboard.
- **A second tab on one document does not autosave.** By design — see Phase 7.
  Without Web Locks (an old browser, or a non-secure context) the old behaviour
  stands and two tabs can overwrite each other's draft.
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
- **An AI definition takes about two seconds.** Measured 1.8–2.2 s against the
  deployed endpoint at `thinkingLevel: 'minimal'`, which is the floor — 3.x
  Flash cannot switch thinking off. A dictionary hit is far quicker and a cached
  one is instant, so this is only the cost of a phrase seen for the first time.
- **The function's rate limit is per instance.** It is an in-memory `Map`, so
  with `maxInstances: 3` the real ceiling is 3× the configured 20/min. Enough to
  stop a runaway loop; not a defence. Wants Firestore if this serves real
  traffic.

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
