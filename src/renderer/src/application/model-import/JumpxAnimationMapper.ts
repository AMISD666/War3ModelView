import { mat4, quat, vec3 } from 'gl-matrix'
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

type Trs = {
    translation: vec3
    rotation: quat
    scaling: vec3
}

const DEFAULT_JUMPX_FPS = 30
const JUMPX_TRACK_LINE_TYPE_DONT_INTERP = 0

const frameToMs = (frame: number, framesPerSecond: number): number =>
    Math.round((Math.max(0, frame) / Math.max(1, framesPerSecond)) * 1000)

export const jumpxAnimationKeyFrame = (
    key: { frame: number; timeMs?: number },
    framesPerSecond: number,
): number => Number.isFinite(key.timeMs) ? Math.round(Number(key.timeMs)) : frameToMs(key.frame, framesPerSecond)

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

const mapScalarTrack = (keys: JumpxScalarKeyDto[], framesPerSecond: number): War3Track | null =>
    makeTrack(keys.map((key) => ({
        frame: jumpxAnimationKeyFrame(key, framesPerSecond),
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
            maxFrame = Math.max(maxFrame, jumpxAnimationKeyFrame(key, framesPerSecond))
        }
    }
    return maxFrame
}

const getKeyFrameRange = (scene: JumpxStaticSceneResult, framesPerSecond: number): [number, number] | null => {
    let minFrame = Infinity
    let maxFrame = -Infinity
    const visit = (key: { frame: number; timeMs?: number }) => {
        const frame = jumpxAnimationKeyFrame(key, framesPerSecond)
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

const readVec3Value = (value: [number, number, number] | undefined, fallback: [number, number, number]): vec3 =>
    vec3.fromValues(...transformJumpxVec3(value ?? fallback))

const readScaleValue = (value: [number, number, number] | undefined, fallback: [number, number, number]): vec3 =>
    vec3.fromValues(...transformJumpxScale(value ?? fallback))

const readQuatValue = (value: [number, number, number, number] | undefined): quat => {
    const source = transformJumpxQuat(value ?? [0, 0, 0, 1])
    const result = quat.fromValues(
        Number.isFinite(source[0]) ? Number(source[0]) : 0,
        Number.isFinite(source[1]) ? Number(source[1]) : 0,
        Number.isFinite(source[2]) ? Number(source[2]) : 0,
        Number.isFinite(source[3]) ? Number(source[3]) : 1,
    )
    if (quat.length(result) <= 0) {
        quat.identity(result)
    } else {
        quat.normalize(result, result)
    }
    return result
}

const keyFrameSet = (bone: JumpxBoneDto, framesPerSecond: number): Set<number> => {
    const frames = new Set<number>()
    for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys]) {
        frames.add(jumpxAnimationKeyFrame(key, framesPerSecond))
    }
    return frames
}

const nearestVec3AtFrame = (
    keys: JumpxBoneDto['positionKeys'],
    frame: number,
    framesPerSecond: number,
    fallback: [number, number, number],
): vec3 => {
    if (keys.length === 0) return readVec3Value(undefined, fallback)
    let chosen = keys[0]
    let chosenFrame = jumpxAnimationKeyFrame(chosen, framesPerSecond)
    for (const key of keys) {
        const currentFrame = jumpxAnimationKeyFrame(key, framesPerSecond)
        if (currentFrame <= frame && currentFrame >= chosenFrame) {
            chosen = key
            chosenFrame = currentFrame
        }
    }
    return readVec3Value(chosen.value, fallback)
}

const nearestQuatAtFrame = (
    keys: JumpxBoneDto['rotationKeys'],
    frame: number,
    framesPerSecond: number,
): quat => {
    if (keys.length === 0) return readQuatValue(undefined)
    let chosen = keys[0]
    let chosenFrame = jumpxAnimationKeyFrame(chosen, framesPerSecond)
    for (const key of keys) {
        const currentFrame = jumpxAnimationKeyFrame(key, framesPerSecond)
        if (currentFrame <= frame && currentFrame >= chosenFrame) {
            chosen = key
            chosenFrame = currentFrame
        }
    }
    return readQuatValue(chosen.value)
}

const nearestScaleAtFrame = (
    keys: JumpxBoneDto['scaleKeys'],
    frame: number,
    framesPerSecond: number,
    fallback: [number, number, number],
): vec3 => {
    if (keys.length === 0) return readScaleValue(undefined, fallback)
    let chosen = keys[0]
    let chosenFrame = jumpxAnimationKeyFrame(chosen, framesPerSecond)
    for (const key of keys) {
        const currentFrame = jumpxAnimationKeyFrame(key, framesPerSecond)
        if (currentFrame <= frame && currentFrame >= chosenFrame) {
            chosen = key
            chosenFrame = currentFrame
        }
    }
    return readScaleValue(chosen.value, fallback)
}

const evaluateGlobalTrs = (bone: JumpxBoneDto, frame: number, framesPerSecond: number): Trs => ({
    translation: nearestVec3AtFrame(bone.positionKeys, frame, framesPerSecond, bone.worldTranslation),
    rotation: nearestQuatAtFrame(bone.rotationKeys, frame, framesPerSecond),
    scaling: nearestScaleAtFrame(bone.scaleKeys, frame, framesPerSecond, [1, 1, 1]),
})

const composeMatrix = (trs: Trs): mat4 =>
    mat4.fromRotationTranslationScale(mat4.create(), trs.rotation, trs.translation, trs.scaling)

const localizeBoneTracks = (
    bone: JumpxBoneDto,
    boneByIndex: Map<number, JumpxBoneDto>,
    framesPerSecond: number,
    pivot: vec3,
): { translation: War3Track | null; rotation: War3Track | null; scaling: War3Track | null } => {
    const frames = Array.from(keyFrameSet(bone, framesPerSecond)).sort((a, b) => a - b)
    if (frames.length === 0) {
        return { translation: null, rotation: null, scaling: null }
    }

    const translationKeys: Array<{ frame: number; vector: Float32Array }> = []
    const rotationKeys: Array<{ frame: number; vector: Float32Array }> = []
    const scalingKeys: Array<{ frame: number; vector: Float32Array }> = []
    const parent = boneByIndex.get(bone.parentId)
    let baseRotationInverse: quat | null = null
    for (const frame of frames) {
        const globalMatrix = composeMatrix(evaluateGlobalTrs(bone, frame, framesPerSecond))
        const localMatrix = mat4.clone(globalMatrix)
        if (parent) {
            const parentInverse = mat4.invert(mat4.create(), composeMatrix(evaluateGlobalTrs(parent, frame, framesPerSecond)))
            if (parentInverse) {
                mat4.multiply(localMatrix, parentInverse, globalMatrix)
            }
        }

        const translation = vec3.create()
        const rotation = quat.create()
        const scaling = vec3.create()
        mat4.getTranslation(translation, localMatrix)
        mat4.getRotation(rotation, localMatrix)
        mat4.getScaling(scaling, localMatrix)
        quat.normalize(rotation, rotation)
        if (!baseRotationInverse) {
            baseRotationInverse = quat.invert(quat.create(), rotation)
        }
        quat.multiply(rotation, baseRotationInverse, rotation)
        quat.normalize(rotation, rotation)
        if (!parent) {
            vec3.sub(translation, translation, pivot)
        }
        translationKeys.push({ frame, vector: new Float32Array([translation[0], translation[1], translation[2]]) })
        rotationKeys.push({ frame, vector: new Float32Array([rotation[0], rotation[1], rotation[2], rotation[3]]) })
        scalingKeys.push({ frame, vector: new Float32Array([scaling[0], scaling[1], scaling[2]]) })
    }

    return {
        translation: makeTrack(translationKeys),
        rotation: makeTrack(rotationKeys),
        scaling: makeTrack(scalingKeys),
    }
}

export const applyJumpxAnimationTracks = (
    scene: JumpxStaticSceneResult,
    modelData: ModelData,
    nodeMapping: JumpxNodeMapping,
    options: { framesPerSecond?: number } = {},
): number => {
    const framesPerSecond = options.framesPerSecond ?? DEFAULT_JUMPX_FPS
    let mappedKeyCount = 0
    const boneByIndex = new Map((scene.bones ?? []).map((bone) => [bone.boneIndex, bone]))

    for (const bone of scene.bones ?? []) {
        const objectId = nodeMapping.objectIdByBoneId.get(bone.boneIndex)
        if (objectId === undefined) {
            continue
        }
        const node = nodeMapping.nodes.find((candidate) => candidate.ObjectId === objectId)
        if (!node) {
            continue
        }
        const pivot = vec3.fromValues(...node.PivotPoint ?? [0, 0, 0])
        const tracks = localizeBoneTracks(bone, boneByIndex, framesPerSecond, pivot)
        mappedKeyCount += appendTrack(node, 'Translation', tracks.translation)
        mappedKeyCount += appendTrack(node, 'Rotation', tracks.rotation)
        mappedKeyCount += appendTrack(node, 'Scaling', tracks.scaling)
        mappedKeyCount += appendTrack(node, 'Visibility', mapScalarTrack(bone.visibilityKeys, framesPerSecond))
    }

    if ((scene.actions ?? []).length > 0) {
        modelData.Sequences = scene.actions.map((action) => makeSequence(action, framesPerSecond, modelData))
    } else if (mappedKeyCount > 0 || scene.particles.some((particle) => particle.emissionRateKeys.length > 0 || particle.visibilityKeys.length > 0)) {
        const range = getKeyFrameRange(scene, framesPerSecond)
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
