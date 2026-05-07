import { mat4, vec3 } from 'gl-matrix'

type ScaleTuple = [number, number, number]

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

function hasNonIdentityScale(value: ScaleTuple, epsilon = 1e-6): boolean {
    return value.some((item, index) => Math.abs(item - 1) > epsilon)
}

function getRawNodeGroups(modelData: any): any[][] {
    return [
        modelData?.Nodes,
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

function transformVectorValue(value: any, matrix: mat4, transformed: Set<any>) {
    if (!isVectorLike(value, 3) || transformed.has(value)) return

    const v = vec3.fromValues(Number(value[0]), Number(value[1]), Number(value[2]))
    if (![v[0], v[1], v[2]].every(Number.isFinite)) return

    vec3.transformMat4(v, v, matrix)
    value[0] = v[0]
    value[1] = v[1]
    value[2] = v[2]
    transformed.add(value)
}

function transformTranslationTrack(track: any, matrix: mat4, transformed: Set<any>) {
    if (!isAnimTrack(track)) return

    for (const key of track.Keys) {
        if (!key || typeof key !== 'object') continue
        transformVectorValue(key.Vector, matrix, transformed)
        transformVectorValue(key.InTan, matrix, transformed)
        transformVectorValue(key.OutTan, matrix, transformed)
    }
}

export function scaleRawNodeTranslationTracksForBakedScale(modelData: any, scale: ScaleTuple) {
    if (!hasNonIdentityScale(scale)) return

    const matrix = mat4.create()
    mat4.scale(matrix, matrix, scale)

    const transformed = new Set<any>()
    const seenNodes = new Set<any>()

    for (const group of getRawNodeGroups(modelData)) {
        for (const node of group) {
            if (!node || typeof node !== 'object' || seenNodes.has(node)) continue
            if (typeof node.ObjectId !== 'number' || !Number.isFinite(node.ObjectId)) continue

            seenNodes.add(node)
            transformTranslationTrack(node.Translation, matrix, transformed)
        }
    }
}
