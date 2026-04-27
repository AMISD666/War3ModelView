import { buildMaterialLayerTopologySignature } from '../../utils/materialTextureRelations'
import { previewProjectionService } from '../preview'
import {
    createSyncResult,
    markRendererMaterialTopologyChanged,
    markRendererSyncApplied,
    markRendererSyncFailed,
    markRendererSyncStarted,
} from './RendererSyncDiagnostics'
import type {
    DocumentMaterialRendererSyncInput,
    MaterialProjectionRendererSyncInput,
    RendererSyncError,
    RendererSyncResult,
} from './RendererSyncTypes'

const getLayerCounts = (materials: unknown[] | undefined): number[] =>
    (Array.isArray(materials) ? materials : []).map((material) => {
        const layers = (material as { Layers?: unknown[] } | null | undefined)?.Layers
        return Array.isArray(layers) ? layers.length : 0
    })

const validateMaterialLayerCacheShape = (
    materials: unknown[] | undefined,
    cache: unknown[][] | undefined,
): boolean => {
    if (!Array.isArray(materials) || materials.length === 0) {
        return !Array.isArray(cache) || cache.length === 0
    }
    if (!Array.isArray(cache) || cache.length !== materials.length) return false
    return materials.every((material, materialIndex) => {
        const layers = (material as { Layers?: unknown[] } | null | undefined)?.Layers
        const layerCount = Array.isArray(layers) ? layers.length : 0
        return Array.isArray(cache[materialIndex]) && cache[materialIndex].length === layerCount
    })
}

export const syncMaterialProjection = (
    input: MaterialProjectionRendererSyncInput,
): RendererSyncResult => {
    const projected = previewProjectionService.getMaterialPreviewProjection(
        input.document,
        input.materialManagerPreview,
    )

    markRendererSyncStarted('materialsOnly', projected.projection, input)

    if (!input.renderer?.model || !input.renderer.modelInstance) {
        const result = createSyncResult(input, projected.projection, 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    if (!projected.modelData) {
        const result = createSyncResult(input, projected.projection, 'none', false)
        markRendererSyncApplied(result)
        return result
    }

    try {
        const rendererModel = input.renderer.model as Record<string, unknown>
        const previousMaterials = rendererModel.Materials as unknown[] | undefined
        const previousLayerCounts = getLayerCounts(previousMaterials)
        const previousTopologySignature = buildMaterialLayerTopologySignature(previousMaterials)
        rendererModel.Textures = projected.modelData.Textures

        const textureCount = Array.isArray(rendererModel.Textures) ? rendererModel.Textures.length : 0
        const nextMaterials = input.prepareMaterialsForRenderer(
            projected.modelData.Materials,
            textureCount,
        )
        const nextTopologySignature = buildMaterialLayerTopologySignature(nextMaterials)
        const materialTopologyChanged = previousTopologySignature !== nextTopologySignature

        rendererModel.Materials = nextMaterials
        rendererModel.Geosets = projected.modelData.Geosets
        rendererModel.TextureAnims = projected.modelData.TextureAnims

        if (typeof input.renderer.modelInstance.syncMaterials === 'function') {
            input.renderer.modelInstance.syncMaterials()
        }

        input.renderer.modelInstance.ribbonsController?.syncEmitters?.()
        if (materialTopologyChanged) {
            input.renderer.modelInstance.ribbonsController?.resetEmitters?.()
            markRendererMaterialTopologyChanged(input, {
                projection: projected.projection,
                previousLayerCounts,
                nextLayerCounts: getLayerCounts(nextMaterials),
            })
        }

        const materialCacheShapeOk = validateMaterialLayerCacheShape(
            nextMaterials,
            input.renderer.rendererData?.materialLayerTextureID,
        )
        if (!materialCacheShapeOk) {
            const syncError: RendererSyncError = {
                code: 'material_layer_cache_mismatch',
                message: 'Renderer material layer cache shape does not match Materials[].Layers after syncMaterials().',
            }
            const result = createSyncResult(input, projected.projection, 'fullReload', false, [syncError])
            markRendererSyncFailed(result, syncError.code)
            return result
        }

        const result = createSyncResult(input, projected.projection, 'materialsOnly', true)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'material_projection_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown renderer sync error',
        }
        const result = createSyncResult(input, projected.projection, 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}

export const syncDocumentMaterials = (
    input: DocumentMaterialRendererSyncInput,
): RendererSyncResult => syncMaterialProjection({
    renderer: input.renderer,
    document: input.document,
    materialManagerPreview: null,
    documentRevision: input.documentRevision,
    previewRevision: input.previewRevision,
    prepareMaterialsForRenderer: input.prepareMaterialsForRenderer,
})
