import { mat4, quat, vec3 } from 'gl-matrix'
import type {
    FbxAnimationStackDto,
    FbxBakedNodeDto,
    FbxBakedQuatKeyDto,
    FbxBakedVec3KeyDto,
    FbxNodeDto,
} from '../../types/fbxImport'
import type { ModelNode } from '../../types/node'
import { collectMappedStackKeyTimes } from './FbxAnimationSampling'

export type War3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}
export type War3NodeTracks = { translation: War3Track | null; rotation: War3Track | null; scaling: War3Track | null }
type ImportedNodeAnimationMapping = { nodes: ModelNode[]; objectIdByTypedId: Map<number, number> }
type ImportedNodeRestMapping = ImportedNodeAnimationMapping & {
    targetRestNodes?: FbxNodeDto[]
    targetObjectIdByTypedId?: Map<number, number>
}
type LocalTransform = { translation: vec3; rotation: quat; scaling: vec3 }

const TRANSFORM_EPSILON = 1e-5

const toFiniteNumber = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? Number(value) : fallback

const readVec3 = (value: [number, number, number] | undefined, fallback: [number, number, number]): vec3 =>
    vec3.fromValues(
        toFiniteNumber(value?.[0], fallback[0]),
        toFiniteNumber(value?.[1], fallback[1]),
        toFiniteNumber(value?.[2], fallback[2]),
    )

const readQuat = (value: [number, number, number, number] | undefined): quat => {
    const result = quat.fromValues(
        toFiniteNumber(value?.[0], 0),
        toFiniteNumber(value?.[1], 0),
        toFiniteNumber(value?.[2], 0),
        toFiniteNumber(value?.[3], 1),
    )
    const length = quat.length(result)
    if (!Number.isFinite(length) || length <= 0) {
        quat.identity(result)
    } else {
        quat.normalize(result, result)
    }
    return result
}

const makeTrack = (keys: Array<{ frame: number; vector: Float32Array }>): War3Track | null => {
    if (keys.length === 0) return null
    return {
        LineType: 1,
        InterpolationType: 1,
        GlobalSeqId: null,
        Keys: keys
            .filter((key) => Number.isFinite(key.frame))
            .sort((a, b) => a.frame - b.frame)
            .map((key) => ({ Frame: key.frame, Vector: key.vector })),
    }
}

const findLeftIndex = <T extends { timeSeconds: number }>(keys: T[], timeSeconds: number): number => {
    let left = 0
    let right = keys.length - 1
    while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        if (keys[mid].timeSeconds <= timeSeconds) {
            left = mid + 1
        } else {
            right = mid - 1
        }
    }
    return Math.max(0, left - 1)
}

const evaluateVec3 = (
    keys: FbxBakedVec3KeyDto[] | undefined,
    timeSeconds: number,
    fallback: vec3,
): vec3 => {
    if (!keys || keys.length === 0) return vec3.clone(fallback)
    if (keys.length === 1 || timeSeconds <= keys[0].timeSeconds) {
        return readVec3(keys[0].value, [fallback[0], fallback[1], fallback[2]])
    }
    const last = keys[keys.length - 1]
    if (timeSeconds >= last.timeSeconds) {
        return readVec3(last.value, [fallback[0], fallback[1], fallback[2]])
    }

    const leftIndex = findLeftIndex(keys, timeSeconds)
    const left = keys[leftIndex]
    const right = keys[Math.min(leftIndex + 1, keys.length - 1)]
    const duration = right.timeSeconds - left.timeSeconds
    const t = duration > 0 ? (timeSeconds - left.timeSeconds) / duration : 0
    const result = vec3.create()
    vec3.lerp(result, readVec3(left.value, [fallback[0], fallback[1], fallback[2]]), readVec3(right.value, [fallback[0], fallback[1], fallback[2]]), t)
    return result
}

const evaluateQuat = (
    keys: FbxBakedQuatKeyDto[] | undefined,
    timeSeconds: number,
    fallback: quat,
): quat => {
    if (!keys || keys.length === 0) return quat.clone(fallback)
    if (keys.length === 1 || timeSeconds <= keys[0].timeSeconds) {
        return readQuat(keys[0].value)
    }
    const last = keys[keys.length - 1]
    if (timeSeconds >= last.timeSeconds) {
        return readQuat(last.value)
    }

    const leftIndex = findLeftIndex(keys, timeSeconds)
    const left = keys[leftIndex]
    const right = keys[Math.min(leftIndex + 1, keys.length - 1)]
    const duration = right.timeSeconds - left.timeSeconds
    const t = duration > 0 ? (timeSeconds - left.timeSeconds) / duration : 0
    const result = quat.create()
    quat.slerp(result, readQuat(left.value), readQuat(right.value), t)
    return result
}

const buildRestLocals = (nodes: FbxNodeDto[]): Map<number, LocalTransform> => {
    const result = new Map<number, LocalTransform>()
    for (const node of nodes) {
        result.set(node.typedId, {
            translation: readVec3(node.localTranslation, [0, 0, 0]),
            rotation: readQuat(node.localRotation),
            scaling: readVec3(node.localScale, [1, 1, 1]),
        })
    }
    return result
}

const isStaticBakedNode = (node: FbxBakedNodeDto | undefined): boolean =>
    !!node && node.constantTranslation && node.constantRotation && node.constantScale

const isRestIdentityBridge = (rest: LocalTransform | undefined): boolean =>
    !!rest
    && vec3.squaredLength(rest.translation) <= TRANSFORM_EPSILON * TRANSFORM_EPSILON
    && Math.abs(Math.abs(quat.dot(rest.rotation, quat.create())) - 1) <= TRANSFORM_EPSILON
    && Math.abs(rest.scaling[0] - 1) <= TRANSFORM_EPSILON
    && Math.abs(rest.scaling[1] - 1) <= TRANSFORM_EPSILON
    && Math.abs(rest.scaling[2] - 1) <= TRANSFORM_EPSILON

const localMatrix = (transform: LocalTransform): mat4 => {
    const result = mat4.create()
    mat4.fromRotationTranslationScale(result, transform.rotation, transform.translation, transform.scaling)
    return result
}

const buildRestWorldMatrices = (nodes: FbxNodeDto[], restLocals: Map<number, LocalTransform>): Map<number, mat4> => {
    const nodeByTypedId = new Map(nodes.map((node) => [node.typedId, node]))
    const cache = new Map<number, mat4>()
    const compute = (typedId: number): mat4 => {
        const cached = cache.get(typedId)
        if (cached) return cached
        const node = nodeByTypedId.get(typedId)
        const local = localMatrix(restLocals.get(typedId) ?? { translation: vec3.create(), rotation: quat.create(), scaling: vec3.fromValues(1, 1, 1) })
        const parent = node?.parentTypedId !== undefined ? compute(node.parentTypedId) : null
        const world = mat4.create()
        if (parent) {
            mat4.multiply(world, parent, local)
        } else {
            mat4.copy(world, local)
        }
        cache.set(typedId, world)
        return world
    }
    for (const node of nodes) compute(node.typedId)
    return cache
}

const decomposePivotDelta = (matrix: mat4, pivot: vec3): LocalTransform => {
    const rotation = quat.create()
    const scaling = vec3.create()
    const matrixTranslation = vec3.fromValues(matrix[12], matrix[13], matrix[14])
    mat4.getRotation(rotation, matrix)
    mat4.getScaling(scaling, matrix)

    const rs = mat4.create()
    mat4.fromRotationTranslationScale(rs, rotation, vec3.create(), scaling)
    const rotatedScaledPivot = vec3.create()
    vec3.transformMat4(rotatedScaledPivot, pivot, rs)
    const translation = vec3.create()
    vec3.sub(translation, matrixTranslation, pivot)
    vec3.add(translation, translation, rotatedScaledPivot)

    return { translation, rotation, scaling }
}

export const buildWar3DeltaTracksForStack = (
    sceneNodes: FbxNodeDto[],
    stack: FbxAnimationStackDto,
    sequenceStartFrame: number,
    nodeMapping: ImportedNodeRestMapping,
): Map<number, War3NodeTracks> => {
    const restLocals = buildRestLocals(sceneNodes)
    const restWorld = buildRestWorldMatrices(sceneNodes, restLocals)
    const targetRestNodes = nodeMapping.targetRestNodes ?? sceneNodes
    const targetRestLocals = buildRestLocals(targetRestNodes)
    const targetRestWorld = buildRestWorldMatrices(targetRestNodes, targetRestLocals)
    const targetTypedIdByObjectId = nodeMapping.targetObjectIdByTypedId
        ? new Map([...nodeMapping.targetObjectIdByTypedId].map(([typedId, objectId]) => [objectId, typedId]))
        : new Map([...nodeMapping.objectIdByTypedId].map(([typedId, objectId]) => [objectId, typedId]))
    const restWorldInverse = new Map<number, mat4>()
    for (const [typedId, objectId] of nodeMapping.objectIdByTypedId) {
        const targetTypedId = targetTypedIdByObjectId.get(objectId) ?? typedId
        const matrix = targetRestWorld.get(targetTypedId) ?? restWorld.get(typedId)
        if (!matrix) {
            continue
        }
        const inverse = mat4.create()
        mat4.invert(inverse, matrix)
        restWorldInverse.set(typedId, inverse)
    }

    const fbxNodeByTypedId = new Map(sceneNodes.map((node) => [node.typedId, node]))
    const bakedByTypedId = new Map((stack.bakedNodes ?? []).map((node) => [node.nodeTypedId, node]))
    const typedIdByObjectId = new Map([...nodeMapping.objectIdByTypedId].map(([typedId, objectId]) => [objectId, typedId]))
    const importedNodeByTypedId = new Map(nodeMapping.nodes.map((node) => [node.ObjectId, node]))
    const stackSampleTimes = collectMappedStackKeyTimes(stack, nodeMapping)

    const animatedWorldAt = (typedId: number, timeSeconds: number, cache: Map<number, mat4>): mat4 => {
        const cached = cache.get(typedId)
        if (cached) return cached
        const node = fbxNodeByTypedId.get(typedId)
        const rest = restLocals.get(typedId)
        const baked = bakedByTypedId.get(typedId)
        const useRestLocal = !nodeMapping.objectIdByTypedId.has(typedId) && !node?.isBone && isStaticBakedNode(baked) && isRestIdentityBridge(rest)
        const transform: LocalTransform = useRestLocal && rest
            ? rest
            : {
                translation: evaluateVec3(baked?.translationKeys, timeSeconds, rest?.translation ?? vec3.create()),
                rotation: evaluateQuat(baked?.rotationKeys, timeSeconds, rest?.rotation ?? quat.create()),
                scaling: evaluateVec3(baked?.scaleKeys, timeSeconds, rest?.scaling ?? vec3.fromValues(1, 1, 1)),
            }
        const local = localMatrix(transform)
        const world = mat4.create()
        if (node?.parentTypedId !== undefined) {
            mat4.multiply(world, animatedWorldAt(node.parentTypedId, timeSeconds, cache), local)
        } else {
            mat4.copy(world, local)
        }
        cache.set(typedId, world)
        return world
    }

    const mappedTypedIds = [...nodeMapping.objectIdByTypedId.keys()]
        .filter((typedId) => fbxNodeByTypedId.has(typedId))

    const result = new Map<number, War3NodeTracks>()
    for (const typedId of mappedTypedIds) {
        const objectId = nodeMapping.objectIdByTypedId.get(typedId)
        if (objectId === undefined) continue
        const importedNode = importedNodeByTypedId.get(objectId)
        if (!importedNode) continue

        const translationKeys: Array<{ frame: number; vector: Float32Array }> = []
        const rotationKeys: Array<{ frame: number; vector: Float32Array }> = []
        const scalingKeys: Array<{ frame: number; vector: Float32Array }> = []
        let previousRotation: quat | null = null

        for (const timeSeconds of stackSampleTimes) {
            const frame = sequenceStartFrame + Math.max(0, Math.round(timeSeconds * 1000))
            const cache = new Map<number, mat4>()
            const animatedWorld = animatedWorldAt(typedId, timeSeconds, cache)
            const skinWorld = mat4.create()
            mat4.multiply(skinWorld, animatedWorld, restWorldInverse.get(typedId) ?? mat4.create())

            let localDelta = skinWorld
            const parentObjectId = typeof importedNode.Parent === 'number' && importedNode.Parent >= 0
                ? importedNode.Parent
                : undefined
            const parentTypedId = parentObjectId !== undefined
                ? typedIdByObjectId.get(parentObjectId)
                : undefined
            if (parentTypedId !== undefined) {
                const targetParentTypedId = parentObjectId !== undefined
                    ? targetTypedIdByObjectId.get(parentObjectId) ?? parentTypedId
                    : parentTypedId
                const parentAnimatedWorld = animatedWorldAt(parentTypedId, timeSeconds, cache)
                const parentSkinWorld = mat4.create()
                const parentRestInverse = restWorldInverse.get(parentTypedId)
                    ?? (() => {
                        const inverse = mat4.create()
                        const matrix = targetRestWorld.get(targetParentTypedId) ?? restWorld.get(parentTypedId)
                        if (matrix) mat4.invert(inverse, matrix)
                        return inverse
                    })()
                mat4.multiply(parentSkinWorld, parentAnimatedWorld, parentRestInverse)
                const inverseParentSkinWorld = mat4.create()
                mat4.invert(inverseParentSkinWorld, parentSkinWorld)
                localDelta = mat4.create()
                mat4.multiply(localDelta, inverseParentSkinWorld, skinWorld)
            }

            const pivot = readVec3(importedNode.PivotPoint as [number, number, number] | undefined, [0, 0, 0])
            const decomposed = decomposePivotDelta(localDelta, pivot)
            if (previousRotation && quat.dot(previousRotation, decomposed.rotation) < 0) {
                quat.scale(decomposed.rotation, decomposed.rotation, -1)
            }
            previousRotation = quat.clone(decomposed.rotation)

            translationKeys.push({ frame, vector: new Float32Array(decomposed.translation) })
            rotationKeys.push({ frame, vector: new Float32Array(decomposed.rotation) })
            scalingKeys.push({ frame, vector: new Float32Array(decomposed.scaling) })
        }

        result.set(typedId, {
            translation: makeTrack(translationKeys),
            rotation: makeTrack(rotationKeys),
            scaling: makeTrack(scalingKeys),
        })
    }

    return result
}
