import type { ModelData } from '../../types/model'

type RendererLike = {
    __modelPath?: unknown
    model?: {
        __modelPath?: unknown
        path?: unknown
        Geosets?: unknown[]
    }
} | null

const normalizeIdentityPath = (path: unknown): string => {
    if (typeof path !== 'string') return ''
    return path.replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase()
}

const getRendererModelPath = (renderer: RendererLike): string =>
    normalizeIdentityPath(renderer?.__modelPath)
    || normalizeIdentityPath(renderer?.model?.__modelPath)
    || normalizeIdentityPath(renderer?.model?.path)

const cloneArrayLike = <T,>(value: T): T => {
    if (ArrayBuffer.isView(value)) {
        const Ctor = (value as any).constructor
        return new Ctor(value as any) as T
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneArrayLike(item)) as T
    }
    return value
}

const cloneRendererGeosetForSave = (rendererGeoset: any, documentGeoset: any): any => {
    const next = {
        ...(documentGeoset ?? {}),
        MaterialID: documentGeoset?.MaterialID ?? rendererGeoset.MaterialID ?? 0,
        SelectionGroup: rendererGeoset.SelectionGroup ?? documentGeoset?.SelectionGroup ?? 0,
        Unselectable: rendererGeoset.Unselectable ?? documentGeoset?.Unselectable ?? false,
        Vertices: cloneArrayLike(rendererGeoset.Vertices ?? documentGeoset?.Vertices ?? []),
        Normals: cloneArrayLike(rendererGeoset.Normals ?? documentGeoset?.Normals ?? []),
        VertexGroup: cloneArrayLike(documentGeoset?.VertexGroup ?? rendererGeoset.VertexGroup ?? []),
        Faces: cloneArrayLike(rendererGeoset.Faces ?? documentGeoset?.Faces ?? []),
        TVertices: cloneArrayLike(rendererGeoset.TVertices ?? documentGeoset?.TVertices ?? []),
        Groups: cloneArrayLike(documentGeoset?.Groups ?? rendererGeoset.Groups ?? [[0]]),
        TotalGroupsCount: rendererGeoset.TotalGroupsCount ?? documentGeoset?.TotalGroupsCount,
        MinimumExtent: cloneArrayLike(rendererGeoset.MinimumExtent ?? documentGeoset?.MinimumExtent),
        MaximumExtent: cloneArrayLike(rendererGeoset.MaximumExtent ?? documentGeoset?.MaximumExtent),
        BoundsRadius: rendererGeoset.BoundsRadius ?? documentGeoset?.BoundsRadius,
        Anims: cloneArrayLike(rendererGeoset.Anims ?? documentGeoset?.Anims ?? []),
    }

    if (rendererGeoset.Tangents || documentGeoset?.Tangents) {
        next.Tangents = cloneArrayLike(rendererGeoset.Tangents ?? documentGeoset.Tangents)
    }
    if (rendererGeoset.SkinWeights || documentGeoset?.SkinWeights) {
        next.SkinWeights = cloneArrayLike(documentGeoset?.SkinWeights ?? rendererGeoset.SkinWeights)
    }

    return next
}

export const mergeLiveRendererGeometryForSave = (
    modelData: ModelData,
    renderer: RendererLike,
    modelPath: string | null,
): ModelData => {
    const rendererGeosets = renderer?.model?.Geosets
    if (!Array.isArray(rendererGeosets) || rendererGeosets.length === 0) {
        return modelData
    }

    const expectedPath = normalizeIdentityPath(modelPath ?? (modelData as any)?.__modelPath ?? (modelData as any)?.path)
    const rendererPath = getRendererModelPath(renderer)
    if (expectedPath && rendererPath && expectedPath !== rendererPath) {
        return modelData
    }

    const documentGeosets = Array.isArray((modelData as any).Geosets) ? (modelData as any).Geosets : []
    return {
        ...modelData,
        Geosets: rendererGeosets.map((geoset, index) =>
            cloneRendererGeosetForSave(geoset, documentGeosets[index])
        ) as any,
    }
}
