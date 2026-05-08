import { normalizeSequencesForPlayback } from '../../utils/sequenceUtils'

export type SequenceCommandStalePolicy = 'warn' | 'reject'

export interface SequenceCommandRevision {
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy: SequenceCommandStalePolicy
}

export interface ApplySequenceChangesCommandPayload extends SequenceCommandRevision {
    sequences: any[]
    deletedIntervals: Array<[number, number]>
    pruneKeyframes: boolean
}

export type ApplySequenceChangesPayloadInput = {
    documentId?: string | null
    documentRevision?: number
    sequences: any[]
    deletedIntervals: Array<[number, number]>
    pruneKeyframes: boolean
}

export type ApplySequenceChangesParseResult =
    | { ok: true; payload: ApplySequenceChangesCommandPayload }
    | { ok: false; reason: string }

const normalizeDeletedIntervals = (value: unknown): Array<[number, number]> => {
    if (!Array.isArray(value)) {
        return []
    }

    return value.flatMap((entry): Array<[number, number]> => {
        if (!Array.isArray(entry) || entry.length < 2) {
            return []
        }
        const start = Number(entry[0])
        const end = Number(entry[1])
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            return []
        }
        return [[start, end]]
    })
}

export const createApplySequenceChangesPayload = ({
    documentId,
    documentRevision,
    sequences,
    deletedIntervals,
    pruneKeyframes,
}: ApplySequenceChangesPayloadInput): ApplySequenceChangesCommandPayload => ({
    documentId: documentId ?? null,
    baseDocumentRevision: documentRevision,
    stalePolicy: 'reject',
    sequences: normalizeSequencesForPlayback(sequences),
    deletedIntervals: normalizeDeletedIntervals(deletedIntervals),
    pruneKeyframes,
})

export const parseApplySequenceChangesPayload = (payload: unknown): ApplySequenceChangesParseResult => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    const candidate = payload as {
        documentId?: unknown
        baseDocumentRevision?: unknown
        stalePolicy?: unknown
        sequences?: unknown
        deletedIntervals?: unknown
        pruneKeyframes?: unknown
    }

    if (!Array.isArray(candidate.sequences)) {
        return { ok: false, reason: 'Sequences must be an array' }
    }

    return {
        ok: true,
        payload: {
            documentId: typeof candidate.documentId === 'string' || candidate.documentId === null
                ? candidate.documentId
                : null,
            baseDocumentRevision: typeof candidate.baseDocumentRevision === 'number'
                ? candidate.baseDocumentRevision
                : undefined,
            stalePolicy: candidate.stalePolicy === 'warn' ? 'warn' : 'reject',
            sequences: normalizeSequencesForPlayback(candidate.sequences),
            deletedIntervals: normalizeDeletedIntervals(candidate.deletedIntervals),
            pruneKeyframes: candidate.pruneKeyframes !== false,
        },
    }
}
