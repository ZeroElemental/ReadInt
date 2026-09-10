import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  // pdf.js and tesseract both ship their own workers; keep them ESM.
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // No manual chunk config: pdf.js (and later tesseract) are reached only
  // through dynamic import, so rolldown splits them out on its own.
})
