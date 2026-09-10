<script lang="ts">
  import { onMount } from 'svelte'
  import {
    annotationsForDoc,
    getDocument,
    getDraft,
    listDocuments,
    putDocument,
    touchDocument,
  } from '../lib/storage.ts'
  import { detectFormat, openDocument } from '../adapters/index.ts'
  import { openDoc } from '../lib/reader.svelte.ts'
  import type { DocumentRecord } from '../lib/types.ts'

  let docs = $state<DocumentRecord[]>([])
  let dragging = $state(false)
  let error = $state('')
  let busy = $state(false)

  onMount(async () => {
    docs = await listDocuments()
  })

  async function accept(files: FileList | null) {
    if (!files?.length || busy) return
    const file = files[0]
    error = ''
    busy = true
    try {
      const now = Date.now()
      const rec: DocumentRecord = {
        id: crypto.randomUUID(),
        name: file.name,
        format: detectFormat(file),
        blob: file,
        pageCount: 0, // real count only exists once the adapter is open
        ocrDone: false,
        addedAt: now,
        lastOpenedAt: now,
        lastPageIndex: 0,
      }
      await putDocument(rec)
      await open(rec)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  /** The one open path: the drop handler and the shelf both land here. */
  async function open(rec: DocumentRecord) {
    // If this throws, reader state is never touched — a corrupt file leaves the
    // library on screen with an error rather than a half-open reader.
    const adapter = await openDocument(rec.blob, rec.format)
    // The saved marks, plus any autosave that outlived a crash. The draft is
    // carried, never merged — the user is asked.
    const [saved, draft] = await Promise.all([
      annotationsForDoc(rec.id),
      getDraft(rec.id),
    ])
    openDoc(rec, adapter, saved, draft ?? null)
    await touchDocument(rec.id, { pageCount: adapter.pageCount })
  }

  async function reopen(id: string) {
    if (busy) return
    error = ''
    busy = true
    try {
      const rec = await getDocument(id)
      if (!rec) throw new Error('That document is no longer stored on this device.')
      await open(rec)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }
</script>

<main class="library">
  <header>
    <h1>ReadInt</h1>
    <p>Open a document and read it like a book.</p>
  </header>

  <label
    class="drop"
    class:dragging
    ondragover={(e) => {
      e.preventDefault()
      dragging = true
    }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => {
      e.preventDefault()
      dragging = false
      accept(e.dataTransfer?.files ?? null)
    }}
  >
    <input
      type="file"
      accept=".pdf,.epub,image/*"
      hidden
      onchange={(e) => accept(e.currentTarget.files)}
    />
    <span>Drop a PDF, image, or EPUB — or click to choose</span>
    <small>Nothing is uploaded. Documents stay on this device.</small>
  </label>

  {#if error}<p class="error">{error}</p>{/if}

  {#if docs.length}
    <ul class="shelf">
      {#each docs as doc (doc.id)}
        <li><button onclick={() => reopen(doc.id)}>{doc.name}</button></li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .library {
    max-width: 46rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
  }
  header h1 {
    margin: 0;
    font-size: 2rem;
    letter-spacing: -0.02em;
  }
  header p {
    margin: 0.25rem 0 2rem;
    color: var(--muted);
  }
  .drop {
    display: grid;
    place-items: center;
    gap: 0.4rem;
    padding: 3.5rem 1rem;
    border: 1px dashed var(--rule);
    border-radius: 12px;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s, border-color 0.15s;
  }
  .drop:hover,
  .dragging {
    background: var(--raise);
    border-color: var(--ink);
  }
  .drop small {
    color: var(--muted);
  }
  .error {
    color: #b4232a;
  }
  .shelf {
    list-style: none;
    padding: 0;
    margin: 2rem 0 0;
    display: grid;
    gap: 0.5rem;
  }
  .shelf button {
    width: 100%;
    text-align: left;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: var(--paper);
    cursor: pointer;
    font: inherit;
  }
</style>
