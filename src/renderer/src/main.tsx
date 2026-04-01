import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import './assets/index.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { markStandalonePerf } from './utils/standalonePerf'

const App = React.lazy(() => import('./App'))

const installBrowserGuards = () => {
    window.addEventListener(
        'keydown',
        (e) => {
            const key = e.key
            const ctrlOrMeta = e.ctrlKey || e.metaKey
            const lower = typeof key === 'string' ? key.toLowerCase() : ''

            const shouldBlock =
                key === 'F3' ||
                key === 'F5' ||
                (ctrlOrMeta && (lower === 'r' || lower === 'p' || lower === 'f' || lower === 'g')) ||
                (ctrlOrMeta && key === 'F5') ||
                (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) ||
                key === 'ContextMenu' ||
                (e.shiftKey && key === 'F10')

            if (shouldBlock) {
                e.preventDefault()
            }
        },
        true
    )

    document.addEventListener(
        'contextmenu',
        (e) => {
            e.preventDefault()
        },
        true
    )
}

installBrowserGuards()

markStandalonePerf('main_entry_selected', {
    targetWindow: 'main',
})

const RootComponent = (
    <React.Suspense fallback={null}>
        <App />
    </React.Suspense>
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(RootComponent)

requestAnimationFrame(() => {
    const skeleton = document.getElementById('app-skeleton')
    if (skeleton) skeleton.remove()
    getCurrentWindow().show().catch(() => {})
})
