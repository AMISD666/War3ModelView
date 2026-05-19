import type { JumpxActionDto, JumpxBoneDto, JumpxScalarKeyDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import type { ModelData, Sequence } from '../../types/model'
import type { ModelNode } from '../../types/node'
import type { JumpxNodeMapping } from './JumpxNodeMapper'
import { transformJumpxQuat, transformJumpxScale, transformJumpxVec3 } from './JumpxCoordinateTransform'

type War3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

const DEFAULT_JUMPX_FPS = 30
const JUMPX_TRACK_LINE_TYPE_DONT_INTERP = 0
const DEFAULT_JUMPX_START_FRAME = 320

const frameToMs = (frame: number, framesPerSecond: number): number =>
    Math.round((Math.max(0, frame) / Math.max(1, framesPerSecond)) * 1000)

const sourceFrameToOutputFrame = (
    key: { frame: number; timeMs?: number },
    framesPerSecond: number,
    sourceStartFrame: number,
): number => frameToMs(Number(key.frame) - sourceStartFrame, framesPerSecond)

export const jumpxAnimationKeyFrame = (
    key: { frame: number; timeMs?: number },
    framesPerSecond: number,
    sourceStartFrame = 0,
): number => sourceFrameToOutputFrame(key, framesPerSecond, sourceStartFrame)

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

const makeSequence = (action: JumpxActionDto, framesPerSecond: number, modelData: ModelData): Sequence => ({
    Name: action.name.trim() || `JumpX_Action_${action.actionIndex}`,
    Interval: [jumpxAnimationKeyFrame({ frame: action.startFrame }, framesPerSecond), jumpxAnimationKeyFrame({ frame: action.endFrame }, framesPerSecond)],
    MinimumExtent: modelData.Model.MinimumExtent,
    MaximumExtent: modelData.Model.MaximumExtent,
    BoundsRadius: modelData.Model.BoundsRadius,
})

const getMaxKeyFrame = (scene: JumpxStaticSceneResult, framesPerSecond: number): number => {
    let maxFrame = 0
    for (const bone of scene.bones ?? []) {
        for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys, ...bone.visibilityKeys]) {
            maxFrame = Math.max(maxFrame, jumpxAnimationKeyFrame(key, framesPerSecond, DEFAULT_JUMPX_START_FRAME))
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
    if (!Number.isFinite(minFrame) || !Number.isFinite(maxFrame)) {
        return null
    }
    return [Math.round(minFrame), Math.round(maxFrame)]
}

const mapBoneTracks = (
    bone: JumpxBoneDto,
    framesPerSecond: number,
    pivot: [number, number, number],
    sourceStartFrame: number,
): { translation: War3Track | null; rotation: War3Track | null; scaling: War3Track | null } => {
    if (bone.positionKeys.length === 0 && bone.rotationKeys.length === 0 && bone.scaleKeys.length === 0) {
        return { translation: null, rotation: null, scaling: null }
    }

    const translationKeys: Array<{ frame: number; vector: Float32Array }> = []
    for (const key of bone.positionKeys) {
        const frame = jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame)
        const value = transformJumpxVec3(key.value)
        translationKeys.push({
            frame,
            vector: new Float32Array([
                value[0] - pivot[0],
                value[1] - pivot[1],
                value[2] - pivot[2],
            ]),
        })
    }

    return {
        translation: makeTrack(translationKeys),
        rotation: makeTrack(bone.rotationKeys.map((key) => ({
            frame: jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame),
            vector: new Float32Array(transformJumpxQuat(key.value)),
        }))),
        scaling: makeTrack(bone.scaleKeys.map((key) => ({
            frame: jumpxAnimationKeyFrame(key, framesPerSecond, sourceStartFrame),
            vector: new Float32Array(transformJumpxScale(key.value)),
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
        const tracks = mapBoneTracks(bone, framesPerSecond, node.PivotPoint ?? [0, 0, 0], sourceStartFrame)
        mappedKeyCount += appendTrack(node, 'Translation', tracks.translation)
        mappedKeyCount += appendTrack(node, 'Rotation', tracks.rotation)
        mappedKeyCount += appendTrack(node, 'Scaling', tracks.scaling)
        mappedKeyCount += appendTrack(node, 'Visibility', mapScalarTrack(bone.visibilityKeys, framesPerSecond, sourceStartFrame))
    }

    if ((scene.actions ?? []).length > 0) {
        modelData.Sequences = scene.actions.map((action) => makeSequence(action, framesPerSecond, modelData))
    } else if (mappedKeyCount > 0 || scene.particles.some((particle) => particle.emissionRateKeys.length > 0 || particle.visibilityKeys.length > 0)) {
        const range = getKeyFrameRange(scene, framesPerSecond, sourceStartFrame)
        modelData.Sequences = [{
            Name: 'OjsSZMBU 1',
            Interval: range ?? [0, Math.max(1, getMaxKeyFrame(scene, framesPerSecond))],
            MinimumExtent: modelData.Model.MinimumExtent,
            MaximumExtent: modelData.Model.MaximumExtent,
            BoundsRadius: modelData.Model.BoundsRadius,
        }]
    }

    return mappedKeyCount
}
