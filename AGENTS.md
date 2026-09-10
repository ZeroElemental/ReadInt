# ReadInt

A reading platform that feels like a book in hand. The user opens a PDF, image,
or EPUB and gets a two-page spread, zooms into the page they're reading, and
follows their own cursor down the page the way a finger tracks a line. On top of
that: highlighting, underlining, freehand ink, sticky notes, selection-to-
definition, in-document search, and explicit save/restore of all markup.

**Local-first.** Documents never leave the device. The only thing crossing the
network is a term and one sentence of context, to `/api/define`.

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

4. **Layer conflicts are resolved by tool, not z-index.** The text layer sits
   above the annotation layers because selection must be on top; exactly one
   layer has `pointer-events: auto` at a time, keyed on `reader.tool`.

5. **One hi-res magnifier canvas at a time.** Built lazily for the focused page,
   released on page change. At 2.5x an A4 page is ~20MB — one is fine, every
   page is not.

6. **Save is explicit** (Ctrl+S / the button). The 30s autosave writes to a
   *separate* `drafts` record that is offered for recovery, never merged
   silently — otherwise "saved" stops meaning anything.

7. **`src/lib/storage.ts` is the only module that touches Dexie.** Annotations
   carry a stable `id` and `updatedAt`, so adding cloud sync later is one file
   plus a merge function, not a migration.

## Layout

```
src/
  lib/
    types.ts           domain types (all geometry in page units)
    coords.ts          THE conversion module + coords.test.ts
    reader.svelte.ts   the entire global store ($state singleton)
    storage.ts         Dexie schema + the only IndexedDB access
    keys.ts            keyboard map (a plain object, not a library)
  adapters/
    types.ts           DocAdapter interface
    PdfAdapter.ts      pdf.js; also handles scanned PDFs via OCR
    ImageAdapter.ts    one image = a one-page document
    EpubAdapter.ts     reflowable; CFI-based annotations, band magnifier only
  components/
    ReaderShell.svelte spread geometry, focus side, page turns, input
    PageView.svelte    the six-layer stack for one page
    TextLayer.svelte   transparent selectable text (layer 4)
    AnnotationLayer.svelte  highlights, ink, notes (layers 2/3/5)
    Magnifier.svelte   lens + band, one crop pipeline (layer 6)
    DefinitionPopup.svelte  dictionary -> AI fallback, cached
    SearchPanel.svelte in-document search
    Toolbar.svelte / Library.svelte
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

See `PROGRESS.md` for what's built and what's next.
