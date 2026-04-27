import {
    createSyncResult,
    markRendererTextureAnimationMetadataSynced,
    markRendererSyncApplied,
    markRendererSyncFailed,
    markRendererSyncStarted,
} from './RendererSyncDiagnostics'
import type {
    AnimationMetadataRendererSyncInput,
    RendererSyncError,
    RendererSyncResult,
} from './RendererSyncTypes'

export const syncAnimationMetadata = (
    input: AnimationMetadataRendererSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('animationMetadata', 'document', input)

    if (!input.renderer?.model || !input.renderer.modelInstance || !input.document) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    try {
        const rendererModel = input.renderer.model as Record<string, unknown>
        const documentRecord = input.document as unknown as Record<string, unknown>
        let changed = false

        if (input.document.GeosetAnims !== undefined && rendererModel.GeosetAnims !== input.document.GeosetAnims) {
            rendererModel.GeosetAnims = input.document.GeosetAnims
            input.renderer.modelInstance.syncGeosetAnims?.()
            changed = true
        }

        if (Array.isArray(input.document.Sequences) && input.document.Sequences.length > 0) {
            if (rendererModel.Sequences !== input.document.Sequences) {
                rendererModel.Sequences = input.document.Sequences
                changed = true
            }
        } else if ((!Array.isArray(rendererModel.Sequences) || rendererModel.Sequences.length === 0) && input.ensureSequences) {
            const ensured = input.ensureSequences(input.renderer.model)
            if (ensured !== undefined) {
                rendererModel.Sequences = ensured
                changed = true
            }
        }

        if (input.document.GlobalSequences !== undefined) {
            if (rendererModel.GlobalSequences !== input.document.GlobalSequences) {
                rendererModel.GlobalSequences = input.document.GlobalSequences
                changed = true
            }
            input.renderer.modelInstance.syncGlobalSequences?.()
        }

        if (input.document.TextureAnims !== undefined && rendererModel.TextureAnims !== input.document.TextureAnims) {
            rendererModel.TextureAnims = input.document.TextureAnims
            changed = true
            markRendererTextureAnimationMetadataSynced(input, {
                textureAnimCount: Array.isArray(input.document.TextureAnims) ? input.document.TextureAnims.length : 0,
            })
        }

        if (input.document.PivotPoints !== undefined && rendererModel.PivotPoints !== input.document.PivotPoints) {
            rendererModel.PivotPoints = input.document.PivotPoints
            changed = true
        }

        const minimumExtent = documentRecord.MinimumExtent
        if (minimumExtent !== undefined && rendererModel.MinimumExtent !== minimumExtent) {
            rendererModel.MinimumExtent = minimumExtent
            changed = true
        }

        const maximumExtent = documentRecord.MaximumExtent
        if (maximumExtent !== undefined && rendererModel.MaximumExtent !== maximumExtent) {
            rendererModel.MaximumExtent = maximumExtent
            changed = true
        }

        const extents = documentRecord.Extents
        if (extents !== undefined && rendererModel.Extents !== extents) {
            rendererModel.Extents = extents
            changed = true
        }

        const result = createSyncResult(input, 'document', 'animationMetadata', changed)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'animation_metadata_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown animation metadata sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}
