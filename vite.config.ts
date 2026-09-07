import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  // pdf.js and tesseract both ship their own workers; keep them ESM.
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // Chunk splitting for pdf.js / tesseract is deliberately not configured yet —
  // neither is imported, so there is nothing to split. Add it in Phase 1 when
  // there's a real bundle to measure.
})
