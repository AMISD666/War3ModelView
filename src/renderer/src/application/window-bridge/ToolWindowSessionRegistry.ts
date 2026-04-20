import type { NodeEditorKind } from '../../types/nodeEditorRpc'

export interface NodeEditorWindowSession {
    kind: NodeEditorKind
    objectId: number
    sessionNonce: number
}

export class ToolWindowSessionRegistry {
    private pendingNodeEditorSession: NodeEditorWindowSession | null = null
    private nodeEditorSessionNonce = 0
    private readonly keyframeMap = new Map<string, string>()
    private nextPoolIndex = 0

    constructor(private readonly keyframePoolSize: number = 8) {}

    setPendingNodeEditorSession(kind: NodeEditorKind, objectId: number): void {
        this.nodeEditorSessionNonce += 1
        this.pendingNodeEditorSession = {
            kind,
            objectId,
            sessionNonce: this.nodeEditorSessionNonce,
        }
    }

    getPendingNodeEditorSession(): NodeEditorWindowSession | null {
        return this.pendingNodeEditorSession
    }

    getKeyframeWindowId(fieldName: string): string {
        const safeFieldName = fieldName || 'default'
        const key = safeFieldName.toLowerCase().trim()

        const existing = this.keyframeMap.get(key)
        if (existing) {
            return existing
        }

        const windowId = `keyframeEditor_${this.nextPoolIndex}`
        this.keyframeMap.set(key, windowId)
        this.nextPoolIndex = (this.nextPoolIndex + 1) % this.keyframePoolSize
        return windowId
    }
}
