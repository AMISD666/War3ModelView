import type {
    MaterialManagerCommandPayload,
    MaterialManagerStalePolicy,
    ParseMaterialManagerCommandPayloadResult,
} from './MaterialManagerCommandPayload'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

const revisionFromPayload = (payload: Record<string, unknown>): Pick<MaterialManagerCommandPayload, 'documentId' | 'baseDocumentRevision' | 'stalePolicy'> => ({
    documentId: typeof payload.documentId === 'string' || payload.documentId === null
        ? payload.documentId
        : null,
    baseDocumentRevision: typeof payload.baseDocumentRevision === 'number'
        ? payload.baseDocumentRevision
        : undefined,
    stalePolicy: payload.stalePolicy === 'warn' ? 'warn' : 'reject' as MaterialManagerStalePolicy,
})

const readActionPayload = (payload: Record<string, unknown>) =>
    isRecord(payload.payload) ? payload.payload : null

export const parseMaterialManagerCommandPayload = (payload: unknown): ParseMaterialManagerCommandPayloadResult => {
    if (!isRecord(payload) || typeof payload.action !== 'string') {
        return { ok: false, reason: 'Payload must be an action object' }
    }

    const revision = revisionFromPayload(payload)
    const actionPayload = readActionPayload(payload)

    if (payload.action === 'SAVE_MATERIALS' || payload.action === 'COMMIT_MATERIALS') {
        if (!actionPayload || !Array.isArray(actionPayload.materials) || !Array.isArray(actionPayload.textures)) {
            return { ok: false, reason: `${payload.action} requires materials and textures arrays` }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: payload.action,
                payload: {
                    materials: actionPayload.materials,
                    textures: actionPayload.textures,
                    geosets: Array.isArray(actionPayload.geosets) ? actionPayload.geosets : undefined,
                    ribbonEmitters: Array.isArray(actionPayload.ribbonEmitters) ? actionPayload.ribbonEmitters : undefined,
                    materialDelete:
                        isRecord(actionPayload.materialDelete)
                        && typeof actionPayload.materialDelete.deletedIndex === 'number'
                        && typeof actionPayload.materialDelete.nextMaterialCount === 'number'
                            ? {
                                deletedIndex: actionPayload.materialDelete.deletedIndex,
                                nextMaterialCount: actionPayload.materialDelete.nextMaterialCount,
                            }
                            : undefined,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'PATCH_SELECTED_MATERIAL_PREVIEW') {
        const updates = actionPayload && isRecord(actionPayload.updates) ? actionPayload.updates : null
        if (!actionPayload || typeof actionPayload.materialIndex !== 'number' || !updates) {
            return { ok: false, reason: 'PATCH_SELECTED_MATERIAL_PREVIEW requires materialIndex and updates' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'PATCH_SELECTED_MATERIAL_PREVIEW',
                payload: { materialIndex: actionPayload.materialIndex, updates },
                ...revision,
            },
        }
    }

    if (payload.action === 'PATCH_SELECTED_LAYER_PREVIEW') {
        const updates = actionPayload && isRecord(actionPayload.updates) ? actionPayload.updates : null
        if (
            !actionPayload
            || typeof actionPayload.materialIndex !== 'number'
            || typeof actionPayload.layerIndex !== 'number'
            || !updates
        ) {
            return { ok: false, reason: 'PATCH_SELECTED_LAYER_PREVIEW requires materialIndex, layerIndex, and updates' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'PATCH_SELECTED_LAYER_PREVIEW',
                payload: {
                    materialIndex: actionPayload.materialIndex,
                    layerIndex: actionPayload.layerIndex,
                    updates,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'ADD_LAYER_PREVIEW') {
        const layer = actionPayload && isRecord(actionPayload.layer) ? actionPayload.layer : null
        if (!actionPayload || typeof actionPayload.materialIndex !== 'number' || !layer) {
            return { ok: false, reason: 'ADD_LAYER_PREVIEW requires materialIndex and layer' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'ADD_LAYER_PREVIEW',
                payload: { materialIndex: actionPayload.materialIndex, layer },
                ...revision,
            },
        }
    }

    if (payload.action === 'DELETE_LAYER_PREVIEW') {
        if (!actionPayload || typeof actionPayload.materialIndex !== 'number' || typeof actionPayload.layerIndex !== 'number') {
            return { ok: false, reason: 'DELETE_LAYER_PREVIEW requires materialIndex and layerIndex' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'DELETE_LAYER_PREVIEW',
                payload: { materialIndex: actionPayload.materialIndex, layerIndex: actionPayload.layerIndex },
                ...revision,
            },
        }
    }

    if (payload.action === 'MOVE_LAYER_PREVIEW') {
        if (
            !actionPayload
            || typeof actionPayload.materialIndex !== 'number'
            || typeof actionPayload.fromIndex !== 'number'
            || typeof actionPayload.toIndex !== 'number'
        ) {
            return { ok: false, reason: 'MOVE_LAYER_PREVIEW requires materialIndex, fromIndex, and toIndex' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'MOVE_LAYER_PREVIEW',
                payload: {
                    materialIndex: actionPayload.materialIndex,
                    fromIndex: actionPayload.fromIndex,
                    toIndex: actionPayload.toIndex,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'ADD_MATERIAL_PREVIEW') {
        const material = actionPayload && isRecord(actionPayload.material) ? actionPayload.material : null
        if (!actionPayload || !material) {
            return { ok: false, reason: 'ADD_MATERIAL_PREVIEW requires material' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'ADD_MATERIAL_PREVIEW',
                payload: { material },
                ...revision,
            },
        }
    }

    if (payload.action === 'DELETE_MATERIAL_PREVIEW') {
        if (
            !actionPayload
            || typeof actionPayload.materialIndex !== 'number'
            || !Number.isInteger(actionPayload.materialIndex)
            || actionPayload.materialIndex < 0
        ) {
            return { ok: false, reason: 'DELETE_MATERIAL_PREVIEW requires materialIndex' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'DELETE_MATERIAL_PREVIEW',
                payload: { materialIndex: actionPayload.materialIndex },
                ...revision,
            },
        }
    }

    if (payload.action === 'CLEAR_MATERIAL_PREVIEW' || payload.action === 'RELOAD_RENDERER') {
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: payload.action,
                ...revision,
            },
        }
    }

    if (payload.action === 'SET_SELECTION') {
        if (!actionPayload) {
            return { ok: false, reason: 'SET_SELECTION requires a payload object' }
        }
        return {
            ok: true,
            payload: {
                type: 'material-manager-command',
                action: 'SET_SELECTION',
                payload: {
                    selectedMaterialIndex:
                        typeof actionPayload.selectedMaterialIndex === 'number' ? actionPayload.selectedMaterialIndex : null,
                    selectedMaterialLayerIndex:
                        typeof actionPayload.selectedMaterialLayerIndex === 'number' ? actionPayload.selectedMaterialLayerIndex : null,
                },
                ...revision,
            },
        }
    }

    return { ok: false, reason: 'Unsupported material manager action' }
}
