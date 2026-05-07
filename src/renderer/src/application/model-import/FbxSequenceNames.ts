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

const hasStandLikeStack = (rawNames: string[]): boolean =>
    rawNames.some((name) => {
        const normalized = normalizeWords(name)
        return normalized === 'idle' || normalized === 'stand'
    })

const isSpellLikeName = (normalized: string): boolean =>
    normalized === 'magic'
    || normalized.startsWith('magic ')
    || normalized === 'spell'
    || normalized.startsWith('spell ')
    || normalized === 'cast'
    || normalized.startsWith('cast ')

const isAttackLikeName = (normalized: string): boolean =>
    normalized === 'attack'
    || normalized.startsWith('attack ')

const getSpellOccurrence = (rawNames: string[], index: number): number => {
    let occurrence = 0
    for (let nameIndex = 0; nameIndex <= index; nameIndex += 1) {
        if (isSpellLikeName(normalizeWords(rawNames[nameIndex] ?? ''))) {
            occurrence += 1
        }
    }
    return Math.max(1, occurrence)
}

const getAttackOccurrence = (rawNames: string[], index: number): number => {
    let occurrence = 0
    for (let nameIndex = 0; nameIndex <= index; nameIndex += 1) {
        if (isAttackLikeName(normalizeWords(rawNames[nameIndex] ?? ''))) {
            occurrence += 1
        }
    }
    return Math.max(1, occurrence)
}

export const makeWar3SequenceNameFromFbxStack = (
    rawName: string | undefined,
    index: number,
    rawNames: string[],
): string => {
    const trimmedName = rawName?.trim() ?? ''
    const normalized = normalizeWords(trimmedName)

    if (!normalized) {
        return `${FALLBACK_SEQUENCE_PREFIX}_${index + 1}`
    }
    if (normalized === 'idle' || normalized === 'stand') {
        return 'Stand'
    }
    if (normalized === 'rest') {
        return hasStandLikeStack(rawNames) ? 'Birth' : 'Stand'
    }
    if (normalized === 'birth') {
        return 'Birth'
    }
    if (normalized === 'run' || normalized === 'running' || normalized === 'walk' || normalized === 'walking') {
        return 'Walk'
    }
    if (normalized === 'die' || normalized === 'death') {
        return 'Death'
    }
    if (normalized === 'dead') {
        return rawNames.some((name) => ['die', 'death'].includes(normalizeWords(name))) ? 'Decay' : 'Death'
    }
    if (isSpellLikeName(normalized)) {
        return `Spell ${getSpellOccurrence(rawNames, index)}`
    }
    if (isAttackLikeName(normalized)) {
        const occurrence = getAttackOccurrence(rawNames, index)
        return occurrence === 1 ? 'Attack' : `Attack ${occurrence}`
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
