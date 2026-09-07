<script lang="ts">
  import { onMount } from 'svelte'
  import { reader } from './lib/reader.svelte.ts'
  import { loadSettings } from './lib/storage.ts'
  import Library from './components/Library.svelte'
  import ReaderShell from './components/ReaderShell.svelte'

  onMount(async () => {
    reader.settings = await loadSettings()
  })

  // Explicit save is the contract, so leaving with unsaved marks must warn.
  function beforeUnload(ev: BeforeUnloadEvent) {
    if (reader.dirty) ev.preventDefault()
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />

{#if reader.docId}
  <ReaderShell />
{:else}
  <Library />
{/if}
