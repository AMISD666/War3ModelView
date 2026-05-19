import { useRendererStore } from '../../store/rendererStore'

type RendererWithGeometrySync = {
    model?: {
        Geosets?: unknown[]
    } | null
    update?: (delta: number) => void
    updateGeosetVertices?: (index: number, data: Float32Array) => void
    updateGeosetNormals?: (index: number, data: Float32Array) => void
    updateGeosetTexCoords?: (index: number, data: Float32Array) => void
    updateGeosetGroups?: (index: number) => void
}

type GeosetSyncOptions = {
    vertices?: boolean
    normals?: boolean
    texCoords?: boolean
    groups?: boolean
    updateFrame?: boolean
    bumpRevision?: boolean
}

const toFloat32Array = (value: unknown): Float32Array | null => {
    if (value instanceof Float32Array) return value
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        return new Float32Array(value as ArrayLike<number>)
    }
    return null
}

export const syncRendererGeosetBuffers = (
    renderer: RendererWithGeometrySync | null | undefined,
    geosetIndices: Iterable<number>,
    options: GeosetSyncOptions,
): void => {
    if (!renderer?.model?.Geosets) return

    let changed = false
    for (const geosetIndex of geosetIndices) {
        if (!Number.isInteger(geosetIndex) || geosetIndex < 0) continue
        const geoset = renderer.model.Geosets[geosetIndex] as Record<string, unknown> | undefined
        if (!geoset) continue

        if (options.vertices) {
            const vertices = toFloat32Array(geoset.Vertices)
            if (vertices && typeof renderer.updateGeosetVertices === 'function') {
                renderer.updateGeosetVertices(geosetIndex, vertices)
                changed = true
            }
        }

        if (options.normals) {
            const normals = toFloat32Array(geoset.Normals)
            if (normals && typeof renderer.updateGeosetNormals === 'function') {
                renderer.updateGeosetNormals(geosetIndex, normals)
                changed = true
            }
        }

        if (options.texCoords) {
            const tVertices = Array.isArray(geoset.TVertices) ? geoset.TVertices[0] : undefined
            const texCoords = toFloat32Array(tVertices)
            if (texCoords && typeof renderer.updateGeosetTexCoords === 'function') {
                renderer.updateGeosetTexCoords(geosetIndex, texCoords)
                changed = true
            }
        }

        if (options.groups && typeof renderer.updateGeosetGroups === 'function') {
            renderer.updateGeosetGroups(geosetIndex)
            changed = true
        }
    }

    if (!changed) return

    if (options.updateFrame !== false && typeof renderer.update === 'function') {
        renderer.update(0)
    }
    if (options.bumpRevision !== false) {
        useRendererStore.getState().bumpVertexRenderRevision()
    }
}
