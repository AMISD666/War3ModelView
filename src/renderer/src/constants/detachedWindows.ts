export const DETACHED_TEXTURE_EDITOR_LABEL = 'texture_editor_window'

export const DETACHED_TEXTURE_EDITOR_QUERY = 'texture-editor'

export const DETACHED_TEXTURE_EDITOR_EVENTS = {
    requestSnapshot: 'detached:texture-editor:request-snapshot',
    snapshot: 'detached:texture-editor:snapshot',
    delta: 'detached:texture-editor:delta',
    apply: 'detached:texture-editor:apply'
} as const

export interface DetachedTextureEditorSnapshot {
    textures: any[]
    modelPath?: string
    revision: number
}

export interface DetachedTextureDeltaOp {
    type: 'add' | 'remove' | 'update'
    index: number
    texture?: any
}

export interface DetachedTextureEditorDeltaPayload {
    ops: DetachedTextureDeltaOp[]
    modelPath?: string
    revision: number
}

export interface DetachedTextureEditorApplyPayload {
    textures: any[]
}
