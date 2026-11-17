import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Excalidraw's editor chunk is inherently large; it's lazy-loaded per route.
    chunkSizeWarningLimit: 2500,
  },
})
