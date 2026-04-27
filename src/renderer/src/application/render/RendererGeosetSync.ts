import {
    createSyncResult,
    markRendererSyncApplied,
    markRendererSyncFailed,
    markRendererSyncStarted,
} from './RendererSyncDiagnostics'
import type {
    GeosetBuffersRendererSyncInput,
    GeosetMaterialBindingSyncInput,
    RendererSyncError,
    RendererSyncResult,
} from './RendererSyncTypes'

export const syncGeosetMaterialBindings = (
    input: GeosetMaterialBindingSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('geosetMaterialBindings', 'document', input)

    if (!input.renderer?.model || !input.renderer.modelInstance) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    if (!Array.isArray(input.document?.Geosets) || !Array.isArray(input.renderer.model.Geosets)) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncApplied(result)
        return result
    }

    try {
        const modelGeosets = input.document.Geosets as unknown as Array<Record<string, unknown>>
        const rendererGeosets = input.renderer.model.Geosets as unknown as Array<Record<string, unknown>>
        const materialCount = Array.isArray(input.document.Materials) ? input.document.Materials.length : 0
        let changed = false
        const minLen = Math.min(modelGeosets.length, rendererGeosets.length)

        for (let index = 0; index < minLen; index += 1) {
            const geoset = modelGeosets[index]
            const rendererGeoset = rendererGeosets[index]
            if (geoset?.MaterialID === undefined || !rendererGeoset) {
                continue
            }

            const rawMatId = typeof geoset.MaterialID === 'number' ? geoset.MaterialID : Number(geoset.MaterialID)
            const safeMatId = Number.isFinite(rawMatId)
                ? Math.min(Math.max(0, Math.floor(rawMatId)), materialCount > 0 ? materialCount - 1 : 0)
                : 0

            if (rendererGeoset.MaterialID !== safeMatId) {
                rendererGeoset.MaterialID = safeMatId
                changed = true
            }
        }

        if (changed) {
            input.renderer.modelInstance.syncMaterials?.()
        }

        const result = createSyncResult(input, 'document', 'geosetMaterialBindings', changed)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'geoset_material_binding_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown geoset material sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}

export const syncGeosetBuffers = (
    input: GeosetBuffersRendererSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('geosetBuffers', 'document', input)

    if (!input.renderer?.model || !Array.isArray(input.document?.Geosets) || !Array.isArray(input.renderer.model.Geosets)) {
        const result = createSyncResult(input, 'document', 'none', false)
        if (!input.renderer?.model) {
            markRendererSyncFailed(result, 'renderer_unavailable')
        } else {
            markRendererSyncApplied(result)
        }
        return result
    }

    try {
        const modelGeosets = input.document.Geosets as unknown as Array<Record<string, unknown>>
        const rendererGeosets = input.renderer.model.Geosets as unknown as Array<Record<string, unknown>>
        const minLen = Math.min(modelGeosets.length, rendererGeosets.length)
        let changed = false

        for (let index = 0; index < minLen; index += 1) {
            const geoset = modelGeosets[index]
            const rendererGeoset = rendererGeosets[index]
            const rendererGeosetMeta = rendererGeoset as Record<string, unknown>
            let geosetSkinningChanged = false

            if (geoset?.Vertices && rendererGeosetMeta.__sourceVerticesRef !== geoset.Vertices) {
                const vertexData = geoset.Vertices instanceof Float32Array ? geoset.Vertices : new Float32Array(geoset.Vertices as ArrayLike<number>)
                rendererGeoset.Vertices = vertexData
                rendererGeosetMeta.__sourceVerticesRef = geoset.Vertices
                input.renderer.updateGeosetVertices?.(index, vertexData)
                changed = true
            }

            if (Array.isArray(geoset?.Groups) && rendererGeosetMeta.__sourceGroupsRef !== geoset.Groups) {
                rendererGeoset.Groups = geoset.Groups.map((group: unknown) => (Array.isArray(group) ? [...group] : []))
                rendererGeoset.TotalGroupsCount = typeof geoset.TotalGroupsCount === 'number'
                    ? geoset.TotalGroupsCount
                    : (rendererGeoset.Groups as unknown[]).reduce<number>((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0)
                rendererGeosetMeta.__sourceGroupsRef = geoset.Groups
                geosetSkinningChanged = true
                changed = true
            }

            if (geoset?.VertexGroup && rendererGeosetMeta.__sourceVertexGroupRef !== geoset.VertexGroup) {
                const vertexGroupValues = Array.from(geoset.VertexGroup as ArrayLike<number>, (value) => Number(value) || 0)
                const VertexGroupCtor = geoset.VertexGroup instanceof Uint16Array || vertexGroupValues.some((value) => value > 255) ? Uint16Array : Uint8Array
                rendererGeoset.VertexGroup = new VertexGroupCtor(vertexGroupValues)
                rendererGeosetMeta.__sourceVertexGroupRef = geoset.VertexGroup
                geosetSkinningChanged = true
                changed = true
            }

            if (geoset?.SkinWeights && rendererGeosetMeta.__sourceSkinWeightsRef !== geoset.SkinWeights) {
                rendererGeoset.SkinWeights = geoset.SkinWeights instanceof Uint8Array
                    ? geoset.SkinWeights
                    : new Uint8Array(Array.from(geoset.SkinWeights as ArrayLike<number>, (value) => Number(value) || 0))
                rendererGeosetMeta.__sourceSkinWeightsRef = geoset.SkinWeights
                geosetSkinningChanged = true
                changed = true
            }

            if (geosetSkinningChanged) {
                input.renderer.updateGeosetGroups?.(index)
            }

            if (geoset?.SelectionGroup !== undefined && rendererGeoset.SelectionGroup !== geoset.SelectionGroup) {
                rendererGeoset.SelectionGroup = geoset.SelectionGroup
                changed = true
            }

            if (geoset?.MinimumExtent !== undefined && rendererGeoset.MinimumExtent !== geoset.MinimumExtent) {
                rendererGeoset.MinimumExtent = geoset.MinimumExtent
                changed = true
            }

            if (geoset?.MaximumExtent !== undefined && rendererGeoset.MaximumExtent !== geoset.MaximumExtent) {
                rendererGeoset.MaximumExtent = geoset.MaximumExtent
                changed = true
            }

            if (geoset?.Normals && rendererGeosetMeta.__sourceNormalsRef !== geoset.Normals) {
                const normalData = geoset.Normals instanceof Float32Array ? geoset.Normals : new Float32Array(geoset.Normals as ArrayLike<number>)
                rendererGeoset.Normals = normalData
                rendererGeosetMeta.__sourceNormalsRef = geoset.Normals
                input.renderer.updateGeosetNormals?.(index, normalData)
                changed = true
            }

            const uvSource = Array.isArray(geoset?.TVertices) ? geoset.TVertices[0] : undefined
            if (uvSource && rendererGeosetMeta.__sourceTVerticesRef !== uvSource) {
                const float32Data = uvSource instanceof Float32Array ? uvSource : new Float32Array(uvSource as ArrayLike<number>)
                rendererGeosetMeta.__sourceTVerticesRef = uvSource
                input.renderer.updateGeosetTexCoords?.(index, float32Data)
                changed = true
            }
        }

        const result = createSyncResult(input, 'document', 'geosetBuffers', changed)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'geoset_buffer_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown geoset buffer sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}
