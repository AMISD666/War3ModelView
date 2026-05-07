import type { Geoset } from '../../types/geoset'
import { computeGeosetExtents } from './FbxGeosetGeometry'

export type FbxGeosetCompactionResult = {
    geoset: Geoset
    verticesBefore: number
    verticesAfter: number
}

const keyNumber = (value: number | undefined): string => String(Math.fround(Number(value ?? 0)))

const keyComponents = (source: ArrayLike<number> | undefined, start: number, count: number): string => {
    const parts: string[] = []
    for (let offset = 0; offset < count; offset += 1) {
        parts.push(keyNumber(source?.[start + offset]))
    }
    return parts.join(',')
}

const buildVertexKey = (
    geoset: Geoset,
    vertexIndex: number,
    vertexGroups: ArrayLike<number>,
): string => {
    const textureVertices = Array.isArray(geoset.TVertices) ? geoset.TVertices : []
    const textureKey = textureVertices
        .map((layer) => keyComponents(layer, vertexIndex * 2, 2))
        .join('|')
    const tangentKey = geoset.Tangents ? keyComponents(geoset.Tangents, vertexIndex * 4, 4) : ''
    const skinWeightKey = geoset.SkinWeights ? keyComponents(geoset.SkinWeights, vertexIndex * 4, 4) : ''
    return [
        keyComponents(geoset.Vertices, vertexIndex * 3, 3),
        keyComponents(geoset.Normals, vertexIndex * 3, 3),
        textureKey,
        keyNumber(vertexGroups[vertexIndex]),
        tangentKey,
        skinWeightKey,
    ].join('#')
}

export const compactImportedFbxGeosetVertices = (geoset: Geoset): FbxGeosetCompactionResult => {
    const vertexCount = Math.floor((geoset.Vertices?.length ?? 0) / 3)
    const faces = Array.from(geoset.Faces as ArrayLike<number>, (value) => Number(value) || 0)
    const vertexGroups = geoset.VertexGroup ?? new Uint8Array(vertexCount)
    if (vertexCount === 0 || faces.length === 0) {
        return { geoset, verticesBefore: vertexCount, verticesAfter: vertexCount }
    }

    const keyToNewIndex = new Map<string, number>()
    const oldToNewIndex = new Array<number>(vertexCount)
    const nextVertices: number[] = []
    const nextNormals: number[] = []
    const nextTextureVertices = (Array.isArray(geoset.TVertices) ? geoset.TVertices : [])
        .map(() => [] as number[])
    const nextVertexGroups: number[] = []
    const nextTangents: number[] = []
    const nextSkinWeights: number[] = []

    for (let oldIndex = 0; oldIndex < vertexCount; oldIndex += 1) {
        const key = buildVertexKey(geoset, oldIndex, vertexGroups)
        let newIndex = keyToNewIndex.get(key)
        if (newIndex === undefined) {
            newIndex = keyToNewIndex.size
            keyToNewIndex.set(key, newIndex)
            nextVertices.push(
                Number(geoset.Vertices[oldIndex * 3] ?? 0),
                Number(geoset.Vertices[oldIndex * 3 + 1] ?? 0),
                Number(geoset.Vertices[oldIndex * 3 + 2] ?? 0),
            )
            nextNormals.push(
                Number(geoset.Normals[oldIndex * 3] ?? 0),
                Number(geoset.Normals[oldIndex * 3 + 1] ?? 0),
                Number(geoset.Normals[oldIndex * 3 + 2] ?? 0),
            )
            for (let layerIndex = 0; layerIndex < nextTextureVertices.length; layerIndex += 1) {
                const layer = geoset.TVertices?.[layerIndex]
                nextTextureVertices[layerIndex].push(
                    Number(layer?.[oldIndex * 2] ?? 0),
                    Number(layer?.[oldIndex * 2 + 1] ?? 0),
                )
            }
            nextVertexGroups.push(Number(vertexGroups[oldIndex] ?? 0))
            if (geoset.Tangents) {
                nextTangents.push(
                    Number(geoset.Tangents[oldIndex * 4] ?? 0),
                    Number(geoset.Tangents[oldIndex * 4 + 1] ?? 0),
                    Number(geoset.Tangents[oldIndex * 4 + 2] ?? 0),
                    Number(geoset.Tangents[oldIndex * 4 + 3] ?? 0),
                )
            }
            if (geoset.SkinWeights) {
                nextSkinWeights.push(
                    Number(geoset.SkinWeights[oldIndex * 4] ?? 0),
                    Number(geoset.SkinWeights[oldIndex * 4 + 1] ?? 0),
                    Number(geoset.SkinWeights[oldIndex * 4 + 2] ?? 0),
                    Number(geoset.SkinWeights[oldIndex * 4 + 3] ?? 0),
                )
            }
        }
        oldToNewIndex[oldIndex] = newIndex
    }

    const nextFaces = faces.map((index) => oldToNewIndex[index] ?? 0)
    const vertexGroupCtor = nextVertexGroups.some((value) => value > 255) ? Uint16Array : Uint8Array
    const nextVertexCount = nextVertices.length / 3
    const extents = computeGeosetExtents(nextVertices)
    return {
        geoset: {
            ...geoset,
            Vertices: new Float32Array(nextVertices),
            Normals: new Float32Array(nextNormals),
            TVertices: nextTextureVertices.map((layer) => new Float32Array(layer)),
            Faces: nextVertexCount > 65535 ? new Uint32Array(nextFaces) : new Uint16Array(nextFaces),
            VertexGroup: new vertexGroupCtor(nextVertexGroups),
            ...extents,
            ...(geoset.Tangents ? { Tangents: new Float32Array(nextTangents) } : {}),
            ...(geoset.SkinWeights ? { SkinWeights: new Uint8Array(nextSkinWeights) } : {}),
        },
        verticesBefore: vertexCount,
        verticesAfter: nextVertexCount,
    }
}
