import type { FbxImportDiagnostic, FbxStaticMeshDto } from '../../types/fbxImport'
import type { Geoset } from '../../types/geoset'

export type ImportedNodeMappingForGeosets = {
    defaultObjectId: number
    objectIdByTypedId: Map<number, number>
}

const warning = (category: FbxImportDiagnostic['category'], message: string): FbxImportDiagnostic => ({
    severity: 'warning',
    category,
    message,
})

export type FbxClassicInfluence = {
    objectId: number
    weight: number
}

const MAX_CLASSIC_MATRIX_INFLUENCES = 4
const CLASSIC_WEIGHT_ERROR_EPSILON = 1e-9

export const chooseClassicInfluencesForFbxWeights = (
    influences: FbxClassicInfluence[],
): FbxClassicInfluence[] => {
    const mergedByObjectId = new Map<number, number>()
    for (const influence of influences) {
        if (!Number.isFinite(influence.objectId) || !Number.isFinite(influence.weight) || influence.weight <= 0) {
            continue
        }
        mergedByObjectId.set(influence.objectId, (mergedByObjectId.get(influence.objectId) ?? 0) + influence.weight)
    }

    const sorted = Array.from(mergedByObjectId, ([objectId, weight]) => ({ objectId, weight }))
        .sort((a, b) => b.weight - a.weight || a.objectId - b.objectId)
    if (sorted.length <= 1) {
        return sorted
    }

    const total = sorted.reduce((sum, item) => sum + item.weight, 0)
    if (total <= 0) {
        return []
    }

    const normalized = sorted.map((item) => ({
        objectId: item.objectId,
        weight: item.weight / total,
    }))

    let bestCount = 1
    let bestError = Number.POSITIVE_INFINITY
    for (let count = 1; count <= Math.min(MAX_CLASSIC_MATRIX_INFLUENCES, normalized.length); count += 1) {
        const equalWeight = 1 / count
        const error = normalized.reduce((sum, item, index) => {
            const representedWeight = index < count ? equalWeight : 0
            const delta = item.weight - representedWeight
            return sum + delta * delta
        }, 0)
        if (error + CLASSIC_WEIGHT_ERROR_EPSILON < bestError) {
            bestCount = count
            bestError = error
        }
    }

    return normalized.slice(0, bestCount)
}

const findMeshObjectId = (mesh: FbxStaticMeshDto, nodeMapping: ImportedNodeMappingForGeosets): number => {
    if (mesh.nodeTypedId !== undefined) {
        const mapped = nodeMapping.objectIdByTypedId.get(mesh.nodeTypedId)
        if (mapped !== undefined) {
            return mapped
        }
    }
    return nodeMapping.defaultObjectId
}

const buildSkinnedGroups = (
    mesh: FbxStaticMeshDto,
    vertexCount: number,
    fallbackObjectId: number,
    nodeMapping: ImportedNodeMappingForGeosets,
    diagnostics: FbxImportDiagnostic[],
): { vertexGroup: Uint8Array | Uint16Array; groups: number[][] } => {
    const stride = Math.max(0, Math.floor(mesh.skinWeightStride || 0))
    const hasSkinBuffers = stride > 0
        && mesh.skinWeightCounts.length >= vertexCount
        && mesh.skinBoneNodeTypedIds.length >= vertexCount * stride
        && mesh.skinWeights.length >= vertexCount * stride
    if (!hasSkinBuffers) {
        return { vertexGroup: new Uint8Array(vertexCount), groups: [[fallbackObjectId]] }
    }

    const groupByKey = new Map<string, number>()
    const groups: number[][] = []
    const vertexGroupValues = new Array<number>(vertexCount)
    let missingBoneRefs = 0
    let fallbackVertices = 0

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const count = Math.min(4, Math.max(0, Math.floor(mesh.skinWeightCounts[vertexIndex] ?? 0)))
        const influences: FbxClassicInfluence[] = []
        for (let weightIndex = 0; weightIndex < count; weightIndex += 1) {
            const sourceIndex = vertexIndex * stride + weightIndex
            const boneTypedId = mesh.skinBoneNodeTypedIds[sourceIndex]
            const objectId = nodeMapping.objectIdByTypedId.get(boneTypedId)
            if (objectId === undefined) {
                missingBoneRefs += 1
                continue
            }
            const weight = mesh.skinWeights[sourceIndex]
            if (Number.isFinite(weight) && weight > 0) {
                influences.push({ objectId, weight })
            }
        }

        const resolved = influences.length > 0
            ? chooseClassicInfluencesForFbxWeights(influences)
            : [{ objectId: fallbackObjectId, weight: 1 }]
        if (influences.length === 0) {
            fallbackVertices += 1
        }

        const key = resolved.map((item) => item.objectId).join(',')
        let groupIndex = groupByKey.get(key)
        if (groupIndex === undefined) {
            groupIndex = groups.length
            groupByKey.set(key, groupIndex)
            groups.push(resolved.map((item) => item.objectId))
        }
        vertexGroupValues[vertexIndex] = groupIndex
    }

    if (missingBoneRefs > 0) {
        diagnostics.push(warning('skeleton', `FBX mesh "${mesh.name}" has ${missingBoneRefs} skin weights referencing bones that were not imported.`))
    }
    if (fallbackVertices > 0) {
        diagnostics.push(warning('skeleton', `FBX mesh "${mesh.name}" has ${fallbackVertices} vertices without usable skin weights; they were bound to the mesh fallback node.`))
    }
    if (groups.length > 255) {
        diagnostics.push(warning('war3-limit', `FBX mesh "${mesh.name}" produced ${groups.length} matrix groups; classic GNDX serialization stores group indices as bytes, so save/reopen needs manual validation.`))
    }

    const vertexGroup = groups.length > 255
        ? new Uint16Array(vertexGroupValues)
        : new Uint8Array(vertexGroupValues)
    return { vertexGroup, groups }
}

export const mapFbxMeshToGeoset = (
    mesh: FbxStaticMeshDto,
    materialId: number,
    nodeMapping: ImportedNodeMappingForGeosets,
    diagnostics: FbxImportDiagnostic[],
): Geoset => {
    const vertexCount = Math.floor(mesh.vertices.length / 3)
    const fallbackObjectId = findMeshObjectId(mesh, nodeMapping)
    const skin = buildSkinnedGroups(mesh, vertexCount, fallbackObjectId, nodeMapping, diagnostics)
    const totalGroupsCount = skin.groups.reduce((sum, group) => sum + group.length, 0)

    return {
        Vertices: new Float32Array(mesh.vertices),
        Normals: new Float32Array(mesh.normals.length === vertexCount * 3 ? mesh.normals : new Array(vertexCount * 3).fill(0)),
        TVertices: [new Float32Array(mesh.uvs.length === vertexCount * 2 ? mesh.uvs : new Array(vertexCount * 2).fill(0))],
        Faces: vertexCount > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices),
        VertexGroup: skin.vertexGroup,
        Groups: skin.groups,
        TotalGroupsCount: totalGroupsCount,
        MinimumExtent: mesh.minimumExtent,
        MaximumExtent: mesh.maximumExtent,
        BoundsRadius: mesh.boundsRadius,
        MaterialID: materialId,
        SelectionGroup: 0,
        Unselectable: false,
    }
}
