import { windowManager } from './WindowManager'

type WarmWindowSpec = {
    id: string
    title: string
    w: number
    h: number
}

type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    cancelIdleCallback?: (id: number) => void
}

const WARMUP_WINDOWS: WarmWindowSpec[] = [
    { id: 'materialManager', title: '材质管理器', w: 740, h: 450 },
    { id: 'textureManager', title: '贴图管理器', w: 920, h: 480 },
    { id: 'sequenceManager', title: '动画管理器', w: 600, h: 450 },
    { id: 'cameraManager', title: '相机管理器', w: 700, h: 520 },
    { id: 'keyframeEditor_0', title: '关键帧编辑器', w: 600, h: 480 },
    { id: 'geosetEditor', title: '多边形管理器', w: 640, h: 480 },
    { id: 'textureAnimManager', title: '贴图动画管理器', w: 800, h: 480 },
    { id: 'keyframeEditor_1', title: '关键帧编辑器', w: 600, h: 480 },
    { id: 'geosetAnimManager', title: '多边形动画管理器', w: 800, h: 560 },
    { id: 'geosetVisibilityTool', title: '多边形动作显隐工具', w: 980, h: 560 },
    { id: 'globalSequenceManager', title: '全局动作管理器', w: 300, h: 360 },
    { id: 'modelOptimize', title: '模型优化', w: 320, h: 520 }
]

export const scheduleStandaloneWarmup = (): (() => void) => {
    const idleWindow = window as IdleWindow
    let cancelled = false
    let timeoutId: number | null = null
    let idleId: number | null = null
    let index = 0

    const getDelay = (currentIndex: number) => {
        if (currentIndex === 0) return 2500
        if (currentIndex < 4) return 1200
        return 2200
    }

    const scheduleNext = (delay: number) => {
        if (cancelled || index >= WARMUP_WINDOWS.length) return

        timeoutId = window.setTimeout(() => {
            const run = async () => {
                if (cancelled || index >= WARMUP_WINDOWS.length) return

                const spec = WARMUP_WINDOWS[index]
                index += 1

                try {
                    await windowManager.preloadToolWindow(spec.id, spec.title, spec.w, spec.h)
                } catch (error) {
                    console.warn(`[standaloneWarmup] Failed to warm ${spec.id}:`, error)
                }

                scheduleNext(getDelay(index))
            }

            if (typeof idleWindow.requestIdleCallback === 'function') {
                idleId = idleWindow.requestIdleCallback(() => {
                    void run()
                }, { timeout: 1500 })
                return
            }

            void run()
        }, delay)
    }

    scheduleNext(getDelay(0))

    return () => {
        cancelled = true
        if (timeoutId !== null) {
            window.clearTimeout(timeoutId)
        }
        if (idleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
            idleWindow.cancelIdleCallback(idleId)
        }
    }
}

