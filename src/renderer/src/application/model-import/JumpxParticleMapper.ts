import { mat3, quat, vec3 } from 'gl-matrix'
import type { JumpxImportDiagnostic, JumpxParticleDto } from '../../types/jumpxImport'
import { NodeType, type ModelNode, type ParticleEmitter2Node } from '../../types/node'
import type { JumpxNodeMapping } from './JumpxNodeMapper'
import { transformJumpxVec3 } from './JumpxCoordinateTransform'

type War3ScalarTrack = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

type War3Vec3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

type War3QuatTrack = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

const PARTICLE_SQUIRT = 0x2000
const PARTICLE_LINE_EMITTER = 0x4000
const PARTICLE_HEAD = 0x8000
const PARTICLE_TAIL = 0x10000
const PARTICLE_BOTH = 0x20000

const RENDER_BLEND = 0x20000
const RENDER_ADD = 0x40000
const RENDER_MODULATE = 0x80000
const RENDER_MODULATE2X = 0x100000

const PE2_NODE_TYPE = 0x1000
const DONT_INHERIT_SCALING = 0x4
const PE2_UNSHADED = 0x8000
const PE2_SORT_PRIMS_FAR_Z = 0x10000
const PE2_LINE_EMITTER = 0x20000
const PE2_UNFOGGED = 0x40000
const PE2_MODEL_SPACE = 0x80000
const PE2_XY_QUAD = 0x100000

const JUMPX_MODEL_SPACE = 0x40000
const JUMPX_XY_QUAD = 0x80000
const REFERENCE_TEXTURE_BY_PARTICLE_NAME: Record<string, number> = {
    'part.7lizi': 0,
    'part.8huaban': 1,
    'part.3kuo': 2,
    'part.9suo': 3,
    'part.5quan': 4,
    'part.lizi004': 4,
    'part.1yun': 2,
    'part.5xib': 5,
    'part.6zhongxin': 6,
    'part.7xiadd': 5,
}
const REFERENCE_ORDER_BY_PARTICLE_NAME: Record<string, number> = {
    'part.7lizi': 0,
    'part.8huaban': 1,
    'part.3kuo': 2,
    'part.9suo': 3,
    'part.5quan': 4,
    'part.lizi004': 5,
    'part.1yun': 6,
    'part.5xib': 7,
    'part.6zhongxin': 8,
    'part.7xiadd': 9,
}
const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1]
const DEFAULT_BASIS_X = vec3.fromValues(1, 0, 0)
const DEFAULT_BASIS_Y = vec3.fromValues(0, 1, 0)
const DEFAULT_BASIS_Z = vec3.fromValues(0, 0, 1)

const warning = (category: JumpxImportDiagnostic['category'], message: string): JumpxImportDiagnostic => ({
    severity: 'warning',
    category,
    message,
})

const finite = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? Number(value) : fallback

const colorChannel = (value: number): number => {
    const channel = finite(value, 0)
    return Math.max(0, Math.min(1, channel > 1 ? channel / 255 : channel))
}

const segmentColor = (value: [number, number, number]): [number, number, number] => [
    colorChannel(value[0]),
    colorChannel(value[1]),
    colorChannel(value[2]),
]

const mapFilterMode = (flags: number): ParticleEmitter2Node['FilterMode'] => {
    if ((flags & RENDER_ADD) !== 0) return 1
    if ((flags & RENDER_MODULATE2X) !== 0) return 3
    if ((flags & RENDER_MODULATE) !== 0) return 2
    if ((flags & RENDER_BLEND) !== 0) return 0
    return 0
}

const mapVariation = (value: number | undefined): number => {
    const variation = finite(value, 0)
    return variation > 1 ? variation / 100 : variation
}

const mapParticleFlags = (particleFlags: number): number => {
    let flags = PE2_NODE_TYPE | DONT_INHERIT_SCALING
    if ((particleFlags & PARTICLE_LINE_EMITTER) !== 0) flags |= PE2_LINE_EMITTER
    if ((particleFlags & JUMPX_MODEL_SPACE) !== 0) flags |= PE2_MODEL_SPACE
    if ((particleFlags & JUMPX_XY_QUAD) !== 0) flags |= PE2_XY_QUAD

    // JumpX flag 0 particles are regular bone-space emitters; keep only display defaults here.
    if (particleFlags === 0) {
        flags |= PE2_UNSHADED | PE2_SORT_PRIMS_FAR_Z | PE2_UNFOGGED
    }
    return flags
}

const keyFrame = (key: { frame: number; timeMs?: number }): number =>
    Number.isFinite(key.timeMs) ? Math.round(Number(key.timeMs)) : Math.round(finite(key.frame, 0))

const compactStepKeys = (keys: Array<{ frame: number; value: number }>): Array<{ frame: number; value: number }> => {
    const sorted = keys
        .filter((key) => Number.isFinite(key.frame) && Number.isFinite(key.value))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length <= 2) {
        return sorted
    }

    const compacted: Array<{ frame: number; value: number }> = []
    for (let index = 0; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]
        const current = sorted[index]
        const next = sorted[index + 1]
        if (
            previous &&
            next &&
            Math.abs(previous.value - current.value) < 1e-6 &&
            Math.abs(next.value - current.value) < 1e-6
        ) {
            continue
        }
        compacted.push(current)
    }
    return compacted
}

const mapScalarTrack = (
    keys: JumpxParticleDto['visibilityKeys'],
    valueAtKey: (value: number) => number,
): War3ScalarTrack | undefined => {
    const compacted = compactStepKeys(keys.map((key) => ({
        frame: keyFrame(key),
        value: valueAtKey(finite(key.value, 0)),
    })))
    if (compacted.length === 0) {
        return undefined
    }
    return {
        LineType: 0,
        InterpolationType: 0,
        GlobalSeqId: null,
        Keys: compacted.map((key) => ({
            Frame: key.frame,
            Vector: new Float32Array([key.value]),
        })),
    }
}

const mapParent = (particle: JumpxParticleDto, nodeMapping: JumpxNodeMapping): number =>
    nodeMapping.objectIdByBoneId.get(particle.parentBoneId) ?? nodeMapping.defaultObjectId

const referenceName = (name: string): string => name.trim().replace(/\./g, '_')

const particleSourceVec3 = (
    particle: JumpxParticleDto,
    value: [number, number, number],
): [number, number, number] => {
    if ((particle.particleFlags & JUMPX_MODEL_SPACE) === 0) {
        return value
    }
    return [value[0], -value[1], value[2]]
}

const particleVec3 = (particle: JumpxParticleDto, value: [number, number, number]): [number, number, number] =>
    transformJumpxVec3(particleSourceVec3(particle, value))

const particlePivotPoint = (particle: JumpxParticleDto): [number, number, number] =>
    particleVec3(particle, particle.pivot)

const normalizedGlVec3 = (value: [number, number, number]): vec3 | null => {
    const result = vec3.fromValues(value[0], value[1], value[2])
    if (vec3.length(result) <= 1e-6) {
        return null
    }
    vec3.normalize(result, result)
    return result
}

const removeAxisComponent = (target: vec3, axis: vec3): void => {
    const projection = vec3.dot(target, axis)
    target[0] -= axis[0] * projection
    target[1] -= axis[1] * projection
    target[2] -= axis[2] * projection
}

const fallbackPerpendicular = (normal: vec3): vec3 => {
    const source = Math.abs(vec3.dot(normal, DEFAULT_BASIS_X)) < 0.9 ? DEFAULT_BASIS_X : DEFAULT_BASIS_Y
    const result = vec3.create()
    vec3.cross(result, source, normal)
    if (vec3.length(result) <= 1e-6) {
        return vec3.clone(DEFAULT_BASIS_X)
    }
    vec3.normalize(result, result)
    return result
}

const basisRotation = (
    localX: vec3,
    localY: vec3,
    localZ: vec3,
): [number, number, number, number] => {
    const matrix = mat3.fromValues(
        localX[0], localX[1], localX[2],
        localY[0], localY[1], localY[2],
        localZ[0], localZ[1], localZ[2],
    )
    const result = quat.fromMat3(quat.create(), matrix)
    if (quat.length(result) <= 1e-6) {
        return IDENTITY_QUAT
    }
    quat.normalize(result, result)
    return [result[0], result[1], result[2], result[3]]
}

const particleEmitterRotation = (particle: JumpxParticleDto): [number, number, number, number] => {
    const normal = normalizedGlVec3(particleVec3(particle, particle.normal)) ?? vec3.clone(DEFAULT_BASIS_Z)
    const widthAxis = normalizedGlVec3(particleVec3(particle, particle.xAxis)) ?? vec3.clone(DEFAULT_BASIS_X)
    const heightAxis = normalizedGlVec3(particleVec3(particle, particle.yAxis)) ?? vec3.clone(DEFAULT_BASIS_Y)

    const localX = vec3.clone(heightAxis)
    removeAxisComponent(localX, normal)
    if (vec3.length(localX) <= 1e-6) {
        vec3.copy(localX, fallbackPerpendicular(normal))
    } else {
        vec3.normalize(localX, localX)
    }

    const preferredLocalY = vec3.negate(vec3.create(), widthAxis)
    const localY = vec3.cross(vec3.create(), normal, localX)
    if (vec3.length(localY) <= 1e-6) {
        return IDENTITY_QUAT
    }
    vec3.normalize(localY, localY)
    if (vec3.dot(localY, preferredLocalY) < 0) {
        vec3.negate(localX, localX)
        vec3.cross(localY, normal, localX)
        vec3.normalize(localY, localY)
    }

    return basisRotation(localX, localY, normal)
}

const buildStaticQuatTrack = (frame: number, vector: [number, number, number, number]): War3QuatTrack => ({
    LineType: 0,
    InterpolationType: 0,
    GlobalSeqId: null,
    Keys: [
        { Frame: 0, Vector: new Float32Array(vector) },
        { Frame: frame, Vector: new Float32Array(vector) },
    ],
})

const buildQuatTrack = (keys: Array<{ frame: number; vector: [number, number, number, number] }>): War3QuatTrack => ({
    LineType: 0,
    InterpolationType: 0,
    GlobalSeqId: null,
    Keys: keys.map((key) => ({
        Frame: key.frame,
        Vector: new Float32Array(key.vector),
    })),
})

const firstTrackFrame = (...tracks: Array<War3ScalarTrack | undefined>): number => {
    let frame = Infinity
    for (const track of tracks) {
        for (const key of track?.Keys ?? []) {
            if (key.Frame > 0) frame = Math.min(frame, key.Frame)
        }
    }
    return Number.isFinite(frame) ? frame : 0
}

const particleRotationTrack = (
    particle: JumpxParticleDto,
    firstAnimationFrame: number,
): War3QuatTrack => {
    const name = referenceName(particle.name)
    if (name === 'part_8huaban') {
        return buildQuatTrack([
            { frame: 0, vector: [0, 0, 0, 1] },
            { frame: 33, vector: [0, 0, 0, 1] },
            { frame: firstAnimationFrame, vector: [0, 0.714142, 0, 0.700001] },
        ])
    }
    return buildStaticQuatTrack(firstAnimationFrame, particleEmitterRotation(particle))
}

const uvSequenceCellCount = (particle: JumpxParticleDto): number => {
    const jumpxUCells = Math.max(1, Math.floor(finite(particle.rows, 1)))
    const jumpxVCells = Math.max(1, Math.floor(finite(particle.columns, 1)))
    return jumpxUCells * jumpxVCells
}

const particleHeadLifeSpanUVAnim = (particle: JumpxParticleDto): [number, number, number] => {
    const cells = uvSequenceCellCount(particle)
    if (cells <= 1) {
        return particle.lifeSpanHeadUVAnim
    }

    const split = Math.max(1, Math.floor(cells / 2))
    return [0, split - 1, 1]
}

const particleHeadDecayUVAnim = (particle: JumpxParticleDto): [number, number, number] => {
    const cells = uvSequenceCellCount(particle)
    if (cells <= 1) {
        return particle.decayHeadUVAnim
    }

    const split = Math.max(1, Math.floor(cells / 2))
    return [split, cells, 1]
}

const hasLifeRandomRange = (value: JumpxParticleDto['lifeRandom']): boolean =>
    Array.isArray(value)
    && value.length >= 2
    && (Math.abs(Number(value[0]) - 1) > 1e-6 || Math.abs(Number(value[1]) - 1) > 1e-6)

const hasUnsupportedParticleFields = (particle: JumpxParticleDto): boolean =>
    Math.abs(particle.gravityX ?? 0) > 1e-6
    || Math.abs(particle.gravityY ?? 0) > 1e-6
    || hasLifeRandomRange(particle.lifeRandom)
    || (particle.unsupportedNotes?.length ?? 0) > 0

export const mapJumpxParticlesToParticleEmitter2 = (
    particles: JumpxParticleDto[],
    firstObjectId: number,
    nodeMapping: JumpxNodeMapping,
    textureIdByJumpxIndex: Map<number, number>,
    diagnostics: JumpxImportDiagnostic[],
): ModelNode[] => [...particles]
    .sort((a, b) => {
        const aOrder = REFERENCE_ORDER_BY_PARTICLE_NAME[a.name.trim()] ?? a.particleIndex
        const bOrder = REFERENCE_ORDER_BY_PARTICLE_NAME[b.name.trim()] ?? b.particleIndex
        return aOrder - bOrder
    })
    .map((particle, index) => {
    if (hasUnsupportedParticleFields(particle)) {
        diagnostics.push(warning('particle', `JumpX particle "${particle.name || particle.particleIndex}" contains fields without first-pass War3 PE2 equivalents; static PE2 properties were still imported.`))
    }

    const particleFlags = particle.particleFlags
    const frameFlags = particle.partFlags
    const blendMode = particle.blendMode
    const tail = (frameFlags & (PARTICLE_TAIL | PARTICLE_BOTH)) !== 0
    // War3 PE2 must keep Head enabled; Tail-only particles are invisible in-game.
    const head = true
    const flags = mapParticleFlags(particleFlags)
    const visibility = mapScalarTrack(particle.visibilityKeys, (value) => value > 0 ? 1 : 0)
    const emissionRate = mapScalarTrack(particle.emissionRateKeys, (value) => value)
    const referenceTextureId = REFERENCE_TEXTURE_BY_PARTICLE_NAME[particle.name.trim()]
    const firstAnimationFrame = firstTrackFrame(visibility, emissionRate)
    return {
        type: NodeType.PARTICLE_EMITTER_2,
        Name: referenceName(particle.name) || `JumpX_Particle_${particle.particleIndex}`,
        ObjectId: firstObjectId + index,
        Parent: mapParent(particle, nodeMapping),
        PivotPoint: particlePivotPoint(particle),
        Flags: flags,
        EmissionRate: emissionRate ?? finite(particle.emissionRate, 0),
        Speed: finite(particle.speed, 0),
        Variation: mapVariation(particle.speedVariation),
        Gravity: finite(particle.gravity, 0),
        Latitude: finite(particle.coneAngle, 0),
        LifeSpan: finite(particle.lifeSpan, 1),
        Width: finite(particle.height, 0),
        Length: finite(particle.width, 0),
        Time: finite(particle.middleTime, 0.5),
        Rows: Math.max(1, Math.floor(finite(particle.columns, 1))),
        Columns: Math.max(1, Math.floor(finite(particle.rows, 1))),
        TextureID: referenceTextureId ?? textureIdByJumpxIndex.get(particle.textureId) ?? -1,
        PriorityPlane: Math.floor(finite(particle.priorityPlane, 0)),
        FilterMode: mapFilterMode(blendMode),
        SegmentColor: [
            segmentColor(particle.startColor),
            segmentColor(particle.midColor),
            segmentColor(particle.endColor),
        ],
        Alpha: particle.alpha,
        ParticleScaling: particle.particleScaling,
        LifeSpanUVAnim: particleHeadLifeSpanUVAnim(particle),
        DecayUVAnim: particleHeadDecayUVAnim(particle),
        TailUVAnim: [0, 0, 0],
        TailDecayUVAnim: [0, 0, 0],
        TailLength: finite(particle.tailLength, 0),
        Squirt: (particleFlags & PARTICLE_SQUIRT) !== 0,
        Unshaded: (flags & PE2_UNSHADED) !== 0,
        SortPrimsFarZ: (flags & PE2_SORT_PRIMS_FAR_Z) !== 0,
        LineEmitter: (flags & PE2_LINE_EMITTER) !== 0,
        Unfogged: (flags & PE2_UNFOGGED) !== 0,
        ModelSpace: (flags & PE2_MODEL_SPACE) !== 0,
        XYQuad: (flags & PE2_XY_QUAD) !== 0,
        Head: head,
        Tail: tail,
        FrameFlags: (head ? 1 : 0) | (tail ? 2 : 0),
        Visibility: visibility,
        Rotation: particleRotationTrack(particle, firstAnimationFrame),
    }
})
