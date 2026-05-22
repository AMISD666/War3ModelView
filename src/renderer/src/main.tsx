import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import './assets/index.css'
import { markStandalonePerf } from './utils/standalonePerf'
import AppErrorBoundary from './components/common/AppErrorBoundary'
import { windowGateway } from './infrastructure/window'
import { initDebugLogging } from './utils/debugLog'
import { flushHtmlStartupBootMarks, markStartupNow } from './application/diagnostics/startupDiagnostics'

const App = React.lazy(() => import('./App'))

markStartupNow('frontend.main.module_enter', {
    userAgent: navigator.userAgent,
    readyState: document.readyState,
})
flushHtmlStartupBootMarks()

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
initDebugLogging()
markStartupNow('frontend.main.after_debug_logging', {
    readyState: document.readyState,
})

markStandalonePerf('main_entry_selected', {
    targetWindow: 'main',
})
markStartupNow('frontend.main.before_create_root')

const RootComponent = (
    <AppErrorBoundary scope="应用入口">
        <React.Suspense fallback={null}>
            <App />
        </React.Suspense>
    </AppErrorBoundary>
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(RootComponent)
markStartupNow('frontend.main.after_create_root_render')

requestAnimationFrame(() => {
    markStartupNow('frontend.main.first_raf_before_show')
    const skeleton = document.getElementById('app-skeleton')
    if (skeleton) skeleton.remove()
    markStartupNow('frontend.main.skeleton_removed', {
        hadSkeleton: Boolean(skeleton),
    })
    windowGateway.showCurrentWindow()
        .then(() => {
            markStartupNow('frontend.main.window_show_done')
            return windowGateway.focusCurrentWindow()
        })
        .then(() => {
            markStartupNow('frontend.main.window_focus_done')
        })
        .catch((error) => {
            markStartupNow('frontend.main.window_show_focus_failed', {
                error: error instanceof Error ? error.message : String(error),
            })
        })
})
