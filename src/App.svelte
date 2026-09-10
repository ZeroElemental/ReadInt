<script lang="ts">
  import { onMount } from 'svelte'
  import { reader } from './lib/reader.svelte.ts'
  import { loadSettings, saveSettings } from './lib/storage.ts'
  import Library from './components/Library.svelte'
  import ReaderShell from './components/ReaderShell.svelte'

  let loaded = $state(false)

  onMount(async () => {
    reader.settings = await loadSettings()
    loaded = true
  })

  // Settings are preferences, not document data — they persist on change rather
  // than waiting for an explicit save. Gated on `loaded` so the defaults can
  // never overwrite what was stored before the read lands.
  $effect(() => {
    const next = { ...reader.settings }
    if (loaded) void saveSettings(next)
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
