import { NodeType } from './node'

/** 独立节点编辑子窗与主窗口 RPC 使用的编辑器种类 */
export type NodeEditorKind =
    | 'particleEmitter'
    | 'particleEmitter2'
    | 'collisionShape'
    | 'light'
    | 'eventObject'
    | 'ribbonEmitter'
    | 'genericNode'
    | 'rename'

/** 主窗口广播给子窗的快照 */
export interface NodeEditorRpcState {
    snapshotVersion: number
    kind: NodeEditorKind | ''
    objectId: number
    /** 当前编辑节点的深拷贝，子窗以本地表单为准；仅首包用于初始化 */
    node: any | null
    textures: any[]
    materials: any[]
    globalSequences: any[]
    sequences: any[]
    modelPath: string
    renameInitialName: string
    allNodes: any[]
    /** 与 modelData.PivotPoints 一致（稀疏数组），独立窗优先从此解析 PIVT，避免节点副本上错误的字节/序列化残留 */
    pivotPoints: any[]
}

/** APPLY_NODE_UPDATE 可选历史记录（与主窗口 HistoryStore 行为一致） */
export interface NodeEditorHistoryPayload {
    name: string
    undoNode: any
    redoNode: any
}

/** 根据节点类型映射到独立编辑器种类（无法映射时返回 null） */
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

/** 窗口标题与默认尺寸（逻辑像素） */
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
