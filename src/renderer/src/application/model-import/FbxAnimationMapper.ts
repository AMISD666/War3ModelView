import type {
    FbxAnimationStackDto,
    FbxStaticSceneResult,
} from '../../types/fbxImport'
import type { ModelData, Sequence } from '../../types/model'
import type { ModelNode } from '../../types/node'
import {
    buildWar3DeltaTracksForStack,
    type War3Track,
} from './FbxAnimationTransforms'
import { collectMappedStackKeyTimes } from './FbxAnimationSampling'
import {
    applyWar3SequenceMetadata,
    makeWar3SequenceNameFromFbxStack,
} from './FbxSequenceNames'

type ImportedNodeAnimationMapping = {
    nodes: ModelNode[]
    objectIdByTypedId: Map<number, number>
}

type NodeTrackProperty = 'Translation' | 'Rotation' | 'Scaling'
type War3NodeTrackSet = {
    translation: War3Track | null
    rotation: War3Track | null
    scaling: War3Track | null
}

const toFiniteNumber = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? Number(value) : fallback

const TRACK_VALUE_EPSILON = 1e-4
const TRAILING_HOLD_FRAME_ALLOWANCE_MS = 50

const getEffectiveStackDurationMs = (
    stack: FbxAnimationStackDto,
    nodeMapping: ImportedNodeAnimationMapping,
): number => {
    const playbackDurationMs = Math.round(
        toFiniteNumber(stack.playbackDuration, stack.timeEnd - stack.timeBegin) * 1000,
    )
    const keyTimes = collectMappedStackKeyTimes(stack, nodeMapping)
    if (keyTimes.length === 0) {
        return Math.max(1, playbackDurationMs)
    }

    const minKeyTime = Math.min(...keyTimes)
    const maxKeyTime = Math.max(...keyTimes)
    const keyDurationMs = Math.round(Math.max(0, maxKeyTime - Math.min(0, minKeyTime)) * 1000)
    return Math.max(1, keyDurationMs)
}

const mergeTrackKeys = (existing: War3Track | undefined, next: War3Track): War3Track => {
    if (!existing || !Array.isArray(existing.Keys)) {
        return next
    }

    const mergedKeys = [...existing.Keys, ...next.Keys].sort((a, b) => a.Frame - b.Frame)
    return {
        ...existing,
        LineType: next.LineType,
        InterpolationType: next.InterpolationType,
        GlobalSeqId: next.GlobalSeqId,
        Keys: mergedKeys,
    }
}

const vectorsDiffer = (left: Float32Array, right: Float32Array): boolean => {
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
        if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) > TRACK_VALUE_EPSILON) {
            return true
        }
    }
    return false
}

const lastMotionFrameInTrack = (track: War3Track | null, sequenceStartFrame: number): number | null => {
    const keys = (track?.Keys ?? [])
        .filter((key) => key.Frame >= sequenceStartFrame && Number.isFinite(key.Frame))
        .sort((a, b) => a.Frame - b.Frame)
    if (keys.length < 2) {
        return null
    }

    let lastMotionIndex: number | null = null
    let previous = keys[0]
    for (let index = 1; index < keys.length; index += 1) {
        const current = keys[index]
        if (vectorsDiffer(previous.Vector, current.Vector)) {
            lastMotionIndex = index
        }
        previous = current
    }
    if (lastMotionIndex === null) {
        return null
    }

    const motionFrame = keys[lastMotionIndex].Frame
    const holdFrame = keys[lastMotionIndex + 1]?.Frame
    return holdFrame !== undefined && holdFrame - motionFrame <= TRAILING_HOLD_FRAME_ALLOWANCE_MS
        ? holdFrame
        : motionFrame
}

const getEffectiveTrackEndFrame = (
    tracksByTypedId: Map<number, War3NodeTrackSet>,
    sequenceStartFrame: number,
    fallbackEndFrame: number,
): number => {
    let lastMotionFrame: number | null = null
    for (const tracks of tracksByTypedId.values()) {
        for (const track of [tracks.translation, tracks.rotation, tracks.scaling]) {
            const trackMotionFrame = lastMotionFrameInTrack(track, sequenceStartFrame)
            if (trackMotionFrame !== null) {
                lastMotionFrame = Math.max(lastMotionFrame ?? trackMotionFrame, trackMotionFrame)
            }
        }
    }
    return lastMotionFrame === null
        ? fallbackEndFrame
        : Math.max(sequenceStartFrame + 1, Math.min(fallbackEndFrame, lastMotionFrame))
}

const trimTrackToEndFrame = (track: War3Track | null, endFrame: number): War3Track | null => {
    if (!track) {
        return null
    }
    return {
        ...track,
        Keys: track.Keys.filter((key) => key.Frame <= endFrame),
    }
}

const trimTracksToEndFrame = (
    tracksByTypedId: Map<number, War3NodeTrackSet>,
    endFrame: number,
): Map<number, War3NodeTrackSet> => {
    const trimmed = new Map<number, War3NodeTrackSet>()
    for (const [typedId, tracks] of tracksByTypedId) {
        trimmed.set(typedId, {
            translation: trimTrackToEndFrame(tracks.translation, endFrame),
            rotation: trimTrackToEndFrame(tracks.rotation, endFrame),
            scaling: trimTrackToEndFrame(tracks.scaling, endFrame),
        })
    }
    return trimmed
}

const appendNodeTrack = (node: ModelNode, property: NodeTrackProperty, track: War3Track | null): number => {
    if (!track) {
        return 0
    }
    const existing = node[property] as War3Track | undefined
    node[property] = mergeTrackKeys(existing, track)
    return track.Keys.length
}

export const applyFbxAnimationTracks = (
    scene: FbxStaticSceneResult,
    modelData: ModelData,
    nodeMapping: ImportedNodeAnimationMapping,
    options: {
        startFrame?: number
        intervalFrame?: number
        append?: boolean
    } = {},
): number => {
    const animationStacks = scene.animationStacks ?? []
    if (animationStacks.length === 0) {
        return 0
    }

    let nextSequenceStart = toFiniteNumber(options.startFrame, 0)
    const fixedStartInterval = options.intervalFrame === undefined
        ? null
        : Math.max(0, Math.round(toFiniteNumber(options.intervalFrame, 0)))
    let mappedTrackCount = 0
    const sequences: Sequence[] = options.append ? [...(modelData.Sequences ?? [])] : []
    const rawStackNames = animationStacks.map((stack) => stack.name)

    for (let stackIndex = 0; stackIndex < animationStacks.length; stackIndex += 1) {
        const stack = animationStacks[stackIndex]
        const durationMs = getEffectiveStackDurationMs(stack, nodeMapping)
        const sequenceStartFrame = nextSequenceStart
        const sequenceEndFrame = sequenceStartFrame + durationMs
        const tracksByTypedId = buildWar3DeltaTracksForStack(
            scene.nodes ?? [],
            stack,
            sequenceStartFrame,
            nodeMapping,
        )
        const effectiveSequenceEndFrame = getEffectiveTrackEndFrame(
            tracksByTypedId,
            sequenceStartFrame,
            sequenceEndFrame,
        )
        sequences.push(applyWar3SequenceMetadata({
            Name: makeWar3SequenceNameFromFbxStack(stack.name, stackIndex, rawStackNames),
            Interval: [sequenceStartFrame, effectiveSequenceEndFrame],
            MinimumExtent: modelData.Model.MinimumExtent,
            MaximumExtent: modelData.Model.MaximumExtent,
            BoundsRadius: modelData.Model.BoundsRadius,
        }))

        const trimmedTracksByTypedId = trimTracksToEndFrame(tracksByTypedId, effectiveSequenceEndFrame)
        for (const [typedId, tracks] of trimmedTracksByTypedId) {
            const objectId = nodeMapping.objectIdByTypedId.get(typedId)
            if (objectId === undefined) {
                continue
            }
            const node = nodeMapping.nodes.find((candidate) => candidate.ObjectId === objectId)
            if (!node) {
                continue
            }
            mappedTrackCount += appendNodeTrack(node, 'Translation', tracks.translation)
            mappedTrackCount += appendNodeTrack(node, 'Rotation', tracks.rotation)
            mappedTrackCount += appendNodeTrack(node, 'Scaling', tracks.scaling)
        }

        nextSequenceStart = fixedStartInterval === null
            ? sequenceEndFrame + 100
            : sequenceStartFrame + fixedStartInterval
    }

    modelData.Sequences = sequences
    return mappedTrackCount
}
