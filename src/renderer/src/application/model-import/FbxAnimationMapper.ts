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

type ImportedNodeAnimationMapping = {
    nodes: ModelNode[]
    objectIdByTypedId: Map<number, number>
}

type NodeTrackProperty = 'Translation' | 'Rotation' | 'Scaling'

const toFiniteNumber = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? Number(value) : fallback

const makeSequenceName = (stack: FbxAnimationStackDto, index: number): string => {
    const name = stack.name.trim()
    return name.length > 0 ? name : `FBX_Anim_${index + 1}`
}

const collectMappedStackKeyTimes = (
    stack: FbxAnimationStackDto,
    nodeMapping: ImportedNodeAnimationMapping,
): number[] => {
    const times: number[] = []
    for (const baked of stack.bakedNodes ?? []) {
        if (!nodeMapping.objectIdByTypedId.has(baked.nodeTypedId)) {
            continue
        }
        for (const key of baked.translationKeys ?? []) times.push(key.timeSeconds)
        for (const key of baked.rotationKeys ?? []) times.push(key.timeSeconds)
        for (const key of baked.scaleKeys ?? []) times.push(key.timeSeconds)
    }
    return times.filter(Number.isFinite)
}

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
): number => {
    const animationStacks = scene.animationStacks ?? []
    if (animationStacks.length === 0) {
        return 0
    }

    let nextSequenceStart = 0
    let mappedTrackCount = 0
    const sequences: Sequence[] = []

    for (let stackIndex = 0; stackIndex < animationStacks.length; stackIndex += 1) {
        const stack = animationStacks[stackIndex]
        const durationMs = getEffectiveStackDurationMs(stack, nodeMapping)
        const sequenceStartFrame = nextSequenceStart
        const sequenceEndFrame = sequenceStartFrame + durationMs
        sequences.push({
            Name: makeSequenceName(stack, stackIndex),
            Interval: [sequenceStartFrame, sequenceEndFrame],
            MinimumExtent: modelData.Model.MinimumExtent,
            MaximumExtent: modelData.Model.MaximumExtent,
            BoundsRadius: modelData.Model.BoundsRadius,
        })

        const tracksByTypedId = buildWar3DeltaTracksForStack(
            scene.nodes ?? [],
            stack,
            sequenceStartFrame,
            nodeMapping,
        )
        for (const [typedId, tracks] of tracksByTypedId) {
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

        nextSequenceStart = sequenceEndFrame + 100
    }

    modelData.Sequences = sequences
    return mappedTrackCount
}
