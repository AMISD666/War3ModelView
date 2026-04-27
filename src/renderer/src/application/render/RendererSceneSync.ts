import {
    createSyncResult,
    markRendererSyncApplied,
    markRendererSyncFailed,
    markRendererSyncStarted,
} from './RendererSyncDiagnostics'
import type {
    RendererSyncError,
    RendererSyncResult,
    SceneMetadataRendererSyncInput,
} from './RendererSyncTypes'

export const syncSceneMetadata = (
    input: SceneMetadataRendererSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('sceneMetadata', 'document', input)

    if (!input.renderer?.model || !input.document) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    try {
        const rendererModel = input.renderer.model as Record<string, unknown>
        const documentRecord = input.document as unknown as Record<string, unknown>
        let changed = false

        const nextEmitters = (input.particleEmitters ?? input.document.ParticleEmitters2 ?? []) as unknown[]
        const currentEmitters = Array.isArray(rendererModel.ParticleEmitters2) ? rendererModel.ParticleEmitters2 as unknown[] : []
        if (currentEmitters.length === nextEmitters.length && input.syncParticleEmittersInPlace) {
            input.syncParticleEmittersInPlace(currentEmitters, nextEmitters)
            if (rendererModel.ParticleEmitters2 !== currentEmitters) {
                rendererModel.ParticleEmitters2 = currentEmitters
            }
            changed = changed || currentEmitters.length > 0
        } else if (rendererModel.ParticleEmitters2 !== nextEmitters) {
            rendererModel.ParticleEmitters2 = nextEmitters
            changed = true
        }

        if (input.document.RibbonEmitters !== undefined && rendererModel.RibbonEmitters !== input.document.RibbonEmitters) {
            rendererModel.RibbonEmitters = input.document.RibbonEmitters
            input.renderer.modelInstance?.ribbonsController?.syncEmitters?.()
            changed = true
        }

        if (input.document.Lights !== undefined && rendererModel.Lights !== input.document.Lights) {
            rendererModel.Lights = input.document.Lights
            changed = true
        }

        if (documentRecord.Bones !== undefined && rendererModel.Bones !== documentRecord.Bones) {
            rendererModel.Bones = documentRecord.Bones
            changed = true
        }

        if (documentRecord.Helpers !== undefined && rendererModel.Helpers !== documentRecord.Helpers) {
            rendererModel.Helpers = documentRecord.Helpers
            changed = true
        }

        if (documentRecord.Attachments !== undefined && rendererModel.Attachments !== documentRecord.Attachments) {
            rendererModel.Attachments = documentRecord.Attachments
            changed = true
        }

        if (documentRecord.EventObjects !== undefined && rendererModel.EventObjects !== documentRecord.EventObjects) {
            rendererModel.EventObjects = documentRecord.EventObjects
            changed = true
        }

        if (documentRecord.CollisionShapes !== undefined && rendererModel.CollisionShapes !== documentRecord.CollisionShapes) {
            rendererModel.CollisionShapes = documentRecord.CollisionShapes
            changed = true
        }

        if (documentRecord.Cameras !== undefined && rendererModel.Cameras !== documentRecord.Cameras) {
            rendererModel.Cameras = documentRecord.Cameras
            changed = true
        }

        const result = createSyncResult(input, 'document', 'sceneMetadata', changed)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'scene_metadata_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown scene metadata sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}
