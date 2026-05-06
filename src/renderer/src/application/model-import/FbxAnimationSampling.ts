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
    for (const baked of stack.bakedNodes ?? []) {
        if (!nodeMapping.objectIdByTypedId.has(baked.nodeTypedId)) {
            continue
        }
        addNodeKeyTimes(times, baked)
    }
    return [...times].sort((a, b) => a - b)
}
