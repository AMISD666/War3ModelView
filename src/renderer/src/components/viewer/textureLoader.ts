/**
 * textureLoader - Utility functions for loading model textures
 * Consolidates texture loading logic from Viewer.tsx
 */

// @ts-ignore
import { decodeBLP, getBLPImageData } from 'war3-model'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { logTextureInfo, logTextureLoadComplete } from '../../utils/debugLogger'

export interface TextureLoadResult {
    path: string
    loaded: boolean
    error?: string
}

/**
 * Normalize path separators to backslashes
 */
function normalizePath(p: string): string {
    return p.replace(/\//g, '\\')
}

/**
 * Check if a path looks like a standard War3 MPQ path
 */
function isMPQPath(path: string): boolean {
    return /^(Textures|UI|ReplaceableTextures|Units|Buildings|Doodads|Environment)[\\\/]/i.test(path)
}

/**
 * Load a texture from MPQ archive
 */
export async function loadTextureFromMPQ(texturePath: string): Promise<ImageData | null> {
    try {
        const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })

        if (mpqData && mpqData.length > 0) {
            const mpqBuffer = new Uint8Array(mpqData).buffer
            const blp = decodeBLP(mpqBuffer)
            const mipLevel0 = getBLPImageData(blp, 0)
            return new ImageData(
                new Uint8ClampedArray(mipLevel0.data),
                mipLevel0.width,
                mipLevel0.height
            )
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
        const texBuffer = await readFile(filePath)
        const blp = decodeBLP(texBuffer.buffer)
        const mipLevel0 = getBLPImageData(blp, 0)
        return new ImageData(
            new Uint8ClampedArray(mipLevel0.data),
            mipLevel0.width,
            mipLevel0.height
        )
    } catch (e) {
        // File loading failed
    }
    return null
}

/**
 * Generate candidate paths for a texture relative to the model directory
 */
export function getTextureCandidatePaths(modelPath: string, texturePath: string): string[] {
    const textureRelPath = normalizePath(texturePath)
    const modelDir = normalizePath(modelPath.substring(0, modelPath.lastIndexOf('\\')))

    const candidates: string[] = []

    // Primary: model dir + texture relative path
    candidates.push(`${modelDir}\\${textureRelPath}`)

    // Fallback: just filename in model dir
    const filename = textureRelPath.split('\\').pop() || ''
    if (filename !== textureRelPath) {
        candidates.push(`${modelDir}\\${filename}`)
    }

    // Try parent directories (up to 3 levels)
    let currentDir = modelDir
    for (let depth = 0; depth < 3; depth++) {
        const lastSlash = currentDir.lastIndexOf('\\')
        if (lastSlash === -1) break
        currentDir = currentDir.substring(0, lastSlash)
        candidates.push(`${currentDir}\\${textureRelPath}`)
    }

    return candidates
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

    // Strategy 1: Try MPQ first for standard War3 paths
    if (isMPQPath(texturePath)) {
        try {
            const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })
            if (mpqData && mpqData.length > 0) {
                const mpqBuffer = new Uint8Array(mpqData).buffer
                const blp = decodeBLP(mpqBuffer)
                const mipLevel0 = getBLPImageData(blp, 0)
                const imageData = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                )
                if (renderer.setTextureImageData) {
                    renderer.setTextureImageData(texturePath, [imageData])
                    console.debug(`${logPrefix} Loaded from MPQ in ${(performance.now() - startTime).toFixed(1)}ms`)
                    return true
                }
            }
        } catch (e) {
            // MPQ failed silently, continue to fallback
        }
    }

    // Strategy 2: If not a standard MPQ path but might still be in MPQ, try MPQ anyway
    if (!isMPQPath(texturePath)) {
        try {
            const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })
            if (mpqData && mpqData.length > 0) {
                const mpqBuffer = new Uint8Array(mpqData).buffer
                const blp = decodeBLP(mpqBuffer)
                const mipLevel0 = getBLPImageData(blp, 0)
                const imageData = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                )
                if (renderer.setTextureImageData) {
                    renderer.setTextureImageData(texturePath, [imageData])
                    console.debug(`${logPrefix} Loaded from MPQ (non-standard path) in ${(performance.now() - startTime).toFixed(1)}ms`)
                    return true
                }
            }
        } catch (e) {
            // MPQ fallback failed
        }
    }

    // Strategy 3: Try local file system (skip if dropped file with no real path)
    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)

        for (const candidate of candidates) {
            const fileStart = performance.now()
            const imageData = await loadTextureFromFile(candidate)
            if (imageData && renderer.setTextureImageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                console.debug(`${logPrefix} Loaded from FS (${candidate}) in ${(performance.now() - startTime).toFixed(1)}ms (File read: ${(performance.now() - fileStart).toFixed(1)}ms)`)
                return true
            }
        }
    }

    console.warn(`${logPrefix} Failed to load in ${(performance.now() - startTime).toFixed(1)}ms`)
    return false
}

/**
 * Decode a single texture to ImageData (pure data operation, can run in parallel)
 */
async function decodeTexture(
    texturePath: string,
    modelPath: string
): Promise<{ path: string; imageData: ImageData | null; error?: string }> {
    const startTime = performance.now()

    // Strategy 1: Try MPQ first for standard War3 paths
    if (isMPQPath(texturePath)) {
        try {
            const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })
            if (mpqData && mpqData.length > 0) {
                const mpqBuffer = new Uint8Array(mpqData).buffer
                const blp = decodeBLP(mpqBuffer)
                const mipLevel0 = getBLPImageData(blp, 0)
                const imageData = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                )
                console.debug(`[Texture] ${texturePath}: Decoded from MPQ in ${(performance.now() - startTime).toFixed(1)}ms`)
                return { path: texturePath, imageData }
            }
        } catch (e) {
            // MPQ failed, try file system
        }
    }

    // Strategy 2: If not a standard MPQ path, try MPQ anyway as fallback
    if (!isMPQPath(texturePath)) {
        try {
            const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })
            if (mpqData && mpqData.length > 0) {
                const mpqBuffer = new Uint8Array(mpqData).buffer
                const blp = decodeBLP(mpqBuffer)
                const mipLevel0 = getBLPImageData(blp, 0)
                const imageData = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                )
                console.debug(`[Texture] ${texturePath}: Decoded from MPQ (non-standard path) in ${(performance.now() - startTime).toFixed(1)}ms`)
                return { path: texturePath, imageData }
            }
        } catch (e) {
            // MPQ fallback failed
        }
    }

    // Strategy 3: Try local file system (skip if dropped file with no real path)
    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)
        for (const candidate of candidates) {
            const imageData = await loadTextureFromFile(candidate)
            if (imageData) {
                console.debug(`[Texture] ${texturePath}: Decoded from FS in ${(performance.now() - startTime).toFixed(1)}ms`)
                return { path: texturePath, imageData }
            }
        }
    }

    console.warn(`[Texture] ${texturePath}: Failed to decode in ${(performance.now() - startTime).toFixed(1)}ms`)
    return { path: texturePath, imageData: null, error: 'Failed to load from MPQ or file system' }
}
/**
 * Load all textures for a model
 * Uses parallel async loading (Tauri IPC is naturally parallel) + sequential WebGL upload
 */
export async function loadAllTextures(
    model: any,
    renderer: any,
    modelPath: string
): Promise<TextureLoadResult[]> {
    console.time('[Viewer] Texture Load (Batch)')
    const batchStart = performance.now()
    const results: TextureLoadResult[] = []

    if (!model.Textures) {
        console.timeEnd('[Viewer] Texture Load (Batch)')
        return results
    }

    const texturePaths = model.Textures
        .filter((texture: any) => texture.Image)
        .map((texture: any) => texture.Image as string)

    if (texturePaths.length === 0) {
        console.timeEnd('[Viewer] Texture Load (Batch)')
        return results
    }

    // Phase 1: Load and decode all textures in PARALLEL
    // Tauri's async IPC naturally parallelizes across multiple promises
    console.time('[Viewer] Texture Load+Decode (Parallel)')
    const decodePromises = texturePaths.map((path: string) => decodeTexture(path, modelPath))
    const decodedTextures = await Promise.all(decodePromises)
    console.timeEnd('[Viewer] Texture Load+Decode (Parallel)')

    // Phase 2: Upload to WebGL SEQUENTIALLY (WebGL state is not thread-safe)
    console.time('[Viewer] Texture Upload (Sequential)')
    for (const decoded of decodedTextures) {
        if (decoded.imageData && renderer.setTextureImageData) {
            renderer.setTextureImageData(decoded.path, [decoded.imageData])
            results.push({ path: decoded.path, loaded: true })
        } else {
            results.push({ path: decoded.path, loaded: false, error: decoded.error })
        }
    }
    console.timeEnd('[Viewer] Texture Upload (Sequential)')

    // Log to production CMD window
    const textureResults = decodedTextures.map((d, _i) => ({
        path: d.path,
        loaded: d.imageData !== null,
        time: undefined // timing not available per-texture in batch mode
    }))
    await logTextureInfo(textureResults)
    const loadedCount = results.filter(r => r.loaded).length
    await logTextureLoadComplete(texturePaths.length, loadedCount, performance.now() - batchStart)

    console.timeEnd('[Viewer] Texture Load (Batch)')
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
            // Create a canvas to get ImageBitmap
            const texCanvas = document.createElement('canvas')
            texCanvas.width = imageData.width
            texCanvas.height = imageData.height
            const ctx = texCanvas.getContext('2d')
            if (ctx) {
                ctx.putImageData(imageData, 0, 0)
                const img = await createImageBitmap(texCanvas)
                if (renderer.setReplaceableTexture) {
                    renderer.setReplaceableTexture(id, img)
                }
            }
        }
    }

    await loadReplaceable(teamColorPath, 1)
    await loadReplaceable(teamGlowPath, 2)
}
