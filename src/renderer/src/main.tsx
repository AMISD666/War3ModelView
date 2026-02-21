import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import App from './App'
import './assets/index.css'
import { parseMDX } from 'war3-model'

// Tauri webview still has some "browser" accelerators (find/refresh/print, etc.).
// We disable those so function keys (e.g. F3/F5) and app shortcuts aren't hijacked.
const installBrowserGuards = () => {
    window.addEventListener(
        'keydown',
        (e) => {
            const key = e.key
            const ctrlOrMeta = e.ctrlKey || e.metaKey
            const lower = typeof key === 'string' ? key.toLowerCase() : ''

            // Never allow refresh/print/find navigations.
            const shouldBlock =
                key === 'F3' || // browser find-next in some shells
                key === 'F5' || // refresh
                (ctrlOrMeta && (lower === 'r' || lower === 'p' || lower === 'f' || lower === 'g')) || // refresh/print/find/find-next
                (ctrlOrMeta && key === 'F5') || // hard refresh variant
                (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) || // back/forward navigation
                key === 'ContextMenu' || // keyboard context menu key
                (e.shiftKey && key === 'F10') // keyboard context menu shortcut

            if (shouldBlock) {
                // Prevent the webview's default behavior while still letting our own shortcut handlers run.
                e.preventDefault()
            }
        },
        true
    )

    // Disable the default webview context menu (refresh/print/etc). App provides its own context menus.
    document.addEventListener(
        'contextmenu',
        (e) => {
            e.preventDefault()
        },
        true
    )
}

// Suppress specific debug logs in production
const suppressedPrefixes = ['[Particles]', '[initShaders]', '[ModelRenderer]'];
const originalLog = console.log;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
    if (typeof args[0] === 'string' && suppressedPrefixes.some(p => args[0].startsWith(p))) {
        return;
    }
    originalLog(...args);
};

console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && suppressedPrefixes.some(p => args[0].startsWith(p))) {
        return;
    }
    originalWarn(...args);
};

console.log('war3-model loaded:', parseMDX)

installBrowserGuards()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <App />
)
