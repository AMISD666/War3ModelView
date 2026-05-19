export type GeosetAnimationStalePolicy = 'warn' | 'reject'

export interface GeosetAnimationCommandEnvelope {
    action: 'UPDATE_GEOSET_ANIMS'
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy: GeosetAnimationStalePolicy
}

export interface UpdateGeosetAnimsCommandPayload extends GeosetAnimationCommandEnvelope {
    payload: {
        geosetAnims: unknown[]
    }
}

export type UpdateGeosetAnimsPayloadInput = {
    documentId?: string | null
    documentRevision?: number
    stalePolicy?: GeosetAnimationStalePolicy
    geosetAnims: unknown[]
}

export type UpdateGeosetAnimsParseResult =
    | { ok: true; payload: UpdateGeosetAnimsCommandPayload }
    | { ok: false; reason: string }

export const createUpdateGeosetAnimsPayload = ({
    documentId,
    documentRevision,
    stalePolicy = 'warn',
    geosetAnims,
}: UpdateGeosetAnimsPayloadInput): UpdateGeosetAnimsCommandPayload => ({
    action: 'UPDATE_GEOSET_ANIMS',
    documentId: documentId ?? null,
    baseDocumentRevision: documentRevision,
    stalePolicy,
    payload: { geosetAnims },
})

export const parseUpdateGeosetAnimsPayload = (payload: unknown): UpdateGeosetAnimsParseResult => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    const candidate = payload as {
        action?: unknown
        documentId?: unknown
        baseDocumentRevision?: unknown
        stalePolicy?: unknown
        payload?: unknown
    }
    const actionPayload = candidate.payload && typeof candidate.payload === 'object' && !Array.isArray(candidate.payload)
        ? candidate.payload as { geosetAnims?: unknown }
        : null

    if (candidate.action !== 'UPDATE_GEOSET_ANIMS') {
        return { ok: false, reason: 'Unsupported geoset animation action' }
    }

    if (!Array.isArray(actionPayload?.geosetAnims)) {
        return { ok: false, reason: 'Geoset animations must be provided as payload.geosetAnims' }
    }

    return {
        ok: true,
        payload: {
            action: 'UPDATE_GEOSET_ANIMS',
            documentId: typeof candidate.documentId === 'string' || candidate.documentId === null
                ? candidate.documentId
                : null,
            baseDocumentRevision: typeof candidate.baseDocumentRevision === 'number'
                ? candidate.baseDocumentRevision
                : undefined,
            stalePolicy: candidate.stalePolicy === 'warn' ? 'warn' : 'reject',
            payload: {
                geosetAnims: actionPayload.geosetAnims,
            },
        },
    }
}
