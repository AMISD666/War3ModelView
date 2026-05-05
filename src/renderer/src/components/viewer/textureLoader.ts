/**
 * textureLoader - Utility functions for loading model textures
 * Consolidates texture loading logic from Viewer.tsx
 */

import { desktopGateway } from '../../infrastructure/desktop'
import { decodeWar3BlpMipToImageData } from '../../infrastructure/texture'
import { TextureAdjustments } from '../../utils/textureAdjustments'
import { invokeReadMpqFile } from '../../utils/mpqPerf'
import {
    createTextureDecodeCacheDependencies,
    createTextureDecodeCacheKey,
    getCachedDecodedTexture,
    setCachedDecodedTexture,
} from './textureDecodeCache'
import { markStandalonePerf } from '../../utils/standalonePerf'
import { markCacheHit, markCacheMiss } from '../../application/cache'
import {
    getTextureCandidatePaths,
    normalizePath,
    prepareModelForTextureLoad,
    REPLACEABLE_TEXTURES,
    TextureLoadContext,
    isMPQPath,
} from './texturePathHelpers'
import { decodePngImageData, decodeTextureData, decodeTextureDataAsync, DecodeTextureOptions } from './textureDecoder'
import {
    parseTextureBytesPayload,
    toTightArrayBuffer,
} from './textureBufferUtils'
import {
    DecodedTextureImage,
    decodeBatchWithWorkerPool,
    normalizeWorkers,
    WorkerLike,
} from './textureWorkerDecode'

export interface TextureLoadResult {
    path: string
    loaded: boolean
    error?: string
}

export {
    decodeTextureData,
    decodeTextureDataAsync,
    getTextureCandidatePaths,
    isMPQPath,
    normalizePath,
    prepareModelForTextureLoad,
    REPLACEABLE_TEXTURES,
}

export type {
    DecodeTextureOptions,
    TextureLoadContext,
    WorkerLike,
}

/**
 * Load a texture from MPQ archive
 */
export async function loadTextureFromMPQ(texturePath: string): Promise<ImageData | null> {
    try {
        const mpqData = await invokeReadMpqFile<Uint8Array>(normalizePath(texturePath), 'textureLoader.loadTextureFromMPQ')

        if (mpqData && mpqData.length > 0) {
            return decodeWar3BlpMipToImageData(toTightArrayBuffer(mpqData), 0)
        }
    } catch (e) {
        // MPQ loading failed
    }
    return null
}

/**
 * Load a texture from local file system
 */
export async function loadTextureFromFile(filePath: string): Promise<ImageData | null> {
    try {
        const texBuffer = await desktopGateway.readFile(filePath)
        if (filePath.toLowerCase().endsWith('.png')) {
            return await decodePngImageData(texBuffer)
        }
        return await decodeTextureDataAsync(toTightArrayBuffer(texBuffer), filePath)
    } catch (e) {
        // File loading failed
    }
    return null
}

/**
 * Load a texture for a model renderer
 * Tries MPQ first for standard War3 paths, then falls back to local file system
 */
export async function loadTextureForRenderer(
    renderer: any,
    texturePath: string,
    modelPath: string
): Promise<boolean> {
    if (!texturePath) return false

    const startTime = performance.now()
    const logPrefix = `[Texture] ${texturePath}:`

    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)

        for (const candidate of candidates) {
            const imageData = await loadTextureFromFile(candidate)
            if (imageData && renderer.setTextureImageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                return true
            }
        }
    }

    try {
        const mpqData = await invokeReadMpqFile<Uint8Array>(normalizePath(texturePath), 'textureLoader.loadTextureForRenderer')
        if (mpqData && mpqData.length > 0) {
            const imageData = await decodeTextureDataAsync(toTightArrayBuffer(mpqData), texturePath)
            if (imageData && renderer.setTextureImageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                return true
            }
        }
    } catch (e) {
        // MPQ failed
    }

    console.warn(`${logPrefix} Failed to load in ${(performance.now() - startTime).toFixed(1)}ms`)
    return false
}

/**
 * Decode a single texture to ImageData (pure data operation, can run in parallel)
 */
export async function decodeTexture(
    texturePath: string,
    modelPath: string,
    options?: DecodeTextureOptions
): Promise<{ path: string; imageData: ImageData | null; error?: string }> {
    const startTime = performance.now()

    const decodeBuffer = async (buffer: ArrayBuffer) => {
        if (texturePath.toLowerCase().endsWith('.png') && modelPath && !modelPath.startsWith('dropped:')) {
            return await decodePngImageData(new Uint8Array(buffer))
        }
        return await decodeTextureDataAsync(buffer, texturePath, options)
    }

    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)
        for (const candidate of candidates) {
            const texBuffer = await desktopGateway.readFile(candidate).catch(() => null)
            if (texBuffer) {
                try {
                    const imageData = await decodeBuffer(toTightArrayBuffer(texBuffer))
                    if (!imageData) continue
                    return { path: texturePath, imageData }
                } catch (e) {
                    console.warn(`[Texture] Failed to decode found file ${candidate}:`, e)
                }
            }
        }
    }

    try {
        const mpqData = await invokeReadMpqFile<Uint8Array>(normalizePath(texturePath), 'textureLoader.decodeTexture.primaryMpq')
        if (mpqData && mpqData.length > 0) {
            const imageData = await decodeBuffer(toTightArrayBuffer(mpqData))
            if (!imageData) {
                return { path: texturePath, imageData: null, error: 'Decode failed' }
            }
            return { path: texturePath, imageData }
        }
    } catch (e) {
        // MPQ failed
    }

    try {
        const mpqData = await invokeReadMpqFile<Uint8Array>(normalizePath(texturePath), 'textureLoader.decodeTexture.fallbackMpq')
        if (mpqData && mpqData.length > 0) {
            const imageData = await decodeBuffer(toTightArrayBuffer(mpqData))
            if (!imageData) {
                return { path: texturePath, imageData: null, error: 'Decode failed' }
            }
            return { path: texturePath, imageData }
        }
    } catch (e) {
        // Final fail
    }

    console.warn(`[Texture] ${texturePath}: Failed to decode in ${(performance.now() - startTime).toFixed(1)}ms`)
    return { path: texturePath, imageData: null, error: 'Failed to load from MPQ or file system' }
}

function createDecodeOptionsByPath(
    paths: Iterable<string>,
    textureAdjustmentsByPath: Map<string, TextureAdjustments>,
    alphaRequiredTexturePaths: Set<string>,
    maxDimension?: number
): Map<string, DecodeTextureOptions> {
    const optionsByPath = new Map<string, DecodeTextureOptions>()
    for (const path of paths) {
        optionsByPath.set(path, {
            adjustments: textureAdjustmentsByPath.get(path),
            maxDimension,
            preferBlpBaseMip: alphaRequiredTexturePaths.has(path),
            forceOpaqueAlpha: false,
        })
    }
    return optionsByPath
}

export async function loadAllTextures(
    model: any,
    renderer: any,
    modelPath: string,
    worker?: WorkerLike | WorkerLike[],
    maxDimension?: number,
    options?: {
        yieldUploads?: boolean
        uploadYieldBatch?: number
        uploadFrameBudgetMs?: number
        workerDecodeMinTextures?: number
        workerDecodeMinBytes?: number
        targetPaths?: string[]
        /** 若已由 prepareModelForTextureLoad 准备，则不再重复解析路径与修改 model */
        textureLoadContext?: TextureLoadContext
        /** 与 textureLoadContext 配合：提前发起的 Rust 批量读，可与 WebGL 初始化并行 */
        batchPayloadPromise?: Promise<Uint8Array>
    }
): Promise<TextureLoadResult[]> {
    const results: TextureLoadResult[] = []
    const perfStart = performance.now()

    if (!model.Textures) {
        return results
    }

    const ctx =
        options?.textureLoadContext ??
        prepareModelForTextureLoad(model, { targetPaths: options?.targetPaths })

    const { effectiveTexturePaths, alphaRequiredTexturePaths, textureAdjustmentsByPath } = ctx

    if (effectiveTexturePaths.length === 0) {
        return results
    }

    const decodedTextures = new Map<string, DecodedTextureImage>()
    const decodeCacheKeys = new Map<string, string>()
    const decodeCacheDependencies = new Map<string, ReturnType<typeof createTextureDecodeCacheDependencies>>()
    const workers = normalizeWorkers(worker)
    let readMs = 0
    let decodeMs = 0
    let uploadMs = 0
    let cacheHits = 0
    let decodedCount = 0

    try {
        const readStart = performance.now()
        const payload =
            options?.batchPayloadPromise != null
                ? await options.batchPayloadPromise
                : await desktopGateway.invoke<Uint8Array>('load_textures_batch_bin', {
                      modelPath,
                      texturePaths: effectiveTexturePaths
                  })
        readMs = performance.now() - readStart
        const decodedBatch = parseTextureBytesPayload(payload, effectiveTexturePaths)
        const entries = Array.from(decodedBatch.entries())
        const uncachedEntries: Array<[string, Uint8Array]> = []
        const textureOptionsByPath = createDecodeOptionsByPath(
            decodedBatch.keys(),
            textureAdjustmentsByPath,
            alphaRequiredTexturePaths,
            maxDimension
        )

        for (const [path, bytes] of entries) {
            const textureOptions = textureOptionsByPath.get(path)
            const cacheKey = createTextureDecodeCacheKey(path, bytes, textureOptions)
            const dependencies = createTextureDecodeCacheDependencies(path, bytes, textureOptions)
            decodeCacheKeys.set(path, cacheKey)
            decodeCacheDependencies.set(path, dependencies)

            const cachedImage = getCachedDecodedTexture(cacheKey)
            if (cachedImage) {
                decodedTextures.set(path, cachedImage)
                cacheHits += 1
            } else {
                uncachedEntries.push([path, bytes])
            }
        }

        if (cacheHits > 0) {
            markCacheHit({
                source: 'frontend.textureDecode',
                namespace: 'textureDecode',
                modelPath,
                count: cacheHits,
                requested: entries.length,
                maxDimension: maxDimension ?? null,
            })
        }

        if (uncachedEntries.length > 0) {
            markCacheMiss({
                source: 'frontend.textureDecode',
                namespace: 'textureDecode',
                modelPath,
                count: uncachedEntries.length,
                requested: entries.length,
                maxDimension: maxDimension ?? null,
            })
        }

        const decodeStart = performance.now()
        const totalBytes = uncachedEntries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0)
        // 降低门槛：多数角色模贴图数量在 3～5 张且单张不大，走 Worker 池并行解码可明显缩短主线程阻塞
        const workerDecodeMinTextures = options?.workerDecodeMinTextures ?? 3
        const workerDecodeMinBytes = options?.workerDecodeMinBytes ?? Math.floor(1.5 * 1024 * 1024)
        const useWorkerPool =
            workers.length > 0 &&
            uncachedEntries.length >= workerDecodeMinTextures &&
            totalBytes >= workerDecodeMinBytes

        if (useWorkerPool) {
            const pooled = await decodeBatchWithWorkerPool(
                uncachedEntries,
                workers,
                textureOptionsByPath,
                maxDimension
            )
            for (const [path, image] of pooled.entries()) {
                decodedTextures.set(path, image)
                decodedCount += 1
                const cacheKey = decodeCacheKeys.get(path)
                if (cacheKey) {
                    setCachedDecodedTexture(cacheKey, image, decodeCacheDependencies.get(path))
                }
            }
        } else {
            for (const [path, bytes] of uncachedEntries) {
                const imageData = await decodeTextureDataAsync(toTightArrayBuffer(bytes), path, textureOptionsByPath.get(path))
                if (imageData) {
                    decodedTextures.set(path, imageData)
                    decodedCount += 1
                    const cacheKey = decodeCacheKeys.get(path)
                    if (cacheKey) {
                        setCachedDecodedTexture(cacheKey, imageData, decodeCacheDependencies.get(path))
                    }
                }
            }
        }
        decodeMs = performance.now() - decodeStart
    } catch (e) {
        console.error('[Viewer] Texture batch load failed:', e)
    }

    const shouldYieldUploads = !!options?.yieldUploads
    const uploadYieldBatch = Math.max(1, Math.floor(options?.uploadYieldBatch ?? 4))
    const uploadFrameBudgetMs = Math.max(1, options?.uploadFrameBudgetMs ?? 8)
    let uploadedSinceYield = 0
    let uploadBatchStart = performance.now()
    const uploadStart = performance.now()
    for (const path of effectiveTexturePaths) {
        const imageData = decodedTextures.get(path)
        if (imageData && renderer.setTextureImageData) {
            renderer.setTextureImageData(path, [imageData])
            results.push({ path, loaded: true })
            if (shouldYieldUploads) {
                uploadedSinceYield++
            }
            if (
                shouldYieldUploads &&
                (uploadedSinceYield >= uploadYieldBatch || performance.now() - uploadBatchStart >= uploadFrameBudgetMs)
            ) {
                uploadedSinceYield = 0
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
                uploadBatchStart = performance.now()
            }
        } else {
            results.push({ path, loaded: false, error: 'Not found in FS or MPQ' })
        }
    }
    uploadMs = performance.now() - uploadStart

    markStandalonePerf('model_texture_load', {
        modelPath,
        requested: effectiveTexturePaths.length,
        found: decodedTextures.size,
        loaded: results.filter((result) => result.loaded).length,
        cacheHits,
        decoded: decodedCount,
        workerCount: workers.length,
        readMs: Number(readMs.toFixed(2)),
        decodeMs: Number(decodeMs.toFixed(2)),
        uploadMs: Number(uploadMs.toFixed(2)),
        totalMs: Number((performance.now() - perfStart).toFixed(2)),
        yieldedUploads: shouldYieldUploads,
    })

    return results
}

/**
 * Load team color textures (replaceable textures 1 and 2)
 */
export async function loadTeamColorTextures(
    renderer: any,
    colorIndex: number
): Promise<void> {
    if (!renderer) return

    const idStr = colorIndex.toString().padStart(2, '0')
    const teamColorPath = `ReplaceableTextures\\TeamColor\\TeamColor${idStr}.blp`
    const teamGlowPath = `ReplaceableTextures\\TeamGlow\\TeamGlow${idStr}.blp`

    const loadReplaceable = async (path: string, id: number) => {
        const imageData = await loadTextureFromMPQ(path)
        if (imageData) {
            // CRITICAL: Directly use imageData with premultiplyAlpha='none' to avoid Canvas API destroying RGB data on transparent pixels
            const img = await createImageBitmap(imageData, { premultiplyAlpha: 'none' })
            if (renderer.setReplaceableTexture) {
                renderer.setReplaceableTexture(id, img)
            }
        }
    }

    await Promise.all([loadReplaceable(teamColorPath, 1), loadReplaceable(teamGlowPath, 2)])
}
