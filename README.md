# ReadInt

**A local-first reading platform that feels like a book in hand.**

Open a PDF, a scan, an image or an EPUB and read it as a two-page spread. Zoom into
the page you are on, follow your own cursor down the text the way a finger tracks a
line, mark it up, look words up, search it, and take your notes with you — while your
documents never leave your device.

**Live:** <https://readint-6b7d2.web.app>

---

## Contents

- [What it is](#what-it-is)
- [Use cases](#use-cases)
- [Features](#features)
- [Privacy](#privacy)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Deploying](#deploying)
- [Documentation](#documentation)
- [Status](#status)
- [License](#license)

---

## What it is

ReadInt is a single-page web app for reading and annotating documents. It is built
around one idea: **your library belongs on your machine.** Files are stored in the
browser (IndexedDB), rendering and OCR run locally, and there is no account. The only
server is a tiny endpoint that explains a phrase when you ask it to — and it receives
at most a few hundred characters, never the document.

It handles four kinds of input through one interface:

| Input | How it is read |
|---|---|
| **PDF** | Rendered with pdf.js, with a selectable text layer |
| **Scanned PDF** | Detected automatically and read by OCR in the browser |
| **Image** (PNG, JPEG) | Treated as a one-page document and OCR'd |
| **EPUB** | Reflowable, paginated by epub.js, with CFI-anchored annotations |

## Use cases

- **Studying and research.** Highlight, underline and annotate papers and textbooks,
  then export your marks as Markdown for notes or a literature review.
- **Reading scanned material.** Old books, printouts and photographed pages become
  selectable and searchable, so search and word lookup work on them like on any PDF.
- **Reading closely.** The lens and line-band magnifier follow your cursor, which
  helps with dense layouts, small print and tired eyes.
- **Ebooks without a store.** Open a DRM-free EPUB, jump by chapter, change the type
  size, and keep highlights that stay on the same words when the text reflows.
- **Sharing your markup.** Export the original PDF with your highlights, underlines,
  ink and notes drawn on it — text layer intact — to send to someone else.
- **Reading sensitive documents.** Contracts, drafts and personal papers stay in your
  browser. Nothing about the file is uploaded.

## Features

| | |
|---|---|
| **Reading** | Two-page spread with a page-turn animation, single-page mode, left-to-right or right-to-left, fit-to-height on open, and your place remembered per document |
| **Magnifier** | A lens or a full-width line band that follows the cursor. Both are a 1:1 device-pixel crop of a high-resolution render, so there is no blur and almost no per-frame cost |
| **Annotations** | Highlight, underline, freehand ink with pen pressure, sticky notes, and erase, with colour and thickness controls |
| **Saving** | An explicit save (Ctrl+S) plus a 30-second draft that is *offered* after a crash, never merged behind your back |
| **Search** | Case, accent and ligature insensitive, and it finds words split by a hyphen at a line break. Hits stream in as pages are scanned |
| **Definitions** | Select text for a definition: cache, then a public dictionary for single words, then an AI explanation of phrases *as your document uses them* |
| **OCR** | Scanned pages and images are read in a Web Worker. It works offline and the words feed the same selection, search and definition code as a native PDF |
| **EPUB** | Chapter menu, reading position and progress, font size, in-book search, highlights, underlines and notes anchored to the text |
| **Export** | Your marks as Markdown, or the original PDF with them drawn on it |
| **Keyboard** | Page turns, zoom, tool switching, search, save, and define-the-selection without touching the mouse |

Freehand ink and the magnifier are not available for EPUB: reflowing text has no
stable place to pin a stroke to, and an iframe cannot be rasterised to magnify. Zoom
changes the font size there instead.

## Privacy

Your documents are held in IndexedDB on your machine. They are never uploaded — not
the file, not a page of text, not your annotations. OCR and export run entirely in
the browser, using assets this app serves itself.

Exactly two things cross the network, and only when you select text and ask for a
definition:

| To | What it receives |
|---|---|
| `dictionaryapi.dev` | The single word you selected, nothing else |
| `/api/define` (this app's own function) | The selected term plus its sentence, **hard-capped at 300 characters** |

`/api/define` passes that to Gemini and returns a sentence or two. It uses a **paid**
Gemini key on purpose: on the paid tier Google does not use prompts to improve its
products, whereas on the free tier it does. If you deploy your own, put the key on a
project with billing enabled.

The cap is enforced in code on both sides, and the server *refuses* an over-long
request rather than trimming it. Every lookup is cached locally, so asking twice never
sends anything twice.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| UI | **Svelte 5** (runes), **TypeScript** | No virtual DOM to fight on 60fps pointer paths; runes cover state without a library |
| Build | **Vite** | A plain SPA — no server rendering or routing is needed |
| PDF | **pdf.js** | Rendering and text extraction |
| EPUB | **epub.js** | Pagination, CFIs and annotation rendering |
| OCR | **tesseract.js** (WASM, in a worker) | Runs offline; assets are self-hosted rather than fetched from a CDN |
| Storage | **Dexie** over IndexedDB | The only module that touches the database, so sync could later be one file |
| Ink | **perfect-freehand** | Pressure-sensitive stroke outlines |
| PDF export | **pdf-lib** | Draws marks onto the *original* PDF, so its text layer survives |
| Backend | **Firebase Hosting** + one **Cloud Function** (gen2, Node 22, `asia-south1`) | The only server: a single POST route, no framework |
| Definitions | **dictionaryapi.dev**, **Gemini** Flash | Free lookup first, AI only for what it cannot answer |

Heavy dependencies — pdf.js, tesseract, epub.js and pdf-lib — are only ever reached
through `await import()`, so each ships as its own chunk and costs nothing until it is
used.

Deliberately **not** React (a virtual DOM is the wrong tool for pointer-driven
rendering), **not** SvelteKit, and no state library. The reasoning behind these and
every other fork is in [DECISIONS.md](DECISIONS.md).

## Getting started

### Prerequisites

- **Node.js 20.19+ or 22.12+** to run and build the app (Vite's requirement)
- **Node.js 24** to run the tests — they are TypeScript files run directly by
  `node --test`, and older Node cannot strip the types
- A modern desktop browser. OCR needs WebAssembly SIMD, which every current browser has

### Run it

```bash
git clone https://github.com/ZeroElemental/ReadInt.git
cd ReadInt
npm install
npm run dev
```

Open the address Vite prints (by default <http://localhost:5173>) and drop a PDF, an
image or an EPUB onto the page.

Without a backend the app still works: single-word lookups go through the public
dictionary, and anything it cannot answer says "Definition service not available yet"
instead of failing silently. Reading, annotating, searching, OCR and export need no
server at all.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run check` | `svelte-check` — types and accessibility, expected to report 0 errors and 0 warnings |
| `npm test` | Unit tests via `node --test`, no framework |
| `cd functions && npm test` | Tests for the definition function |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `←` / `→` | Previous / next page (reversed in right-to-left mode) |
| `Space` / `Shift+Space` | Next / previous page |
| `+` / `-` / `0` | Zoom in / out / reset (font size in an EPUB) |
| `S` `H` `U` `P` `N` `E` | Select, Highlight, Underline, Pen, Note, Erase |
| `M` | Cycle the magnifier: off, lens, line band |
| `F` | Switch which page of the spread is focused |
| `D` | Define the current selection |
| `Ctrl+F` | Search the document |
| `Ctrl+S` | Save your marks |
| `Esc` | Close the search panel or a card |

## Project layout

```
src/
  adapters/    PdfAdapter, ImageAdapter, EpubAdapter — how each format is read
  components/  Reader shell, page and EPUB views, toolbar, search, popups
  lib/         Store, coordinates, storage, search, OCR, export — mostly pure, mostly tested
functions/     The single /api/define Cloud Function
public/        Self-hosted OCR assets (WASM core + English model)
```

`src/lib/coords.ts` is the load-bearing module: every mark is stored in *page units*
(PDF user space), never screen pixels, which is why highlights stay put across zoom,
spread changes and different displays.

## Testing

The suite is 82 tests: 75 for the app and 7 for the function. They cover the pure
logic where an off-by-one would be silent — coordinate conversion, search
normalisation, OCR-to-page-unit mapping, EPUB text offsets, the tab lock, and the
export.

Geometry and rendering cannot be asserted by unit tests, so each feature was also
verified in a real browser against a rasterised target: for example, an exported PDF
was rendered and compared pixel by pixel with the original. Those measurements are
recorded in [PROGRESS.md](PROGRESS.md).

## Deploying

The site is static and the function is one file. Deploying needs a Firebase project on
the **Blaze** plan and a Gemini API key. The full checklist, including the parts that
stall in practice, is in [DEPLOY.md](DEPLOY.md).

```bash
npm run build
firebase deploy --only hosting            # the site
firebase deploy --only functions          # /api/define
```

## Documentation

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Architecture and the invariants that hold it together |
| [DECISIONS.md](DECISIONS.md) | Every fork in the road: what was chosen, what was not, and why — plus what is still open |
| [ROADMAP.md](ROADMAP.md) | Every phase, what it covers, what is done and what is left |
| [PROGRESS.md](PROGRESS.md) | The build log: what was built and how it was proven |
| [DEPLOY.md](DEPLOY.md) | Deploying the site and the definitions backend |

## Status

All planned phases are complete: PDF, scanned PDF, image and EPUB reading;
magnifier; annotations and saving; definitions and search; OCR; export; and a
release-hardening pass (one item there, moving the rate limit to a shared store, is
deliberately deferred). The site is live.

Still open, none of it started: accounts and cross-device sync of your marks (the
documents would stay on each device), and an AI study layer. Both need real design
decisions first; the options are laid out in [DECISIONS.md](DECISIONS.md), and the
open items are tracked as [GitHub issues](https://github.com/ZeroElemental/ReadInt/issues).

## License

MIT — see [LICENSE](LICENSE).
