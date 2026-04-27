import type { NodeEditorKind } from '../../types/nodeEditorRpc'

export type ToolWindowId =
    | 'cameraManager'
    | 'geosetEditor'
    | 'geosetVisibilityTool'
    | 'textureManager'
    | 'textureAnimManager'
    | 'materialManager'
    | 'sequenceManager'
    | 'globalSequenceManager'
    | 'geosetAnimManager'
    | 'modelOptimize'
    | 'modelMerge'
    | 'globalColorAdjust'
    | 'dissolveEffect'

export type WindowSize = {
    width: number
    height: number
}

export type NodeEditorWindowLayout = WindowSize & {
    title: string
}

export const TOOL_WINDOW_SIZES: Record<ToolWindowId, WindowSize> = {
    cameraManager: { width: 680, height: 520 },
    geosetEditor: { width: 660, height: 480 },
    geosetVisibilityTool: { width: 980, height: 580 },
    textureManager: { width: 920, height: 480 },
    textureAnimManager: { width: 800, height: 480 },
    materialManager: { width: 760, height: 450 },
    sequenceManager: { width: 600, height: 560 },
    globalSequenceManager: { width: 300, height: 360 },
    geosetAnimManager: { width: 800, height: 560 },
    modelOptimize: { width: 320, height: 520 },
    modelMerge: { width: 560, height: 500 },
    globalColorAdjust: { width: 550, height: 480 },
    dissolveEffect: { width: 600, height: 620 },
}

export const NODE_EDITOR_WINDOW_SIZES: Record<NodeEditorKind, WindowSize> = {
    particleEmitter: { width: 640, height: 520 },
    particleEmitter2: { width: 960, height: 740 },
    collisionShape: { width: 360, height: 400 },
    light: { width: 560, height: 420 },
    eventObject: { width: 520, height: 480 },
    ribbonEmitter: { width: 560, height: 520 },
    genericNode: { width: 400, height: 450 },
    rename: { width: 400, height: 200 },
}

export const NODE_EDITOR_WINDOW_TITLES: Record<NodeEditorKind, string> = {
    particleEmitter: '粒子发射器',
    particleEmitter2: '粒子发射器 II',
    collisionShape: '碰撞形状',
    light: '灯光',
    eventObject: '事件对象',
    ribbonEmitter: '丝带发射器',
    genericNode: '编辑节点',
    rename: '重命名节点',
}

export function getToolWindowSize(windowId: ToolWindowId): WindowSize {
    return TOOL_WINDOW_SIZES[windowId]
}

export function getNodeEditorWindowSize(kind: NodeEditorKind): WindowSize {
    return NODE_EDITOR_WINDOW_SIZES[kind]
}

export function getNodeEditorWindowTitle(kind: NodeEditorKind): string {
    return NODE_EDITOR_WINDOW_TITLES[kind]
}

export function getNodeEditorWindowLayout(kind: NodeEditorKind): NodeEditorWindowLayout {
    return {
        title: getNodeEditorWindowTitle(kind),
        ...getNodeEditorWindowSize(kind),
    }
}
