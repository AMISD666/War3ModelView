import { mat3, mat4, quat, vec3 } from 'gl-matrix'
import { useModelStore, extractNodesFromModel } from '../store/modelStore'
import { ModelNode } from '../types/node'
import { Command } from '../utils/CommandManager'
import { validateDocumentReferencesAfterCommand } from '../application/commands/CommandIntegrityGuard'
import { pivotVec3ToTuple } from '../utils/modelUtils'
import { calculateModelExtent } from '../utils/geometryUtils'
import { scaleRawNodeTranslationTracksForBakedScale } from './GlobalTransformNodeTracks'

type TransformOps = {
    translation: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
}

type Snapshot = {
    modelData: any
    nodes: ModelNode[]
    trackerRotation: [number, number, number]
}

const GLOBAL_TRANSFORM_ROOT_NAME = '__WMV_GLOBAL_TRANSFORM_ROOT__'

function cloneDeep<T>(value: T): T {
    const sc = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone
    if (typeof sc === 'function') {
        return sc(value)
    }
    return JSON.parse(JSON.stringify(value))
}

function hasNonZeroVec3(value: [number, number, number], epsilon = 1e-6): boolean {
    return value.some((item) => Math.abs(item) > epsilon)
}

function hasNonIdentityScale(value: [number, number, number], epsilon = 1e-6): boolean {
    return value.some((item, index) => Math.abs(item - 1) > epsilon)
}

function isAnimTrack(value: any): boolean {
    return value && typeof value === 'object' && Array.isArray(value.Keys)
}

function isVectorLike(value: any, minLength = 1): value is { length: number; [index: number]: number } {
    if (!(Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView)))) {
        return false
    }
    const arrayLike = value as { length?: number }
    return typeof arrayLike.length === 'number' && arrayLike.length >= minLength
}

function scaleNumericValue(value: any, factor: number): any {
    if (typeof value === 'number') {
        return value * factor
    }

    if (isVectorLike(value, 1)) {
        for (let i = 0; i < value.length; i++) {
            const num = Number(value[i])
            if (Number.isFinite(num)) {
                value[i] = num * factor
            }
        }
    }

    return value
}

function scaleScalarTrack(track: any, factor: number) {
    if (!isAnimTrack(track)) return

    for (const key of track.Keys) {
        if (!key || typeof key !== 'object') continue
        key.Vector = scaleNumericValue(key.Vector, factor)
        key.InTan = scaleNumericValue(key.InTan, factor)
        key.OutTan = scaleNumericValue(key.OutTan, factor)
    }
}

function scaleScalarProperty(obj: any, prop: string, factor: number) {
    if (!obj || !(prop in obj)) return

    if (isAnimTrack(obj[prop])) {
        scaleScalarTrack(obj[prop], factor)
        return
    }

    obj[prop] = scaleNumericValue(obj[prop], factor)
}

function scaleScalarPropertyWithAnim(obj: any, prop: string, animProp: string | null, factor: number) {
    if (!obj) return

    const propValue = obj[prop]
    scaleScalarProperty(obj, prop, factor)

    if (!animProp || !(animProp in obj)) return
    if (propValue && typeof propValue === 'object' && obj[animProp] === propValue) return

    scaleScalarProperty(obj, animProp, factor)
}

type BakedTransformContext = {
    positionMatrix: mat4
    vectorMatrix: mat4
    normalMatrix: mat3
    radiusScale: number
}

function makeBakedTransformContext(
    ops: TransformOps,
    pivot: [number, number, number]
): BakedTransformContext {
    const rotationQuat = quat.create()
    quat.fromEuler(rotationQuat, ops.rotation[0], ops.rotation[1], ops.rotation[2])

    const rotScale = mat4.create()
    mat4.fromRotationTranslationScale(rotScale, rotationQuat, [0, 0, 0], ops.scale)

    const positionMatrix = mat4.create()
    mat4.translate(positionMatrix, positionMatrix, ops.translation)
    mat4.translate(positionMatrix, positionMatrix, pivot)
    mat4.multiply(positionMatrix, positionMatrix, rotScale)
    mat4.translate(positionMatrix, positionMatrix, [-pivot[0], -pivot[1], -pivot[2]])

    const normalMatrix = mat3.create()
    if (!mat3.normalFromMat4(normalMatrix, rotScale)) {
        mat3.identity(normalMatrix)
    }

    const rawRadiusScale = Math.max(Math.abs(ops.scale[0]), Math.abs(ops.scale[1]), Math.abs(ops.scale[2]))

    return {
        positionMatrix,
        vectorMatrix: rotScale,
        normalMatrix,
        radiusScale: Number.isFinite(rawRadiusScale) ? rawRadiusScale : 1,
    }
}

function transformPositionValue(value: any, ctx: BakedTransformContext, transformed: Set<any>) {
    if (!isVectorLike(value, 3)) return
    if (transformed.has(value)) return

    const v = vec3.fromValues(Number(value[0]), Number(value[1]), Number(value[2]))
    if (![v[0], v[1], v[2]].every(Number.isFinite)) return

    vec3.transformMat4(v, v, ctx.positionMatrix)
    value[0] = v[0]
    value[1] = v[1]
    value[2] = v[2]
    transformed.add(value)
}

function transformVectorValue(value: any, ctx: BakedTransformContext, transformed: Set<any>) {
    if (!isVectorLike(value, 3)) return
    if (transformed.has(value)) return

    const v = vec3.fromValues(Number(value[0]), Number(value[1]), Number(value[2]))
    if (![v[0], v[1], v[2]].every(Number.isFinite)) return

    vec3.transformMat4(v, v, ctx.vectorMatrix)
    value[0] = v[0]
    value[1] = v[1]
    value[2] = v[2]
    transformed.add(value)
}

function transformFlatPositionArray(values: any, ctx: BakedTransformContext, transformed: Set<any>) {
    if (!isVectorLike(values, 3)) return
    if (transformed.has(values)) return

    const v = vec3.create()
    for (let i = 0; i + 2 < values.length; i += 3) {
        vec3.set(v, Number(values[i]), Number(values[i + 1]), Number(values[i + 2]))
        if (![v[0], v[1], v[2]].every(Number.isFinite)) continue

        vec3.transformMat4(v, v, ctx.positionMatrix)
        values[i] = v[0]
        values[i + 1] = v[1]
        values[i + 2] = v[2]
    }

    transformed.add(values)
}

function transformFlatNormalArray(values: any, ctx: BakedTransformContext, transformed: Set<any>) {
    if (!isVectorLike(values, 3)) return
    if (transformed.has(values)) return

    const n = vec3.create()
    for (let i = 0; i + 2 < values.length; i += 3) {
        vec3.set(n, Number(values[i]), Number(values[i + 1]), Number(values[i + 2]))
        if (![n[0], n[1], n[2]].every(Number.isFinite)) continue

        vec3.transformMat3(n, n, ctx.normalMatrix)
        vec3.normalize(n, n)
        values[i] = n[0]
        values[i + 1] = n[1]
        values[i + 2] = n[2]
    }

    transformed.add(values)
}

function transformVec3Track(track: any, ctx: BakedTransformContext, transformed: Set<any>) {
    if (!isAnimTrack(track)) return

    for (const key of track.Keys) {
        if (!key || typeof key !== 'object') continue
        transformVectorValue(key.Vector, ctx, transformed)
        transformVectorValue(key.InTan, ctx, transformed)
        transformVectorValue(key.OutTan, ctx, transformed)
    }
}

function transformQuatValue(value: any, rotation: quat, inverseRotation: quat, transformed: Set<any>) {
    if (!isVectorLike(value, 4)) return
    if (transformed.has(value)) return

    const source = quat.fromValues(Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3]))
    if (![source[0], source[1], source[2], source[3]].every(Number.isFinite)) return

    const rotated = quat.create()
    const next = quat.create()
    quat.multiply(rotated, rotation, source)
    quat.multiply(next, rotated, inverseRotation)
    value[0] = next[0]
    value[1] = next[1]
    value[2] = next[2]
    value[3] = next[3]
    transformed.add(value)
}

function transformQuatTrack(track: any, rotation: quat, inverseRotation: quat, transformed: Set<any>) {
    if (!isAnimTrack(track)) return

    for (const key of track.Keys) {
        if (!key || typeof key !== 'object') continue
        transformQuatValue(key.Vector, rotation, inverseRotation, transformed)
        transformQuatValue(key.InTan, rotation, inverseRotation, transformed)
        transformQuatValue(key.OutTan, rotation, inverseRotation, transformed)
    }
}

function transformExtentFields(obj: any, ctx: BakedTransformContext, transformed: Set<any>) {
    if (!obj || typeof obj !== 'object') return

    const min = obj.MinimumExtent
    const max = obj.MaximumExtent
    if (isVectorLike(min, 3) && isVectorLike(max, 3) && !transformed.has(min) && !transformed.has(max)) {
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
        const v = vec3.create()
        let minX = Infinity, minY = Infinity, minZ = Infinity
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

        for (const corner of corners) {
            if (!corner.every(Number.isFinite)) continue
            vec3.set(v, corner[0], corner[1], corner[2])
            vec3.transformMat4(v, v, ctx.positionMatrix)
            minX = Math.min(minX, v[0])
            minY = Math.min(minY, v[1])
            minZ = Math.min(minZ, v[2])
            maxX = Math.max(maxX, v[0])
            maxY = Math.max(maxY, v[1])
            maxZ = Math.max(maxZ, v[2])
        }

        if ([minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
            min[0] = minX
            min[1] = minY
            min[2] = minZ
            max[0] = maxX
            max[1] = maxY
            max[2] = maxZ
            transformed.add(min)
            transformed.add(max)
        }
    } else {
        transformPositionValue(min, ctx, transformed)
        transformPositionValue(max, ctx, transformed)
    }

    if (typeof obj.BoundsRadius === 'number' && Number.isFinite(obj.BoundsRadius)) {
        obj.BoundsRadius *= ctx.radiusScale
    }
}

function transformCollisionShapeFields(shape: any, ctx: BakedTransformContext, transformedAbsolute: Set<any>) {
    if (!shape || typeof shape !== 'object') return

    transformPositionValue(shape.Vertex1, ctx, transformedAbsolute)
    transformPositionValue(shape.Vertex2, ctx, transformedAbsolute)

    const vertices = shape.Vertices
    if (isVectorLike(vertices, 3) && typeof vertices[0] === 'number') {
        transformFlatPositionArray(vertices, ctx, transformedAbsolute)
    } else if (Array.isArray(vertices)) {
        for (const vertex of vertices) {
            transformPositionValue(vertex, ctx, transformedAbsolute)
        }
    }

    if (typeof shape.BoundsRadius === 'number' && Number.isFinite(shape.BoundsRadius)) {
        shape.BoundsRadius *= ctx.radiusScale
    }
}

function transformCameraFields(
    camera: any,
    ctx: BakedTransformContext,
    transformedAbsolute: Set<any>,
    transformedRelative: Set<any>,
    options: { includePivot?: boolean } = {}
) {
    if (!camera || typeof camera !== 'object') return

    if (options.includePivot !== false) {
        transformPositionValue(camera.PivotPoint, ctx, transformedAbsolute)
    }
    transformPositionValue(camera.Position, ctx, transformedAbsolute)
    transformPositionValue(camera.TargetPosition, ctx, transformedAbsolute)
    transformVec3Track(camera.Translation, ctx, transformedRelative)
    transformVec3Track(camera.TargetTranslation, ctx, transformedRelative)
}

function scaleRawNodeParametersForBakedScale(modelData: any, factor: number) {
    if (Array.isArray(modelData?.ParticleEmitters2)) {
        for (const emitter of modelData.ParticleEmitters2) {
            scaleScalarPropertyWithAnim(emitter, 'Speed', 'SpeedAnim', factor)
            scaleScalarPropertyWithAnim(emitter, 'Width', 'WidthAnim', factor)
            scaleScalarPropertyWithAnim(emitter, 'Length', 'LengthAnim', factor)
            scaleScalarPropertyWithAnim(emitter, 'Gravity', 'GravityAnim', factor)
            scaleScalarProperty(emitter, 'ParticleScaling', factor)
        }
    }

    if (Array.isArray(modelData?.ParticleEmitters)) {
        for (const emitter of modelData.ParticleEmitters) {
            scaleScalarProperty(emitter, 'InitVelocity', factor)
            scaleScalarProperty(emitter, 'InitialVelocity', factor)
            scaleScalarProperty(emitter, 'Gravity', factor)
        }
    }

    if (Array.isArray(modelData?.RibbonEmitters)) {
        for (const emitter of modelData.RibbonEmitters) {
            scaleScalarProperty(emitter, 'HeightAbove', factor)
            scaleScalarProperty(emitter, 'HeightBelow', factor)
            scaleScalarProperty(emitter, 'Gravity', factor)
        }
    }

    if (Array.isArray(modelData?.ParticleEmitterPopcorns)) {
        for (const emitter of modelData.ParticleEmitterPopcorns) {
            scaleScalarPropertyWithAnim(emitter, 'Speed', 'SpeedAnim', factor)
        }
    }

    if (Array.isArray(modelData?.Lights)) {
        for (const light of modelData.Lights) {
            scaleScalarPropertyWithAnim(light, 'AttenuationStart', 'AttenuationStartAnim', factor)
            scaleScalarPropertyWithAnim(light, 'AttenuationEnd', 'AttenuationEndAnim', factor)
        }
    }
}

function getRawNodeGroups(modelData: any): any[][] {
    return [
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
}

function transformPivotPointsPreservingIds(modelData: any, ctx: BakedTransformContext) {
    const pivotPoints = Array.isArray(modelData?.PivotPoints) ? modelData.PivotPoints : null
    const transformedById = new Map<number, [number, number, number]>()

    if (pivotPoints) {
        modelData.PivotPoints = pivotPoints.map((pivotPoint: unknown, objectId: number) => {
            const source = pivotVec3ToTuple(pivotPoint) ?? [0, 0, 0]
            const transformed = [...source] as [number, number, number]
            transformPositionValue(transformed, ctx, new Set<any>())
            transformedById.set(objectId, transformed)
            return new Float32Array(transformed)
        })
    }

    for (const group of getRawNodeGroups(modelData)) {
        for (const node of group) {
            if (!node || typeof node !== 'object') continue
            const objectId = typeof node.ObjectId === 'number' ? node.ObjectId : -1
            const fromTable = objectId >= 0 ? transformedById.get(objectId) : undefined
            if (fromTable) {
                node.PivotPoint = new Float32Array(fromTable)
                continue
            }

            const source = pivotVec3ToTuple(node.PivotPoint)
            if (!source) continue
            const transformed = [...source] as [number, number, number]
            transformPositionValue(transformed, ctx, new Set<any>())
            node.PivotPoint = new Float32Array(transformed)
        }
    }
}

function forEachRawObjectNode(modelData: any, callback: (node: any) => void) {
    const seen = new Set<any>()
    const visit = (node: any) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        if (typeof node.ObjectId !== 'number' || !Number.isFinite(node.ObjectId)) return
        seen.add(node)
        callback(node)
    }

    for (const group of getRawNodeGroups(modelData)) {
        for (const node of group) visit(node)
    }
    if (Array.isArray(modelData?.Nodes)) {
        for (const node of modelData.Nodes) visit(node)
    }
}

function readStaticVec3Track(track: any): [number, number, number] | null {
    if (!isAnimTrack(track) || track.Keys.length === 0) return null

    const first = track.Keys[0]?.Vector
    if (!isVectorLike(first, 3)) return null

    const value: [number, number, number] = [Number(first[0]), Number(first[1]), Number(first[2])]
    if (!value.every(Number.isFinite)) return null

    for (const key of track.Keys) {
        const vector = key?.Vector
        if (!isVectorLike(vector, 3)) return null
        for (let i = 0; i < 3; i++) {
            const num = Number(vector[i])
            if (!Number.isFinite(num) || Math.abs(num - value[i]) > 1e-5) {
                return null
            }
        }
    }

    return value
}

function isStaticIdentityQuatTrack(track: any): boolean {
    if (track === undefined || track === null) return true
    if (!isAnimTrack(track)) return false

    for (const key of track.Keys) {
        const vector = key?.Vector
        if (!isVectorLike(vector, 4)) return false
        const x = Number(vector[0])
        const y = Number(vector[1])
        const z = Number(vector[2])
        const w = Number(vector[3])
        if (![x, y, z, w].every(Number.isFinite)) return false
        if (Math.abs(x) > 1e-5 || Math.abs(y) > 1e-5 || Math.abs(z) > 1e-5 || Math.abs(w - 1) > 1e-5) {
            return false
        }
    }

    return true
}

function flattenLegacyGlobalTranslationRoot(modelData: any) {
    const roots: any[] = []
    forEachRawObjectNode(modelData, (node) => {
        if (node.Name === GLOBAL_TRANSFORM_ROOT_NAME) {
            roots.push(node)
        }
    })
    const root = roots[0] ?? null
    if (!root || typeof root.ObjectId !== 'number') return

    const translation = readStaticVec3Track(root.Translation)
    const scaling = readStaticVec3Track(root.Scaling)
    if (
        !translation ||
        !isStaticIdentityQuatTrack(root.Rotation) ||
        (scaling && hasNonIdentityScale(scaling))
    ) {
        return
    }

    const rootParent = typeof root.Parent === 'number' ? root.Parent : -1
    const rootPivot = pivotVec3ToTuple(root.PivotPoint) ?? [0, 0, 0]

    bakePlacementIntoModelDataPreservingNodes(modelData, translation, [0, 0, 0], rootPivot)

    forEachRawObjectNode(modelData, (node) => {
        if (node !== root && node.Parent === root.ObjectId) {
            node.Parent = rootParent
        }
        if (node.ObjectId === root.ObjectId && node.Name === GLOBAL_TRANSFORM_ROOT_NAME) {
            delete node.Translation
            delete node.Rotation
            delete node.Scaling
        }
    })
}

function bakeScaleOnlyIntoModelDataPreservingNodes(
    modelData: any,
    scale: [number, number, number],
    pivot: [number, number, number]
) {
    if (!hasNonIdentityScale(scale)) return

    const ctx = makeBakedTransformContext({
        translation: [0, 0, 0],
        rotation: [0, 0, 0],
        scale,
    }, pivot)
    const transformedAbsolute = new Set<any>()
    const transformedRelative = new Set<any>()

    transformPivotPointsPreservingIds(modelData, ctx)
    transformExtentFields(modelData, ctx, transformedAbsolute)
    transformExtentFields(modelData?.Info, ctx, transformedAbsolute)

    if (Array.isArray(modelData?.Sequences)) {
        for (const sequence of modelData.Sequences) {
            transformExtentFields(sequence, ctx, transformedAbsolute)
        }
    }

    if (Array.isArray(modelData?.Geosets)) {
        for (const geoset of modelData.Geosets) {
            transformFlatPositionArray(geoset?.Vertices, ctx, transformedAbsolute)
            transformFlatNormalArray(geoset?.Normals, ctx, transformedRelative)
            transformExtentFields(geoset, ctx, transformedAbsolute)

            if (Array.isArray(geoset?.Anims)) {
                for (const anim of geoset.Anims) {
                    transformExtentFields(anim, ctx, transformedAbsolute)
                }
            }
        }
    }

    if (Array.isArray(modelData?.Cameras)) {
        for (const camera of modelData.Cameras) {
            transformCameraFields(camera, ctx, transformedAbsolute, transformedRelative, { includePivot: false })
        }
    }

    if (Array.isArray(modelData?.CollisionShapes)) {
        for (const shape of modelData.CollisionShapes) {
            transformCollisionShapeFields(shape, ctx, transformedAbsolute)
        }
    }

    scaleRawNodeTranslationTracksForBakedScale(modelData, scale)
    scaleRawNodeParametersForBakedScale(modelData, ctx.radiusScale)
    calculateModelExtent(modelData)
}

function bakePlacementIntoModelDataPreservingNodes(
    modelData: any,
    translation: [number, number, number],
    rotation: [number, number, number],
    pivot: [number, number, number]
) {
    if (!hasNonZeroVec3(translation) && !hasNonZeroVec3(rotation)) return

    const ctx = makeBakedTransformContext({
        translation,
        rotation,
        scale: [1, 1, 1],
    }, pivot)
    const transformedAbsolute = new Set<any>()
    const transformedRelative = new Set<any>()
    const transformedQuats = new Set<any>()
    const hasRotation = hasNonZeroVec3(rotation)

    transformPivotPointsPreservingIds(modelData, ctx)
    transformExtentFields(modelData, ctx, transformedAbsolute)
    transformExtentFields(modelData?.Info, ctx, transformedAbsolute)

    if (Array.isArray(modelData?.Sequences)) {
        for (const sequence of modelData.Sequences) {
            transformExtentFields(sequence, ctx, transformedAbsolute)
        }
    }

    if (Array.isArray(modelData?.Geosets)) {
        for (const geoset of modelData.Geosets) {
            transformFlatPositionArray(geoset?.Vertices, ctx, transformedAbsolute)
            transformFlatNormalArray(geoset?.Normals, ctx, transformedRelative)
            transformExtentFields(geoset, ctx, transformedAbsolute)

            if (Array.isArray(geoset?.Anims)) {
                for (const anim of geoset.Anims) {
                    transformExtentFields(anim, ctx, transformedAbsolute)
                }
            }
        }
    }

    if (hasRotation) {
        const rotationQuat = quat.create()
        const inverseRotationQuat = quat.create()
        quat.fromEuler(rotationQuat, rotation[0], rotation[1], rotation[2])
        quat.invert(inverseRotationQuat, rotationQuat)

        forEachRawObjectNode(modelData, (node) => {
            transformVec3Track(node.Translation, ctx, transformedRelative)
            transformQuatTrack(node.Rotation, rotationQuat, inverseRotationQuat, transformedQuats)
        })
    }

    if (Array.isArray(modelData?.Cameras)) {
        for (const camera of modelData.Cameras) {
            transformCameraFields(camera, ctx, transformedAbsolute, transformedRelative, { includePivot: false })
        }
    }

    if (Array.isArray(modelData?.CollisionShapes)) {
        for (const shape of modelData.CollisionShapes) {
            transformCollisionShapeFields(shape, ctx, transformedAbsolute)
        }
    }

    calculateModelExtent(modelData)
}

function composeTrackerRotation(
    current: [number, number, number],
    delta: [number, number, number]
): [number, number, number] {
    if (!hasNonZeroVec3(delta)) return [...current]

    const currentQuat = quat.create()
    quat.fromEuler(currentQuat, current[0], current[1], current[2])

    const deltaQuat = quat.create()
    quat.fromEuler(deltaQuat, delta[0], delta[1], delta[2])

    const nextQuat = quat.create()
    quat.multiply(nextQuat, deltaQuat, currentQuat)

    const x = nextQuat[0], y = nextQuat[1], z = nextQuat[2], w = nextQuat[3]
    const sinrCosp = 2 * (w * x + y * z)
    const cosrCosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinrCosp, cosrCosp)

    const sinp = 2 * (w * y - z * x)
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp)

    const sinyCosp = 2 * (w * z + x * y)
    const cosyCosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(sinyCosp, cosyCosp)

    return [
        roll * 180 / Math.PI,
        pitch * 180 / Math.PI,
        yaw * 180 / Math.PI
    ]
}

export class GlobalTransformCommand implements Command {
    name = 'Global Transform'

    private before: Snapshot | null
    private after: Snapshot | null

    constructor(ops: TransformOps, _renderer?: any | null, pivot?: [number, number, number] | null) {
        const state = useModelStore.getState()
        if (!state.modelData) {
            this.before = null
            this.after = null
            return
        }

        const basePivot: [number, number, number] = pivot
            ? [pivot[0], pivot[1], pivot[2]]
            : [0, 0, 0]

        this.before = {
            modelData: cloneDeep(state.modelData),
            nodes: cloneDeep(state.nodes),
            trackerRotation: [...state.globalTransformTracker.rotation] as [number, number, number]
        }

        const nextModelDataBase = cloneDeep(state.modelData)
        flattenLegacyGlobalTranslationRoot(nextModelDataBase)

        if (hasNonIdentityScale(ops.scale)) {
            bakeScaleOnlyIntoModelDataPreservingNodes(nextModelDataBase, ops.scale, basePivot)
        }

        bakePlacementIntoModelDataPreservingNodes(nextModelDataBase, ops.translation, ops.rotation, basePivot)

        ;(nextModelDataBase as any).__forceFullReload = true

        this.after = {
            modelData: nextModelDataBase,
            nodes: extractNodesFromModel(nextModelDataBase),
            trackerRotation: composeTrackerRotation(this.before.trackerRotation, ops.rotation)
        }
    }

    execute() {
        this.apply(this.after, 'execute')
    }

    undo() {
        this.apply(this.before, 'undo')
    }

    private apply(snapshot: Snapshot | null, phase: 'execute' | 'undo') {
        if (!snapshot) return

        useModelStore.getState().replaceDocumentSnapshot(snapshot.modelData, {
            nodes: snapshot.nodes,
            globalTransformTracker: {
                rotation: [...snapshot.trackerRotation] as [number, number, number]
            },
            rendererReload: true,
        })
        validateDocumentReferencesAfterCommand(this.name, phase)
    }
}
