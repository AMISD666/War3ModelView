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

// TGA Constants
const TGA_TYPE_NO_DATA = 0
const TGA_TYPE_INDEXED = 1
const TGA_TYPE_RGB = 2
const TGA_TYPE_GREY = 3
const TGA_TYPE_RLE_INDEXED = 9
const TGA_TYPE_RLE_RGB = 10
const TGA_TYPE_RLE_GREY = 11

const TGA_ORIGIN_MASK = 0x30
const TGA_ORIGIN_SHIFT = 0x04
const TGA_ORIGIN_BL = 0x00
const TGA_ORIGIN_BR = 0x10
const TGA_ORIGIN_UL = 0x20
const TGA_ORIGIN_UR = 0x30

/**
 * Decode TGA buffer to ImageData
 * Supports: 8, 16, 24, 32 bit, RLE compressed or uncompressed, RGB/Grey/Indexed
 */
function decodeTGA(buffer: ArrayBuffer): ImageData {
    const view = new DataView(buffer)
    const header = {
        idLength: view.getUint8(0),
        colorMapType: view.getUint8(1),
        imageType: view.getUint8(2),
        colorMapIndex: view.getUint16(3, true),
        colorMapLength: view.getUint16(5, true),
        colorMapDepth: view.getUint8(7),
        xOrigin: view.getUint16(8, true),
        yOrigin: view.getUint16(10, true),
        width: view.getUint16(12, true),
        height: view.getUint16(14, true),
        pixelDepth: view.getUint8(16),
        imageDesc: view.getUint8(17)
    }

    // Check validation of header
    if ((header.width <= 0 || header.height <= 0) ||
        (header.pixelDepth !== 8 && header.pixelDepth !== 16 && header.pixelDepth !== 24 && header.pixelDepth !== 32)) {
        throw new Error('Invalid TGA header')
    }

    const tgaData = new Uint8Array(buffer, 18 + header.idLength + (header.colorMapType === 1 ? header.colorMapLength * (header.colorMapDepth >> 3) : 0))
    const pixelCount = header.width * header.height
    const bytesPerPixel = header.pixelDepth >> 3
    const outputData = new Uint8ClampedArray(pixelCount * 4)

    let offset = 0
    let pixelIndex = 0

    // Helper to get pixel color based on format
    // Returns [r, g, b, a]
    const getPixel = (data: Uint8Array, idx: number, depth: number): number[] => {
        if (depth === 24) { // BGR
            return [data[idx + 2], data[idx + 1], data[idx], 255]
        } else if (depth === 32) { // BGRA
            return [data[idx + 2], data[idx + 1], data[idx], data[idx + 3]]
        } else if (depth === 8) { // Grey
            const v = data[idx]
            return [v, v, v, 255]
        } else if (depth === 16) { // 16-bit BGRA (1-5-5-5)
            // Complex handling omitted for brevity, fallback black
            // War3 usually uses 24/32
            // 实际上 War3 TGA 大多是 24/32 位
            const val = data[idx] | (data[idx + 1] << 8)
            const r = (val & 0x7C00) >> 10
            const g = (val & 0x03E0) >> 5
            const b = (val & 0x001F)
            return [(r * 255) / 31, (g * 255) / 31, (b * 255) / 31, (val & 0x8000) ? 255 : 0]
        }
        return [0, 0, 0, 0]
    }

    // Decoding Loop
    const isRLE = header.imageType === TGA_TYPE_RLE_RGB || header.imageType === TGA_TYPE_RLE_GREY || header.imageType === TGA_TYPE_RLE_INDEXED

    if (isRLE) {
        let pixelsProcessed = 0
        while (pixelsProcessed < pixelCount) {
            const chunkHeader = tgaData[offset++]
            const chunkPixelCount = (chunkHeader & 0x7F) + 1
            const isRLEChunk = (chunkHeader & 0x80) !== 0

            if (isRLEChunk) {
                // Read next pixel value and repeat it
                const rlePixelStart = offset
                // For 24/32 bit, read bytes directly
                // Optimization: just use getPixel
                const pixelVal = getPixel(tgaData, offset, header.pixelDepth)
                offset += bytesPerPixel

                for (let i = 0; i < chunkPixelCount; i++) {
                    outputData[pixelIndex * 4] = pixelVal[0]
                    outputData[pixelIndex * 4 + 1] = pixelVal[1]
                    outputData[pixelIndex * 4 + 2] = pixelVal[2]
                    outputData[pixelIndex * 4 + 3] = pixelVal[3]
                    pixelIndex++
                }
            } else {
                // Raw chunk, read next N pixels
                for (let i = 0; i < chunkPixelCount; i++) {
                    const pixelVal = getPixel(tgaData, offset, header.pixelDepth)
                    outputData[pixelIndex * 4] = pixelVal[0]
                    outputData[pixelIndex * 4 + 1] = pixelVal[1]
                    outputData[pixelIndex * 4 + 2] = pixelVal[2]
                    outputData[pixelIndex * 4 + 3] = pixelVal[3]
                    offset += bytesPerPixel
                    pixelIndex++
                }
            }
            pixelsProcessed += chunkPixelCount
        }
    } else {
        // Uncompressed
        for (let i = 0; i < pixelCount; i++) {
            const pixelVal = getPixel(tgaData, offset, header.pixelDepth)
            outputData[i * 4] = pixelVal[0]
            outputData[i * 4 + 1] = pixelVal[1]
            outputData[i * 4 + 2] = pixelVal[2]
            outputData[i * 4 + 3] = pixelVal[3]
            offset += bytesPerPixel
        }
    }

    // Handle Orientation (Flip Vertical if Bottom-Left)
    // TGA standard: Origin logic. Bits 5 & 4 of Image Desc.
    // 00 = Bottom-Left (Default for OpenGL, need flip for Canvas?)
    // Canvas 0,0 is Top-Left. TGA 0,0 bottom-left means it's upside down in memory relative to Canvas.
    // Usually need to flip Y if origin is Bottom-Left (which is 0x00).
    // EXCEPT: ImageData expects Top-Left.
    // If TGA is BL (0x00), data starts at bottom row. We need to flip it to be TL.
    const imageDesc = header.imageDesc
    const origin = (imageDesc & TGA_ORIGIN_MASK) >> TGA_ORIGIN_SHIFT
    // 0 = Bottom-Left, 1 = Bottom-Right, 2 = Top-Left, 3 = Top-Right

    if (origin === 0 || origin === 1) { // Bottom origin
        // Flip Vertical
        const rowBytes = header.width * 4
        const halfHeight = Math.floor(header.height / 2)
        const tempRow = new Uint8ClampedArray(rowBytes)
        for (let y = 0; y < halfHeight; y++) {
            const topRowIdx = y * rowBytes
            const botRowIdx = (header.height - 1 - y) * rowBytes

            // Swap rows
            tempRow.set(outputData.subarray(topRowIdx, topRowIdx + rowBytes))
            outputData.set(outputData.subarray(botRowIdx, botRowIdx + rowBytes), topRowIdx)
            outputData.set(tempRow, botRowIdx)
        }
    }

    // Flip Horizontal if Right origin (rare)
    if (origin === 1 || origin === 3) {
        // ... omitted for now, very rare in War3 textures
    }

    return new ImageData(outputData, header.width, header.height)
}

/**
 * Decode a single texture to ImageData (pure data operation, can run in parallel)
 */
async function decodeTexture(
    texturePath: string,
    modelPath: string
): Promise<{ path: string; imageData: ImageData | null; error?: string }> {
    const startTime = performance.now()
    const isTga = texturePath.toLowerCase().endsWith('.tga')

    // Helper to decode buffer based on type
    const decodeBuffer = (buffer: ArrayBuffer, isTgaFile: boolean) => {
        if (isTgaFile) {
            return decodeTGA(buffer)
        } else {
            const blp = decodeBLP(buffer)
            const mipLevel0 = getBLPImageData(blp, 0)
            return new ImageData(
                new Uint8ClampedArray(mipLevel0.data),
                mipLevel0.width,
                mipLevel0.height
            )
        }
    }

    // Strategy 1: Try MPQ first for standard War3 paths
    if (isMPQPath(texturePath)) {
        try {
            const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })
            if (mpqData && mpqData.length > 0) {
                const mpqBuffer = new Uint8Array(mpqData).buffer
                const imageData = decodeBuffer(mpqBuffer, isTga)
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
                const imageData = decodeBuffer(mpqBuffer, isTga)
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
            const texBuffer = await readFile(candidate).catch(() => null)
            if (texBuffer) {
                try {
                    const imageData = decodeBuffer(texBuffer.buffer, isTga)
                    console.debug(`[Texture] ${texturePath}: Decoded from FS in ${(performance.now() - startTime).toFixed(1)}ms`)
                    return { path: texturePath, imageData }
                } catch (e) {
                    console.warn(`[Texture] Failed to decode found file ${candidate}:`, e)
                }
            }
        }
    }

    console.warn(`[Texture] ${texturePath}: Failed to decode in ${(performance.now() - startTime).toFixed(1)}ms`)
    return { path: texturePath, imageData: null, error: 'Failed to load from MPQ or file system' }
}
/**
 * Load all textures for a model
 * OPTIMIZED: Uses batch MPQ read to reduce IPC overhead
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

    // OPTIMIZATION: Separate MPQ paths from local paths
    const mpqPaths = texturePaths.filter((p: string) => isMPQPath(p))
    const otherPaths = texturePaths.filter((p: string) => !isMPQPath(p))

    const decodedTextures: { path: string; imageData: ImageData | null; error?: string }[] = []

    // Phase 1a: Batch load MPQ textures in single IPC call
    if (mpqPaths.length > 0) {
        console.time('[Viewer] Batch MPQ Read')
        try {
            const batchResults = await invoke<(number[] | null)[]>('read_mpq_files_batch', { paths: mpqPaths })
            console.timeEnd('[Viewer] Batch MPQ Read')

            console.time('[Viewer] Batch MPQ Decode')
            for (let i = 0; i < mpqPaths.length; i++) {
                const path = mpqPaths[i]
                const data = batchResults[i]
                if (data && data.length > 0) {
                    try {
                        const buffer = new Uint8Array(data).buffer
                        const isTga = path.toLowerCase().endsWith('.tga')
                        let imageData: ImageData

                        if (isTga) {
                            // TGA decode would need to be inlined here, but for now use fallback
                            const blp = decodeBLP(buffer)
                            const mipLevel0 = getBLPImageData(blp, 0)
                            imageData = new ImageData(new Uint8ClampedArray(mipLevel0.data), mipLevel0.width, mipLevel0.height)
                        } else {
                            const blp = decodeBLP(buffer)
                            const mipLevel0 = getBLPImageData(blp, 0)
                            imageData = new ImageData(new Uint8ClampedArray(mipLevel0.data), mipLevel0.width, mipLevel0.height)
                        }
                        decodedTextures.push({ path, imageData })
                    } catch (e) {
                        decodedTextures.push({ path, imageData: null, error: 'Decode failed' })
                    }
                } else {
                    decodedTextures.push({ path, imageData: null, error: 'Not found in MPQ' })
                }
            }
            console.timeEnd('[Viewer] Batch MPQ Decode')
        } catch (e) {
            console.error('[Viewer] Batch MPQ read failed:', e)
            // Fallback: add all as failed
            mpqPaths.forEach((path: string) => decodedTextures.push({ path, imageData: null, error: 'Batch read failed' }))
        }
    }

    // Phase 1b: Load other textures (non-MPQ paths) in parallel
    if (otherPaths.length > 0) {
        console.time('[Viewer] Non-MPQ Texture Load')
        const otherPromises = otherPaths.map((path: string) => decodeTexture(path, modelPath))
        const otherResults = await Promise.all(otherPromises)
        decodedTextures.push(...otherResults)
        console.timeEnd('[Viewer] Non-MPQ Texture Load')
    }

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
    const textureResults = decodedTextures.map((d) => ({
        path: d.path,
        loaded: d.imageData !== null,
        time: undefined
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
