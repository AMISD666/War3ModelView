import { registerShortcutHandler } from '../../shortcuts/manager'
import type { ToolWindowId } from '../../constants/windowLayouts'

export type EditorShortcutId =
    | 'editor.nodeManager'
    | 'editor.cameraManager'
    | 'editor.geosetManager'
    | 'editor.geosetAnimManager'
    | 'editor.textureManager'
    | 'editor.textureAnimManager'
    | 'editor.materialManager'
    | 'editor.sequenceManager'
    | 'editor.globalSequenceManager'

export type EditorToggleId =
    | 'nodeManager'
    | 'modelInfo'
    | 'geosetVisibility'
    | 'geosetVisibilityTool'
    | 'texture'
    | 'textureAnim'
    | 'sequence'
    | 'camera'
    | 'material'
    | 'geoset'
    | 'geosetAnim'
    | 'globalSequence'
    | 'globalColorAdjust'
    | 'modelOptimize'
    | 'modelMerge'
    | 'dissolveEffect'
    | string

export interface ToolWindowController {
    openConfiguredToolWindow(windowId: ToolWindowId, title: string): Promise<void>
    openConfiguredMaterialManager(): Promise<void>
}

export interface ToolWindowOrchestratorDependencies {
    windowManager: ToolWindowController
    toggleNodeManager(): void
    toggleModelInfo(): void
    toggleGeosetVisibility(): void
    toggleInlineEditor(editor: string): void
    reportOpenError(title: string, error: unknown): void
}

const WINDOW_TOGGLE_CONFIG: Record<string, { windowId: ToolWindowId; title: string; errorTitle?: string }> = {
    camera: { windowId: 'cameraManager', title: '相机管理器' },
    geoset: { windowId: 'geosetEditor', title: '多边形管理器' },
    geosetAnim: { windowId: 'geosetAnimManager', title: '多边形动画管理器' },
    geosetVisibilityTool: { windowId: 'geosetVisibilityTool', title: '多边形动作显隐工具', errorTitle: '多边形显隐工具' },
    texture: { windowId: 'textureManager', title: '贴图管理器' },
    textureAnim: { windowId: 'textureAnimManager', title: '贴图动画管理器' },
    sequence: { windowId: 'sequenceManager', title: '动画管理器' },
    globalSequence: { windowId: 'globalSequenceManager', title: '全局动作管理器' },
    globalColorAdjust: { windowId: 'globalColorAdjust', title: '全局颜色调整' },
    modelOptimize: { windowId: 'modelOptimize', title: '模型优化' },
    modelMerge: { windowId: 'modelMerge', title: '模型合并' },
    dissolveEffect: { windowId: 'dissolveEffect', title: '消散动画工具' },
}

const SHORTCUT_EDITOR_MAP: Record<EditorShortcutId, EditorToggleId> = {
    'editor.nodeManager': 'nodeManager',
    'editor.cameraManager': 'camera',
    'editor.geosetManager': 'geoset',
    'editor.geosetAnimManager': 'geosetVisibilityTool',
    'editor.textureManager': 'texture',
    'editor.textureAnimManager': 'textureAnim',
    'editor.materialManager': 'material',
    'editor.sequenceManager': 'sequence',
    'editor.globalSequenceManager': 'globalSequence',
}

export class ToolWindowOrchestrator {
    openEditor(editor: EditorToggleId, dependencies: ToolWindowOrchestratorDependencies): void {
        if (editor === 'nodeManager') {
            dependencies.toggleNodeManager()
            return
        }

        if (editor === 'modelInfo') {
            dependencies.toggleModelInfo()
            return
        }

        if (editor === 'geosetVisibility') {
            dependencies.toggleGeosetVisibility()
            return
        }

        if (editor === 'material') {
            void dependencies.windowManager.openConfiguredMaterialManager().catch((error) => {
                dependencies.reportOpenError('材质管理器', error)
            })
            return
        }

        const windowConfig = WINDOW_TOGGLE_CONFIG[editor]
        if (windowConfig) {
            void dependencies.windowManager.openConfiguredToolWindow(windowConfig.windowId, windowConfig.title).catch((error) => {
                dependencies.reportOpenError(windowConfig.errorTitle ?? windowConfig.title, error)
            })
            return
        }

        dependencies.toggleInlineEditor(editor)
    }

    registerEditorShortcuts(dependencies: ToolWindowOrchestratorDependencies): Array<() => void> {
        return Object.entries(SHORTCUT_EDITOR_MAP).map(([shortcutId, editor]) =>
            registerShortcutHandler(shortcutId, () => {
                this.openEditor(editor, dependencies)
                return true
            }),
        )
    }

    scheduleStandaloneWarmup(hasModelData: boolean, startedRef: { current: boolean }): (() => void) | undefined {
        if (!hasModelData || startedRef.current) {
            return undefined
        }

        startedRef.current = true

        let disposed = false
        let cleanup: (() => void) | undefined

        void import('../../utils/standaloneWarmup').then(({ scheduleStandaloneWarmup }) => {
            if (disposed) {
                return
            }
            cleanup = scheduleStandaloneWarmup()
        })

        return () => {
            disposed = true
            cleanup?.()
        }
    }
}

export const toolWindowOrchestrator = new ToolWindowOrchestrator()
