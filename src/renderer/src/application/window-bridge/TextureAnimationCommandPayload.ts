export type TextureAnimationStalePolicy = 'warn' | 'reject'

export type TextureAnimationAction = 'ADD' | 'DELETE' | 'UPDATE' | 'TOGGLE_BLOCK' | 'SAVE_ALL'

export interface TextureAnimationCommandEnvelope {
    type: 'texture-animation-command'
    action: TextureAnimationAction
    documentId: string | null
    baseDocumentRevision?: number
    stalePolicy: TextureAnimationStalePolicy
}

export interface TextureAnimationCommandPayload extends TextureAnimationCommandEnvelope {
    textureAnims: unknown[]
    deleteIndex?: number
}

export interface CreateTextureAnimationCommandInput {
    action: TextureAnimationAction
    documentId: string | null
    documentRevision: number
    textureAnims: unknown[]
    deleteIndex?: number
    stalePolicy?: TextureAnimationStalePolicy
}

export type ParseTextureAnimationCommandResult =
    | { ok: true; payload: TextureAnimationCommandPayload }
    | { ok: false; reason: string }

const isTextureAnimationAction = (action: unknown): action is TextureAnimationAction =>
    action === 'ADD'
    || action === 'DELETE'
    || action === 'UPDATE'
    || action === 'TOGGLE_BLOCK'
    || action === 'SAVE_ALL'

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null

export const createTextureAnimationCommandPayload = ({
    action,
    documentId,
    documentRevision,
    textureAnims,
    deleteIndex,
    stalePolicy = 'reject',
}: CreateTextureAnimationCommandInput): TextureAnimationCommandPayload => ({
    type: 'texture-animation-command',
    action,
    documentId,
    baseDocumentRevision: documentRevision,
    stalePolicy,
    textureAnims,
    ...(typeof deleteIndex === 'number' ? { deleteIndex } : {}),
})

export const parseTextureAnimationCommandPayload = (payload: unknown): ParseTextureAnimationCommandResult => {
    const record = asRecord(payload)
    if (!record) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    if (record.type !== undefined && record.type !== 'texture-animation-command') {
        return { ok: false, reason: 'Unsupported texture animation payload type' }
    }

    if (!isTextureAnimationAction(record.action)) {
        return { ok: false, reason: 'Unsupported texture animation action' }
    }

    const legacyPayload = record.payload
    const legacyRecord = asRecord(legacyPayload)
    const textureAnims = Array.isArray(record.textureAnims)
        ? record.textureAnims
        : Array.isArray(legacyRecord?.newAnims)
            ? legacyRecord.newAnims
            : Array.isArray(legacyPayload)
                ? legacyPayload
                : null

    if (!textureAnims) {
        return { ok: false, reason: 'Texture animation list must be an array' }
    }

    const rawDeleteIndex = record.deleteIndex ?? legacyRecord?.deleteIndex
    if (record.action === 'DELETE' && typeof rawDeleteIndex !== 'number') {
        return { ok: false, reason: 'DELETE requires deleteIndex' }
    }

    return {
        ok: true,
        payload: {
            type: 'texture-animation-command',
            action: record.action,
            documentId: typeof record.documentId === 'string' || record.documentId === null
                ? record.documentId
                : null,
            baseDocumentRevision: typeof record.baseDocumentRevision === 'number'
                ? record.baseDocumentRevision
                : undefined,
            stalePolicy: record.stalePolicy === 'warn' ? 'warn' : 'reject',
            textureAnims,
            ...(typeof rawDeleteIndex === 'number' ? { deleteIndex: rawDeleteIndex } : {}),
        },
    }
}
