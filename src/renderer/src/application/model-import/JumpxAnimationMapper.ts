import { quat } from 'gl-matrix'
import type { JumpxActionDto, JumpxBoneDto, JumpxGeometryDto, JumpxScalarKeyDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import type { ModelData, Sequence } from '../../types/model'
import type { ModelNode } from '../../types/node'
import type { JumpxNodeMapping } from './JumpxNodeMapper'
import { transformJumpxQuat, transformJumpxScale, transformJumpxVec3 } from './JumpxCoordinateTransform'
import { applyParticleLifecycleEmissionTracks } from './JumpxParticleLifecycleMapper'

type War3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

const DEFAULT_JUMPX_FPS = 30
const DEFAULT_JUMPX_START_FRAME = 320
const JUMPX_TRACK_LINE_TYPE_DONT_INTERP = 0
const JUMPX_TRACK_LINE_TYPE_LINEAR = 1
const SCALE_EPSILON = 1e-5
const FLAT_GEOMETRY_EPSILON = 1e-3
const CIRCULAR_PLANE_RATIO_LIMIT = 1.05

const frameToMs = (frame: number, framesPerSecond: number): number =>
    Math.round((Math.max(0, frame) / Math.max(1, framesPerSecond)) * 1000)

export const jumpxAnimationKeyFrame = (
    key: { frame: number; timeMs?: number },
    framesPerSecond: number,
    sourceStartFrame = 0,
): number => {
    if (Number.isFinite(key.timeMs)) {
        return Math.round(Number(key.timeMs))
    }
    return frameToMs(Number(key.frame) - sourceStartFrame, framesPerSecond)
}

const jumpxActionKeyFrame = (frame: number, framesPerSecond: number): number =>
    frameToMs(Number(frame) + DEFAULT_JUMPX_START_FRAME, framesPerSecond)

const normalizeActionName = (name: string, actionIndex: number): string => {
    const normalized = name.trim().toLowerCase().replace(/[_\-.]+/g, ' ')
    if (!normalized) return `JumpX_Action_${actionIndex}`
    return name.trim()
}

const makeTrack = (keys: Array<{ frame: number; vector: Float32Array }>, lineType = JUMPX_TRACK_LINE_TYPE_DONT_INTERP): War3Track | null => {
    const sorted = keys
        .filter((key) => Number.isFinite(key.frame))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length === 0) {
        return null
    }
    return {
        LineType: lineType,
        InterpolationType: lineType,
        GlobalSeqId: null,
        Keys: sorted.map((key) => ({ Frame: key.frame, Vector: key.vector })),
    }
}

const mapScalarTrack = (keys: JumpxScalarKeyDto[], framesPerSecond: number, sourceStartFrame: number): War3Track | null =>
    makeTrack(keys.map((key) => ({
        frame: jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame),
        vector: new Float32Array([key.value]),
    })))

const appendTrack = (node: ModelNode, property: 'Translation' | 'Rotation' | 'Scaling' | 'Visibility', track: War3Track | null): number => {
    if (!track) {
        return 0
    }
    node[property] = track
    return track.Keys.length
}

const prependStaticKey = (track: War3Track | null): War3Track | null => {
    if (!track) {
        return null
    }
    if ((track.Keys[0]?.Frame ?? 0) === 0) {
        return track
    }
    const vector = new Float32Array(track.Keys[0]?.Vector ?? [])
    return {
        ...track,
        Keys: [{ Frame: 0, Vector: vector }, ...track.Keys],
    }
}

const makeSequence = (action: JumpxActionDto, framesPerSecond: number, modelData: ModelData): Sequence => ({
    Name: normalizeActionName(action.name, action.actionIndex),
    Interval: [
        jumpxActionKeyFrame(action.startFrame, framesPerSecond),
        jumpxActionKeyFrame(action.endFrame, framesPerSecond),
    ],
    NonLooping: ['dead', 'death'].includes(action.name.trim().toLowerCase()) || undefined,
    MinimumExtent: modelData.Model.MinimumExtent,
    MaximumExtent: modelData.Model.MaximumExtent,
    BoundsRadius: modelData.Model.BoundsRadius,
})

const getMaxKeyFrame = (scene: JumpxStaticSceneResult, framesPerSecond: number, sourceStartFrame: number): number => {
    let maxFrame = 0
    for (const bone of scene.bones ?? []) {
        for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys, ...bone.visibilityKeys]) {
            maxFrame = Math.max(maxFrame, jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame))
        }
    }
    for (const material of scene.materials ?? []) {
        for (const key of [...material.alphaKeys, ...material.colorKeys, ...material.uvOffsetKeys, ...material.blendKeys]) {
            maxFrame = Math.max(maxFrame, jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame))
        }
    }
    return maxFrame
}

const getKeyFrameRange = (scene: JumpxStaticSceneResult, framesPerSecond: number, sourceStartFrame: number): [number, number] | null => {
    let minFrame = Infinity
    let maxFrame = -Infinity
    const visit = (key: { frame: number; timeMs?: number }) => {
        const frame = jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame)
        minFrame = Math.min(minFrame, frame)
        maxFrame = Math.max(maxFrame, frame)
    }
    for (const bone of scene.bones ?? []) {
        for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys, ...bone.visibilityKeys]) {
            visit(key)
        }
    }
    for (const particle of scene.particles ?? []) {
        for (const key of [...particle.emissionRateKeys, ...particle.visibilityKeys]) {
            visit(key)
        }
    }
    for (const material of scene.materials ?? []) {
        for (const key of [...material.alphaKeys, ...material.colorKeys, ...material.uvOffsetKeys, ...material.blendKeys]) {
            visit(key)
        }
    }
    if (!Number.isFinite(minFrame) || !Number.isFinite(maxFrame)) {
        return null
    }
    return [Math.round(minFrame), Math.round(maxFrame)]
}

const normalizedQuat = (value: [number, number, number, number] | undefined): quat => {
    const transformed = transformJumpxQuat(value)
    const result = quat.fromValues(transformed[0], transformed[1], transformed[2], transformed[3])
    if (quat.length(result) <= 0) {
        quat.identity(result)
    } else {
        quat.normalize(result, result)
    }
    return result
}

const mapRotationTrack = (
    keys: JumpxBoneDto['rotationKeys'],
    framesPerSecond: number,
    sourceStartFrame: number,
): War3Track | null => {
    if (keys.length === 0) {
        return null
    }
    let previousRotation: quat | null = null
    return makeTrack(keys.map((key) => {
        const rotation = normalizedQuat(key.value)
        if (previousRotation && quat.dot(previousRotation, rotation) < 0) {
            quat.scale(rotation, rotation, -1)
        }
        previousRotation = quat.clone(rotation)
        return {
            frame: jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame),
            vector: new Float32Array([rotation[0], rotation[1], rotation[2], rotation[3]]),
        }
    }), JUMPX_TRACK_LINE_TYPE_LINEAR)
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= SCALE_EPSILON

const transformJumpxAxis = (sourceAxis: number): number =>
    sourceAxis === 0 ? 1 : sourceAxis === 1 ? 0 : 2

const circularPlaneNormalAxis = (geometry: JumpxGeometryDto): number | null => {
    const size = [
        Math.abs(geometry.maximumExtent[0] - geometry.minimumExtent[0]),
        Math.abs(geometry.maximumExtent[1] - geometry.minimumExtent[1]),
        Math.abs(geometry.maximumExtent[2] - geometry.minimumExtent[2]),
    ]
    let flatAxis = 0
    for (let axis = 1; axis < 3; axis += 1) {
        if (size[axis] < size[flatAxis]) {
            flatAxis = axis
        }
    }
    const planeAxes = [0, 1, 2].filter((axis) => axis !== flatAxis)
    const planeMax = Math.max(size[planeAxes[0]], size[planeAxes[1]])
    const planeMin = Math.min(size[planeAxes[0]], size[planeAxes[1]])
    if (planeMax <= FLAT_GEOMETRY_EPSILON) {
        return null
    }
    if (size[flatAxis] > Math.max(FLAT_GEOMETRY_EPSILON, planeMax * 0.01)) {
        return null
    }
    if (planeMax / Math.max(FLAT_GEOMETRY_EPSILON, planeMin) > CIRCULAR_PLANE_RATIO_LIMIT) {
        return null
    }
    return transformJumpxAxis(flatAxis)
}

const buildCircularScaleNormalAxisByBone = (geometries: JumpxGeometryDto[]): Map<number, number> => {
    const axisVotesByBone = new Map<number, Map<number, number>>()
    for (const geometry of geometries) {
        const axis = circularPlaneNormalAxis(geometry)
        if (axis === null || geometry.ancestorBoneId < 0) {
            continue
        }
        let votes = axisVotesByBone.get(geometry.ancestorBoneId)
        if (!votes) {
            votes = new Map<number, number>()
            axisVotesByBone.set(geometry.ancestorBoneId, votes)
        }
        votes.set(axis, (votes.get(axis) ?? 0) + 1)
    }
    const result = new Map<number, number>()
    for (const [boneId, votes] of axisVotesByBone) {
        const [axis] = Array.from(votes).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
        result.set(boneId, axis)
    }
    return result
}

const mapBoneScaleKey = (
    value: [number, number, number] | undefined,
    circularNormalAxis: number | undefined,
): [number, number, number] => {
    const x = Math.abs(Number(value?.[0] ?? 1))
    const y = Math.abs(Number(value?.[1] ?? 1))
    const z = Math.abs(Number(value?.[2] ?? 1))
    if (circularNormalAxis !== undefined) {
        if (close(x, y) && !close(y, z)) {
            const mapped = [x, x, x] as [number, number, number]
            mapped[circularNormalAxis] = z
            return mapped
        }
        if (close(x, z) && !close(x, y)) {
            const mapped = [x, x, x] as [number, number, number]
            mapped[circularNormalAxis] = y
            return mapped
        }
        if (close(y, z) && !close(x, y)) {
            const mapped = [y, y, y] as [number, number, number]
            mapped[circularNormalAxis] = x
            return mapped
        }
    }
    return transformJumpxScale(value)
}

const mapBoneTracks = (
    bone: JumpxBoneDto,
    framesPerSecond: number,
    pivot: [number, number, number],
    sourceStartFrame: number,
    circularScaleNormalAxis: number | undefined,
): { translation: War3Track | null; rotation: War3Track | null; scaling: War3Track | null } => {
    return {
        translation: makeTrack(bone.positionKeys.map((key) => {
            const transformed = transformJumpxVec3(key.value ?? bone.worldTranslation)
            return {
                frame: jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame),
                vector: new Float32Array([
                    transformed[0] - pivot[0],
                    transformed[1] - pivot[1],
                    transformed[2] - pivot[2],
                ]),
            }
        })),
        rotation: mapRotationTrack(bone.rotationKeys, framesPerSecond, sourceStartFrame),
        scaling: makeTrack(bone.scaleKeys.map((key) => ({
            frame: jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame),
            vector: new Float32Array(mapBoneScaleKey(key.value, circularScaleNormalAxis)),
        }))),
    }
}

export const applyJumpxAnimationTracks = (
    scene: JumpxStaticSceneResult,
    modelData: ModelData,
    nodeMapping: JumpxNodeMapping,
    options: { framesPerSecond?: number } = {},
): number => {
    const framesPerSecond = options.framesPerSecond ?? DEFAULT_JUMPX_FPS
    const sourceStartFrame = (scene.actions ?? []).length > 0 ? 0 : DEFAULT_JUMPX_START_FRAME
    const circularScaleNormalAxisByBone = buildCircularScaleNormalAxisByBone(scene.geometries ?? [])
    const particleParentBoneIds = new Set((scene.particles ?? []).map((particle) => particle.parentBoneId))
    let mappedKeyCount = 0

    for (const bone of scene.bones ?? []) {
        const objectId = nodeMapping.objectIdByBoneId.get(bone.boneIndex)
        if (objectId === undefined) {
            continue
        }
        const node = nodeMapping.nodes.find((candidate) => candidate.ObjectId === objectId)
        if (!node) {
            continue
        }
        const pivot = node.PivotPoint ?? [0, 0, 0]
        const tracks = mapBoneTracks(
            bone,
            framesPerSecond,
            pivot,
            sourceStartFrame,
            circularScaleNormalAxisByBone.get(bone.boneIndex),
        )
        const needsFrameZeroPose = particleParentBoneIds.has(bone.boneIndex)
        mappedKeyCount += appendTrack(node, 'Translation', needsFrameZeroPose ? prependStaticKey(tracks.translation) : tracks.translation)
        mappedKeyCount += appendTrack(node, 'Rotation', needsFrameZeroPose ? prependStaticKey(tracks.rotation) : tracks.rotation)
        mappedKeyCount += appendTrack(node, 'Scaling', needsFrameZeroPose ? prependStaticKey(tracks.scaling) : tracks.scaling)
        mappedKeyCount += appendTrack(node, 'Visibility', mapScalarTrack(bone.visibilityKeys, framesPerSecond, sourceStartFrame))

        const meshObjectId = nodeMapping.meshObjectIdByBoneId.get(bone.boneIndex)
        const meshNode = meshObjectId !== undefined
            ? nodeMapping.nodes.find((candidate) => candidate.ObjectId === meshObjectId)
            : undefined
        if (meshNode) {
            const meshTracks = mapBoneTracks(
                bone,
                framesPerSecond,
                [0, 0, 0],
                sourceStartFrame,
                undefined,
            )
            mappedKeyCount += appendTrack(meshNode, 'Translation', prependStaticKey(meshTracks.translation))
            mappedKeyCount += appendTrack(meshNode, 'Rotation', prependStaticKey(meshTracks.rotation))
            mappedKeyCount += appendTrack(meshNode, 'Scaling', prependStaticKey(meshTracks.scaling))
            mappedKeyCount += appendTrack(meshNode, 'Visibility', mapScalarTrack(bone.visibilityKeys, framesPerSecond, sourceStartFrame))
        }
    }

    if ((scene.actions ?? []).length > 0) {
        modelData.Sequences = scene.actions.map((action) => makeSequence(action, framesPerSecond, modelData))
    } else if (
        mappedKeyCount > 0
        || scene.particles.some((particle) => particle.emissionRateKeys.length > 0 || particle.visibilityKeys.length > 0)
        || scene.materials.some((material) =>
            material.alphaKeys.length > 0
            || material.colorKeys.length > 0
            || material.uvOffsetKeys.length > 0
            || material.blendKeys.length > 0)
    ) {
        const range = getKeyFrameRange(scene, framesPerSecond, sourceStartFrame)
        modelData.Sequences = [{
            Name: 'OjsSZMBU 1',
            Interval: range ?? [0, Math.max(1, getMaxKeyFrame(scene, framesPerSecond, sourceStartFrame))],
            MinimumExtent: modelData.Model.MinimumExtent,
            MaximumExtent: modelData.Model.MaximumExtent,
            BoundsRadius: modelData.Model.BoundsRadius,
        }]
    }

    mappedKeyCount += applyParticleLifecycleEmissionTracks(scene, modelData, framesPerSecond, sourceStartFrame)

    return mappedKeyCount
}
