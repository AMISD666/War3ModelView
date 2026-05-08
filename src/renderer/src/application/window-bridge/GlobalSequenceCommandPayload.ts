export type GlobalSequenceStalePolicy = 'warn' | 'reject'

export interface GlobalSequenceCommandEnvelope {
    action: 'SAVE'
    documentId: string | null
    baseDocumentRevision?: number
    stalePolicy: GlobalSequenceStalePolicy
}

export interface GlobalSequenceSaveCommandPayload extends GlobalSequenceCommandEnvelope {
    durations: number[]
}

export type GlobalSequenceSavePayloadInput = {
    documentId: string | null
    documentRevision: number
    durations: unknown[]
}

export type GlobalSequenceSavePayloadParseResult =
    | { ok: true; payload: GlobalSequenceSaveCommandPayload }
    | { ok: false; reason: string }

export const normalizeGlobalSequenceDurations = (durations: unknown): number[] => {
    if (!Array.isArray(durations)) {
        return []
    }

    return durations.map((duration) => Math.max(0, Math.floor(Number(duration) || 0)))
}

export const createGlobalSequenceSavePayload = ({
    documentId,
    documentRevision,
    durations,
}: GlobalSequenceSavePayloadInput): GlobalSequenceSaveCommandPayload => ({
    action: 'SAVE',
    documentId,
    baseDocumentRevision: documentRevision,
    stalePolicy: 'reject',
    durations: normalizeGlobalSequenceDurations(durations),
})

export const parseGlobalSequenceSavePayload = (payload: unknown): GlobalSequenceSavePayloadParseResult => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    const candidate = payload as {
        action?: unknown
        documentId?: unknown
        baseDocumentRevision?: unknown
        stalePolicy?: unknown
        durations?: unknown
        globalSequences?: unknown
    }

    if (candidate.action !== 'SAVE') {
        return { ok: false, reason: 'Unsupported global sequence action' }
    }

    const rawDurations = candidate.durations ?? candidate.globalSequences
    if (!Array.isArray(rawDurations)) {
        return { ok: false, reason: 'Global sequence durations must be an array' }
    }

    return {
        ok: true,
        payload: {
            action: 'SAVE',
            documentId: typeof candidate.documentId === 'string' || candidate.documentId === null
                ? candidate.documentId
                : null,
            baseDocumentRevision: typeof candidate.baseDocumentRevision === 'number'
                ? candidate.baseDocumentRevision
                : undefined,
            stalePolicy: candidate.stalePolicy === 'warn' ? 'warn' : 'reject',
            durations: normalizeGlobalSequenceDurations(rawDurations),
        },
    }
}
