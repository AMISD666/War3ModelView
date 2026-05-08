import type { Sequence } from '../../types/model'

const FALLBACK_SEQUENCE_PREFIX = 'FBX_Anim'

const normalizeWords = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/([a-z])(\d)/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

export const makeWar3SequenceNameFromFbxStack = (
    rawName: string | undefined,
    index: number,
    rawNames: string[],
): string => {
    void rawNames
    const trimmedName = rawName?.trim() ?? ''
    if (!normalizeWords(trimmedName)) {
        return `${FALLBACK_SEQUENCE_PREFIX}_${index + 1}`
    }

    return trimmedName
}

export const applyWar3SequenceMetadata = (sequence: Sequence): Sequence => {
    const normalized = normalizeWords(sequence.Name)
    if (normalized === 'walk' && sequence.MoveSpeed === undefined) {
        return { ...sequence, MoveSpeed: 270 }
    }
    if ((normalized === 'attack' || normalized.startsWith('attack ') || normalized === 'death') && !sequence.NonLooping) {
        return { ...sequence, NonLooping: true }
    }
    return sequence
}
