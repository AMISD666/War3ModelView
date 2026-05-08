export type TextureManagerStalePolicy = 'warn' | 'reject'

export type TextureSaveMode = 'overwrite' | 'save_as'

export type TextureManagerCommandRevision = {
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: TextureManagerStalePolicy
}

export type SaveTexturesCommandPayload = TextureManagerCommandRevision & {
    action: 'SAVE_TEXTURES'
    payload: unknown[]
}

export type PatchTextureCommandPayload = TextureManagerCommandRevision & {
    action: 'PATCH_TEXTURE'
    payload: {
        index: number
        updates: Record<string, unknown>
    }
}

export type DeleteTextureCommandPayload = TextureManagerCommandRevision & {
    action: 'DELETE_TEXTURE'
    payload: {
        index: number
    }
}

export type AddTexturesCommandPayload = TextureManagerCommandRevision & {
    action: 'ADD_TEXTURES'
    payload: {
        textures: Record<string, unknown>[]
    }
}

export type SetTextureSaveModeCommandPayload = TextureManagerCommandRevision & {
    action: 'SET_TEXTURE_SAVE_MODE'
    payload: {
        mode: TextureSaveMode
    }
}

export type SetTextureSaveSuffixCommandPayload = TextureManagerCommandRevision & {
    action: 'SET_TEXTURE_SAVE_SUFFIX'
    payload: {
        suffix: string
    }
}

export type ReloadRendererCommandPayload = TextureManagerCommandRevision & {
    action: 'RELOAD_RENDERER'
}

export type TextureManagerCommandPayload =
    | SaveTexturesCommandPayload
    | PatchTextureCommandPayload
    | DeleteTextureCommandPayload
    | AddTexturesCommandPayload
    | SetTextureSaveModeCommandPayload
    | SetTextureSaveSuffixCommandPayload
    | ReloadRendererCommandPayload

export type ParseTextureManagerCommandPayloadResult =
    | { ok: true; payload: TextureManagerCommandPayload }
    | { ok: false; reason: string }

export type TextureManagerCommandContext = {
    documentId?: string | null
    documentRevision?: number
}

export const withTextureManagerRevision = <TPayload extends TextureManagerCommandPayload>(
    context: TextureManagerCommandContext,
    payload: TPayload,
): TPayload => ({
    ...payload,
    documentId: context.documentId ?? null,
    baseDocumentRevision: context.documentRevision,
    stalePolicy: payload.stalePolicy ?? 'reject',
})

export const createSaveTexturesCommandPayload = (
    textures: unknown[],
    stalePolicy: TextureManagerStalePolicy = 'warn',
): SaveTexturesCommandPayload => ({
    action: 'SAVE_TEXTURES',
    payload: textures,
    stalePolicy,
})

export const createPatchTextureCommandPayload = (
    index: number,
    updates: Record<string, unknown>,
    stalePolicy: TextureManagerStalePolicy = 'warn',
): PatchTextureCommandPayload => ({
    action: 'PATCH_TEXTURE',
    payload: { index, updates },
    stalePolicy,
})

export const createDeleteTextureCommandPayload = (
    index: number,
    stalePolicy: TextureManagerStalePolicy = 'warn',
): DeleteTextureCommandPayload => ({
    action: 'DELETE_TEXTURE',
    payload: { index },
    stalePolicy,
})

export const createAddTexturesCommandPayload = (
    textures: Record<string, unknown>[],
    stalePolicy: TextureManagerStalePolicy = 'warn',
): AddTexturesCommandPayload => ({
    action: 'ADD_TEXTURES',
    payload: { textures },
    stalePolicy,
})

export const createSetTextureSaveModeCommandPayload = (
    mode: TextureSaveMode,
    stalePolicy: TextureManagerStalePolicy = 'warn',
): SetTextureSaveModeCommandPayload => ({
    action: 'SET_TEXTURE_SAVE_MODE',
    payload: { mode },
    stalePolicy,
})

export const createSetTextureSaveSuffixCommandPayload = (
    suffix: string,
    stalePolicy: TextureManagerStalePolicy = 'warn',
): SetTextureSaveSuffixCommandPayload => ({
    action: 'SET_TEXTURE_SAVE_SUFFIX',
    payload: { suffix },
    stalePolicy,
})

export const createReloadRendererCommandPayload = (): ReloadRendererCommandPayload => ({
    action: 'RELOAD_RENDERER',
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

export const parseTextureManagerCommandPayload = (payload: unknown): ParseTextureManagerCommandPayloadResult => {
    if (!isRecord(payload) || typeof payload.action !== 'string') {
        return { ok: false, reason: 'Payload must be an action object' }
    }

    const revision = {
        documentId: typeof payload.documentId === 'string' || payload.documentId === null
            ? payload.documentId
            : undefined,
        baseDocumentRevision: typeof payload.baseDocumentRevision === 'number'
            ? payload.baseDocumentRevision
            : undefined,
        stalePolicy: payload.stalePolicy === 'warn' ? 'warn' : 'reject' as TextureManagerStalePolicy,
    }

    if (payload.action === 'PATCH_TEXTURE') {
        if (
            !isRecord(payload.payload)
            || typeof payload.payload.index !== 'number'
            || !Number.isInteger(payload.payload.index)
            || payload.payload.index < 0
            || !isRecord(payload.payload.updates)
        ) {
            return { ok: false, reason: 'PATCH_TEXTURE requires index and updates' }
        }
        return {
            ok: true,
            payload: {
                action: 'PATCH_TEXTURE',
                payload: {
                    index: payload.payload.index,
                    updates: payload.payload.updates,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'DELETE_TEXTURE') {
        if (
            !isRecord(payload.payload)
            || typeof payload.payload.index !== 'number'
            || !Number.isInteger(payload.payload.index)
            || payload.payload.index < 0
        ) {
            return { ok: false, reason: 'DELETE_TEXTURE requires index' }
        }
        return {
            ok: true,
            payload: {
                action: 'DELETE_TEXTURE',
                payload: {
                    index: payload.payload.index,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'ADD_TEXTURES') {
        if (
            !isRecord(payload.payload)
            || !Array.isArray(payload.payload.textures)
            || payload.payload.textures.some((texture) => !isRecord(texture))
        ) {
            return { ok: false, reason: 'ADD_TEXTURES requires texture records' }
        }
        return {
            ok: true,
            payload: {
                action: 'ADD_TEXTURES',
                payload: {
                    textures: payload.payload.textures,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'SAVE_TEXTURES') {
        if (!Array.isArray(payload.payload)) {
            return { ok: false, reason: 'SAVE_TEXTURES requires an array payload' }
        }
        return {
            ok: true,
            payload: {
                action: 'SAVE_TEXTURES',
                payload: payload.payload,
                ...revision,
            },
        }
    }

    if (payload.action === 'SET_TEXTURE_SAVE_MODE') {
        if (!isRecord(payload.payload)) {
            return { ok: false, reason: 'SET_TEXTURE_SAVE_MODE requires a payload object' }
        }
        return {
            ok: true,
            payload: {
                action: 'SET_TEXTURE_SAVE_MODE',
                payload: {
                    mode: payload.payload.mode === 'save_as' ? 'save_as' : 'overwrite',
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'SET_TEXTURE_SAVE_SUFFIX') {
        if (!isRecord(payload.payload) || typeof payload.payload.suffix !== 'string') {
            return { ok: false, reason: 'SET_TEXTURE_SAVE_SUFFIX requires payload.suffix' }
        }
        return {
            ok: true,
            payload: {
                action: 'SET_TEXTURE_SAVE_SUFFIX',
                payload: {
                    suffix: payload.payload.suffix,
                },
                ...revision,
            },
        }
    }

    if (payload.action === 'RELOAD_RENDERER') {
        return {
            ok: true,
            payload: {
                action: 'RELOAD_RENDERER',
                ...revision,
            },
        }
    }

    return { ok: false, reason: 'Unsupported texture manager action' }
}
