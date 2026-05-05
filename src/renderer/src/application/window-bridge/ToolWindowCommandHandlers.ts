import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { useSelectionStore } from '../../store/selectionStore'
import { remapMaterialsAfterTextureAnimRemoval } from '../../utils/materialTextureRelations'
import { modelDocumentCommandHandler, textureMaterialCommandHandler } from '../commands'
import { markCommandReceived as markCommandReceivedDiagnostic, markCommandRejected, markToolCommandStaleRevision } from '../diagnostics'
import { previewOverlayService } from '../preview'
import { mergeGeosetMetadata } from './ToolWindowSnapshots'

export interface TextureManagerCommandOptions {
    onTexturesSaved?: () => void
}

type RevisionedToolCommand = {
    action?: string
    payload?: unknown
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const markCommandReceived = (
    source: string,
    commandName: string,
    command: RevisionedToolCommand | undefined,
): void => {
    const state = useModelStore.getState()
    markCommandReceivedDiagnostic({
        source,
        commandName,
        action: command?.action ?? '',
        commandDocumentId: command?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: command?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        stalePolicy: command?.stalePolicy ?? '',
    })
}

const checkCommandRevision = (
    source: string,
    command: RevisionedToolCommand | undefined,
): boolean => {
    const baseDocumentRevision = command?.baseDocumentRevision
    if (typeof baseDocumentRevision !== 'number') {
        return true
    }

    const state = useModelStore.getState()
    const commandDocumentId = command?.documentId
    const documentMismatch =
        commandDocumentId !== undefined &&
        commandDocumentId !== null &&
        state.documentId !== null &&
        commandDocumentId !== state.documentId
    const revisionMismatch = baseDocumentRevision !== state.documentRevision

    if (!documentMismatch && !revisionMismatch) {
        return true
    }

    markToolCommandStaleRevision({
        source,
        action: command?.action ?? '',
        commandDocumentId: command?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
        stalePolicy: command?.stalePolicy ?? 'warn',
    })

    if (documentMismatch || command?.stalePolicy === 'reject') {
        markCommandRejected({
            source,
            action: command?.action ?? '',
            commandDocumentId: command?.documentId ?? '',
            activeDocumentId: state.documentId ?? '',
            baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
            reason: documentMismatch ? 'document_mismatch' : 'stale_revision',
        })
        console.warn(`[${source}] Rejected stale command`, {
            action: command?.action,
            commandDocumentId: command?.documentId,
            activeDocumentId: state.documentId,
            baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
        })
        return false
    }

    console.warn(`[${source}] Stale command detected; applying for compatibility`, {
        action: command?.action,
        commandDocumentId: command?.documentId,
        activeDocumentId: state.documentId,
        baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
    })
    return true
}

export class TextureManagerCommandHandler {
    handle(command: string, payload: unknown, options: TextureManagerCommandOptions = {}): void {
        if (command === 'SAVE_TEXTURES') {
            const textures = (payload as { textures?: unknown } | undefined)?.textures
            if (Array.isArray(textures)) {
                textureMaterialCommandHandler.setTextureCollection({ textures })
                options.onTexturesSaved?.()
            }
            return
        }

        if (command !== 'EXECUTE_TEXTURE_ACTION') {
            return
        }

        const actionPayload = payload as RevisionedToolCommand | undefined
        markCommandReceived('TextureManagerCommandHandler', command, actionPayload)
        if (!checkCommandRevision('TextureManagerCommandHandler', actionPayload)) {
            return
        }
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'SAVE_TEXTURES') {
            if (Array.isArray(data)) {
                textureMaterialCommandHandler.setTextureCollection({ textures: data })
            }
            return
        }

        if (action === 'SAVE_TEXTURES_WITH_MATERIALS') {
            const record = asRecord(data)
            const textures = Array.isArray(record?.textures) ? record.textures : []
            const currentTextures = useModelStore.getState().modelData?.Textures
            if (Array.isArray(currentTextures) && textures.length === currentTextures.length - 1) {
                textureMaterialCommandHandler.setTextureCollection({ textures })
                return
            }

            const currentGeosets = useModelStore.getState().modelData?.Geosets
            const mergedGeosets = mergeGeosetMetadata(currentGeosets, record?.geosets as unknown[] | undefined)
            textureMaterialCommandHandler.setTextureMaterialCollections({
                textures,
                materials: Array.isArray(record?.materials) ? record.materials : undefined,
                geosets: mergedGeosets,
                particleEmitters: Array.isArray(record?.particleEmitters) ? record.particleEmitters : undefined,
                particleEmitters2: Array.isArray(record?.particleEmitters2) ? record.particleEmitters2 : undefined,
            })
            return
        }

        if (action === 'SET_TEXTURE_SAVE_MODE') {
            const record = asRecord(data)
            useRendererStore.getState().setTextureSaveMode(record?.mode === 'save_as' ? 'save_as' : 'overwrite')
            return
        }

        if (action === 'SET_TEXTURE_SAVE_SUFFIX') {
            const record = asRecord(data)
            const nextSuffix = typeof record?.suffix === 'string' ? record.suffix : ''
            useRendererStore.getState().setTextureSaveSuffix(nextSuffix)
            return
        }

        if (action === 'RELOAD_RENDERER') {
            useModelStore.getState().triggerRendererReload()
        }
    }
}

export class MaterialManagerCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_MATERIAL_ACTION') {
            return
        }

        const actionPayload = payload as RevisionedToolCommand | undefined
        markCommandReceived('MaterialManagerCommandHandler', command, actionPayload)
        if (!checkCommandRevision('MaterialManagerCommandHandler', actionPayload)) {
            previewOverlayService.clearMaterialManagerPreview()
            return
        }
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'SAVE_MATERIALS') {
            const record = asRecord(data)
            const currentGeosets = useModelStore.getState().modelData?.Geosets
            const mergedGeosets = mergeGeosetMetadata(currentGeosets, record?.geosets as unknown[] | undefined)
            textureMaterialCommandHandler.setMaterialManagerPreview({
                preview: {
                    textures: Array.isArray(record?.textures) ? record.textures : [],
                    materials: Array.isArray(record?.materials) ? record.materials : [],
                    geosets: mergedGeosets,
                    ribbonEmitters: Array.isArray(record?.ribbonEmitters) ? record.ribbonEmitters : undefined,
                },
            })
            return
        }

        if (action === 'COMMIT_MATERIALS') {
            const record = asRecord(data)
            const currentGeosets = useModelStore.getState().modelData?.Geosets
            const mergedGeosets = mergeGeosetMetadata(currentGeosets, record?.geosets as unknown[] | undefined)
            textureMaterialCommandHandler.commitMaterialManagerPreview({
                textures: Array.isArray(record?.textures) ? record.textures : [],
                materials: Array.isArray(record?.materials) ? record.materials : [],
                geosets: mergedGeosets,
                ribbonEmitters: Array.isArray(record?.ribbonEmitters) ? record.ribbonEmitters : undefined,
            })
            return
        }

        if (action === 'CLEAR_MATERIAL_PREVIEW') {
            textureMaterialCommandHandler.clearMaterialManagerPreview()
            return
        }

        if (action === 'RELOAD_RENDERER') {
            useModelStore.getState().triggerRendererReload()
            return
        }

        if (action === 'SET_SELECTION') {
            const record = asRecord(data)
            if (record && Object.prototype.hasOwnProperty.call(record, 'selectedMaterialIndex')) {
                useSelectionStore.getState().setSelectedMaterialIndex(
                    typeof record.selectedMaterialIndex === 'number' ? record.selectedMaterialIndex : null
                )
            }
            if (record && Object.prototype.hasOwnProperty.call(record, 'selectedMaterialLayerIndex')) {
                useSelectionStore.getState().setSelectedMaterialLayerIndex(
                    typeof record.selectedMaterialLayerIndex === 'number' ? record.selectedMaterialLayerIndex : null
                )
            }
        }
    }
}

export class GeosetEditorCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_GEOSET_ACTION') {
            return
        }

        const actionPayload = payload as RevisionedToolCommand | undefined
        markCommandReceived('GeosetEditorCommandHandler', command, actionPayload)
        if (!checkCommandRevision('GeosetEditorCommandHandler', actionPayload)) {
            return
        }
        if (actionPayload?.action !== 'SAVE_ALL') {
            return
        }

        const currentGeosets = useModelStore.getState().modelData?.Geosets
        const mergedGeosets = mergeGeosetMetadata(
            currentGeosets,
            Array.isArray(actionPayload.payload) ? actionPayload.payload : undefined,
        )
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

        const actionPayload = payload as RevisionedToolCommand | undefined
        markCommandReceived('GeosetVisibilityCommandHandler', command, actionPayload)
        if (!checkCommandRevision('GeosetVisibilityCommandHandler', actionPayload)) {
            return
        }
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'SAVE_ANIMS') {
            if (Array.isArray(data)) {
                modelDocumentCommandHandler.replaceGeosetAnimationList({
                    name: 'Update Geoset Visibility',
                    before: structuredClone(useModelStore.getState().modelData?.GeosetAnims || []),
                    after: data,
                })
            }
            return
        }

        if (action === 'SET_SEQUENCE') {
            useModelStore.getState().setSequence(typeof data === 'number' ? data : -1)
            return
        }

        if (action === 'SET_FRAME') {
            if (typeof data === 'number') {
                useModelStore.getState().setFrame(data)
            }
        }
    }
}

export class GeosetAnimationCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_ANIM_ACTION') {
            return
        }

        const actionPayload = payload as RevisionedToolCommand | undefined
        markCommandReceived('GeosetAnimationCommandHandler', command, actionPayload)
        if (!checkCommandRevision('GeosetAnimationCommandHandler', actionPayload)) {
            return
        }
        if (actionPayload?.action === 'UPDATE_GEOSET_ANIMS' && Array.isArray(actionPayload.payload)) {
            modelDocumentCommandHandler.replaceGeosetAnimationList({
                name: 'Update Geoset Animation',
                before: structuredClone(useModelStore.getState().modelData?.GeosetAnims || []),
                after: actionPayload.payload,
            })
        }
    }
}

export class TextureAnimationCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_TEXTURE_ANIM_ACTION') {
            return
        }

        const actionPayload = payload as RevisionedToolCommand | undefined
        markCommandReceived('TextureAnimationCommandHandler', command, actionPayload)
        if (!checkCommandRevision('TextureAnimationCommandHandler', actionPayload)) {
            return
        }
        const action = actionPayload?.action
        if (action !== 'ADD' && action !== 'DELETE' && action !== 'UPDATE' && action !== 'TOGGLE_BLOCK' && action !== 'SAVE_ALL') {
            return
        }

        const data = actionPayload?.payload
        const record = asRecord(data)
        const anims = record && Array.isArray(record.newAnims)
            ? record.newAnims
            : data

        if (Array.isArray(anims)) {
            const currentModelData = useModelStore.getState().modelData
            if (action === 'DELETE' && typeof record?.deleteIndex === 'number') {
                const oldMaterials = structuredClone(currentModelData?.Materials || [])
                const newMaterials = remapMaterialsAfterTextureAnimRemoval(oldMaterials, record.deleteIndex)
                modelDocumentCommandHandler.replaceTextureAnimationListAndMaterials({
                    name: 'Delete Texture Animation',
                    beforeTextureAnims: structuredClone(currentModelData?.TextureAnims || []),
                    afterTextureAnims: anims,
                    beforeMaterials: oldMaterials,
                    afterMaterials: newMaterials,
                })
            } else {
                modelDocumentCommandHandler.replaceTextureAnimationList({
                    name: 'Update Texture Animation',
                    before: structuredClone(currentModelData?.TextureAnims || []),
                    after: anims,
                })
            }
        } else {
            console.error('[ToolWindowCommandHandlers] Received invalid TextureAnims payload:', data)
        }
    }
}

export const textureManagerCommandHandler = new TextureManagerCommandHandler()
export const materialManagerCommandHandler = new MaterialManagerCommandHandler()
export const geosetEditorCommandHandler = new GeosetEditorCommandHandler()
export const geosetVisibilityCommandHandler = new GeosetVisibilityCommandHandler()
export const geosetAnimationCommandHandler = new GeosetAnimationCommandHandler()
export const textureAnimationCommandHandler = new TextureAnimationCommandHandler()
