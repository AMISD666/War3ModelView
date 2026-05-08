import { useModelStore } from '../../store/modelStore'
import { remapMaterialsAfterTextureAnimRemoval } from '../../utils/materialTextureRelations'
import { modelDocumentCommandHandler } from '../commands'
import { parseUpdateGeosetAnimsPayload } from './GeosetAnimationCommandPayload'
import { parseSaveAllGeosetsCommandPayload } from './GeosetEditorCommandPayload'
import { parseTextureAnimationCommandPayload } from './TextureAnimationCommandPayload'
import { asRecord, checkCommandRevision, markCommandReceived, rejectToolWindowCommand, type RevisionedToolCommand } from './ToolWindowCommandShared'
import { mergeGeosetMetadata } from './ToolWindowSnapshots'

export type GeosetVisibilityActionPayload =
    | {
        action: 'SAVE_ANIMS'
        payload: {
            geosetAnims: unknown[]
        }
        documentId?: string | null
        baseDocumentRevision?: number
        stalePolicy?: 'warn' | 'reject'
    }
    | {
        action: 'SET_SEQUENCE'
        payload: {
            sequenceIndex: number | null
        }
        documentId?: string | null
        baseDocumentRevision?: number
        stalePolicy?: 'warn' | 'reject'
    }
    | {
        action: 'SET_FRAME'
        payload: {
            frame: number
        }
        documentId?: string | null
        baseDocumentRevision?: number
        stalePolicy?: 'warn' | 'reject'
    }

const normalizeRevisionEnvelope = (record: Record<string, unknown>): Pick<RevisionedToolCommand, 'documentId' | 'baseDocumentRevision' | 'stalePolicy'> => ({
    documentId: typeof record.documentId === 'string' || record.documentId === null ? record.documentId : undefined,
    baseDocumentRevision: typeof record.baseDocumentRevision === 'number' ? record.baseDocumentRevision : undefined,
    stalePolicy: record.stalePolicy === 'warn' || record.stalePolicy === 'reject' ? record.stalePolicy : undefined,
})

const normalizeGeosetVisibilityPayload = (payload: unknown): GeosetVisibilityActionPayload | null => {
    const record = asRecord(payload)
    if (!record || typeof record.action !== 'string') {
        return null
    }

    const envelope = normalizeRevisionEnvelope(record)
    const actionPayload = asRecord(record.payload)

    if (record.action === 'SAVE_ANIMS') {
        const geosetAnims = Array.isArray(actionPayload?.geosetAnims) ? actionPayload.geosetAnims : null
        return geosetAnims ? { ...envelope, action: 'SAVE_ANIMS', payload: { geosetAnims } } : null
    }

    if (record.action === 'SET_SEQUENCE') {
        const sequenceIndex = actionPayload?.sequenceIndex
        if (sequenceIndex !== null && typeof sequenceIndex !== 'number') {
            return null
        }
        return { ...envelope, action: 'SET_SEQUENCE', payload: { sequenceIndex } }
    }

    if (record.action === 'SET_FRAME') {
        const frame = actionPayload?.frame
        if (typeof frame !== 'number' || !Number.isFinite(frame)) {
            return null
        }
        return { ...envelope, action: 'SET_FRAME', payload: { frame } }
    }

    return null
}

export class GeosetEditorCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_GEOSET_ACTION') {
            return
        }

        const source = 'GeosetEditorCommandHandler'
        const savePayload = parseSaveAllGeosetsCommandPayload(payload)
        const actionPayload = savePayload.ok ? savePayload.payload : payload as RevisionedToolCommand | undefined
        markCommandReceived(source, command, actionPayload)
        if (!checkCommandRevision(source, actionPayload)) {
            return
        }
        if (!savePayload.ok) {
            console.warn(`[${source}] Rejected invalid payload`, { reason: savePayload.reason })
            return
        }

        const currentGeosets = useModelStore.getState().modelData?.Geosets
        const mergedGeosets = mergeGeosetMetadata(currentGeosets, savePayload.payload.geosets)
        if (mergedGeosets) {
            modelDocumentCommandHandler.replaceGeosetList({
                name: 'Update Geosets',
                before: structuredClone(currentGeosets || []),
                after: mergedGeosets,
            })
        }
    }
}

export class GeosetVisibilityCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_VISIBILITY_ACTION') {
            return
        }

        const source = 'GeosetVisibilityCommandHandler'
        const actionPayload = normalizeGeosetVisibilityPayload(payload)
        markCommandReceived(source, command, actionPayload ?? undefined)
        if (!actionPayload) {
            rejectToolWindowCommand(source, undefined, 'invalid_payload')
            return
        }
        if (!checkCommandRevision(source, actionPayload)) {
            return
        }

        if (actionPayload.action === 'SAVE_ANIMS') {
            modelDocumentCommandHandler.replaceGeosetAnimationList({
                name: 'Update Geoset Visibility',
                before: structuredClone(useModelStore.getState().modelData?.GeosetAnims || []),
                after: actionPayload.payload.geosetAnims,
            })
            return
        }
        if (actionPayload.action === 'SET_SEQUENCE') {
            useModelStore.getState().setSequence(actionPayload.payload.sequenceIndex ?? -1)
            return
        }
        if (actionPayload.action === 'SET_FRAME') {
            useModelStore.getState().setFrame(actionPayload.payload.frame)
        }
    }
}

export class GeosetAnimationCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_ANIM_ACTION') {
            return
        }

        const source = 'GeosetAnimationCommandHandler'
        const updatePayload = parseUpdateGeosetAnimsPayload(payload)
        const actionPayload = updatePayload.ok ? updatePayload.payload : payload as RevisionedToolCommand | undefined
        markCommandReceived(source, command, actionPayload)
        if (!checkCommandRevision(source, actionPayload)) {
            return
        }
        if (!updatePayload.ok) {
            console.warn(`[${source}] Rejected invalid payload`, { reason: updatePayload.reason })
            return
        }

        modelDocumentCommandHandler.replaceGeosetAnimationList({
            name: 'Update Geoset Animation',
            before: structuredClone(useModelStore.getState().modelData?.GeosetAnims || []),
            after: updatePayload.payload.payload.geosetAnims,
        })
    }
}

export class TextureAnimationCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_TEXTURE_ANIM_ACTION') {
            return
        }

        const source = 'TextureAnimationCommandHandler'
        const textureAnimPayload = parseTextureAnimationCommandPayload(payload)
        const actionPayload = textureAnimPayload.ok ? textureAnimPayload.payload : payload as RevisionedToolCommand | undefined
        markCommandReceived(source, command, actionPayload)
        if (!checkCommandRevision(source, actionPayload)) {
            return
        }
        if (!textureAnimPayload.ok) {
            console.error('[ToolWindowCommandHandlers] Received invalid TextureAnims payload:', {
                reason: textureAnimPayload.reason,
            })
            return
        }

        const currentModelData = useModelStore.getState().modelData
        const { action, textureAnims, deleteIndex } = textureAnimPayload.payload
        if (action === 'DELETE') {
            const oldMaterials = structuredClone(currentModelData?.Materials || [])
            const newMaterials = remapMaterialsAfterTextureAnimRemoval(oldMaterials, deleteIndex!)
            modelDocumentCommandHandler.replaceTextureAnimationListAndMaterials({
                name: 'Delete Texture Animation',
                beforeTextureAnims: structuredClone(currentModelData?.TextureAnims || []),
                afterTextureAnims: textureAnims,
                beforeMaterials: oldMaterials,
                afterMaterials: newMaterials,
            })
        } else {
            modelDocumentCommandHandler.replaceTextureAnimationList({
                name: 'Update Texture Animation',
                before: structuredClone(currentModelData?.TextureAnims || []),
                after: textureAnims,
            })
        }
    }
}

export const geosetEditorCommandHandler = new GeosetEditorCommandHandler()
export const geosetVisibilityCommandHandler = new GeosetVisibilityCommandHandler()
export const geosetAnimationCommandHandler = new GeosetAnimationCommandHandler()
export const textureAnimationCommandHandler = new TextureAnimationCommandHandler()
