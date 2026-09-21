<script lang="ts">
  /**
   * Export, as a button that opens two choices.
   *
   * Which choices exist depends on what is open: Markdown works for every format
   * because it is just the marks and the text under them, but the annotated PDF
   * is the ORIGINAL FILE with marks drawn on it, so it is offered only when the
   * original is a PDF. A scan counts — it is a PDF — and simply has no text layer
   * to keep, as it had none to begin with.
   */
  import { canAnnotatePdf, runExport, type ExportKind } from '../lib/exporter.ts'

  /** How long the result stays on screen. Long enough to read, short enough to leave. */
  const MESSAGE_MS = 6000

  let open = $state(false)
  let busy = $state(false)
  let message = $state('')
  let root = $state<HTMLDivElement | null>(null)
  let first = $state<HTMLButtonElement | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  const pdfOk = $derived(canAnnotatePdf())

  // Focus follows the menu, so opening it from the keyboard lands somewhere.
  $effect(() => {
    if (open) first?.focus()
  })
  $effect(() => () => clearTimeout(timer))

  async function choose(kind: ExportKind) {
    open = false
    busy = true
    message = ''
    clearTimeout(timer)
    try {
      message = await runExport(kind)
    } catch (err) {
      console.error('export failed', err)
      // An encrypted PDF is the likeliest cause, and pdf-lib says so plainly.
      message = `Export failed: ${(err as Error).message}`
    } finally {
      busy = false
      timer = setTimeout(() => (message = ''), MESSAGE_MS)
    }
  }
</script>

<svelte:window
  onkeydown={(e) => e.key === 'Escape' && open && (open = false)}
  onpointerdown={(e) => open && !root?.contains(e.target as Node) && (open = false)}
/>

<div class="export" bind:this={root}>
  <button
    onclick={() => (open = !open)}
    disabled={busy}
    aria-haspopup="menu"
    aria-expanded={open}
  >
    {busy ? 'Exporting…' : 'Export'}
  </button>

  {#if open}
    <div class="menu" role="menu" aria-label="Export">
      <button role="menuitem" bind:this={first} onclick={() => choose('markdown')}>
        Marks as Markdown
      </button>
      <button
        role="menuitem"
        disabled={!pdfOk}
        title={pdfOk ? '' : 'Only available when the original is a PDF'}
        onclick={() => choose('pdf')}
      >
        Annotated PDF
      </button>
      <p class="hint">Includes marks you have not saved yet.</p>
    </div>
  {/if}
</div>

{#if message}
  <p class="toast" role="status">{message}</p>
{/if}

<style>
  .export {
    position: relative;
  }
  .menu {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 13rem;
    padding: 0.35rem;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.2);
  }
  .menu button {
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    padding: 0.4rem 0.6rem;
    border: none;
    border-radius: 5px;
    background: none;
    cursor: pointer;
    color: inherit;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--raise);
  }
  .menu button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .hint {
    margin: 0.3rem 0.6rem 0.2rem;
    color: var(--muted);
    font-size: 0.7rem;
  }
  .toast {
    position: fixed;
    top: 4rem;
    right: 1rem;
    z-index: 25;
    max-width: 22rem;
    margin: 0;
    padding: 0.55rem 0.8rem;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.2);
    font-size: 0.8rem;
  }
</style>
