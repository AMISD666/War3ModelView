import { NodeType } from './node'

/** 独立节点编辑器的窗口类别。 */
export type NodeEditorKind =
    | 'particleEmitter'
    | 'particleEmitter2'
    | 'collisionShape'
    | 'light'
    | 'eventObject'
    | 'ribbonEmitter'
    | 'genericNode'
    | 'rename'

/** 主窗口广播给独立节点编辑器的快照。 */
export interface NodeEditorRpcState {
    snapshotVersion: number
    kind: NodeEditorKind | ''
    objectId: number
    /** 当前编辑节点的深拷贝，仅用于独立窗口初始化。 */
    node: any | null
    textures: any[]
    materials: any[]
    globalSequences: any[]
    sequences: any[]
    modelPath: string
    renameInitialName: string
    allNodes: any[]
    /** 对应 modelData.PivotPoints，避免独立窗口从节点副本上读取到损坏的 PIVT 数据。 */
    pivotPoints: any[]
}

/** APPLY_NODE_UPDATE 可选历史记录，行为与主窗口 HistoryStore 一致。 */
export interface NodeEditorHistoryPayload {
    name: string
    undoNode: any
    redoNode: any
}

export interface NodeEditorNodePayload<TNode = any> {
    objectId: number
    node: TNode
}

export interface ApplyNodeUpdatePayload<TNode = any> extends NodeEditorNodePayload<TNode> {
    history?: NodeEditorHistoryPayload
}

export interface ClearNodePreviewPayload {
    objectId: number | null
}

export interface RenameNodePayload {
    objectId: number
    name: string
}

export const NODE_EDITOR_COMMANDS = {
    applyNodeUpdate: 'APPLY_NODE_UPDATE',
    previewNodeUpdate: 'PREVIEW_NODE_UPDATE',
    clearNodePreview: 'CLEAR_NODE_PREVIEW',
    renameNode: 'RENAME_NODE',
} as const

export type NodeEditorCommand = typeof NODE_EDITOR_COMMANDS[keyof typeof NODE_EDITOR_COMMANDS]

export type NodeEditorCommandPayloadMap = {
    APPLY_NODE_UPDATE: ApplyNodeUpdatePayload
    PREVIEW_NODE_UPDATE: NodeEditorNodePayload
    CLEAR_NODE_PREVIEW: ClearNodePreviewPayload
    RENAME_NODE: RenameNodePayload
}

export type NodeEditorCommandEnvelope<TCommand extends NodeEditorCommand = NodeEditorCommand> = {
    command: TCommand
    payload: NodeEditorCommandPayloadMap[TCommand]
}

export type NodeEditorCommandSender = <TCommand extends NodeEditorCommand>(
    command: TCommand,
    payload: NodeEditorCommandPayloadMap[TCommand]
) => void

/** 根据节点类型映射到独立编辑器类别，无法映射时返回 null。 */
export function nodeTypeToEditorKind(nodeType: NodeType): NodeEditorKind | null {
    switch (nodeType) {
        case NodeType.PARTICLE_EMITTER:
            return 'particleEmitter'
        case NodeType.PARTICLE_EMITTER_2:
            return 'particleEmitter2'
        case NodeType.COLLISION_SHAPE:
            return 'collisionShape'
        case NodeType.LIGHT:
            return 'light'
        case NodeType.EVENT_OBJECT:
            return 'eventObject'
        case NodeType.RIBBON_EMITTER:
            return 'ribbonEmitter'
        default:
            return null
    }
}

/** 独立窗口标题与默认逻辑像素尺寸。 */
export function getNodeEditorWindowLayout(kind: NodeEditorKind): { title: string; w: number; h: number } {
    switch (kind) {
        case 'particleEmitter':
            return { title: '粒子发射器', w: 640, h: 520 }
        case 'particleEmitter2':
            return { title: '粒子发射器 II', w: 960, h: 740 }
        case 'collisionShape':
            return { title: '碰撞形状', w: 360, h: 400 }
        case 'light':
            return { title: '灯光', w: 560, h: 420 }
        case 'eventObject':
            return { title: '事件对象', w: 520, h: 480 }
        case 'ribbonEmitter':
            return { title: '丝带发射器', w: 560, h: 520 }
        case 'genericNode':
            return { title: '编辑节点', w: 400, h: 450 }
        case 'rename':
            return { title: '重命名节点', w: 400, h: 200 }
        default:
            return { title: '节点编辑器', w: 640, h: 520 }
    }
}
