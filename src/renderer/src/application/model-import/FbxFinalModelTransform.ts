import { mat3, mat4, quat, vec3 } from 'gl-matrix'
import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'

type MutableVectorLike = { length: number; [index: number]: number }
type TrackKey = { Vector?: unknown; InTan?: unknown; OutTan?: unknown }
type AnimTrack = { Keys?: TrackKey[] }

const IMPORT_FINAL_ROTATION_Z_DEGREES = 90

const isMutableVectorLike = (value: unknown, minLength: number): value is MutableVectorLike => {
    if (!(Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView)))) {
        return false
    }
    return typeof (value as { length?: unknown }).length === 'number'
        && (value as { length: number }).length >= minLength
}

const isAnimTrack = (value: unknown): value is AnimTrack =>
    !!value && typeof value === 'object' && Array.isArray((value as { Keys?: unknown }).Keys)

const finiteTuple3 = (value: MutableVectorLike): [number, number, number] | null => {
    const result: [number, number, number] = [Number(value[0]), Number(value[1]), Number(value[2])]
    return result.every(Number.isFinite) ? result : null
}

const transformVec3Value = (value: unknown, matrix: mat4, transformed: Set<unknown>): void => {
    if (!isMutableVectorLike(value, 3) || transformed.has(value)) return
    const tuple = finiteTuple3(value)
    if (!tuple) return

    const vector = vec3.fromValues(tuple[0], tuple[1], tuple[2])
    vec3.transformMat4(vector, vector, matrix)
    value[0] = vector[0]
    value[1] = vector[1]
    value[2] = vector[2]
    transformed.add(value)
}

const transformNormalValue = (value: unknown, matrix: mat3, transformed: Set<unknown>): void => {
    if (!isMutableVectorLike(value, 3) || transformed.has(value)) return
    const tuple = finiteTuple3(value)
    if (!tuple) return

    const vector = vec3.fromValues(tuple[0], tuple[1], tuple[2])
    vec3.transformMat3(vector, vector, matrix)
    vec3.normalize(vector, vector)
    value[0] = vector[0]
    value[1] = vector[1]
    value[2] = vector[2]
    transformed.add(value)
}

const transformFlatVec3Array = (value: unknown, matrix: mat4, transformed: Set<unknown>): void => {
    if (!isMutableVectorLike(value, 3) || transformed.has(value)) return

    const vector = vec3.create()
    for (let index = 0; index + 2 < value.length; index += 3) {
        const x = Number(value[index])
        const y = Number(value[index + 1])
        const z = Number(value[index + 2])
        if (![x, y, z].every(Number.isFinite)) continue

        vec3.set(vector, x, y, z)
        vec3.transformMat4(vector, vector, matrix)
        value[index] = vector[0]
        value[index + 1] = vector[1]
        value[index + 2] = vector[2]
    }
    transformed.add(value)
}

const transformFlatNormalArray = (value: unknown, matrix: mat3, transformed: Set<unknown>): void => {
    if (!isMutableVectorLike(value, 3) || transformed.has(value)) return

    const vector = vec3.create()
    for (let index = 0; index + 2 < value.length; index += 3) {
        const x = Number(value[index])
        const y = Number(value[index + 1])
        const z = Number(value[index + 2])
        if (![x, y, z].every(Number.isFinite)) continue

        vec3.set(vector, x, y, z)
        vec3.transformMat3(vector, vector, matrix)
        vec3.normalize(vector, vector)
        value[index] = vector[0]
        value[index + 1] = vector[1]
        value[index + 2] = vector[2]
    }
    transformed.add(value)
}

const transformExtentFields = (target: unknown, matrix: mat4, transformed: Set<unknown>): void => {
    if (!target || typeof target !== 'object') return
    const record = target as { MinimumExtent?: unknown; MaximumExtent?: unknown }
    const min = record.MinimumExtent
    const max = record.MaximumExtent
    if (!isMutableVectorLike(min, 3) || !isMutableVectorLike(max, 3) || transformed.has(min) || transformed.has(max)) {
        transformVec3Value(min, matrix, transformed)
        transformVec3Value(max, matrix, transformed)
        return
    }

    const minTuple = finiteTuple3(min)
    const maxTuple = finiteTuple3(max)
    if (!minTuple || !maxTuple) return

    const corners: [number, number, number][] = [
        [minTuple[0], minTuple[1], minTuple[2]],
        [maxTuple[0], minTuple[1], minTuple[2]],
        [minTuple[0], maxTuple[1], minTuple[2]],
        [minTuple[0], minTuple[1], maxTuple[2]],
        [maxTuple[0], maxTuple[1], minTuple[2]],
        [maxTuple[0], minTuple[1], maxTuple[2]],
        [minTuple[0], maxTuple[1], maxTuple[2]],
        [maxTuple[0], maxTuple[1], maxTuple[2]],
    ]
    const vector = vec3.create()
    const nextMin: [number, number, number] = [Infinity, Infinity, Infinity]
    const nextMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const corner of corners) {
        vec3.set(vector, corner[0], corner[1], corner[2])
        vec3.transformMat4(vector, vector, matrix)
        nextMin[0] = Math.min(nextMin[0], vector[0])
        nextMin[1] = Math.min(nextMin[1], vector[1])
        nextMin[2] = Math.min(nextMin[2], vector[2])
        nextMax[0] = Math.max(nextMax[0], vector[0])
        nextMax[1] = Math.max(nextMax[1], vector[1])
        nextMax[2] = Math.max(nextMax[2], vector[2])
    }

    min[0] = nextMin[0]
    min[1] = nextMin[1]
    min[2] = nextMin[2]
    max[0] = nextMax[0]
    max[1] = nextMax[1]
    max[2] = nextMax[2]
    transformed.add(min)
    transformed.add(max)
}

const transformVec3Track = (track: unknown, matrix: mat4, transformed: Set<unknown>): void => {
    if (!isAnimTrack(track)) return
    for (const key of track.Keys ?? []) {
        transformVec3Value(key.Vector, matrix, transformed)
        transformVec3Value(key.InTan, matrix, transformed)
        transformVec3Value(key.OutTan, matrix, transformed)
    }
}

const transformQuatValue = (
    value: unknown,
    rotation: quat,
    inverseRotation: quat,
    transformed: Set<unknown>,
): void => {
    if (!isMutableVectorLike(value, 4) || transformed.has(value)) return
    const source = quat.fromValues(Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3]))
    if (![source[0], source[1], source[2], source[3]].every(Number.isFinite)) return

    const rotated = quat.create()
    quat.multiply(rotated, rotation, source)
    quat.multiply(rotated, rotated, inverseRotation)
    quat.normalize(rotated, rotated)
    value[0] = rotated[0]
    value[1] = rotated[1]
    value[2] = rotated[2]
    value[3] = rotated[3]
    transformed.add(value)
}

const transformQuatTrack = (
    track: unknown,
    rotation: quat,
    inverseRotation: quat,
    transformed: Set<unknown>,
): void => {
    if (!isAnimTrack(track)) return
    for (const key of track.Keys ?? []) {
        transformQuatValue(key.Vector, rotation, inverseRotation, transformed)
        transformQuatValue(key.InTan, rotation, inverseRotation, transformed)
        transformQuatValue(key.OutTan, rotation, inverseRotation, transformed)
    }
}

const forEachImportedNode = (modelData: ModelData, callback: (node: ModelNode) => void): void => {
    const seen = new Set<ModelNode>()
    const groups = [
        modelData.Bones,
        modelData.Helpers,
        modelData.Nodes,
    ]
    for (const group of groups) {
        if (!Array.isArray(group)) continue
        for (const node of group) {
            if (!node || seen.has(node)) continue
            seen.add(node)
            callback(node)
        }
    }
}

export const rotateImportedFbxModelZ90 = (modelData: ModelData): void => {
    const rotation = quat.create()
    quat.fromEuler(rotation, 0, 0, IMPORT_FINAL_ROTATION_Z_DEGREES)
    const inverseRotation = quat.create()
    quat.invert(inverseRotation, rotation)

    const positionMatrix = mat4.create()
    mat4.fromQuat(positionMatrix, rotation)
    const normalMatrix = mat3.create()
    mat3.fromMat4(normalMatrix, positionMatrix)

    const transformedPositions = new Set<unknown>()
    const transformedNormals = new Set<unknown>()
    const transformedQuats = new Set<unknown>()

    if (Array.isArray(modelData.PivotPoints)) {
        for (const pivot of modelData.PivotPoints) {
            transformVec3Value(pivot, positionMatrix, transformedPositions)
        }
    }

    forEachImportedNode(modelData, (node) => {
        transformVec3Value(node.PivotPoint, positionMatrix, transformedPositions)
        transformVec3Track(node.Translation, positionMatrix, transformedPositions)
        transformQuatTrack(node.Rotation, rotation, inverseRotation, transformedQuats)
    })

    for (const geoset of modelData.Geosets ?? []) {
        transformFlatVec3Array(geoset.Vertices, positionMatrix, transformedPositions)
        transformFlatNormalArray(geoset.Normals, normalMatrix, transformedNormals)
        transformExtentFields(geoset, positionMatrix, transformedPositions)
    }

    transformExtentFields(modelData.Model, positionMatrix, transformedPositions)
    for (const sequence of modelData.Sequences ?? []) {
        transformExtentFields(sequence, positionMatrix, transformedPositions)
    }
}
