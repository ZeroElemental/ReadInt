# Progress

The log of what has actually been built and proven. Update this as work lands —
it is the handoff between sessions.

For the plan — every phase, what it covers, what is left — see `ROADMAP.md`.
For the architecture and its invariants, see `AGENTS.md`.

**Status:** Phases 0–5 complete, deploy included. The app is live at
<https://readint-6b7d2.web.app> and `/api/define` answers from `asia-south1`.
Scanned PDFs and images now read. **Phase 5's code is not deployed yet** — it
is built and verified locally; `firebase deploy` is the outstanding step.
Phase 6 (EPUB) next.
**Last updated:** 2026-09-21

---

## Start here next session

**Deploy Phase 5, then start Phase 6 (EPUB).** The deploy is the short one and
carries a new wrinkle: `public/tessdata/` is ~5.8MB of OCR assets that ship
with the site, so check they are actually served — the SPA rewrite in
`firebase.json` would otherwise hand tesseract `index.html` for a missing file,
and it would fail on garbage rather than on a 404.

```
curl -sI https://readint-6b7d2.web.app/tessdata/eng.traineddata.gz
```

Phase 6 is genuinely a different problem, not more of the same: reflowable text
has no fixed page geometry, so `Annotation.cfi` replaces quads and
`PageGeometry` stops being meaningful. `ROADMAP.md` has the checklist.

Standing checks, all green as of this commit:

```
npm test      # 34 passing (27 + 7 for OCR)
npm run check # 0 errors, 0 warnings
npm run build # clean; pdf.js and tesseract each split into their own chunk
cd functions && npx tsc --noEmit   # clean

curl -s -X POST https://readint-6b7d2.web.app/api/define   -H 'content-type: application/json'   -d '{"term":"quad","sentence":"Each quad is stored in page units."}'
```

**A note on Node.** `npm test` needs Node 24. This machine's shell defaults to
22 through fnm, where `node --test` cannot strip TypeScript and every test file
fails with `ERR_UNKNOWN_FILE_EXTENSION` — the toolchain, not the tests.

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

## Phase 4 — Definitions + search ✅

- [x] `lib/search.ts` — flatten, fold, find, map hits back to quads (pure)
- [x] `lib/search.test.ts` — 9 cases, `node --test`
- [x] Selection → popup, placed from the range rect, cache → dictionary → AI
- [x] Dexie lookup cache keyed `(folded term, docId)`
- [x] `SearchPanel` — streaming scan, prev/next, page + focus-side navigation
- [x] Transient hit overlay in `PageView`, inert and never persisted
- [x] `functions/` + `firebase.json` written and typechecking
- [x] Deployed — `readint-6b7d2`, function `api` in `asia-south1`

**A page's text is not a string, and that is the whole problem.** It is a few
hundred positioned runs, split wherever the font changed, wrapped across lines,
with words cut in half by a hyphen at the break. `search.ts` flattens them into
one string while remembering which run owns each character, folds that (NFKD,
strip combining marks, lowercase, collapse whitespace) with a map back to the
raw text, searches the folded copy, and walks both maps home. Two joining rules
carry the weight: within a line a space goes in only when there is a real
horizontal gap, because pdf.js splits a run at every font change; across a line
a trailing hyphen is dropped entirely.

**The privacy boundary is now code, not prose** — invariant 11. `MAX_CONTEXT`
in `search.ts` caps what is assembled, and the function *refuses* anything
longer rather than truncating it, so the two sides cannot drift apart.

**No framework in the function.** The roadmap said Hono; for one POST route it
was a dependency plus a real hazard — `firebase-functions` consumes the request
stream to fill `req.body`, so a fetch-style adapter on top waits forever for a
body already read.

**Verified in a real browser** (Playwright, against a regenerated 4-page test
PDF that prints at known page coordinates):

- "understand" is found on all 4 pages where the source reads `under-` /
  `stand` across a line break. "cafe" finds "café", "resume" finds "résumé",
  and a two-word phrase spanning a real word gap is found.
- The hit overlay measured `left=72.26 top=216.28` at zoom 0.488 / 0.61 /
  0.763 / 0.954 — the same page coordinates at every one. In the same frame the
  text span for that word measured `72.26 / 216.28` too, so the mark sits
  exactly on the glyphs rather than merely being self-consistent.
- Sub-word slicing: searching "WORD" inside a 10-character "ANCHORWORD" run
  drew `left=144.45 width=48.08` against a predicted `144.43 / 48.12`.
- Next/prev walked all 4 hits, moving focus left→right within a spread, turning
  to the next spread, and wrapping both ways, with exactly one `.current`
  overlay alive throughout.
- **Cache: a seeded lookup row produced the definition with 0 network
  requests.** The uncached path sent exactly one request, to dictionaryapi.dev,
  carrying only the word.
- The `/api/define` body was exactly `{term, sentence}` — no document, no page
  text, no annotations.
- With Highlight active a selection makes a mark and does *not* open the popup;
  switching back to Select restores it. Invariant 4 survived a second
  `pointerup` listener.

**One real bug the browser found: no timeout.** The dictionary fetch hung for
38 s before failing, and the card sat on "Looking up…" the whole time — on a
captive portal or a dead tunnel it would have sat there indefinitely. Both
requests now carry an 8 s deadline (`AbortSignal.any` of the user's cancel and
`AbortSignal.timeout`), a dictionary that is merely unreachable falls through
to the model instead of aborting the lookup, and a timeout says so. After the
fix the same selection settled in 259 ms.

### The deploy, and the four things it caught

Live at <https://readint-6b7d2.web.app>; function `api`, gen2, Node 22,
`asia-south1`, secret `GEMINI_API_KEY` v1 out of Secret Manager. Everything
below was measured against the deployed URL, not a local emulator.

**1. `gemini-2.5-flash` is closed to new projects.** It answers `404` with a
note pointing at `gemini-3.6-flash`. A model id is not a constant you write
once — it is a dependency with a support window, and this one expired between
the code being written and the project being created.

**2. Thinking tokens are charged against `maxOutputTokens`.** 3.x Flash cannot
switch thinking off at all. The original `maxOutputTokens: 200` would have been
spent reasoning and returned an EMPTY answer — which this code would have
reported as "no definition returned", diagnosing a budget problem as a model
problem. Now 800 with `thinkingLevel: 'minimal'`.

**3. `parts[0]` is no longer the answer.** A thinking model returns its
reasoning in the same array, flagged `thought`. The parser takes the first part
that is not one.

**4. `thinkingLevel` is a latency control, not just a cost one.** At `'low'` a
lookup took **4.2–4.8 s**; at `'minimal'`, **1.8–2.2 s** — and the answers came
back *more* specific, not less. The client's deadline is 8 s, so `'low'` fit
inside it while still being far too slow to sit under a popup. Worth knowing
that the budget that keeps a request legal is not the budget that makes it feel
instant.

**Verified against the live endpoint:** a real definition that uses the
surrounding sentence (asked for "coordinate system" in a sentence about page
units, the answer explained why zoom does not move an annotation); the
no-sentence path; and every guard — `301` characters of context → `400`,
exactly `300` → `200`, `GET` → `405`, an unknown path → `404`, a missing term
→ `400`. The privacy cap refuses rather than truncating, on the server, exactly
as invariant 11 requires.

**Cost guards in place:** `maxInstances: 3`, `timeoutSeconds: 20`, 256 MiB, a
per-IP rate limit, a $1 budget alert, and a 1-day Artifact Registry cleanup
policy so old build images cannot accumulate into a bill.

---

## Phase 5 — OCR ✅

- [x] `lib/ocr.ts` — tesseract boxes → `TextItem[]` in page units (pure)
- [x] `lib/ocr.test.ts` — 7 cases, `node --test`
- [x] `lib/tesseract.ts` — one shared worker, a job queue, progress
- [x] Scanned detection + rasterise + handoff in `PdfAdapter.getTextItems`
- [x] `ImageAdapter` — one image as a one-page document
- [x] Per-page progress pill in `PageView`
- [x] `public/tessdata/` — self-hosted core and model, so OCR works offline

**No hand-written worker, and the roadmap was wrong to ask for one.**
`createWorker()` already spawns and owns a Web Worker; `workers/ocr.worker.ts`
would have been a worker inside a worker — a postMessage hop and a lifecycle to
get wrong, for nothing. `lib/tesseract.ts` is a thin owner of tesseract's own
worker instead, and it is reached only through `await import()`, which is what
keeps 5MB out of the entry chunk. Jobs are queued because one worker reads one
page at a time whether we like it or not, and the search panel scans every page
of a document.

**The conversion does no arithmetic of its own.** A tesseract box is a rect in
raster pixels measured down from the top-left — which is exactly what
`ScreenRect` already means. Divide by the raster scale and `screenToQuad`
supplies page units, the y-flip and any page rotation, from the same code the
selection path uses. That is the whole of `linesToTextItems`, and it is why
invariant 1 holds on a scan without a second conversion to get wrong.

**The raster scale is measured, not assumed.** `renderPage` multiplies by
devicePixelRatio and rounds, so `ocrPage` derives the scale from
`canvas.width / viewport.width` rather than recomputing that arithmetic. A
conversion that re-derives what it could read is one refactor away from putting
every word in the wrong place.

**Line ids come from tesseract, not from `groupByLine`.** groupByLine clusters
baselines within 1.5pt, which is right for a digital PDF where a baseline is
exact. A scan's baselines wobble with the paper and the skew — the test fixture
is rotated 0.35° for exactly this reason — and at 216dpi that wobble clears
1.5pt easily. Tesseract already decided which words share a line, with far more
evidence than a y-coordinate.

**Words take the LINE's vertical extent, not their own ink.** This one was
found by looking at a highlight. A word's ink box is as tall as that word
happens to be, so `system` reaches lower than `coordinate`; pdf.js does not
work that way — it reports a run's height as the font's, uniform along a line —
and everything downstream is built on that. With ragged boxes a highlight over
a phrase came back as a row of uneven tiles with the spaces left white. Same
type is not the same shape, and invariant 2 needs the shape.

### Verified in a real browser

The fixture is an HTML page of known text, skewed 0.35°, screenshotted to a
JPEG and wrapped in a one-page image-only PDF (US Letter, so one page unit is
exactly two image pixels). pdf.js opens it and reports **0 text runs** — a
genuine scan, not a PDF with its text hidden.

- **All 31 words read correctly**, including `under-` / `stand` split across a
  line break.
- **`ANCHOR` landed at `x=116.33 w=92.67`** against a predicted `117.07 / 91.31`
  — the 0.74pt is the left side-bearing of a serif A. Sampling the rasterised
  canvas inside that quad gives **22.8% dark pixels, and exactly 0 one line
  above or below**, so the mark sits on real glyphs rather than merely being
  self-consistent.
- **Search found "understand" across the hyphenated break with no search-side
  changes at all**, drawing one quad per line, and "cafe" still found "Cafe".
  That is invariant 2 proven rather than asserted.
- A highlight over a phrase saved at `x=76.70 w=260.18`, survived a reload, and
  measured `76.79–76.88 / 260.32–260.39` at 25%, 31% and 39% zoom. Reopening
  did **not** re-run OCR, and `ocrDone` was true on the record.
- A PNG of the same page opens as a one-page document with page units in
  natural pixels. The y-flip was checked against the raster, not against
  itself: ink **0.145 inside the quad, 0 at the mirrored y, 0 in the margin**.
- Cold OCR of one letter page: the progress pill appeared at **1.3s** (0% →
  30% → 50%) and text was selectable at **3.8s**, worker spawn, 3.9MB of wasm
  and a 1.9MB model included. The native PDF path was re-checked in the same
  session and still reports `source: 'native'`, with no pill.

### Five bugs this phase surfaced, all fixed

1. **The two-file wasm core cannot load itself.** It is 1MB smaller than the
   single-file build, and its loader resolves the sibling `.wasm` against a
   script directory that is empty inside tesseract's worker: `Failed to parse
   URL from tesseract-core-simd-lstm.wasm`. The single-file build carries the
   wasm inline, which is why upstream ships those at all.
2. **Selecting two words gave `coordinatesystem`.** Absolutely positioned spans
   are adjacent to a selection with nothing between them, and that string is
   what reaches the definition popup. Invisible on a digital PDF, where a run
   usually carries its own spaces; constant on a scan, where every word is its
   own run. The text layer now emits a separator using search.ts's own gap
   rule — one rule, two consumers, no chance of them disagreeing. It has to be
   a NON-BREAKING space: a plain one is the only in-flow content in that layer,
   so white-space processing collapses every one of them away.
3. **`GAP_RATIO` was sitting inside the distribution it was meant to split.**
   Real spaces on the test page measured 0.242 to 0.636 of the run height; the
   threshold was 0.25, so one pair in twenty-four came back as `Everyquad` —
   in the searched string as well as the selected one. A mid-word run split,
   the case the rule exists for, has a gap of zero. 0.12 is twice the kerning
   ceiling and half the narrowest real space measured.
4. **A highlight over a phrase was a row of uneven tiles**, with the word gaps
   left white. Per-word ink heights, fixed at the source — see above.
5. **DOM rects split one line into two at low zoom.** `mergeQuadsByLine`'s
   fixed 1.5-unit tolerance suits exact extraction geometry, but selection
   rects are rounded and dividing by zoom magnifies that: at 25% one screen
   pixel is four page units, and on an image document a page unit is a pixel
   rather than a point. The selection call site now scales the tolerance to the
   text's own height.

Also fixed in passing: a spread's trailing leaf on an odd page count made every
layer ask for a page that does not exist, logging `Invalid page request` each
time. Answered once in `pageText` — there is no text on a page that is not
there — rather than in each caller.

`pageText` also dedupes in flight now. The Dexie cache only ever deduped
callers arriving after the first one had finished, and the text layer, the band
magnifier and the search panel routinely ask for the same page in the same
tick. On a digital PDF that wasted a cheap `getTextContent()`; on a scan it
would have wasted a whole second OCR pass.

### Known limitations

- **English only.** `eng.traineddata` is what ships; another script needs
  another model in `public/tessdata/`.
- **SIMD is required.** One core build ships rather than the three tesseract
  probes for, so a browser without SIMD — nothing since 2021 — gets no OCR at
  all rather than a slow fallback.
- **An image is read at its natural resolution.** A 3000px scan is fine; a
  1000px phone photo of a page will read badly, and upscaling cannot put the
  detail back.
- **`OCR_SCALE` is 3**, i.e. 216dpi. It is the accuracy-versus-speed knob, and
  the cost is quadratic.
- **One worker, so pages are read strictly one at a time.** The first search of
  a scanned book pays for every page in sequence. Hits stream in as pages
  finish and `pageText` caches each one, so it is paid once per document.
- **The worker is never terminated**, holding a thread and ~30MB for the
  session. Deliberate: it is a singleton, unlike the magnifier's per-page
  canvas, and tearing it down would trade bounded memory for a two-second cold
  start on the next scan.
- **Progress shows on the page being read, not on the shelf.** Opening a
  200-page scan and going to make tea looks idle from the library.

---

## Phase 6 and beyond

Moved to `ROADMAP.md` so the plan lives in one place and cannot drift out of
sync with this log. It carries the checklist for EPUB (6), the deferred backend
work, and the known limitations across every phase.

Two pieces of deferred work now have issues rather than only prose:
[#1](https://github.com/ZeroElemental/ReadInt/issues/1) for AI search over the
document, and [#2](https://github.com/ZeroElemental/ReadInt/issues/2) for the
Gemini model id expiring behind a flat `502`.
