import type {
    CreateMaterialManagerCommandPayloadInput,
    MaterialManagerAction,
    MaterialManagerCommandPayload,
    MaterialManagerStalePolicy,
} from './MaterialManagerCommandPayload'

const getDefaultStalePolicy = (action: MaterialManagerAction): MaterialManagerStalePolicy =>
    action === 'COMMIT_MATERIALS'
        ? 'reject'
        : action === 'SAVE_MATERIALS'
    || action === 'PATCH_SELECTED_MATERIAL_PREVIEW'
    || action === 'PATCH_SELECTED_LAYER_PREVIEW'
    || action === 'ADD_LAYER_PREVIEW'
    || action === 'DELETE_LAYER_PREVIEW'
    || action === 'MOVE_LAYER_PREVIEW'
    || action === 'ADD_MATERIAL_PREVIEW'
    || action === 'DELETE_MATERIAL_PREVIEW'
        ? 'warn'
        : 'reject'

export const createMaterialManagerCommandPayload = ({
    action,
    payload,
    documentId,
    documentRevision,
    stalePolicy,
}: CreateMaterialManagerCommandPayloadInput): MaterialManagerCommandPayload => {
    const basePayload = {
        type: 'material-manager-command' as const,
        action,
        documentId,
        baseDocumentRevision: documentRevision,
        stalePolicy: stalePolicy ?? getDefaultStalePolicy(action),
    }

    if (action === 'SAVE_MATERIALS' || action === 'COMMIT_MATERIALS') {
        return { ...basePayload, action, payload }
    }
    if (action === 'PATCH_SELECTED_MATERIAL_PREVIEW') {
        return { ...basePayload, action: 'PATCH_SELECTED_MATERIAL_PREVIEW', payload }
    }
    if (action === 'PATCH_SELECTED_LAYER_PREVIEW') {
        return { ...basePayload, action: 'PATCH_SELECTED_LAYER_PREVIEW', payload }
    }
    if (action === 'ADD_LAYER_PREVIEW') {
        return { ...basePayload, action: 'ADD_LAYER_PREVIEW', payload }
    }
    if (action === 'DELETE_LAYER_PREVIEW') {
        return { ...basePayload, action: 'DELETE_LAYER_PREVIEW', payload }
    }
    if (action === 'MOVE_LAYER_PREVIEW') {
        return { ...basePayload, action: 'MOVE_LAYER_PREVIEW', payload }
    }
    if (action === 'ADD_MATERIAL_PREVIEW') {
        return { ...basePayload, action: 'ADD_MATERIAL_PREVIEW', payload }
    }
    if (action === 'DELETE_MATERIAL_PREVIEW') {
        return { ...basePayload, action: 'DELETE_MATERIAL_PREVIEW', payload }
    }
    if (action === 'SET_SELECTION') {
        return { ...basePayload, action: 'SET_SELECTION', payload }
    }

    return { ...basePayload, action }
}
