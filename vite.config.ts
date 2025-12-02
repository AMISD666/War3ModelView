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
            'war3-model': resolve(__dirname, '../war3-model-4.0.0')
        }
    },

    // Development server
    server: {
        port: 5173,
        strictPort: true
    },

    // Build output
    build: {
        outDir: 'out/renderer',
        emptyOutDir: true
    },

    // Root directory for renderer code
    root: 'src/renderer'
})
