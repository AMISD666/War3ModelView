/**
 * 独立工具窗口专用入口（对应 /standalone.html?window=…）
 * 与主窗口 index.html → main.tsx → App 分离，便于打包拆块、减轻每窗首屏解析量。
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import './assets/index.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { markStandalonePerf } from './utils/standalonePerf'
import AppErrorBoundary from './components/common/AppErrorBoundary'

const ModelOptimizeModal = React.lazy(() => import('./components/modals/ModelOptimizeModal'))
const ModelMergeModal = React.lazy(() => import('./components/modals/ModelMergeModal'))
const CameraManagerModal = React.lazy(() => import('./components/modals/CameraManagerModal'))
const GeosetEditorModal = React.lazy(() => import('./components/modals/GeosetEditorModal'))
const GeosetVisibilityToolModal = React.lazy(() => import('./components/modals/GeosetVisibilityToolModal'))
const GeosetAnimationModal = React.lazy(() => import('./components/modals/GeosetAnimationModal'))
const TextureEditorModal = React.lazy(() => import('./components/modals/TextureEditorModal'))
const TextureAnimationManagerModal = React.lazy(() => import('./components/modals/TextureAnimationManagerModal'))
const MaterialEditorModal = React.lazy(() => import('./components/modals/MaterialEditorModal'))
const SequenceEditorModal = React.lazy(() => import('./components/modals/SequenceEditorModal'))
const GlobalSequenceModal = React.lazy(() => import('./components/modals/GlobalSequenceModal'))
const KeyframeEditor = React.lazy(() => import('./components/editors/KeyframeEditor'))
const NodeEditorStandalone = React.lazy(() => import('./components/detached/NodeEditorStandalone'))
const DissolveEffectModal = React.lazy(() => import('./components/modals/DissolveEffectModal'))

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

const searchParams = new URLSearchParams(window.location.search)
const targetWindow = searchParams.get('window')

markStandalonePerf('standalone_entry_selected', {
    targetWindow: targetWindow || 'unknown',
})

const renderWithinSuspense = (node: React.ReactNode) => (
    <React.Suspense fallback={null}>
        {node}
    </React.Suspense>
)

let RootComponent: React.ReactElement = renderWithinSuspense(
    <div style={{ color: '#888', padding: 16 }}>缺少 window 参数或未知窗口类型</div>
)

if (targetWindow === 'modelOptimize') {
    RootComponent = renderWithinSuspense(
        <ModelOptimizeModal
            visible={true}
            onClose={() => getCurrentWindow().hide()}
            modelData={null}
            isStandalone={true}
        />
    )
} else if (targetWindow === 'modelMerge') {
    RootComponent = renderWithinSuspense(
        <ModelMergeModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'cameraManager') {
    RootComponent = renderWithinSuspense(
        <CameraManagerModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'geosetEditor') {
    RootComponent = renderWithinSuspense(
        <GeosetEditorModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'geosetVisibilityTool') {
    RootComponent = renderWithinSuspense(
        <GeosetVisibilityToolModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'geosetAnimManager') {
    RootComponent = renderWithinSuspense(
        <GeosetAnimationModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'textureManager') {
    RootComponent = renderWithinSuspense(
        <TextureEditorModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'textureAnimManager') {
    RootComponent = renderWithinSuspense(
        <TextureAnimationManagerModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'materialManager') {
    RootComponent = renderWithinSuspense(
        <MaterialEditorModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'sequenceManager') {
    RootComponent = renderWithinSuspense(
        <SequenceEditorModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'globalSequenceManager') {
    RootComponent = renderWithinSuspense(
        <GlobalSequenceModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow === 'nodeEditor') {
    RootComponent = renderWithinSuspense(
        <NodeEditorStandalone />
    )
} else if (targetWindow === 'dissolveEffect') {
    RootComponent = renderWithinSuspense(
        <DissolveEffectModal visible={true} onClose={() => getCurrentWindow().hide()} isStandalone={true} />
    )
} else if (targetWindow?.startsWith('keyframeEditor')) {
    RootComponent = renderWithinSuspense(
        <KeyframeEditor
            visible={true}
            onCancel={() => getCurrentWindow().hide()}
            onOk={() => {}}
            initialData={null}
            isStandalone={true}
        />
    )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <AppErrorBoundary scope={`独立窗口: ${targetWindow || 'unknown'}`}>
        {RootComponent}
    </AppErrorBoundary>
)
