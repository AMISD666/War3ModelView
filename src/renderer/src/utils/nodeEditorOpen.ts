import { windowManager } from './WindowManager'
import type { NodeEditorKind } from '../types/nodeEditorRpc'
import { getNodeEditorWindowLayout } from '../types/nodeEditorRpc'

/** 打开独立 WebView 节点编辑器（先写入会话再显示窗口，主窗口 RPC 据此拼装快照） */
export async function openNodeEditor(kind: NodeEditorKind, objectId: number): Promise<void> {
    const { title, w, h } = getNodeEditorWindowLayout(kind)
    windowManager.setPendingNodeEditorSession(kind, objectId)
    await windowManager.openNodeEditorWindow(title, w, h)
}
