<script lang="ts">
  /**
   * Selection -> meaning, in a small card above the selection.
   *
   *   1. single word  -> dictionaryapi.dev straight from the browser
   *                      (keyless, CORS-open, instant)
   *   2. miss/phrase  -> POST /api/define with the term AND its surrounding
   *                      sentence, so the model explains the term the way this
   *                      document uses it
   *   3. either way   -> cached in Dexie by (term, docId); a repeat lookup
   *                      never touches the network again
   *
   * STATUS: skeleton — Phase 4.
   */

  let term = $state('')
  let meaning = $state('')
  let loading = $state(false)
  let anchor = $state<{ x: number; y: number } | null>(null)

  // TODO(phase-4): on selectionchange/pointerup, read the selection, grab the
  // enclosing sentence for context, position from range.getBoundingClientRect().
</script>

{#if anchor}
  <div class="popup" style:left="{anchor.x}px" style:top="{anchor.y}px" role="dialog">
    <strong>{term}</strong>
    {#if loading}
      <p class="muted">Looking up…</p>
    {:else}
      <p>{meaning}</p>
    {/if}
    <footer>
      <button>Find in document</button>
      <button>Search the web</button>
    </footer>
  </div>
{/if}

<style>
  .popup {
    position: fixed;
    z-index: 20;
    transform: translate(-50%, calc(-100% - 10px));
    max-width: 22rem;
    padding: 0.6rem 0.75rem;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    font-size: 0.85rem;
  }
  .popup p {
    margin: 0.35rem 0 0.5rem;
  }
  .muted {
    color: var(--muted);
  }
  footer {
    display: flex;
    gap: 0.4rem;
  }
  footer button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 5px;
    background: none;
    cursor: pointer;
  }
</style>
