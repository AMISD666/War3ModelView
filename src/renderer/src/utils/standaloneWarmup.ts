import { windowManager } from './WindowManager'
import { getToolWindowSize, type ToolWindowId } from '../constants/windowLayouts'

type WarmWindowSpec = {
    id: ToolWindowId | 'keyframeEditor_0' | 'keyframeEditor_1' | 'nodeEditor'
    title: string
}

// Preload common detached windows in batches after the main model is ready.
const WARMUP_WINDOWS: WarmWindowSpec[] = [
    { id: 'materialManager', title: '材质管理器' },
    { id: 'textureManager', title: '贴图管理器' },
    { id: 'geosetEditor', title: '多边形管理器' },
    { id: 'sequenceManager', title: '动画管理器' },
    { id: 'cameraManager', title: '相机管理器' },
    { id: 'textureAnimManager', title: '贴图动画管理器' },
    { id: 'geosetAnimManager', title: '多边形动画管理器' },
    { id: 'geosetVisibilityTool', title: '多边形动作显隐工具' },
    { id: 'globalSequenceManager', title: '全局动作管理器' },
    { id: 'keyframeEditor_0', title: '关键帧编辑器' },
    { id: 'keyframeEditor_1', title: '关键帧编辑器' },
    { id: 'modelMerge', title: '模型合并' },
    { id: 'globalColorAdjust', title: '全局颜色调整' },
    { id: 'nodeEditor', title: '节点编辑器' },
    { id: 'dissolveEffect', title: '消散动画工具' },
]

const getWarmWindowSize = (id: WarmWindowSpec['id']) => {
    if (id === 'keyframeEditor_0' || id === 'keyframeEditor_1') {
        return { width: 600, height: 480 }
    }

    if (id === 'nodeEditor') {
        return { width: 640, height: 520 }
    }

    return getToolWindowSize(id)
}

const INITIAL_DELAY_MS = 900
const BATCH_SIZE = 3
const BETWEEN_BATCHES_MS = 450

export const prefetchStandaloneLazyChunks = (): void => {
    void Promise.allSettled([
        import('../components/modals/ModelOptimizeModal'),
        import('../components/modals/ModelMergeModal'),
        import('../components/modals/GlobalColorAdjustModal'),
        import('../components/modals/CameraManagerModal'),
        import('../components/modals/GeosetEditorModal'),
        import('../components/modals/GeosetVisibilityToolModal'),
        import('../components/modals/GeosetAnimationModal'),
        import('../components/modals/TextureEditorModal'),
        import('../components/modals/TextureAnimationManagerModal'),
        import('../components/modals/MaterialEditorModal'),
        import('../components/modals/GlobalSequenceModal'),
        import('../components/editors/KeyframeEditor'),
        import('../components/detached/NodeEditorStandalone'),
        import('../components/modals/DissolveEffectModal'),
    ])
}

export const scheduleStandaloneWarmup = (): (() => void) => {
    prefetchStandaloneLazyChunks()

    let cancelled = false
    let activeTimeoutId: number | null = null

    const clearScheduledTimeout = () => {
        if (activeTimeoutId !== null) {
            window.clearTimeout(activeTimeoutId)
            activeTimeoutId = null
        }
    }

    const runBatch = async (startIndex: number) => {
        if (cancelled || startIndex >= WARMUP_WINDOWS.length) return

        const end = Math.min(startIndex + BATCH_SIZE, WARMUP_WINDOWS.length)
        const batch = WARMUP_WINDOWS.slice(startIndex, end)

        await Promise.allSettled(
            batch.map((spec) => {
                const size = getWarmWindowSize(spec.id)
                return windowManager.preloadToolWindow(spec.id, spec.title, size.width, size.height)
            })
        )

        if (cancelled || end >= WARMUP_WINDOWS.length) return

        activeTimeoutId = window.setTimeout(() => {
            activeTimeoutId = null
            void runBatch(end)
        }, BETWEEN_BATCHES_MS)
    }

    activeTimeoutId = window.setTimeout(() => {
        activeTimeoutId = null
        void runBatch(0)
    }, INITIAL_DELAY_MS)

    return () => {
        cancelled = true
        clearScheduledTimeout()
    }
}
