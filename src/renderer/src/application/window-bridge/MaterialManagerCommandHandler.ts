import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { remapRibbonEmittersAfterMaterialRemoval } from '../../utils/materialTextureRelations'
import { textureMaterialCommandHandler } from '../commands'
import { previewOverlayService } from '../preview'
import { parseMaterialManagerCommandPayload } from './MaterialManagerCommandPayload'
import {
    addMaterialLayerPreview,
    addMaterialPreview,
    deleteMaterialLayerPreview,
    deleteMaterialPreview,
    moveMaterialLayerPreview,
    patchMaterialLayerPreview,
    patchMaterialPreview,
} from './MaterialManagerPreviewCommands'
import { checkCommandRevision, markCommandReceived, rejectToolWindowCommand, type RevisionedToolCommand } from './ToolWindowCommandShared'
import { mergeGeosetMetadata } from './ToolWindowSnapshots'

const SOURCE = 'MaterialManagerCommandHandler'

const REVISION_TOLERANT_ACTIONS = new Set([
    'SAVE_MATERIALS',
    'PATCH_SELECTED_MATERIAL_PREVIEW',
    'PATCH_SELECTED_LAYER_PREVIEW',
    'ADD_LAYER_PREVIEW',
    'DELETE_LAYER_PREVIEW',
    'MOVE_LAYER_PREVIEW',
    'ADD_MATERIAL_PREVIEW',
    'DELETE_MATERIAL_PREVIEW',
    'CLEAR_MATERIAL_PREVIEW',
    'RELOAD_RENDERER',
    'SET_SELECTION',
])

const getRevisionCheckPayload = (
    payload: RevisionedToolCommand | undefined,
    action: string | undefined,
): RevisionedToolCommand | undefined => {
    if (!payload || !action || !REVISION_TOLERANT_ACTIONS.has(action)) {
        return payload
    }

    // Preview/selection commands are intentionally document-revision tolerant:
    // they update the preview overlay, not document truth. Keep documentId
    // protection active while avoiding noisy stale-revision warnings.
    return {
        ...payload,
        baseDocumentRevision: useModelStore.getState().documentRevision,
    }
}

const mergeMaterialPreviewPayload = (
    payload: { geosets?: unknown[]; materialDelete?: { deletedIndex: number; nextMaterialCount: number }; ribbonEmitters?: unknown[] },
) => {
    const state = useModelStore.getState()
    const mergedGeosets = mergeGeosetMetadata(state.modelData?.Geosets, payload.geosets)
    const ribbonEmitters = payload.ribbonEmitters
        ?? (payload.materialDelete
            ? remapRibbonEmittersAfterMaterialRemoval(
                state.modelData?.RibbonEmitters,
                payload.materialDelete.deletedIndex,
                payload.materialDelete.nextMaterialCount,
            )
            : undefined)
    return { mergedGeosets, ribbonEmitters }
}

export class MaterialManagerCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_MATERIAL_ACTION') {
            return
        }

        const materialPayload = parseMaterialManagerCommandPayload(payload)
        const actionPayload = materialPayload.ok ? materialPayload.payload : payload as RevisionedToolCommand | undefined
        markCommandReceived(SOURCE, command, actionPayload)
        if (!checkCommandRevision(SOURCE, getRevisionCheckPayload(actionPayload, actionPayload?.action))) {
            previewOverlayService.clearMaterialManagerPreview()
            return
        }
        if (!materialPayload.ok) {
            rejectToolWindowCommand(SOURCE, actionPayload, 'invalid_payload')
            console.warn(`[${SOURCE}] Rejected invalid payload`, { reason: materialPayload.reason })
            return
        }

        const { action } = materialPayload.payload
        if (action === 'SAVE_MATERIALS') {
            const { mergedGeosets, ribbonEmitters } = mergeMaterialPreviewPayload(materialPayload.payload.payload)
            textureMaterialCommandHandler.setMaterialManagerPreview({
                preview: {
                    textures: materialPayload.payload.payload?.textures ?? [],
                    materials: materialPayload.payload.payload?.materials ?? [],
                    geosets: mergedGeosets,
                    ribbonEmitters,
                },
            })
            return
        }
        if (action === 'COMMIT_MATERIALS') {
            const { mergedGeosets, ribbonEmitters } = mergeMaterialPreviewPayload(materialPayload.payload.payload)
            textureMaterialCommandHandler.commitMaterialManagerPreview({
                textures: materialPayload.payload.payload?.textures ?? [],
                materials: materialPayload.payload.payload?.materials ?? [],
                geosets: mergedGeosets,
                ribbonEmitters,
            })
            return
        }
        if (action === 'PATCH_SELECTED_MATERIAL_PREVIEW') {
            const { materialIndex, updates } = materialPayload.payload.payload
            if (!patchMaterialPreview(materialIndex, updates)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_material_patch_target')
            }
            return
        }
        if (action === 'PATCH_SELECTED_LAYER_PREVIEW') {
            const { materialIndex, layerIndex, updates } = materialPayload.payload.payload
            if (!patchMaterialLayerPreview(materialIndex, layerIndex, updates)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_layer_patch_target')
            }
            return
        }
        if (action === 'ADD_LAYER_PREVIEW') {
            const { materialIndex, layer } = materialPayload.payload.payload
            if (!addMaterialLayerPreview(materialIndex, layer)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_add_layer_target')
            }
            return
        }
        if (action === 'DELETE_LAYER_PREVIEW') {
            const { materialIndex, layerIndex } = materialPayload.payload.payload
            if (!deleteMaterialLayerPreview(materialIndex, layerIndex)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_delete_layer_target')
            }
            return
        }
        if (action === 'MOVE_LAYER_PREVIEW') {
            const { materialIndex, fromIndex, toIndex } = materialPayload.payload.payload
            if (!moveMaterialLayerPreview(materialIndex, fromIndex, toIndex)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_move_layer_target')
            }
            return
        }
        if (action === 'ADD_MATERIAL_PREVIEW') {
            const { material } = materialPayload.payload.payload
            if (!addMaterialPreview(material)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_add_material_payload')
            }
            return
        }
        if (action === 'DELETE_MATERIAL_PREVIEW') {
            const { materialIndex } = materialPayload.payload.payload
            if (!deleteMaterialPreview(materialIndex)) {
                rejectToolWindowCommand(SOURCE, materialPayload.payload, 'invalid_delete_material_target')
            }
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
            useSelectionStore.getState().setSelectedMaterialIndex(
                materialPayload.payload.payload?.selectedMaterialIndex ?? null
            )
            useSelectionStore.getState().setSelectedMaterialLayerIndex(
                materialPayload.payload.payload?.selectedMaterialLayerIndex ?? null
            )
        }
    }
}

export const materialManagerCommandHandler = new MaterialManagerCommandHandler()
