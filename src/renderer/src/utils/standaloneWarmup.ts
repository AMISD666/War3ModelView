import { windowManager } from './WindowManager'

type WarmWindowSpec = {
    id: string
    title: string
    w: number
    h: number
}

/**
 * 预热顺序：常用编辑窗靠前，便于在「只跑完前几批」时也已覆盖高频场景。
 * 独立窗体使用 standalone.html + standalone-main.tsx（与主入口分离，见 vite build.rollupOptions.input）。
 */
const WARMUP_WINDOWS: WarmWindowSpec[] = [
    { id: 'materialManager', title: '材质管理器', w: 740, h: 450 },
    { id: 'textureManager', title: '贴图管理器', w: 920, h: 480 },
    { id: 'geosetEditor', title: '多边形管理器', w: 660, h: 520 },
    { id: 'sequenceManager', title: '动画管理器', w: 600, h: 450 },
    { id: 'cameraManager', title: '相机管理器', w: 700, h: 520 },
    { id: 'textureAnimManager', title: '贴图动画管理器', w: 800, h: 480 },
    { id: 'geosetAnimManager', title: '多边形动画管理器', w: 800, h: 600 },
    { id: 'geosetVisibilityTool', title: '多边形动作显隐工具', w: 980, h: 560 },
    { id: 'globalSequenceManager', title: '全局动作管理器', w: 300, h: 360 },
    { id: 'keyframeEditor_0', title: '关键帧编辑器', w: 600, h: 480 },
    { id: 'keyframeEditor_1', title: '关键帧编辑器', w: 600, h: 480 },
    { id: 'modelOptimize', title: '模型优化', w: 320, h: 520 },
    { id: 'modelMerge', title: '模型合并', w: 560, h: 500 },
    { id: 'nodeEditor', title: '节点编辑器', w: 640, h: 520 },
]

/** 首批预热前等待：给主界面与首屏渲染留时间，避免与模型加载抢线程 */
const INITIAL_DELAY_MS = 900

/** 每批并行创建的独立窗口数量（过大可能瞬时占用内存/进程，可按机器调整） */
const BATCH_SIZE = 3

/** 批次之间的间隔，给事件循环与 WebView 初始化喘息时间 */
const BETWEEN_BATCHES_MS = 450

/**
 * 与 standalone-main.tsx 中 lazy 模块一致，在主窗口先 dynamic import 一遍。
 * 子 WebView 加载同源 URL 时，更易命中 HTTP/磁盘缓存，缩短首包等待（每个 WebView 仍要独立解析 JS）。
 */
export const prefetchStandaloneLazyChunks = (): void => {
    void Promise.allSettled([
        import('../components/modals/ModelOptimizeModal'),
        import('../components/modals/ModelMergeModal'),
        import('../components/modals/CameraManagerModal'),
        import('../components/modals/GeosetEditorModal'),
        import('../components/modals/GeosetVisibilityToolModal'),
        import('../components/modals/GeosetAnimationModal'),
        import('../components/modals/TextureEditorModal'),
        import('../components/modals/TextureAnimationManagerModal'),
        import('../components/modals/MaterialEditorModal'),
        import('../components/modals/SequenceEditorModal'),
        import('../components/modals/GlobalSequenceModal'),
        import('../components/editors/KeyframeEditor'),
        import('../components/detached/NodeEditorStandalone'),
    ])
}

/**
 * 在模型已加载后调度后台预热：分批并行创建隐藏 WebView + 预先拉取 lazy chunk。
 */
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
            batch.map((spec) => windowManager.preloadToolWindow(spec.id, spec.title, spec.w, spec.h))
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
