import { mat3, quat, vec3 } from 'gl-matrix'
import { calculateModelExtent } from '../utils/geometryUtils'
import { extractNodesFromModel, updateModelDataWithNodes, useModelStore } from '../store/modelStore'
import { modelDocumentCommandHandler } from '../application/commands'
import type { ModelNode } from '../types/node'
import type { Command } from '../utils/CommandManager'

export type MirrorAxis = 'x' | 'y' | 'z'

type Snapshot = {
    modelData: any
    nodes: ModelNode[]
    trackerRotation: [number, number, number]
}

const WORLD_ORIGIN: [number, number, number] = [0, 0, 0]
const IDENTITY_SCALE: [number, number, number] = [1, 1, 1]

type Vec3Track = {
    Keys?: Array<{
        Vector?: ArrayLike<number> | null
    }> | null
}

function cloneDeep<T>(value: T): T {
    const sc = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone
    if (typeof sc === 'function') {
        return sc(value)
    }
    return JSON.parse(JSON.stringify(value))
}

function getMirrorScale(axis: MirrorAxis): [number, number, number] {
    if (axis === 'x') return [-1, 1, 1]
    if (axis === 'y') return [1, -1, 1]
    return [1, 1, -1]
}

function combineScale(
    left: [number, number, number],
    right: [number, number, number]
): [number, number, number] {
    return [left[0] * right[0], left[1] * right[1], left[2] * right[2]]
}

function getScaleDeterminantSign(scale: [number, number, number]): number {
    return scale[0] * scale[1] * scale[2] < 0 ? -1 : 1
}

function readMirrorNodeScale(node: ModelNode): [number, number, number] {
    const scaling = node.Scaling as Vec3Track | undefined
    const vector = scaling?.Keys?.[0]?.Vector
    if (!vector || vector.length < 3) return [...IDENTITY_SCALE]

    return [
        Number.isFinite(Number(vector[0])) ? Number(vector[0]) : 1,
        Number.isFinite(Number(vector[1])) ? Number(vector[1]) : 1,
        Number.isFinite(Number(vector[2])) ? Number(vector[2]) : 1
    ]
}

function isMirrorRootNode(node: ModelNode): boolean {
    return typeof node?.Name === 'string' && node.Name.startsWith('__WMV_MIRROR_ROOT__')
}

function unwrapExistingMirrorRoots(nodes: ModelNode[]): {
    nodes: ModelNode[]
    scale: [number, number, number]
} {
    const mirrorNodes = nodes.filter(isMirrorRootNode)
    if (mirrorNodes.length === 0) {
        return { nodes, scale: [...IDENTITY_SCALE] }
    }

    const mirrorById = new Map<number, ModelNode>()
    let scale: [number, number, number] = [...IDENTITY_SCALE]
    for (const node of mirrorNodes) {
        mirrorById.set(node.ObjectId, node)
        scale = combineScale(scale, readMirrorNodeScale(node))
    }

    const resolveParent = (parent: number | undefined | null): number => {
        let current = typeof parent === 'number' ? parent : -1
        const seen = new Set<number>()

        while (current >= 0 && mirrorById.has(current) && !seen.has(current)) {
            seen.add(current)
            const nextParent = mirrorById.get(current)?.Parent
            current = typeof nextParent === 'number' ? nextParent : -1
        }

        return current
    }

    return {
        nodes: nodes
            .filter((node) => !isMirrorRootNode(node))
            .map((node) => {
                const parent = resolveParent(node.Parent)
                if (parent === node.Parent) return node
                return { ...node, Parent: parent } as ModelNode
            }),
        scale
    }
}

function reverseTriangleWinding(faces: any): void {
    if (!faces || typeof faces.length !== 'number') return
    for (let i = 0; i + 2 < faces.length; i += 3) {
        const temp = faces[i + 1]
        faces[i + 1] = faces[i + 2]
        faces[i + 2] = temp
    }
}

function isVectorLike(value: any, minLength: number): value is ArrayLike<number> & { [index: number]: number } {
    const length = Number(value?.length)
    return (
        (Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))) &&
        Number.isFinite(length) &&
        length >= minLength
    )
}

function mirrorAbsoluteVec3(value: any, pivot: [number, number, number], scale: [number, number, number]): void {
    if (!isVectorLike(value, 3)) return
    value[0] = pivot[0] + (Number(value[0]) - pivot[0]) * scale[0]
    value[1] = pivot[1] + (Number(value[1]) - pivot[1]) * scale[1]
    value[2] = pivot[2] + (Number(value[2]) - pivot[2]) * scale[2]
}

function mirrorAbsoluteVec3Once(
    value: any,
    pivot: [number, number, number],
    scale: [number, number, number],
    transformed: Set<any>,
): void {
    if (!isVectorLike(value, 3) || transformed.has(value)) return
    mirrorAbsoluteVec3(value, pivot, scale)
    transformed.add(value)
}

function mirrorRelativeVec3(value: any, scale: [number, number, number]): void {
    if (!isVectorLike(value, 3)) return
    value[0] = Number(value[0]) * scale[0]
    value[1] = Number(value[1]) * scale[1]
    value[2] = Number(value[2]) * scale[2]
}

function mirrorVec3Track(track: any, scale: [number, number, number]): void {
    if (!track || !Array.isArray(track.Keys)) return
    track.Keys.forEach((key: any) => {
        mirrorRelativeVec3(key?.Vector, scale)
        mirrorRelativeVec3(key?.InTan, scale)
        mirrorRelativeVec3(key?.OutTan, scale)
    })
}

function mirrorQuatValue(value: any, scale: [number, number, number]): void {
    if (!isVectorLike(value, 4)) return

    const source = quat.fromValues(Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3]))
    if (![source[0], source[1], source[2], source[3]].every(Number.isFinite)) return

    const rotationMatrix = mat3.create()
    const mirrorMatrix = mat3.fromValues(
        scale[0], 0, 0,
        0, scale[1], 0,
        0, 0, scale[2],
    )
    const mirrored = mat3.create()
    mat3.fromQuat(rotationMatrix, source)
    mat3.multiply(mirrored, mirrorMatrix, rotationMatrix)
    mat3.multiply(mirrored, mirrored, mirrorMatrix)

    const next = quat.create()
    quat.fromMat3(next, mirrored)
    quat.normalize(next, next)
    value[0] = next[0]
    value[1] = next[1]
    value[2] = next[2]
    value[3] = next[3]
}

function mirrorQuatTrack(track: any, scale: [number, number, number]): void {
    if (!track || !Array.isArray(track.Keys)) return
    track.Keys.forEach((key: any) => {
        mirrorQuatValue(key?.Vector, scale)
        mirrorQuatValue(key?.InTan, scale)
        mirrorQuatValue(key?.OutTan, scale)
    })
}

function mirrorFlatVec3Array(values: any, scale: [number, number, number], pivot?: [number, number, number]): void {
    if (!isVectorLike(values, 3)) return
    const firstValue = (values as any)[0]
    if (Array.isArray(firstValue) || (ArrayBuffer.isView(firstValue) && !(firstValue instanceof DataView))) {
        for (let i = 0; i < values.length; i++) {
            const value = (values as any)[i]
            if (pivot) {
                mirrorAbsoluteVec3(value, pivot, scale)
            } else {
                mirrorRelativeVec3(value, scale)
            }
        }
        return
    }
    for (let i = 0; i + 2 < values.length; i += 3) {
        if (pivot) {
            values[i] = pivot[0] + (Number(values[i]) - pivot[0]) * scale[0]
            values[i + 1] = pivot[1] + (Number(values[i + 1]) - pivot[1]) * scale[1]
            values[i + 2] = pivot[2] + (Number(values[i + 2]) - pivot[2]) * scale[2]
        } else {
            values[i] = Number(values[i]) * scale[0]
            values[i + 1] = Number(values[i + 1]) * scale[1]
            values[i + 2] = Number(values[i + 2]) * scale[2]
        }
    }
}

function normalizeFlatVec3Array(values: any): void {
    if (!isVectorLike(values, 3)) return
    const v = vec3.create()
    for (let i = 0; i + 2 < values.length; i += 3) {
        vec3.set(v, Number(values[i]), Number(values[i + 1]), Number(values[i + 2]))
        if (![v[0], v[1], v[2]].every(Number.isFinite)) continue
        vec3.normalize(v, v)
        values[i] = v[0]
        values[i + 1] = v[1]
        values[i + 2] = v[2]
    }
}

function mirrorTangents(tangents: any, scale: [number, number, number]): void {
    if (!isVectorLike(tangents, 4)) return
    const handednessScale = getScaleDeterminantSign(scale)
    const t = vec3.create()
    for (let i = 0; i + 3 < tangents.length; i += 4) {
        vec3.set(t, Number(tangents[i]) * scale[0], Number(tangents[i + 1]) * scale[1], Number(tangents[i + 2]) * scale[2])
        if ([t[0], t[1], t[2]].every(Number.isFinite)) {
            vec3.normalize(t, t)
            tangents[i] = t[0]
            tangents[i + 1] = t[1]
            tangents[i + 2] = t[2]
        }
        tangents[i + 3] = Number(tangents[i + 3]) * handednessScale
    }
}

function mirrorExtentFields(obj: any, pivot: [number, number, number], scale: [number, number, number]): void {
    if (!obj || typeof obj !== 'object') return
    const min = obj.MinimumExtent
    const max = obj.MaximumExtent
    if (!isVectorLike(min, 3) || !isVectorLike(max, 3)) return

    const nextMin: [number, number, number] = [Infinity, Infinity, Infinity]
    const nextMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    const corners: [number, number, number][] = [
        [Number(min[0]), Number(min[1]), Number(min[2])],
        [Number(max[0]), Number(min[1]), Number(min[2])],
        [Number(min[0]), Number(max[1]), Number(min[2])],
        [Number(min[0]), Number(min[1]), Number(max[2])],
        [Number(max[0]), Number(max[1]), Number(min[2])],
        [Number(max[0]), Number(min[1]), Number(max[2])],
        [Number(min[0]), Number(max[1]), Number(max[2])],
        [Number(max[0]), Number(max[1]), Number(max[2])],
    ]

    for (const corner of corners) {
        mirrorAbsoluteVec3(corner, pivot, scale)
        for (let i = 0; i < 3; i++) {
            nextMin[i] = Math.min(nextMin[i], corner[i])
            nextMax[i] = Math.max(nextMax[i], corner[i])
        }
    }

    if (nextMin.every(Number.isFinite) && nextMax.every(Number.isFinite)) {
        min[0] = nextMin[0]
        min[1] = nextMin[1]
        min[2] = nextMin[2]
        max[0] = nextMax[0]
        max[1] = nextMax[1]
        max[2] = nextMax[2]
    }
}

function forEachRawObjectNode(modelData: any, callback: (node: any) => void): void {
    const groups = [
        modelData?.Bones,
        modelData?.Helpers,
        modelData?.Attachments,
        modelData?.Lights,
        modelData?.ParticleEmitters,
        modelData?.ParticleEmitters2,
        modelData?.ParticleEmitterPopcorns,
        modelData?.RibbonEmitters,
        modelData?.EventObjects,
        modelData?.CollisionShapes,
    ].filter(Array.isArray) as any[][]
    const seen = new Set<any>()
    groups.forEach((group) => group.forEach((node) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        callback(node)
    }))
}

function bakeMirrorIntoModelData(
    modelData: any,
    scale: [number, number, number],
    pivot: [number, number, number],
): void {
    const shouldReverseWinding = getScaleDeterminantSign(scale) < 0
    const transformedAbsolute = new Set<any>()

    if (Array.isArray(modelData?.PivotPoints)) {
        modelData.PivotPoints.forEach((point: any) => mirrorAbsoluteVec3Once(point, pivot, scale, transformedAbsolute))
    }

    mirrorExtentFields(modelData, pivot, scale)
    mirrorExtentFields(modelData?.Info, pivot, scale)
    if (Array.isArray(modelData?.Sequences)) {
        modelData.Sequences.forEach((sequence: any) => mirrorExtentFields(sequence, pivot, scale))
    }

    if (Array.isArray(modelData?.Geosets)) {
        modelData.Geosets.forEach((geoset: any) => {
            mirrorFlatVec3Array(geoset?.Vertices, scale, pivot)
            mirrorFlatVec3Array(geoset?.Normals, scale)
            normalizeFlatVec3Array(geoset?.Normals)
            mirrorTangents(geoset?.Tangents, scale)
            if (shouldReverseWinding) reverseTriangleWinding(geoset?.Faces)
            mirrorExtentFields(geoset, pivot, scale)
            if (Array.isArray(geoset?.Anims)) {
                geoset.Anims.forEach((anim: any) => mirrorExtentFields(anim, pivot, scale))
            }
        })
    }

    forEachRawObjectNode(modelData, (node) => {
        mirrorAbsoluteVec3Once(node.PivotPoint, pivot, scale, transformedAbsolute)
        mirrorVec3Track(node.Translation, scale)
        mirrorQuatTrack(node.Rotation, scale)
    })

    if (Array.isArray(modelData?.Cameras)) {
        modelData.Cameras.forEach((camera: any) => {
            mirrorAbsoluteVec3(camera?.Position, pivot, scale)
            mirrorAbsoluteVec3(camera?.TargetPosition, pivot, scale)
            mirrorVec3Track(camera?.Translation, scale)
            mirrorVec3Track(camera?.TargetTranslation, scale)
        })
    }

    if (Array.isArray(modelData?.CollisionShapes)) {
        modelData.CollisionShapes.forEach((shape: any) => {
            mirrorAbsoluteVec3(shape?.Vertex1, pivot, scale)
            mirrorAbsoluteVec3(shape?.Vertex2, pivot, scale)
            mirrorFlatVec3Array(shape?.Vertices, scale, pivot)
        })
    }

    calculateModelExtent(modelData)
}

function buildMirroredSnapshot(axis: MirrorAxis): Snapshot | null {
    const state = useModelStore.getState()
    if (!state.modelData) {
        return null
    }

    const sourceModelData = cloneDeep(state.modelData)
    const pivot = WORLD_ORIGIN
    const requestedScale = getMirrorScale(axis)
    const unwrappedMirrorRoots = unwrapExistingMirrorRoots(cloneDeep(state.nodes))
    const scale = combineScale(unwrappedMirrorRoots.scale, requestedScale)
    const nextNodes = unwrappedMirrorRoots.nodes

    const nextModelData = updateModelDataWithNodes(sourceModelData, nextNodes, false)
    if (!nextModelData) {
        return null
    }

    bakeMirrorIntoModelData(nextModelData, scale, pivot)

    ;(nextModelData as any).__forceFullReload = true

    return {
        modelData: nextModelData,
        nodes: extractNodesFromModel(nextModelData),
        trackerRotation: [...state.globalTransformTracker.rotation] as [number, number, number]
    }
}

export class MirrorModelCommand implements Command {
    name: string

    private before: Snapshot | null
    private after: Snapshot | null

    constructor(axis: MirrorAxis) {
        const state = useModelStore.getState()
        this.name = axis === 'z' ? 'Mirror Model Vertical' : 'Mirror Model Horizontal'
        this.before = state.modelData ? {
            modelData: cloneDeep(state.modelData),
            nodes: cloneDeep(state.nodes),
            trackerRotation: [...state.globalTransformTracker.rotation] as [number, number, number]
        } : null
        this.after = buildMirroredSnapshot(axis)
    }

    execute(): void {
        this.apply(this.after)
    }

    undo(): void {
        this.apply(this.before)
    }

    private apply(snapshot: Snapshot | null): void {
        if (!snapshot) return

        modelDocumentCommandHandler.replaceDocumentSnapshot({
            name: this.name,
            before: null,
            after: {
                modelData: cloneDeep(snapshot.modelData),
                nodes: cloneDeep(snapshot.nodes),
                globalTransformTracker: {
                    rotation: [...snapshot.trackerRotation] as [number, number, number]
                },
            },
            options: { recordHistory: false },
            applyOptions: { rendererReload: true },
        })
    }
}
