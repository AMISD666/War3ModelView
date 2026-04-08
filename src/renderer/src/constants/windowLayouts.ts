import type { NodeEditorKind } from '../types/nodeEditorRpc'

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
    | 'dissolveEffect'

export type WindowSize = {
    width: number
    height: number
}

export const TOOL_WINDOW_SIZES: Record<ToolWindowId, WindowSize> = {
    cameraManager: { width: 680, height: 520 }, // 相机管理器
    geosetEditor: { width: 660, height: 480 }, // 多边形管理器
    geosetVisibilityTool: { width: 980, height: 580 }, // 多边形动作显隐工具
    textureManager: { width: 920, height: 480 }, // 贴图管理器
    textureAnimManager: { width: 800, height: 480 }, // 贴图动画管理器
    materialManager: { width: 760, height: 450 }, // 材质管理器
    sequenceManager: { width: 600, height: 500 }, // 动画管理器
    globalSequenceManager: { width: 300, height: 360 }, // 全局动作管理器
    geosetAnimManager: { width: 800, height: 560 }, // 多边形动画管理器
    modelOptimize: { width: 320, height: 520 }, // 模型优化
    modelMerge: { width: 560, height: 500 }, // 模型合并
    dissolveEffect: { width: 600, height: 620 } // 消散动画工具
}

export const NODE_EDITOR_WINDOW_SIZES: Record<NodeEditorKind, WindowSize> = {
    particleEmitter: { width: 640, height: 520 }, // 粒子发射器
    particleEmitter2: { width: 960, height: 740 }, // 粒子发射器2
    collisionShape: { width: 360, height: 400 }, // 碰撞体
    light: { width: 560, height: 420 }, // 灯光
    eventObject: { width: 520, height: 480 }, // 事件对象
    ribbonEmitter: { width: 560, height: 520 }, // 飘带发射器
    genericNode: { width: 400, height: 450 }, // 通用节点
    rename: { width: 400, height: 200 } // 重命名节点
}

export function getToolWindowSize(windowId: ToolWindowId): WindowSize {
    return TOOL_WINDOW_SIZES[windowId]
}

export function getNodeEditorWindowSize(kind: NodeEditorKind): WindowSize {
    return NODE_EDITOR_WINDOW_SIZES[kind]
}
