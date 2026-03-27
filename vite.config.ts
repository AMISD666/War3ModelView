import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Vite config for renderer process (used by Tauri)
export default defineConfig({
    plugins: [react()],
    // Same configuration as electron.vite.config.ts renderer section
    resolve: {
        alias: {
            '@renderer': resolve(__dirname, 'src/renderer/src'),
            // Vendored copy so we can evolve the renderer (WebGPU integration) without depending on an external sibling folder.
            'war3-model': resolve(__dirname, 'vendor/war3-model/index.ts')
        }
    },

    // Development server
    server: {
        port: 5173,
        strictPort: true
    },

    // Build output
    build: {
        outDir: resolve(__dirname, 'out/renderer'),
        emptyOutDir: true
    },

    // Root directory for renderer code
    root: 'src/renderer'
})
