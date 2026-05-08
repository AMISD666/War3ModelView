export type MaterialManagerStalePolicy = 'warn' | 'reject'

export type MaterialManagerAction =
    | 'SAVE_MATERIALS'
    | 'COMMIT_MATERIALS'
    | 'PATCH_SELECTED_MATERIAL_PREVIEW'
    | 'PATCH_SELECTED_LAYER_PREVIEW'
    | 'ADD_LAYER_PREVIEW'
    | 'DELETE_LAYER_PREVIEW'
    | 'MOVE_LAYER_PREVIEW'
    | 'ADD_MATERIAL_PREVIEW'
    | 'DELETE_MATERIAL_PREVIEW'
    | 'CLEAR_MATERIAL_PREVIEW'
    | 'RELOAD_RENDERER'
    | 'SET_SELECTION'

export type MaterialManagerCollectionsPayload = {
    materials?: unknown[]
    textures?: unknown[]
    geosets?: unknown[]
    ribbonEmitters?: unknown[]
    materialDelete?: {
        deletedIndex: number
        nextMaterialCount: number
    }
}

export type MaterialManagerSelectionPayload = {
    selectedMaterialIndex: number | null
    selectedMaterialLayerIndex: number | null
}

export type MaterialManagerLayerPatchPayload = {
    materialIndex: number
    layerIndex: number
    updates: Record<string, unknown>
}

export type MaterialManagerMaterialPatchPayload = {
    materialIndex: number
    updates: Record<string, unknown>
}

export type MaterialManagerAddLayerPayload = {
    materialIndex: number
    layer: Record<string, unknown>
}

export type MaterialManagerDeleteLayerPayload = {
    materialIndex: number
    layerIndex: number
}

export type MaterialManagerMoveLayerPayload = {
    materialIndex: number
    fromIndex: number
    toIndex: number
}

export type MaterialManagerAddMaterialPayload = {
    material: Record<string, unknown>
}

export type MaterialManagerDeleteMaterialPayload = {
    materialIndex: number
}

export type MaterialManagerActionMessage =
    | {
        action: 'SAVE_MATERIALS' | 'COMMIT_MATERIALS'
        payload: MaterialManagerCollectionsPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'PATCH_SELECTED_MATERIAL_PREVIEW'
        payload: MaterialManagerMaterialPatchPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'PATCH_SELECTED_LAYER_PREVIEW'
        payload: MaterialManagerLayerPatchPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'ADD_LAYER_PREVIEW'
        payload: MaterialManagerAddLayerPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'DELETE_LAYER_PREVIEW'
        payload: MaterialManagerDeleteLayerPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'MOVE_LAYER_PREVIEW'
        payload: MaterialManagerMoveLayerPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'ADD_MATERIAL_PREVIEW'
        payload: MaterialManagerAddMaterialPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'DELETE_MATERIAL_PREVIEW'
        payload: MaterialManagerDeleteMaterialPayload
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'CLEAR_MATERIAL_PREVIEW' | 'RELOAD_RENDERER'
        payload?: undefined
        stalePolicy?: MaterialManagerStalePolicy
    }
    | {
        action: 'SET_SELECTION'
        payload: MaterialManagerSelectionPayload
        stalePolicy?: MaterialManagerStalePolicy
    }

export type MaterialManagerCommandPayload =
    | {
        type: 'material-manager-command'
        action: 'SAVE_MATERIALS' | 'COMMIT_MATERIALS'
        payload: MaterialManagerCollectionsPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'PATCH_SELECTED_MATERIAL_PREVIEW'
        payload: MaterialManagerMaterialPatchPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'PATCH_SELECTED_LAYER_PREVIEW'
        payload: MaterialManagerLayerPatchPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'ADD_LAYER_PREVIEW'
        payload: MaterialManagerAddLayerPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'DELETE_LAYER_PREVIEW'
        payload: MaterialManagerDeleteLayerPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'MOVE_LAYER_PREVIEW'
        payload: MaterialManagerMoveLayerPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'ADD_MATERIAL_PREVIEW'
        payload: MaterialManagerAddMaterialPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'DELETE_MATERIAL_PREVIEW'
        payload: MaterialManagerDeleteMaterialPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'CLEAR_MATERIAL_PREVIEW' | 'RELOAD_RENDERER'
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }
    | {
        type: 'material-manager-command'
        action: 'SET_SELECTION'
        payload: MaterialManagerSelectionPayload
        documentId: string | null
        baseDocumentRevision?: number
        stalePolicy: MaterialManagerStalePolicy
    }

export type CreateMaterialManagerCommandPayloadInput = MaterialManagerActionMessage & {
    documentId: string | null
    documentRevision: number
}

export type ParseMaterialManagerCommandPayloadResult =
    | { ok: true; payload: MaterialManagerCommandPayload }
    | { ok: false; reason: string }

export { createMaterialManagerCommandPayload } from './MaterialManagerCommandCreator'
export { parseMaterialManagerCommandPayload } from './MaterialManagerCommandParser'
