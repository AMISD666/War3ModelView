import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: []
  },
  preload: {
    plugins: []
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // Vendored copy so we can evolve the renderer (WebGPU integration) without depending on an external sibling folder.
        'war3-model': resolve('vendor/war3-model/index.ts')
      }
    },
    plugins: [react()]
  }
})
