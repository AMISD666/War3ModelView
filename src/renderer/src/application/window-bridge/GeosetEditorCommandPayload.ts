export type GeosetEditorStalePolicy = 'warn' | 'reject'

export type GeosetEditorCommandAction = 'SAVE_ALL'

export interface GeosetEditorCommandEnvelope {
    type: 'geoset-editor-command'
    action: GeosetEditorCommandAction
    documentId: string | null
    baseDocumentRevision?: number
    stalePolicy: GeosetEditorStalePolicy
}

export interface SaveAllGeosetsCommandPayload extends GeosetEditorCommandEnvelope {
    geosets: unknown[]
}

export type CreateSaveAllGeosetsCommandInput = {
    documentId: string | null
    documentRevision: number
    geosets: unknown[]
    stalePolicy?: GeosetEditorStalePolicy
}

export type ParseSaveAllGeosetsCommandResult =
    | { ok: true; payload: SaveAllGeosetsCommandPayload }
    | { ok: false; reason: string }

export const createSaveAllGeosetsCommandPayload = ({
    documentId,
    documentRevision,
    geosets,
    stalePolicy = 'reject',
}: CreateSaveAllGeosetsCommandInput): SaveAllGeosetsCommandPayload => ({
    type: 'geoset-editor-command',
    action: 'SAVE_ALL',
    documentId,
    baseDocumentRevision: documentRevision,
    stalePolicy,
    geosets,
})

export const parseSaveAllGeosetsCommandPayload = (payload: unknown): ParseSaveAllGeosetsCommandResult => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    const candidate = payload as {
        type?: unknown
        action?: unknown
        documentId?: unknown
        baseDocumentRevision?: unknown
        stalePolicy?: unknown
        geosets?: unknown
        payload?: unknown
    }

    if (candidate.action !== 'SAVE_ALL') {
        return { ok: false, reason: 'Unsupported geoset editor action' }
    }

    if (candidate.type !== undefined && candidate.type !== 'geoset-editor-command') {
        return { ok: false, reason: 'Unsupported geoset editor payload type' }
    }

    const geosets = candidate.geosets ?? candidate.payload
    if (!Array.isArray(geosets)) {
        return { ok: false, reason: 'Geosets must be an array' }
    }

    return {
        ok: true,
        payload: {
            type: 'geoset-editor-command',
            action: 'SAVE_ALL',
            documentId: typeof candidate.documentId === 'string' || candidate.documentId === null
                ? candidate.documentId
                : null,
            baseDocumentRevision: typeof candidate.baseDocumentRevision === 'number'
                ? candidate.baseDocumentRevision
                : undefined,
            stalePolicy: candidate.stalePolicy === 'warn' ? 'warn' : 'reject',
            geosets,
        },
    }
}
