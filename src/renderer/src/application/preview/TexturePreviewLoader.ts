import {
    createTexturePreviewCacheKey,
    markCacheHit,
    markCacheMiss,
    normalizeCachePath,
    RevisionedMemoryCache,
    type CacheDependencyToken,
} from '../cache'
import {
    getTextureCandidatePaths,
    isMpqTexturePath,
    loadTexturePreviewFromFile,
    loadTexturePreviewFromMpq,
} from '../../infrastructure/texture'

const MAX_TEXTURE_PREVIEW_CACHE_ENTRIES = 64

export type TexturePreviewRequest = {
    documentId?: string | null
    assetRevision: number
    modelPath?: string | null
    texturePath: string
}

const texturePreviewCache = new RevisionedMemoryCache<string | null>({
    namespace: 'texturePreview',
    maxEntries: MAX_TEXTURE_PREVIEW_CACHE_ENTRIES,
})

const isAbsolutePath = (path: string): boolean => /^[a-zA-Z]:/.test(path) || path.startsWith('\\')

const imageDataToDataUrl = (imageData: ImageData): string | null => {
    if (typeof document === 'undefined') {
        return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        return null
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL()
}

const buildTexturePreviewCacheKey = (request: TexturePreviewRequest): string => {
    return createTexturePreviewCacheKey({
        scope: 'shared-loader',
        documentId: request.documentId,
        assetRevision: request.assetRevision,
        modelPath: request.modelPath,
        texturePath: request.texturePath,
    })
}

const getTexturePreviewDependencies = (request: TexturePreviewRequest): CacheDependencyToken[] => {
    const normalizedTexturePath = normalizeCachePath(request.texturePath)
    return [
        { kind: 'assetRevision', value: request.assetRevision },
        { kind: 'mpqRevision', value: isMpqTexturePath(normalizedTexturePath), label: normalizedTexturePath },
    ]
}

const resolveLocalPreview = async (modelPath: string | null | undefined, texturePath: string): Promise<string | null> => {
    const normalizedTexturePath = normalizeCachePath(texturePath)
    const candidates = isAbsolutePath(normalizedTexturePath)
        ? [normalizedTexturePath]
        : modelPath
            ? getTextureCandidatePaths(modelPath, normalizedTexturePath)
            : [normalizedTexturePath]

    for (const candidate of candidates) {
        const imageData = await loadTexturePreviewFromFile(candidate)
        if (imageData) {
            return imageDataToDataUrl(imageData)
        }
    }

    return null
}

export const loadTexturePreviewUrl = async (request: TexturePreviewRequest): Promise<string | null> => {
    const cacheKey = buildTexturePreviewCacheKey(request)
    const cached = texturePreviewCache.getEntry(cacheKey)
    if (cached.found) {
        markCacheHit({
            source: 'frontend.texturePreview',
            namespace: 'texturePreview',
            key: cacheKey,
            count: 1,
            documentId: request.documentId ?? null,
            assetRevision: request.assetRevision,
        })
        return cached.value
    }

    markCacheMiss({
        source: 'frontend.texturePreview',
        namespace: 'texturePreview',
        key: cacheKey,
        count: 1,
        documentId: request.documentId ?? null,
        assetRevision: request.assetRevision,
    })

    const normalizedTexturePath = normalizeCachePath(request.texturePath)
    let previewUrl: string | null = null

    if (isMpqTexturePath(normalizedTexturePath)) {
        const imageData = await loadTexturePreviewFromMpq(normalizedTexturePath)
        previewUrl = imageData ? imageDataToDataUrl(imageData) : null
    } else {
        previewUrl = await resolveLocalPreview(request.modelPath, normalizedTexturePath)
        if (!previewUrl) {
            const imageData = await loadTexturePreviewFromMpq(normalizedTexturePath)
            previewUrl = imageData ? imageDataToDataUrl(imageData) : null
        }
    }

    texturePreviewCache.set(cacheKey, previewUrl, {
        dependsOn: getTexturePreviewDependencies(request),
    })
    return previewUrl
}
