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
    documentId: string | null
    documentRevision: number
    assetRevision: number
    previewRevision: number
    snapshotRevision: number
    windowId: string
    /** @deprecated Use snapshotRevision after envelope migration completes. */
    snapshotVersion: number
    /** 每次打开节点编辑器都会递增，用于区分同一节点的连续编辑会话。 */
    sessionNonce: number
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

export interface RevisionedNodeEditorCommandMetadata {
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

export const NODE_EDITOR_COMMANDS = {
    applyNodeUpdate: 'APPLY_NODE_UPDATE',
    previewNodeUpdate: 'PREVIEW_NODE_UPDATE',
    clearNodePreview: 'CLEAR_NODE_PREVIEW',
    renameNode: 'RENAME_NODE',
} as const

export type NodeEditorCommand = typeof NODE_EDITOR_COMMANDS[keyof typeof NODE_EDITOR_COMMANDS]

export type NodeEditorCommandPayloadMap = {
    APPLY_NODE_UPDATE: ApplyNodeUpdatePayload & RevisionedNodeEditorCommandMetadata
    PREVIEW_NODE_UPDATE: NodeEditorNodePayload & RevisionedNodeEditorCommandMetadata
    CLEAR_NODE_PREVIEW: ClearNodePreviewPayload & RevisionedNodeEditorCommandMetadata
    RENAME_NODE: RenameNodePayload & RevisionedNodeEditorCommandMetadata
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
