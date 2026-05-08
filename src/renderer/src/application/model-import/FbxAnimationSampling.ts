import type {
    FbxAnimationStackDto,
    FbxBakedNodeDto,
    FbxBakedQuatKeyDto,
    FbxBakedVec3KeyDto,
} from '../../types/fbxImport'

type ImportedNodeAnimationMapping = {
    objectIdByTypedId: Map<number, number>
}

type TimedKey = FbxBakedVec3KeyDto | FbxBakedQuatKeyDto

const toFiniteNumber = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? Number(value) : fallback

const addFiniteKeyTimes = (times: Set<number>, keys: TimedKey[] | undefined): void => {
    for (const key of keys ?? []) {
        if (Number.isFinite(key.timeSeconds)) {
            times.add(Number(key.timeSeconds))
        }
    }
}

const addNodeKeyTimes = (times: Set<number>, node: FbxBakedNodeDto): void => {
    addFiniteKeyTimes(times, node.translationKeys)
    addFiniteKeyTimes(times, node.rotationKeys)
    addFiniteKeyTimes(times, node.scaleKeys)
}

export const collectMappedStackKeyTimes = (
    stack: FbxAnimationStackDto,
    nodeMapping: ImportedNodeAnimationMapping,
): number[] => {
    const times = new Set<number>()
    const hasMappedNode = (stack.bakedNodes ?? []).some((baked) =>
        nodeMapping.objectIdByTypedId.has(baked.nodeTypedId))
    if (!hasMappedNode && nodeMapping.objectIdByTypedId.size > 0) {
        return []
    }
    for (const baked of stack.bakedNodes ?? []) {
        addNodeKeyTimes(times, baked)
    }
    const playbackDuration = toFiniteNumber(stack.playbackDuration, stack.timeEnd - stack.timeBegin)
    if (playbackDuration > 0) {
        times.add(0)
        times.add(playbackDuration)
    }
    return [...times].sort((a, b) => a - b)
}
