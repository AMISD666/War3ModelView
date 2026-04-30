import { extractNodesFromModel, updateModelDataWithNodes } from '../../store/modelStore'
import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import { deepClone } from '../../utils/modelMerge'
import type { RetargetAnimationReplacementResult, RetargetSequenceReplaceMode } from './retargetAnimationReplacement'
import {
    appendShiftedNodeAnimationFields,
    NODE_OPTIONAL_TRACK_FIELDS,
} from './retargetSequenceTrackCopy'

export {
    appendShiftedNodeAnimationFields,
    NODE_ANIMATION_FIELDS,
    NODE_OPTIONAL_TRACK_FIELDS,
} from './retargetSequenceTrackCopy'

export interface RetargetSingleSequenceReplacementResult extends RetargetAnimationReplacementResult {
    newSequenceName: string
    sourceInterval: [number, number]
    targetInterval: [number, number]
}

const SINGLE_SEQUENCE_FRAME_GAP = 2000

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object'

const cloneValue = <T,>(value: T): T => deepClone(value)

const readName = (value: unknown): string =>
    isObject(value) ? String(value.Name ?? value.name ?? '').trim().toLowerCase() : ''

const nodeKey = (node: ModelNode): string | null => {
    const name = readName(node)
    return name ? `${(node as any).type ?? ''}:${name}` : null
}

const buildNodeLookup = (nodes: ModelNode[]): Map<number | string, ModelNode> => {
    const lookup = new Map<number | string, ModelNode>()
    for (const node of nodes) {
        if (typeof node.ObjectId === 'number') {
            lookup.set(node.ObjectId, node)
        }
        const key = nodeKey(node)
        if (key && !lookup.has(key)) {
            lookup.set(key, node)
        }
    }
    return lookup
}

const readSequenceInterval = (sequence: unknown): [number, number] | null => {
    if (!isObject(sequence)) return null
    const interval = (sequence as any).Interval
    if (!interval || typeof interval.length !== 'number' || interval.length < 2) return null
    const start = Number(interval[0])
    const end = Number(interval[1])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return [start, end]
}

const getMaxSequenceEnd = (sequences: unknown): number => {
    if (!Array.isArray(sequences)) return 0
    return sequences.reduce((max, sequence) => {
        const interval = readSequenceInterval(sequence)
        return interval ? Math.max(max, interval[1]) : max
    }, 0)
}

const updateSequenceCounts = (modelData: Record<string, any>, sequenceCount: number): void => {
    if (modelData.Model) {
        modelData.Model.NumSequences = sequenceCount
    }
    if (modelData.Info) {
        modelData.Info.NumSequences = sequenceCount
    }
}

const appendNameSuffix = (name: unknown, suffix: string): string => {
    const baseName = String(name ?? '').trim() || 'Unnamed'
    const cleanSuffix = suffix.trim()
    return cleanSuffix ? `${baseName}-${cleanSuffix}` : baseName
}

const createShiftedSequence = (
    sourceSequence: Record<string, any>,
    targetInterval: [number, number],
    sourceModelName: string,
): Record<string, any> => ({
    ...cloneValue(sourceSequence),
    Name: appendNameSuffix(sourceSequence.Name, sourceModelName),
    Interval: [targetInterval[0], targetInterval[1]],
})

export const buildRetargetSingleSequenceReplacement = (
    sourceModelData: ModelData,
    targetModelData: ModelData,
    sourceSequenceIndex: number,
    sourceModelName: string,
    mode: RetargetSequenceReplaceMode = 'smart',
): RetargetSingleSequenceReplacementResult => {
    const sourceAny = sourceModelData as any
    const targetAny = cloneValue(targetModelData) as any
    const sourceSequences = Array.isArray(sourceAny.Sequences) ? sourceAny.Sequences : []
    const sourceSequence = sourceSequences[sourceSequenceIndex]
    if (!isObject(sourceSequence)) {
        throw new Error('请选择 A 区动作序列')
    }

    const sourceInterval = readSequenceInterval(sourceSequence)
    if (!sourceInterval) {
        throw new Error('A 区选中的动作序列没有有效关键帧范围')
    }

    const targetSequences = Array.isArray(targetAny.Sequences) ? cloneValue(targetAny.Sequences) : []
    const duration = sourceInterval[1] - sourceInterval[0]
    const targetStart = getMaxSequenceEnd(targetSequences) + SINGLE_SEQUENCE_FRAME_GAP
    const targetInterval: [number, number] = [targetStart, targetStart + duration]
    const newSequence = createShiftedSequence(sourceSequence as Record<string, any>, targetInterval, sourceModelName)

    targetSequences.push(newSequence)
    targetAny.Sequences = targetSequences
    updateSequenceCounts(targetAny, targetSequences.length)

    let copiedTrackCount = 0
    if (mode !== 'manual') {
        const sourceNodes = extractNodesFromModel(sourceModelData)
        const targetNodes = extractNodesFromModel(targetAny)
        const sourceNodeLookup = buildNodeLookup(sourceNodes)
        const nextNodes = targetNodes.map((targetNode) => {
            const key = nodeKey(targetNode)
            const sourceNode = (key ? sourceNodeLookup.get(key) : undefined) ?? sourceNodeLookup.get(targetNode.ObjectId)
            if (!sourceNode) return targetNode
            const nextNode = { ...targetNode } as ModelNode
            copiedTrackCount += appendShiftedNodeAnimationFields(sourceNode as any, nextNode as any, sourceInterval, targetInterval)
            copiedTrackCount += appendShiftedNodeAnimationFields(sourceNode as any, nextNode as any, sourceInterval, targetInterval, NODE_OPTIONAL_TRACK_FIELDS)
            return nextNode
        })
        const withNodes = updateModelDataWithNodes(targetAny, nextNodes, false) as ModelData
        return {
            modelData: withNodes,
            nodes: extractNodesFromModel(withNodes),
            sequenceCount: targetSequences.length,
            copiedTrackCount,
            newSequenceName: newSequence.Name,
            sourceInterval,
            targetInterval,
        }
    }

    return {
        modelData: targetAny,
        nodes: extractNodesFromModel(targetAny),
        sequenceCount: targetSequences.length,
        copiedTrackCount,
        newSequenceName: newSequence.Name,
        sourceInterval,
        targetInterval,
    }
}
