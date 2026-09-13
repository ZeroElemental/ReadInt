# ReadInt

A reading platform that feels like a book in hand. Open a document, get a
two-page spread, zoom into the page you're reading, and follow your own cursor
down the page the way a finger tracks a line — with highlighting, underlining,
freehand ink, sticky notes, selection-to-definition, in-document search, and an
explicit save you control.

**Local-first.** Your documents are stored in your browser and never leave your
device. See [Privacy](#privacy) for the two small exceptions, both of which you
trigger yourself.

## What works today

| | Status |
|---|---|
| **PDF** — render, spread, zoom, text selection | ✅ Working |
| Magnifier — lens and line band | ✅ Working |
| Highlight, underline, ink, notes, erase | ✅ Working |
| Explicit save, draft recovery | ✅ Working |
| In-document search | ✅ Working |
| Definitions — single words (dictionary) | ✅ Working |
| Definitions — phrases (AI fallback) | ⚠️ Needs a deploy — see [DEPLOY.md](DEPLOY.md) |
| **Images** (PNG/JPG) + OCR for scanned PDFs | ⬜ Not built — Phase 5 |
| **EPUB** | ⬜ Not built — Phase 6 |

Dropping an image or an EPUB today fails with `…Adapter.open not implemented`.
The file type is recognised; the adapter behind it is still a stub. PDFs are
the supported path.

Until the definition backend is deployed, single-word lookups work on their own
through a public dictionary, and anything it can't answer says "Definition
service not available yet" rather than failing silently.

## Quick start

```
npm install
npm run dev
```

Then drop a PDF onto the library. Add `?debug` to the URL in dev to bring back
the coordinate rect used to verify the geometry.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run check` | svelte-check — types and a11y |
| `npm test` | `node --test`, no framework |

## Stack

Vite · Svelte 5 (runes) · TypeScript · pdf.js · Dexie/IndexedDB ·
perfect-freehand · tesseract.js · epub.js · Firebase Hosting + Functions gen2.

Deliberately **not** React (a VDOM is the wrong tool for 60fps pointer work),
not SvelteKit (no SSR, no routing needed), and no state library — Svelte 5
runes cover it. The reasoning is in [AGENTS.md](AGENTS.md).

## Privacy

Documents are held in IndexedDB on your machine. They are never uploaded — not
the file, not a page of text, not your annotations.

Two things cross the network, and only when you select text and ask for a
definition:

| To | What it gets |
|---|---|
| `dictionaryapi.dev` | the single word you selected, nothing else |
| `/api/define` (your own deployment) | the selected term, plus its sentence, hard-capped at 300 characters |

The cap is enforced in code on both sides, and the server refuses an over-long
request rather than trimming it. Every lookup is cached locally, so asking
twice never sends anything twice.

## Documentation

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Architecture, and the invariants that hold it together |
| [ROADMAP.md](ROADMAP.md) | Every phase — what it covers, what's done, what's left |
| [DEPLOY.md](DEPLOY.md) | Deploying the definitions backend |
| [PROGRESS.md](PROGRESS.md) | The build log: what was built and how it was proven |

## Licence

MIT — see [LICENSE](LICENSE).
