const TEXTURE_PREVIEW_CACHE_KEY_VERSION = 'v3'

export interface TexturePreviewCacheKeyInput {
    scope: string
    documentId?: string | null
    assetRevision: number
    modelPath?: string | null
    texturePath?: string | null
    textureSignature?: string | null
}

export const normalizeCachePath = (path: string | null | undefined): string => {
    if (!path) return ''
    let normalized = path.replace(/\0/g, '').trim()
    normalized = normalized.replace(/\//g, '\\')
    if (normalized.startsWith('.\\')) {
        normalized = normalized.slice(2)
    }
    if (!normalized.startsWith('\\\\')) {
        while (normalized.startsWith('\\')) {
            normalized = normalized.slice(1)
        }
    }
    return normalized.replace(/\\\\+/g, '\\')
}

export const createTexturePreviewCacheKey = (input: TexturePreviewCacheKeyInput): string => [
    'texturePreview',
    TEXTURE_PREVIEW_CACHE_KEY_VERSION,
    input.scope,
    input.documentId || '',
    input.assetRevision,
    normalizeCachePath(input.modelPath).toLowerCase(),
    normalizeCachePath(input.texturePath).toLowerCase(),
    input.textureSignature || '',
].join('::')
