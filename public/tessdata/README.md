# OCR assets

Committed on purpose. tesseract.js fetches its WASM core and language model
from a CDN by default; ReadInt serves them itself so that **OCR works offline**
and the claim in `README.md` — that exactly two things ever cross the network,
both of which you trigger yourself — stays literally true. Downloading a model
is not an upload, but it is still a third host, and the privacy section is a
promise rather than a vibe.

Copied into `dist/` verbatim by Vite: `public/` is neither hashed nor bundled.

| File | Source | Size |
|---|---|---|
| `tesseract-core-simd-lstm.wasm.js` | `node_modules/tesseract.js-core@7.0.0` | 3.9 MB |
| `eng.traineddata.gz` | <https://tessdata.projectnaptha.com/4.0.0_fast/> | 1.9 MB |

**Why this exact core build.** tesseract.js normally probes for relaxed-SIMD,
then SIMD, then plain, and fetches whichever matches — so self-hosting the
probe would mean shipping three variants. Naming a `.js` file in `corePath`
skips it, and one variant covers every browser: SIMD has been universal since
2021, and relaxed-SIMD would only have been a little faster.

It has to be the **single-file** `.wasm.js`, which carries the wasm inline.
The two-file build is 1 MB smaller and does not work: its loader resolves
`tesseract-core-simd-lstm.wasm` against a script directory that is empty inside
tesseract's own worker, and dies on `Failed to parse URL`. That cost an hour,
so it is written down here rather than rediscovered.

`_fast` rather than `_best` for the model: roughly twice the speed at a small
accuracy cost, which is the right trade for text that is about to be searched
rather than published.

## Refreshing

```
cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js public/tessdata/
curl -sL -o public/tessdata/eng.traineddata.gz \
  https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz
```

Do this when `tesseract.js-core` is upgraded — a core and a worker from
different versions is a failure mode that reads as a corrupt wasm.
