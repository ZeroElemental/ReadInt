# ReadInt

A reading platform that feels like a book in hand. The user opens a PDF, image,
or EPUB and gets a two-page spread, zooms into the page they're reading, and
follows their own cursor down the page the way a finger tracks a line. On top of
that: highlighting, underlining, freehand ink, sticky notes, selection-to-
definition, in-document search, and explicit save/restore of all markup.

**Local-first.** Documents never leave the device. Exactly two things cross the
network, both assembled in `DefinitionPopup.svelte`:

| To | What it gets |
|---|---|
| `dictionaryapi.dev` | a single selected word, nothing else |
| `/api/define` | the selected term + its sentence, hard-capped at 300 chars |

The context is the sentence the term sits in. On a page with sparse punctuation
that walk can reach the page edges, so the cap — not the sentence boundary — is
what actually bounds it. Treat 300 characters of surrounding text as the claim.

Never the file, never a page of text, never an annotation.

## Stack

Vite + Svelte 5 (runes) + TypeScript · pdf.js · Dexie/IndexedDB ·
perfect-freehand · tesseract.js · epub.js · Firebase Hosting + Functions gen2.

Deliberately **not** React (VDOM is wrong for 60fps pointer work), not
SvelteKit (no SSR, no routing), and no state library (runes cover it).

## Invariants

These are load-bearing. Breaking one produces bugs that look like something else.

1. **All geometry is stored in page units** — PDF user space of the unrotated
   page, origin bottom-left. Never screen or CSS pixels. `src/lib/coords.ts` is
   the only place conversion happens, and `coords.test.ts` guards it. If a
   highlight drifts on zoom, spread change, or a DPI change, the bug is here.

2. **The shell never knows what it is reading.** Everything goes through
   `DocAdapter` (`src/adapters/types.ts`). Scanned PDFs are *not* a fourth
   adapter — `PdfAdapter` runs OCR and emits the same `TextItem` shape, so
   nothing downstream branches on "is this OCR".

3. **The 60fps paths never go through reactive state.** Cursor position,
   in-flight ink points, and magnifier crop rects are written straight to the
   DOM/canvas by their component. Only committed results reach `reader`.

4. **Layer conflicts are resolved by tool, not z-index.** `activeLayer()` in
   the store maps `reader.tool` to exactly one live surface, and that surface is
   the only one that *exists* — drawn layers are inert and `aria-hidden`, input
   surfaces are created by `{#if}`. Highlight and underline are **text** tools:
   the browser's own selection is what produces their geometry, so the text
   layer stays live for them.

5. **One hi-res magnifier canvas at a time.** Built lazily for the focused page,
   released on page change. At 2.5x an A4 page is ~20MB — one is fine, every
   page is not.

6. **Save is explicit** (Ctrl+S / the button). The 30s autosave writes to a
   *separate* `drafts` record that is offered for recovery, never merged
   silently — otherwise "saved" stops meaning anything.

7. **`src/lib/storage.ts` is the only module that touches Dexie.** Annotations
   carry a stable `id` and `updatedAt`, so adding cloud sync later is one file
   plus a merge function, not a migration.

8. **Nothing reactive may cross into storage.** Svelte 5 `$state` is a *deep*
   proxy, so a spread copy still hands Dexie a `Proxy` for `quads`/`box`,
   `structuredClone` refuses it, and the write throws. Everything bound for
   Dexie goes through `annotationsSnapshot()` (`$state.snapshot`) in
   `reader.svelte.ts`. A save that fails must leave `dirty` set — that is how
   this class of bug gets noticed instead of losing someone's work.

9. **Nothing renders before its page viewport exists.** A quad without a
   viewport has no meaning, and it is not merely invisible: a note laid out at
   0x0 collapses to its minimum size, and the resize observer stores *that* as
   the user's size. Annotation rendering is gated on `vp`.

10. **`mix-blend-mode` belongs on the layer, not on the mark.** `.highlights`
    has a `z-index` and is therefore a stacking context, so a rect inside it can
    only blend with its transparent parent and comes out an opaque block over
    the text it marks. For the same reason `.page` is `transform-style: flat` —
    `preserve-3d` isolates every layer onto its own plane. The leaf's rotation
    comes from `.book`'s perspective and never needed it.

11. **The network boundary is a function call, not a policy.** What may leave
    the device is capped by `sentenceAround`'s default (`MAX_CONTEXT`, 300
    chars) in `src/lib/search.ts`, and that function is the only way context is
    ever assembled. `functions/src/index.ts` *refuses* anything longer instead
    of truncating it, so the two sides cannot drift apart quietly. Raising the
    cap, or joining sentences to "give the model more to work with", is how the
    local-first claim at the top of this file stops being true.

## Layout

```
src/
  lib/
    types.ts           domain types (all geometry in page units)
    coords.ts          THE conversion module + coords.test.ts
    reader.svelte.ts   the entire global store ($state singleton)
    storage.ts         Dexie schema + the only IndexedDB access
    keys.ts            keyboard map (a plain object, not a library)
    ink.ts             perfect-freehand -> filled SVG outline, in page units
    search.ts          runs -> one string -> folded -> hits -> quads (pure)
  adapters/
    types.ts           DocAdapter interface + PageGeometry
    PdfAdapter.ts      pdf.js; also handles scanned PDFs via OCR
    ImageAdapter.ts    one image = a one-page document
    EpubAdapter.ts     reflowable; CFI-based annotations, band magnifier only
  components/
    ReaderShell.svelte spread geometry, focus side, page turns, input
    PageView.svelte    the six-layer stack for one page
    TextLayer.svelte   transparent selectable text (layer 4)
    AnnotationLayer.svelte  highlights, ink, notes, erase (layers 2/3/5)
    Magnifier.svelte   lens + band, one crop pipeline (layer 6)
    DefinitionPopup.svelte  dictionary -> AI fallback, cached
    SearchPanel.svelte in-document search
    Toolbar.svelte / Library.svelte
functions/
    src/index.ts       POST /api/define — the only server, no framework
```

## Commands

```
npm run dev      # vite dev server
npm run build    # production build
npm run check    # svelte-check (types + a11y)
npm test         # node --test, no framework
```

## Conventions

- `import type` everywhere it applies (`verbatimModuleSyntax` is on), and
  explicit `.ts` extensions on relative imports.
- Svelte 5 syntax only: `$state` / `$derived` / `$props()`, `onclick` not
  `on:click`.
- Unimplemented work is a `TODO(phase-N)` next to the real signature, so the
  shape is committed even when the body isn't.
- Non-trivial logic leaves one runnable check behind (`node --test`). No test
  framework, no fixtures.

## Geometry, in one place

Every layer above the canvas positions itself the same way: compute **once** in
scale-1 CSS px from the page's viewport, then scale with the `--z` custom
property on `.page`. A zoom change is therefore one property write, not a
relayout of a thousand spans. Ink is the one exception and for a good reason —
a stroke is hundreds of points, so its SVG is handed the viewport's own matrix
(`PageGeometry.transform`) and the path stays in page units untouched.

Going the other way (a DOM rect back to page units) means dividing out **both**
the zoom and the leaf's projected/layout ratio, which cancels its 3D transform:
`relativeTo(rect, pageRect, zoom * projection)` then `screenToQuad`.

## Where to look when something is wrong

| Symptom | Cause, nearly always |
|---|---|
| A mark drifts on zoom / DPI / spread change | `coords.ts`, or a screen value stored as a page value |
| A mark is an opaque block | blend mode on the rect instead of the layer, or a new stacking context |
| Save appears to work but nothing persists | a reactive proxy reached Dexie; see invariant 8 |
| A note collapses, or a fresh doc opens dirty | something rendered or measured before `vp`; see invariant 9 |
| Pointer feels sticky | a forced layout on the move path, or reactive state on a 60fps path |
| A search finds nothing it should | the joining or folding rules in `search.ts`; add the case to `search.test.ts` first |
| A search hit lands beside the word | `hitQuads` proportional slicing, or the quad came from the wrong run |

See `PROGRESS.md` for the working checklist and `ROADMAP.md` for the full phase
plan — what each phase covers, what is done, and what is left.
