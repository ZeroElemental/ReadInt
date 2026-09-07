<script lang="ts">
  import { onMount } from 'svelte'
  import { listDocuments } from '../lib/storage.ts'
  import { detectFormat } from '../adapters/index.ts'
  import type { DocumentRecord } from '../lib/types.ts'

  let docs = $state<DocumentRecord[]>([])
  let dragging = $state(false)
  let error = $state('')

  onMount(async () => {
    docs = await listDocuments()
  })

  async function accept(files: FileList | null) {
    if (!files?.length) return
    error = ''
    try {
      detectFormat(files[0])
      // TODO(phase-1): persist the blob, open the adapter, set reader.docId.
      error = 'Import lands in Phase 1.'
    } catch (e) {
      error = (e as Error).message
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
        <li><button>{doc.name}</button></li>
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
