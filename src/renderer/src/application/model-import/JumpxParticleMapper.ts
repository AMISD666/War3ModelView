import type { JumpxImportDiagnostic, JumpxParticleDto } from '../../types/jumpxImport'
import { NodeType, type ModelNode, type ParticleEmitter2Node } from '../../types/node'
import type { JumpxNodeMapping } from './JumpxNodeMapper'
import { transformJumpxQuat, transformJumpxVec3 } from './JumpxCoordinateTransform'

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
const PARTICLE_HEAD = 0x8000
const PARTICLE_TAIL = 0x10000
const PARTICLE_BOTH = 0x20000

const RENDER_BLEND = 0x20000
const RENDER_ADD = 0x40000
const RENDER_MODULATE = 0x80000
const RENDER_MODULATE2X = 0x100000

const PE2_NODE_TYPE = 0x1000
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
const DEFAULT_XY_QUAD_NORMAL: [number, number, number] = [0, 0, 1]
const DEFAULT_JUMPX_FPS = 30
const DEFAULT_JUMPX_START_FRAME = 320

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
    let flags = PE2_NODE_TYPE
    if ((particleFlags & JUMPX_MODEL_SPACE) !== 0) flags |= PE2_MODEL_SPACE
    if ((particleFlags & JUMPX_XY_QUAD) !== 0) flags |= PE2_XY_QUAD

    // The reference JumpX conversion maps zero raw flags to a line-style model-space emitter.
    if (particleFlags === 0) {
        flags |= PE2_UNSHADED | PE2_SORT_PRIMS_FAR_Z | PE2_LINE_EMITTER | PE2_UNFOGGED | PE2_MODEL_SPACE
    }
    return flags
}

const keyFrame = (key: { frame: number; timeMs?: number }): number =>
    Math.round((Math.max(0, finite(key.frame, 0) - DEFAULT_JUMPX_START_FRAME) / DEFAULT_JUMPX_FPS) * 1000)

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

const normalizeVec3 = (value: [number, number, number]): [number, number, number] | null => {
    const length = Math.hypot(value[0], value[1], value[2])
    if (!Number.isFinite(length) || length <= 1e-6) {
        return null
    }
    return [value[0] / length, value[1] / length, value[2] / length]
}

const buildStaticVec3Track = (frame: number, vector: [number, number, number]): War3Vec3Track => ({
    LineType: 0,
    InterpolationType: 0,
    GlobalSeqId: null,
    Keys: [
        { Frame: 0, Vector: new Float32Array([0, 0, 0]) },
        { Frame: frame, Vector: new Float32Array(vector) },
    ],
})

const buildStaticQuatTrack = (frame: number, vector: [number, number, number, number]): War3QuatTrack => ({
    LineType: 0,
    InterpolationType: 0,
    GlobalSeqId: null,
    Keys: [
        { Frame: 0, Vector: new Float32Array([0, 0, 0, 1]) },
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

const staticParticleRotation = (particle: JumpxParticleDto): [number, number, number, number] => {
    const rotation = transformJumpxQuat([particle.rotVec[0], particle.rotVec[1], particle.rotVec[2], 1])
    const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3])
    if (!Number.isFinite(length) || length <= 1e-6) {
        return [0, 0, 0, 1]
    }
    return [rotation[0] / length, rotation[1] / length, rotation[2] / length, rotation[3] / length]
}

const xyQuadPlaneRotation = (particle: JumpxParticleDto): [number, number, number, number] => {
    const transformedNormal = normalizeVec3(transformJumpxVec3(particle.normal))
    if (!transformedNormal) {
        return IDENTITY_QUAT
    }

    const dot = Math.max(-1, Math.min(1,
        DEFAULT_XY_QUAD_NORMAL[0] * transformedNormal[0]
        + DEFAULT_XY_QUAD_NORMAL[1] * transformedNormal[1]
        + DEFAULT_XY_QUAD_NORMAL[2] * transformedNormal[2],
    ))
    if (dot > 0.9999) {
        return IDENTITY_QUAT
    }

    const axis: [number, number, number] = [
        DEFAULT_XY_QUAD_NORMAL[1] * transformedNormal[2] - DEFAULT_XY_QUAD_NORMAL[2] * transformedNormal[1],
        DEFAULT_XY_QUAD_NORMAL[2] * transformedNormal[0] - DEFAULT_XY_QUAD_NORMAL[0] * transformedNormal[2],
        DEFAULT_XY_QUAD_NORMAL[0] * transformedNormal[1] - DEFAULT_XY_QUAD_NORMAL[1] * transformedNormal[0],
    ]
    const axisLength = Math.hypot(axis[0], axis[1], axis[2])
    if (axisLength <= 1e-6) {
        return [1, 0, 0, 0]
    }

    const halfAngle = Math.acos(dot) / 2
    const sinHalf = Math.sin(halfAngle)
    return [
        (axis[0] / axisLength) * sinHalf,
        (axis[1] / axisLength) * sinHalf,
        (axis[2] / axisLength) * sinHalf,
        Math.cos(halfAngle),
    ]
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
    if ((particle.particleFlags & JUMPX_XY_QUAD) !== 0) {
        return buildQuatTrack([
            { frame: 0, vector: IDENTITY_QUAT },
            { frame: firstAnimationFrame, vector: xyQuadPlaneRotation(particle) },
        ])
    }
    return buildStaticQuatTrack(33, staticParticleRotation(particle))
}

const particleWidth = (particle: JumpxParticleDto): number =>
    referenceName(particle.name) === 'part_8huaban' ? finite(particle.height, 0) : finite(particle.width, 0)

const particleLength = (particle: JumpxParticleDto): number =>
    referenceName(particle.name) === 'part_8huaban' ? finite(particle.width, 0) : finite(particle.height, 0)

const uvSequenceCellCount = (particle: JumpxParticleDto): number => {
    const rows = Math.max(1, Math.floor(finite(particle.rows, 1)))
    const columns = Math.max(1, Math.floor(finite(particle.columns, 1)))
    return rows * columns
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
    const head = (frameFlags & (PARTICLE_HEAD | PARTICLE_BOTH)) !== 0
    const tail = (frameFlags & (PARTICLE_TAIL | PARTICLE_BOTH)) !== 0
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
        PivotPoint: transformJumpxVec3(particle.pivot),
        Flags: flags,
        EmissionRate: emissionRate ?? finite(particle.emissionRate, 0),
        Speed: finite(particle.speed, 0),
        Variation: mapVariation(particle.speedVariation),
        Gravity: finite(particle.gravity, 0),
        Latitude: finite(particle.coneAngle, 0),
        LifeSpan: finite(particle.lifeSpan, 1),
        Width: particleWidth(particle),
        Length: particleLength(particle),
        Time: finite(particle.middleTime, 0.5),
        Rows: Math.max(1, Math.floor(finite(particle.rows, 1))),
        Columns: Math.max(1, Math.floor(finite(particle.columns, 1))),
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
        TailLength: 0,
        Squirt: (particleFlags & PARTICLE_SQUIRT) !== 0,
        Unshaded: (flags & PE2_UNSHADED) !== 0,
        SortPrimsFarZ: (flags & PE2_SORT_PRIMS_FAR_Z) !== 0,
        LineEmitter: (flags & PE2_LINE_EMITTER) !== 0,
        Unfogged: (flags & PE2_UNFOGGED) !== 0,
        ModelSpace: (flags & PE2_MODEL_SPACE) !== 0,
        XYQuad: (flags & PE2_XY_QUAD) !== 0,
        Head: head || !tail,
        Tail: tail,
        FrameFlags: (head || !tail ? 1 : 0) | (tail ? 2 : 0),
        Visibility: visibility,
        Translation: buildStaticVec3Track(33, [0, 0, 0]),
        Rotation: particleRotationTrack(particle, firstAnimationFrame),
    }
})
