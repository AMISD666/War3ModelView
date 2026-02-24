import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import App from './App'
import ModelOptimizeModal from './components/modals/ModelOptimizeModal'
import CameraManagerModal from './components/modals/CameraManagerModal'
import GeosetEditorModal from './components/modals/GeosetEditorModal'
import GeosetVisibilityToolModal from './components/modals/GeosetVisibilityToolModal'
import './assets/index.css'
import { parseMDX } from 'war3-model'
import { getCurrentWindow } from '@tauri-apps/api/window'

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

console.log('war3-model loaded:', parseMDX)

installBrowserGuards()

// Simple Router based on Tauri Window URL
const searchParams = new URLSearchParams(window.location.search);
const targetWindow = searchParams.get('window');

let RootComponent = <App />;

if (targetWindow === 'modelOptimize') {
    RootComponent = (
        <React.Suspense fallback={null}>
            <ModelOptimizeModal
                visible={true}
                onClose={() => getCurrentWindow().hide()}
                modelData={null}
                isStandalone={true}
            />
        </React.Suspense>
    );
} else if (targetWindow === 'cameraManager') {
    RootComponent = (
        <React.Suspense fallback={null}>
            <CameraManagerModal
                visible={true}
                onClose={() => getCurrentWindow().hide()}
                isStandalone={true}
            />
        </React.Suspense>
    );
} else if (targetWindow === 'geosetEditor') {
    RootComponent = (
        <React.Suspense fallback={null}>
            <GeosetEditorModal
                visible={true}
                onClose={() => getCurrentWindow().hide()}
                isStandalone={true}
            />
        </React.Suspense>
    );
} else if (targetWindow === 'geosetVisibilityTool') {
    RootComponent = (
        <React.Suspense fallback={null}>
            <GeosetVisibilityToolModal
                visible={true}
                onClose={() => getCurrentWindow().hide()}
                isStandalone={true}
            />
        </React.Suspense>
    );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    RootComponent
)

// Show the window now that React has mounted (window starts hidden via visible:false)
// Also remove the inline skeleton that was visible during JS loading
if (targetWindow) {
    // Standalone windows: just remove skeleton, do NOT `.show()` it here! 
    // It is a preloaded window that should stay hidden until `WindowManager.openToolWindow()` is called.
    const skeleton = document.getElementById('app-skeleton')
    if (skeleton) skeleton.remove()
} else {
    // Main window: slightly delay show to hide heavy 3D engine initialization
    requestAnimationFrame(() => {
        const skeleton = document.getElementById('app-skeleton')
        if (skeleton) skeleton.remove()
        getCurrentWindow().show().catch(() => { })
    })
}

