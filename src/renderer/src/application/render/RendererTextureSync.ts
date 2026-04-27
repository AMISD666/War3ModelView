import {
    createSyncResult,
    markRendererSyncApplied,
    markRendererSyncFailed,
    markRendererSyncStarted,
} from './RendererSyncDiagnostics'
import type {
    RendererSyncError,
    RendererSyncResult,
    TextureStateRendererSyncInput,
} from './RendererSyncTypes'

export const syncTextureState = (
    input: TextureStateRendererSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('textureState', 'document', input)

    if (!input.renderer?.model || !input.document) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    try {
        const rendererModel = input.renderer.model as Record<string, unknown>
        let changed = false

        if (Array.isArray(input.document.Textures)) {
            rendererModel.Textures = input.document.Textures
            input.ensureTextureSamplers?.(input.renderer, input.document.Textures as unknown[])
            input.renderer.syncTextureWrapParametersFromModel?.()
            changed = true
        }

        if (Array.isArray(input.document.TextureAnims) && rendererModel.TextureAnims !== input.document.TextureAnims) {
            rendererModel.TextureAnims = input.document.TextureAnims
            changed = true
        }

        const result = createSyncResult(input, 'document', 'textureState', changed)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'texture_state_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown texture state sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}
