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

export const DETACHED_MANAGER_TYPES = [
    'camera',
    'geoset',
    'geosetAnim',
    'textureAnim',
    'material',
    'sequence',
    'globalSequence'
] as const

export type DetachedManagerType = typeof DETACHED_MANAGER_TYPES[number]

export const DETACHED_MANAGER_EVENTS = {
    requestSnapshot: 'detached:manager:request-snapshot',
    snapshot: 'detached:manager:snapshot',
    apply: 'detached:manager:apply',
    ready: 'detached:manager:ready',
    hydrated: 'detached:manager:hydrated'
} as const

export const getDetachedManagerQuery = (type: DetachedManagerType): string => `manager-${type}`

export const getDetachedManagerLabel = (type: DetachedManagerType): string => `manager_window_${type}`

export interface DetachedManagerRequestSnapshotPayload {
    managerType: DetachedManagerType
    windowLabel?: string
}

export interface DetachedManagerSnapshotPayload {
    managerType: DetachedManagerType
    modelData: any | null
    modelPath?: string
}

export interface DetachedManagerApplyPayload {
    managerType: DetachedManagerType
    modelData: any
    modelPath?: string
}

export interface DetachedManagerLifecyclePayload {
    managerType: DetachedManagerType
    windowLabel: string
}

export const DETACHED_CAMERA_EVENTS = {
    addFromView: 'detached:camera:add-from-view',
    view: 'detached:camera:view'
} as const

export interface DetachedCameraViewPayload {
    camera: any
}
