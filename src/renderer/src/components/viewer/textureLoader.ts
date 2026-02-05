/**
 * textureLoader - Utility functions for loading model textures
 * Consolidates texture loading logic from Viewer.tsx
 */

// @ts-ignore
import { decodeBLP, getBLPImageData } from 'war3-model'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { debugLog, logTextureInfo, logTextureLoadComplete } from '../../utils/debugLogger'

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
const MPQ_PATH_PREFIXES = [
    'Abilities',
    'BattleNet',
    'Buildings',
    'Characters',
    'Doodads',
    'Environment',
    'Font',
    'Fonts',
    'Maps',
    'Objects',
    'PathTextures',
    'ReplaceableTextures',
    'Scripts',
    'SharedModels',
    'Sound',
    'Splats',
    'SpawnedEffects',
    'TerrainArt',
    'Textures',
    'UI',
    'Units',
]

const MPQ_PATH_REGEX = new RegExp(`^(${MPQ_PATH_PREFIXES.join('|')})[\\\\/]`, 'i')

export const REPLACEABLE_TEXTURES: Record<number, string> = {
    1: 'TeamColor\\TeamColor00',
    2: 'TeamGlow\\TeamGlow00',
    11: 'Cliff\\Cliff0',
    21: '', // Used by cursors
    31: 'LordaeronTree\\LordaeronSummerTree',
    32: 'AshenvaleTree\\AshenTree',
    33: 'BarrensTree\\BarrensTree',
    34: 'NorthrendTree\\NorthTree',
    35: 'Mushroom\\MushroomTree',
    36: 'RuinsTree\\RuinsTree',
    37: 'OutlandMushroomTree\\MushroomTree',
}

export function isMPQPath(path: string): boolean {
    return MPQ_PATH_REGEX.test(path)
}

/**
 * Utility to decode base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
}

/**
 * Load a texture from MPQ archive
 */
export async function loadTextureFromMPQ(texturePath: string): Promise<ImageData | null> {
    try {
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: texturePath })

        if (mpqData && mpqData.length > 0) {
            const blp = decodeBLP(mpqData.buffer as ArrayBuffer)
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
        return decodeTextureData(texBuffer.buffer, filePath)
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
    const normalizedModelPath = normalizePath(modelPath)
    const lastSlash = normalizedModelPath.lastIndexOf('\\')
    const modelDir = lastSlash >= 0 ? normalizedModelPath.substring(0, lastSlash) : normalizedModelPath

    const candidates: string[] = []

    // Primary: model dir + texture relative path
    candidates.push(`${modelDir}\\${textureRelPath}`)

    // Fallback: just filename in model dir
    const filename = textureRelPath.split('\\').pop() || ''
    if (filename !== textureRelPath) {
        candidates.push(`${modelDir}\\${filename}`)
    }

    // Try parent directories recursively up to root
    let currentDir = modelDir
    while (true) {
        const lastSlash = currentDir.lastIndexOf('\\')
        if (lastSlash === -1) break
        currentDir = currentDir.substring(0, lastSlash)
        if (currentDir === '' || currentDir.endsWith(':')) {
            // It's a root or drive root
            candidates.push(`${currentDir}\\${textureRelPath}`)
            break
        }
        candidates.push(`${currentDir}\\${textureRelPath}`)
    }

    return Array.from(new Set(candidates))
}

/**
 * Robustly decode a texture buffer (BLP or TGA)
 */
export function decodeTextureData(buffer: ArrayBuffer, path: string): ImageData | null {
    const isTga = path.toLowerCase().endsWith('.tga');
    try {
        if (isTga) {
            return decodeTGA(buffer);
        } else {
            const blp = decodeBLP(buffer);
            const mip0 = getBLPImageData(blp, 0);
            return new ImageData(
                (mip0.data instanceof Uint8ClampedArray ? mip0.data : new Uint8ClampedArray(mip0.data)) as any,
                mip0.width,
                mip0.height
            );
        }
    } catch (e) {
        console.warn(`[Texture] Failed to decode ${path}:`, e);
        return null;
    }
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

    // Strategy 1: Try local file system first (relative to model)
    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)

        for (const candidate of candidates) {
            const fileStart = performance.now()
            const imageData = await loadTextureFromFile(candidate)
            if (imageData && renderer.setTextureImageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                console.debug(`${logPrefix} Loaded from FS (${candidate}) in ${(performance.now() - startTime).toFixed(1)}ms`)
                return true
            }
        }
    }

    // Strategy 2: Try MPQ
    try {
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: texturePath })
        if (mpqData && mpqData.length > 0) {
            const imageData = decodeTextureData(mpqData.buffer as ArrayBuffer, texturePath);
            if (imageData && renderer.setTextureImageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                console.debug(`${logPrefix} Loaded from MPQ in ${(performance.now() - startTime).toFixed(1)}ms`)
                return true
            }
        }
    } catch (e) {
        // MPQ failed
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
export async function decodeTexture(
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

    // Strategy 1: Try local file system first (relative to model)
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

    // Strategy 2: Try MPQ
    try {
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: texturePath })
        if (mpqData && mpqData.length > 0) {
            const imageData = decodeBuffer(mpqData.buffer as ArrayBuffer, isTga)
            console.debug(`[Texture] ${texturePath}: Decoded from MPQ in ${(performance.now() - startTime).toFixed(1)}ms`)
            return { path: texturePath, imageData }
        }
    } catch (e) {
        // MPQ failed
    }

    // Strategy 3: If not a standard MPQ path, try MPQ anyway as fallback (sometimes custom paths are in MPQ)
    try {
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: texturePath })
        if (mpqData && mpqData.length > 0) {
            const imageData = decodeBuffer(mpqData.buffer as ArrayBuffer, isTga)
            console.debug(`[Texture] ${texturePath}: Decoded from MPQ (fallback search) in ${(performance.now() - startTime).toFixed(1)}ms`)
            return { path: texturePath, imageData }
        }
    } catch (e) {
        // Final fail
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
    const perf = {
        total: 0,
        fs: { hits: 0, misses: 0, searchMs: 0, readMs: 0, decodeMs: 0 },
        mpq: { hits: 0, misses: 0, batchMs: 0, base64Ms: 0, decodeMs: 0 },
        uploadMs: 0
    }
    const perTextureMs = new Map<string, number>()

    if (!model.Textures) {
        console.timeEnd('[Viewer] Texture Load (Batch)')
        return results
    }

    // Resolve Replaceable IDs and mutate model data
    model.Textures.forEach((texture: any) => {
        if ((!texture.Image || texture.Image === '') && texture.ReplaceableId !== 0) {
            const replaceablePath = REPLACEABLE_TEXTURES[texture.ReplaceableId];
            if (replaceablePath !== undefined) {
                texture.Image = `ReplaceableTextures\\${replaceablePath}.blp`;
            }
        }
    });

    const texturePaths = new Set(model.Textures
        .map((texture: any) => texture.Image as string)
        .filter((path: string) => !!path));

    // SCAN EMITTERS FOR TEXTURES (v1 Particle Emitters)
    if (model.ParticleEmitters) {
        model.ParticleEmitters.forEach((emitter: any) => {
            if (emitter.FileName && typeof emitter.FileName === 'string') {
                texturePaths.add(emitter.FileName);
            }
        });
    }

    // SCAN EMITTERS FOR REPLACEABLE TEXTURES (v2 Particle Emitters)
    if (model.ParticleEmitters2) {
        model.ParticleEmitters2.forEach((emitter: any) => {
            if (emitter.ReplaceableId > 0 && (emitter.TextureID === -1 || emitter.TextureID === undefined)) {
                const replaceablePath = REPLACEABLE_TEXTURES[emitter.ReplaceableId];
                if (replaceablePath !== undefined) {
                    const fullPath = `ReplaceableTextures\\${replaceablePath}.blp`;
                    texturePaths.add(fullPath);
                }
            }
        });
    }

    const uniqueTexturePaths = Array.from(texturePaths);
    perf.total = uniqueTexturePaths.length

    if (uniqueTexturePaths.length === 0) {
        console.timeEnd('[Viewer] Texture Load (Batch)')
        return results
    }

    const decodedTextures = new Map<string, { path: string; imageData: ImageData | null; error?: string }>()

    // Phase 1: Try local file system for ALL textures first in parallel
    console.time('[Viewer] Local FS Search')
    const localCandidatesMap = new Map<string, string[]>()
    uniqueTexturePaths.forEach(path => {
        localCandidatesMap.set(path, getTextureCandidatePaths(modelPath, path))
    })

    const fsLoadPromises = uniqueTexturePaths.map(async (path) => {
        const searchStart = performance.now()
        let readMs = 0
        let decodeMs = 0
        if (modelPath && !modelPath.startsWith('dropped:')) {
            const candidates = localCandidatesMap.get(path) || []
            for (const candidate of candidates) {
                const readStart = performance.now()
                const buffer = await readFile(candidate).catch(() => null)
                readMs += performance.now() - readStart
                if (buffer) {
                    try {
                        const decodeStart = performance.now()
                        const imageData = decodeTextureData(buffer.buffer, path)
                        decodeMs += performance.now() - decodeStart
                        if (imageData) {
                            const searchMs = performance.now() - searchStart
                            return { path, imageData, stats: { searchMs, readMs, decodeMs, hit: true } }
                        }
                    } catch (e) {
                        // Decode failed or TGA logic (omitted here for simplicity, fallback to general decodeTexture if needed)
                    }
                }
            }
        }
        const searchMs = performance.now() - searchStart
        return { path, imageData: null, stats: { searchMs, readMs, decodeMs, hit: false } }
    })

    const fsResults = await Promise.all(fsLoadPromises)
    const missingPaths: string[] = []

    fsResults.forEach(res => {
        if (res.stats) {
            perf.fs.searchMs += res.stats.searchMs
            perf.fs.readMs += res.stats.readMs
            perf.fs.decodeMs += res.stats.decodeMs
            if (res.stats.hit) perf.fs.hits += 1
            else perf.fs.misses += 1
            perTextureMs.set(res.path, res.stats.searchMs)
        }
        if (res.imageData) {
            decodedTextures.set(res.path, { path: res.path, imageData: res.imageData })
        } else {
            missingPaths.push(res.path)
        }
    })
    console.timeEnd('[Viewer] Local FS Search')

    // Phase 2: Batch load MPQ textures for missing paths
    if (missingPaths.length > 0) {
        console.time('[Viewer] Batch MPQ load')
        try {
            const mpqStart = performance.now()
            const batchResults = await invoke<(string | null)[]>('read_mpq_files_batch', { paths: missingPaths })
            perf.mpq.batchMs += performance.now() - mpqStart
            for (let i = 0; i < missingPaths.length; i++) {
                const path = missingPaths[i]
                const b64Data = batchResults[i]
                if (b64Data) {
                    try {
                        const b64Start = performance.now()
                        const data = base64ToUint8Array(b64Data)
                        perf.mpq.base64Ms += performance.now() - b64Start
                        const decodeStart = performance.now()
                        const imageData = decodeTextureData(data.buffer as ArrayBuffer, path)
                        perf.mpq.decodeMs += performance.now() - decodeStart
                        if (imageData) {
                            decodedTextures.set(path, { path, imageData })
                            perf.mpq.hits += 1
                        }
                    } catch (e) { }
                } else {
                    perf.mpq.misses += 1
                }
            }
        } catch (e) {
            console.error('[Viewer] Batch MPQ failed:', e)
        }
        console.timeEnd('[Viewer] Batch MPQ load')
    }

    // Final Upload to WebGL SEQUENTIALLY
    for (const path of uniqueTexturePaths) {
        const decoded = decodedTextures.get(path)
        if (decoded && decoded.imageData && renderer.setTextureImageData) {
            const uploadStart = performance.now()
            renderer.setTextureImageData(path, [decoded.imageData])
            perf.uploadMs += performance.now() - uploadStart
            results.push({ path, loaded: true })
        } else {
            results.push({ path, loaded: false, error: 'Not found in FS or MPQ' })
        }
    }

    // Log results
    const textureLog = uniqueTexturePaths.map(path => ({
        path,
        loaded: decodedTextures.has(path),
        time: perTextureMs.get(path)
    }))
    await logTextureInfo(textureLog)
    const loadedCount = results.filter(r => r.loaded).length
    await logTextureLoadComplete(uniqueTexturePaths.length, loadedCount, performance.now() - batchStart)

    try {
        await debugLog(
            `   贴图统计: 总数=${perf.total}, FS命中=${perf.fs.hits}, MPQ命中=${perf.mpq.hits}, 失败=${results.length - loadedCount}`
        )
        await debugLog(
            `   FS耗时: 搜索=${perf.fs.searchMs.toFixed(1)}ms, 读=${perf.fs.readMs.toFixed(1)}ms, 解码=${perf.fs.decodeMs.toFixed(1)}ms`
        )
        await debugLog(
            `   MPQ耗时: 批量=${perf.mpq.batchMs.toFixed(1)}ms, base64=${perf.mpq.base64Ms.toFixed(1)}ms, 解码=${perf.mpq.decodeMs.toFixed(1)}ms`
        )
        await debugLog(
            `   上传耗时: ${perf.uploadMs.toFixed(1)}ms`
        )
    } catch { }

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
