import type { Geoset } from '../../types/geoset'
import { MAX_CLASSIC_MATRIX_GROUPS } from './FbxGeosetConstants'
import { computeGeosetExtents } from './FbxGeosetGeometry'

type SplitChunkState = {
    groups: number[][]
    groupIndexBySource: Map<number, number>
    faceIndices: number[]
}

const createSplitChunkState = (): SplitChunkState => ({
    groups: [],
    groupIndexBySource: new Map<number, number>(),
    faceIndices: [],
})

const buildSplitGeosetChunk = (
    source: Geoset,
    chunk: SplitChunkState,
): Geoset | null => {
    if (chunk.faceIndices.length === 0) {
        return null
    }

    const sourceFaces = Array.from(source.Faces as ArrayLike<number>, (value) => Number(value) || 0)
    const sourceVertices = source.Vertices
    const sourceNormals = source.Normals
    const sourceVertexGroups = Array.from(source.VertexGroup as ArrayLike<number>, (value) => Number(value) || 0)
    const sourceTangents = source.Tangents
    const sourceSkinWeights = source.SkinWeights
    const sourceTVertices = Array.isArray(source.TVertices) ? source.TVertices : []

    const usedVertices = new Set<number>()
    for (const faceIndex of chunk.faceIndices) {
        const faceOffset = faceIndex * 3
        usedVertices.add(sourceFaces[faceOffset] ?? 0)
        usedVertices.add(sourceFaces[faceOffset + 1] ?? 0)
        usedVertices.add(sourceFaces[faceOffset + 2] ?? 0)
    }

    const orderedVertices = Array.from(usedVertices).sort((a, b) => a - b)
    const oldToNewVertexIndex = new Map<number, number>()
    orderedVertices.forEach((oldIndex, newIndex) => {
        oldToNewVertexIndex.set(oldIndex, newIndex)
    })

    const nextVertices: number[] = []
    const nextNormals: number[] = []
    const nextVertexGroups: number[] = []
    const nextTVertices = sourceTVertices.map(() => [] as number[])
    const nextTangents: number[] = []
    const nextSkinWeights: number[] = []

    for (const oldIndex of orderedVertices) {
        nextVertices.push(
            Number(sourceVertices[oldIndex * 3] ?? 0),
            Number(sourceVertices[oldIndex * 3 + 1] ?? 0),
            Number(sourceVertices[oldIndex * 3 + 2] ?? 0),
        )
        nextNormals.push(
            Number(sourceNormals[oldIndex * 3] ?? 0),
            Number(sourceNormals[oldIndex * 3 + 1] ?? 0),
            Number(sourceNormals[oldIndex * 3 + 2] ?? 0),
        )
        const remappedGroupIndex = chunk.groupIndexBySource.get(sourceVertexGroups[oldIndex] ?? 0) ?? 0
        nextVertexGroups.push(remappedGroupIndex)

        for (let layerIndex = 0; layerIndex < sourceTVertices.length; layerIndex += 1) {
            const tv = sourceTVertices[layerIndex]
            nextTVertices[layerIndex].push(
                Number(tv[oldIndex * 2] ?? 0),
                Number(tv[oldIndex * 2 + 1] ?? 0),
            )
        }

        if (sourceTangents) {
            nextTangents.push(
                Number(sourceTangents[oldIndex * 4] ?? 0),
                Number(sourceTangents[oldIndex * 4 + 1] ?? 0),
                Number(sourceTangents[oldIndex * 4 + 2] ?? 0),
                Number(sourceTangents[oldIndex * 4 + 3] ?? 0),
            )
        }

        if (sourceSkinWeights) {
            nextSkinWeights.push(
                Number(sourceSkinWeights[oldIndex * 4] ?? 0),
                Number(sourceSkinWeights[oldIndex * 4 + 1] ?? 0),
                Number(sourceSkinWeights[oldIndex * 4 + 2] ?? 0),
                Number(sourceSkinWeights[oldIndex * 4 + 3] ?? 0),
            )
        }
    }

    const nextFaces: number[] = []
    for (const faceIndex of chunk.faceIndices) {
        const faceOffset = faceIndex * 3
        nextFaces.push(
            oldToNewVertexIndex.get(sourceFaces[faceOffset] ?? 0) ?? 0,
            oldToNewVertexIndex.get(sourceFaces[faceOffset + 1] ?? 0) ?? 0,
            oldToNewVertexIndex.get(sourceFaces[faceOffset + 2] ?? 0) ?? 0,
        )
    }

    const vertexGroupCtor = chunk.groups.length >= MAX_CLASSIC_MATRIX_GROUPS ? Uint16Array : Uint8Array
    const extents = computeGeosetExtents(nextVertices)
    return {
        ...source,
        Vertices: new Float32Array(nextVertices),
        Normals: new Float32Array(nextNormals),
        TVertices: nextTVertices.map((layer) => new Float32Array(layer)),
        VertexGroup: new vertexGroupCtor(nextVertexGroups),
        Faces: nextVertices.length / 3 > 65535 ? new Uint32Array(nextFaces) : new Uint16Array(nextFaces),
        Groups: chunk.groups.map((group) => [...group]),
        TotalGroupsCount: chunk.groups.reduce((sum, group) => sum + group.length, 0),
        ...extents,
        ...(sourceTangents ? { Tangents: new Float32Array(nextTangents) } : {}),
        ...(sourceSkinWeights ? { SkinWeights: new Uint8Array(nextSkinWeights) } : {}),
    }
}

export const splitGeosetByClassicMatrixGroupLimit = (
    geoset: Geoset,
): Geoset[] => {
    const groups = Array.isArray(geoset.Groups) ? geoset.Groups : []
    if (groups.length <= MAX_CLASSIC_MATRIX_GROUPS) {
        return [geoset]
    }

    const faces = Array.from(geoset.Faces as ArrayLike<number>, (value) => Number(value) || 0)
    const vertexGroups = Array.from(geoset.VertexGroup as ArrayLike<number>, (value) => Number(value) || 0)
    const totalFaceCount = Math.floor(faces.length / 3)
    const chunks: SplitChunkState[] = []
    let currentChunk = createSplitChunkState()

    const flushChunk = () => {
        if (currentChunk.faceIndices.length > 0) {
            chunks.push(currentChunk)
            currentChunk = createSplitChunkState()
        }
    }

    for (let faceIndex = 0; faceIndex < totalFaceCount; faceIndex += 1) {
        const faceOffset = faceIndex * 3
        const sourceGroupIndices = [
            vertexGroups[faces[faceOffset] ?? 0] ?? 0,
            vertexGroups[faces[faceOffset + 1] ?? 0] ?? 0,
            vertexGroups[faces[faceOffset + 2] ?? 0] ?? 0,
        ]
        const uniqueSourceGroupIndices = Array.from(new Set(sourceGroupIndices))
        const additionalGroupCount = uniqueSourceGroupIndices.reduce((count, sourceGroupIndex) => {
            return currentChunk.groupIndexBySource.has(sourceGroupIndex) ? count : count + 1
        }, 0)

        if (
            currentChunk.faceIndices.length > 0
            && currentChunk.groups.length + additionalGroupCount > MAX_CLASSIC_MATRIX_GROUPS
        ) {
            flushChunk()
        }

        for (const sourceGroupIndex of uniqueSourceGroupIndices) {
            if (currentChunk.groupIndexBySource.has(sourceGroupIndex)) {
                continue
            }
            const group = Array.isArray(groups[sourceGroupIndex]) && groups[sourceGroupIndex].length > 0
                ? groups[sourceGroupIndex]
                : [0]
            currentChunk.groupIndexBySource.set(sourceGroupIndex, currentChunk.groups.length)
            currentChunk.groups.push([...group])
        }

        currentChunk.faceIndices.push(faceIndex)
    }

    flushChunk()

    return chunks
        .map((chunk) => buildSplitGeosetChunk(geoset, chunk))
        .filter((chunk): chunk is Geoset => !!chunk)
}
