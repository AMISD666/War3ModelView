import type { Geoset } from '../../types/geoset'
import type { JumpxGeometryDto, JumpxImportDiagnostic } from '../../types/jumpxImport'
import { MAX_CLASSIC_MATRIX_GROUPS } from './FbxGeosetConstants'
import { compactImportedFbxGeosetVertices } from './FbxGeosetVertexCompactor'
import { splitGeosetByClassicMatrixGroupLimit } from './FbxGeosetSplitter'
import {
    rotateExtentsAroundX,
    rotateFlatVec3ArrayAroundX,
    scaleJumpxFlatVec3ArrayAroundPivot,
    transformJumpxExtents,
    transformJumpxFlatVec3Array,
    transformJumpxVec3,
} from './JumpxCoordinateTransform'

export type JumpxNodeMappingForGeosets = {
    defaultObjectId: number
    objectIdByBoneId: Map<number, number>
    objectIdByGeometryId?: Map<number, number>
}

type ClassicInfluence = {
    objectId: number
    weight: number
}

const MAX_CLASSIC_MATRIX_INFLUENCES = 4
const CLASSIC_WEIGHT_ERROR_EPSILON = 1e-9
const JUMPX_MESH_PLANE_ROTATION_RADIANS = 0

const warning = (category: JumpxImportDiagnostic['category'], message: string): JumpxImportDiagnostic => ({
    severity: 'warning',
    category,
    message,
})

const chooseClassicInfluences = (influences: ClassicInfluence[]): ClassicInfluence[] => {
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

    const normalized = sorted.map((item) => ({ objectId: item.objectId, weight: item.weight / total }))
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

const buildClassicGroups = (
    geometry: JumpxGeometryDto,
    vertexCount: number,
    nodeMapping: JumpxNodeMappingForGeosets,
    diagnostics: JumpxImportDiagnostic[],
): { vertexGroup: Uint8Array | Uint16Array; groups: number[][] } => {
    const geometryObjectId = nodeMapping.objectIdByGeometryId?.get(geometry.geometryIndex)
    if (geometryObjectId !== undefined) {
        return { vertexGroup: new Uint8Array(vertexCount), groups: [[geometryObjectId]] }
    }

    const bakedObjectId = nodeMapping.objectIdByBoneId.get(geometry.skinBoneIds[0]) ?? nodeMapping.defaultObjectId
    if (geometry.objectScale.some((value) => Math.abs(value - 1) > 1e-6)) {
        return { vertexGroup: new Uint8Array(vertexCount), groups: [[bakedObjectId]] }
    }

    const stride = Math.max(0, Math.floor(geometry.skinWeightStride || 0))
    const hasSkinBuffers = stride > 0
        && geometry.skinWeightCounts.length >= vertexCount
        && geometry.skinBoneIds.length >= vertexCount * stride
        && geometry.skinWeights.length >= vertexCount * stride
    if (!hasSkinBuffers) {
        return { vertexGroup: new Uint8Array(vertexCount), groups: [[nodeMapping.defaultObjectId]] }
    }

    const groupByKey = new Map<string, number>()
    const groups: number[][] = []
    const vertexGroupValues = new Array<number>(vertexCount)
    let missingBoneRefs = 0
    let fallbackVertices = 0

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const influenceCount = Math.min(stride, Math.max(0, Math.floor(geometry.skinWeightCounts[vertexIndex] ?? 0)))
        const influences: ClassicInfluence[] = []
        for (let weightIndex = 0; weightIndex < influenceCount; weightIndex += 1) {
            const sourceIndex = vertexIndex * stride + weightIndex
            const objectId = nodeMapping.objectIdByBoneId.get(geometry.skinBoneIds[sourceIndex])
            if (objectId === undefined) {
                missingBoneRefs += 1
                continue
            }
            influences.push({ objectId, weight: geometry.skinWeights[sourceIndex] })
        }

        const resolved = influences.length > 0
            ? chooseClassicInfluences(influences)
            : [{ objectId: nodeMapping.defaultObjectId, weight: 1 }]
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
        diagnostics.push(warning('skeleton', `JumpX geometry "${geometry.name}" has ${missingBoneRefs} skin weights referencing bones that were not imported.`))
    }
    if (fallbackVertices > 0) {
        diagnostics.push(warning('skeleton', `JumpX geometry "${geometry.name}" has ${fallbackVertices} vertices without usable skin weights; they were bound to the default node.`))
    }
    if (groups.length > MAX_CLASSIC_MATRIX_GROUPS) {
        diagnostics.push(warning('war3-limit', `JumpX geometry "${geometry.name}" produced ${groups.length} matrix groups; it will be split for classic MDX output.`))
    }

    return {
        vertexGroup: groups.length >= MAX_CLASSIC_MATRIX_GROUPS ? new Uint16Array(vertexGroupValues) : new Uint8Array(vertexGroupValues),
        groups,
    }
}

const buildGeoset = (
    geometry: JumpxGeometryDto,
    materialId: number,
    vertexGroup: Uint8Array | Uint16Array,
    groups: number[][],
): Geoset => {
    const vertexCount = Math.floor(geometry.vertices.length / 3)
    const normals = geometry.normals.length === vertexCount * 3
        ? geometry.normals
        : new Array(vertexCount * 3).fill(0)
    const uvs = geometry.uvs.length === vertexCount * 2
        ? geometry.uvs
        : new Array(vertexCount * 2).fill(0)
    const scaledVertices = scaleJumpxFlatVec3ArrayAroundPivot(
        geometry.vertices,
        geometry.objectPivot,
        geometry.objectScale,
    )
    const scaledMinimumExtent: [number, number, number] = [
        geometry.objectPivot[0] + (geometry.minimumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
        geometry.objectPivot[1] + (geometry.minimumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
        geometry.objectPivot[2] + (geometry.minimumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2],
    ]
    const scaledMaximumExtent: [number, number, number] = [
        geometry.objectPivot[0] + (geometry.maximumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
        geometry.objectPivot[1] + (geometry.maximumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
        geometry.objectPivot[2] + (geometry.maximumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2],
    ]
    const transformedVertices = transformJumpxFlatVec3Array(scaledVertices)
    const transformedNormals = transformJumpxFlatVec3Array(normals)
    const pivot = transformJumpxVec3(geometry.objectPivot)
    const transformedExtents = transformJumpxExtents(scaledMinimumExtent, scaledMaximumExtent)
    const extents = rotateExtentsAroundX(
        transformedExtents.min,
        transformedExtents.max,
        JUMPX_MESH_PLANE_ROTATION_RADIANS,
        pivot,
    )
    return {
        Vertices: rotateFlatVec3ArrayAroundX(transformedVertices, JUMPX_MESH_PLANE_ROTATION_RADIANS, pivot),
        Normals: rotateFlatVec3ArrayAroundX(transformedNormals, JUMPX_MESH_PLANE_ROTATION_RADIANS),
        TVertices: [new Float32Array(uvs)],
        Faces: vertexCount > 65535 ? new Uint32Array(geometry.indices) : new Uint16Array(geometry.indices),
        VertexGroup: vertexGroup,
        Groups: groups,
        TotalGroupsCount: groups.reduce((sum, group) => sum + group.length, 0),
        MinimumExtent: extents.min,
        MaximumExtent: extents.max,
        BoundsRadius: geometry.boundsRadius,
        MaterialID: materialId,
        SelectionGroup: 0,
        Unselectable: false,
    }
}

export const mapJumpxGeometryToGeosets = (
    geometry: JumpxGeometryDto,
    materialId: number,
    nodeMapping: JumpxNodeMappingForGeosets,
    diagnostics: JumpxImportDiagnostic[],
): Geoset[] => {
    const vertexCount = Math.floor(geometry.vertices.length / 3)
    const skin = buildClassicGroups(geometry, vertexCount, nodeMapping, diagnostics)
    const geoset = buildGeoset(geometry, materialId, skin.vertexGroup, skin.groups)
    const compacted = compactImportedFbxGeosetVertices(geoset)
    if (compacted.verticesAfter < compacted.verticesBefore) {
        diagnostics.push(warning('geometry', `JumpX geometry "${geometry.name}" shared equivalent triangle-corner vertices during import (${compacted.verticesBefore} -> ${compacted.verticesAfter}).`))
    }
    const splitGeosets = splitGeosetByClassicMatrixGroupLimit(compacted.geoset)
    if (splitGeosets.length > 1) {
        diagnostics.push(warning('war3-limit', `JumpX geometry "${geometry.name}" was split into ${splitGeosets.length} geosets to preserve classic MDX skinning.`))
    }
    return splitGeosets
}
