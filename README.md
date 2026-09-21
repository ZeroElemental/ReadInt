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
| Definitions — phrases (AI fallback) | ✅ Working — [deployed](DEPLOY.md) |
| **Images** (PNG/JPG) + OCR for scanned PDFs | ✅ Working |
| **EPUB** | ⬜ Not built — Phase 6 |

Dropping an EPUB today fails with `EpubAdapter.open not implemented`. The file
type is recognised; the adapter behind it is still a stub.

A scanned PDF or a photo of a page is read by OCR in the browser, and the words
come back in the same shape the PDF text layer would have produced — so
selection, highlighting, search and definitions all work on a scan with no
separate code path. English only, and the first page of a document takes a few
seconds.

A live deployment runs at <https://readint-6b7d2.web.app>. Running your own is
a fifteen-minute job — [DEPLOY.md](DEPLOY.md) has the checklist. Without one the
app still works: single-word lookups go through a public dictionary, and
anything it can't answer says "Definition service not available yet" rather
than failing silently.

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

tesseract's wasm core and English model are served from `public/tessdata/`
rather than a CDN, so OCR works offline and nothing about it reaches the
network. See the README in that directory.

Deliberately **not** React (a VDOM is the wrong tool for 60fps pointer work),
not SvelteKit (no SSR, no routing needed), and no state library — Svelte 5
runes cover it. The reasoning is in [AGENTS.md](AGENTS.md).

## Privacy

Documents are held in IndexedDB on your machine. They are never uploaded — not
the file, not a page of text, not your annotations. That includes OCR: a
scanned page is read on your device, by wasm this app serves itself.

Two things cross the network, and only when you select text and ask for a
definition:

| To | What it gets |
|---|---|
| `dictionaryapi.dev` | the single word you selected, nothing else |
| `/api/define` (your own deployment) | the selected term, plus its sentence, hard-capped at 300 characters |

`/api/define` passes that term and sentence to Gemini and returns a sentence or
two. It is deployed against a **paid** Gemini key, which matters: on the paid
tier Google "doesn't use your prompts ... or responses to improve our
products", whereas the free tier does. If you deploy your own, put the key on a
project with billing enabled or your readers' selections become training data.

The cap is enforced in code on both sides, and the server refuses an over-long
request rather than trimming it — 301 characters of context comes back `400`,
verified against the live endpoint. Every lookup is cached locally, so asking
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
