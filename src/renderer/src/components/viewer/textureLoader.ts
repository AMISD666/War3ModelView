/**
 * textureLoader - Utility functions for loading model textures
 * Consolidates texture loading logic from Viewer.tsx
 */

// @ts-ignore
import { decodeBLP, getBLPImageData } from 'war3-model'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import {
    applyTextureAdjustments,
    normalizeTextureAdjustments,
    TEXTURE_ADJUSTMENTS_KEY,
    TextureAdjustments
} from '../../utils/textureAdjustments'

export interface TextureLoadResult {
    path: string
    loaded: boolean
    error?: string
}

export interface DecodeTextureOptions {
    // For thumbnail/batch use-cases: decode a smaller texture representation.
    maxDimension?: number
    // Use BLP mip0 to avoid broken lower mips on some custom models.
    preferBlpBaseMip?: boolean
    // Ignore source alpha and force fully opaque pixels.
    forceOpaqueAlpha?: boolean
    adjustments?: TextureAdjustments
}

type WorkerLike = {
    addEventListener: (type: 'message', listener: (event: any) => void) => void
    removeEventListener: (type: 'message', listener: (event: any) => void) => void
    postMessage: (message: any, transferOrOptions?: Transferable[] | StructuredSerializeOptions) => void
}

type DecodedTextureImage = ImageData | ImageBitmap

interface WorkerRpcState {
    pendingSingle: Map<string, (image: DecodedTextureImage | null) => void>
    pendingBatch: Map<string, (result: WorkerBatchResultMap | null) => void>
    listener: (event: any) => void
}

interface WorkerBatchDecodeTask {
    id: string
    path: string
    bytes: Uint8Array
    maxDimension?: number
    preferBlpBaseMip: boolean
}

interface WorkerBatchResultMap {
    decoded: Map<string, DecodedTextureImage>
    failedPaths: Set<string>
}

const workerRpcMap = new WeakMap<WorkerLike, WorkerRpcState>()
let decodeRequestCounter = 0

/**
 * Normalize path separators to backslashes
 */
export function normalizePath(p: string): string {
    if (!p) return ''
    let out = p.replace(/\0/g, '').trim()
    out = out.replace(/\//g, '\\')
    if (out.startsWith('.\\')) {
        out = out.slice(2)
    }
    if (!out.startsWith('\\\\')) {
        while (out.startsWith('\\')) {
            out = out.slice(1)
        }
    }
    out = out.replace(/\\\\+/g, '\\')
    return out
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
 * Load a texture from MPQ archive
 */
export async function loadTextureFromMPQ(texturePath: string): Promise<ImageData | null> {
    try {
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizePath(texturePath) })

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
function chooseBlpMipLevel(blp: any, maxDimension?: number): number {
    if (!maxDimension || maxDimension <= 0) return 0

    const width = Number(blp?.width ?? blp?.Width ?? 0)
    const height = Number(blp?.height ?? blp?.Height ?? 0)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 0
    }

    const maxSide = Math.max(width, height)
    if (maxSide <= maxDimension) return 0

    return Math.max(0, Math.floor(Math.log2(maxSide / maxDimension)))
}

function downscaleImageDataIfNeeded(imageData: ImageData, maxDimension?: number): ImageData {
    if (!maxDimension || maxDimension <= 0) return imageData
    if (imageData.width <= maxDimension && imageData.height <= maxDimension) return imageData

    const scale = maxDimension / Math.max(imageData.width, imageData.height)
    const targetWidth = Math.max(1, Math.round(imageData.width * scale))
    const targetHeight = Math.max(1, Math.round(imageData.height * scale))

    if (typeof OffscreenCanvas !== 'undefined') {
        const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height)
        const sourceCtx = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
        if (sourceCtx) {
            sourceCtx.putImageData(imageData, 0, 0)
            const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight)
            const targetCtx = targetCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
            if (targetCtx) {
                targetCtx.clearRect(0, 0, targetWidth, targetHeight)
                targetCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight)
                return targetCtx.getImageData(0, 0, targetWidth, targetHeight)
            }
        }
    }

    if (typeof document !== 'undefined') {
        const sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = imageData.width
        sourceCanvas.height = imageData.height
        const sourceCtx = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
        if (sourceCtx) {
            sourceCtx.putImageData(imageData, 0, 0)
            const targetCanvas = document.createElement('canvas')
            targetCanvas.width = targetWidth
            targetCanvas.height = targetHeight
            const targetCtx = targetCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
            if (targetCtx) {
                targetCtx.clearRect(0, 0, targetWidth, targetHeight)
                targetCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight)
                return targetCtx.getImageData(0, 0, targetWidth, targetHeight)
            }
        }
    }

    return imageData
}

function forceOpaqueAlphaIfNeeded(imageData: ImageData, forceOpaqueAlpha?: boolean): ImageData {
    if (!forceOpaqueAlpha) return imageData
    const data = imageData.data
    for (let i = 3; i < data.length; i += 4) {
        data[i] = 255
    }
    return imageData
}

interface ImageLumaStats {
    alphaSampleCount: number
    meanLuma: number
    brightRatio: number
}

function getImageLumaStats(imageData: ImageData): ImageLumaStats {
    const data = imageData.data
    const pixelCount = data.length >> 2
    if (pixelCount <= 0) {
        return { alphaSampleCount: 0, meanLuma: 0, brightRatio: 0 }
    }

    const maxSamples = 4096
    const step = Math.max(1, Math.floor(pixelCount / maxSamples))

    let alphaSampleCount = 0
    let lumaSum = 0
    let brightCount = 0

    for (let pixel = 0; pixel < pixelCount; pixel += step) {
        const i = pixel * 4
        const a = data[i + 3]
        if (a <= 8) continue

        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

        alphaSampleCount += 1
        lumaSum += luma
        if (luma >= 48) brightCount += 1
    }

    if (alphaSampleCount <= 0) {
        return { alphaSampleCount: 0, meanLuma: 0, brightRatio: 0 }
    }

    return {
        alphaSampleCount,
        meanLuma: lumaSum / alphaSampleCount,
        brightRatio: brightCount / alphaSampleCount
    }
}

function shouldTryBlpBaseMipFallback(imageData: ImageData): boolean {
    const stats = getImageLumaStats(imageData)
    if (stats.alphaSampleCount < 64) return false
    // Broken low mips are often almost-black while still mostly opaque.
    return stats.meanLuma < 22 && stats.brightRatio < 0.04
}

function shouldUseBlpBaseMip(preferred: ImageData, base: ImageData): boolean {
    const preferredStats = getImageLumaStats(preferred)
    const baseStats = getImageLumaStats(base)

    if (preferredStats.alphaSampleCount < 64 || baseStats.alphaSampleCount < 64) {
        return false
    }

    return (
        baseStats.meanLuma >= preferredStats.meanLuma + 18 &&
        baseStats.brightRatio >= preferredStats.brightRatio + 0.08
    )
}

export function decodeTextureData(buffer: ArrayBuffer, path: string, options?: DecodeTextureOptions): ImageData | null {
    const isTga = path.toLowerCase().endsWith('.tga');
    const applyAdjustmentsIfNeeded = (imageData: ImageData): ImageData => {
        if (!options?.adjustments) return imageData
        const normalized = normalizeTextureAdjustments(options.adjustments)
        return applyTextureAdjustments(imageData, normalized)
    }
    try {
        if (isTga) {
            const decoded = decodeTGA(buffer);
            const resized = downscaleImageDataIfNeeded(decoded, options?.maxDimension);
            const adjusted = applyAdjustmentsIfNeeded(resized)
            return forceOpaqueAlphaIfNeeded(adjusted, options?.forceOpaqueAlpha);
        } else {
            const blp = decodeBLP(buffer);
            const preferredMip = options?.preferBlpBaseMip ? 0 : chooseBlpMipLevel(blp, options?.maxDimension);

            let mip: any;
            try {
                mip = getBLPImageData(blp, preferredMip);
            } catch {
                mip = getBLPImageData(blp, 0);
            }

            let decoded = new ImageData(
                (mip.data instanceof Uint8ClampedArray ? mip.data : new Uint8ClampedArray(mip.data)) as any,
                mip.width,
                mip.height
            );

            if (
                preferredMip > 0 &&
                !options?.preferBlpBaseMip &&
                shouldTryBlpBaseMipFallback(decoded)
            ) {
                try {
                    const baseMip = getBLPImageData(blp, 0);
                    const baseDecoded = new ImageData(
                        (baseMip.data instanceof Uint8ClampedArray ? baseMip.data : new Uint8ClampedArray(baseMip.data)) as any,
                        baseMip.width,
                        baseMip.height
                    );
                    if (shouldUseBlpBaseMip(decoded, baseDecoded)) {
                        decoded = baseDecoded;
                    }
                } catch {
                    // Keep preferred mip if fallback decoding fails.
                }
            }

            // BYPASS Canvas downscaling completely for alpha-dependent textures because Canvas 2D always premultiplies alpha, destroying RGB data.
            const resized = options?.preferBlpBaseMip ? decoded : downscaleImageDataIfNeeded(decoded, options?.maxDimension);
            const adjusted = applyAdjustmentsIfNeeded(resized)
            return forceOpaqueAlphaIfNeeded(adjusted, options?.forceOpaqueAlpha);
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
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizePath(texturePath) })
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
    modelPath: string,
    options?: DecodeTextureOptions
): Promise<{ path: string; imageData: ImageData | null; error?: string }> {
    const startTime = performance.now()

    // Helper to decode buffer based on type
    const decodeBuffer = (buffer: ArrayBuffer) =>
        decodeTextureData(buffer, texturePath, options)

    // Strategy 1: Try local file system first (relative to model)
    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)
        for (const candidate of candidates) {
            const texBuffer = await readFile(candidate).catch(() => null)
            if (texBuffer) {
                try {
                    const imageData = decodeBuffer(texBuffer.buffer)
                    if (!imageData) continue
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
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizePath(texturePath) })
        if (mpqData && mpqData.length > 0) {
            const imageData = decodeBuffer(mpqData.buffer as ArrayBuffer)
            if (!imageData) {
                return { path: texturePath, imageData: null, error: 'Decode failed' }
            }
            console.debug(`[Texture] ${texturePath}: Decoded from MPQ in ${(performance.now() - startTime).toFixed(1)}ms`)
            return { path: texturePath, imageData }
        }
    } catch (e) {
        // MPQ failed
    }

    // Strategy 3: If not a standard MPQ path, try MPQ anyway as fallback (sometimes custom paths are in MPQ)
    try {
        const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizePath(texturePath) })
        if (mpqData && mpqData.length > 0) {
            const imageData = decodeBuffer(mpqData.buffer as ArrayBuffer)
            if (!imageData) {
                return { path: texturePath, imageData: null, error: 'Decode failed' }
            }
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
 * OPTIMIZED: Batch read in Rust (no base64), decode in JS
 */
function toUint8Array(payload: any): Uint8Array | null {
    if (!payload) return null
    if (payload instanceof Uint8Array) return payload
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
    }
    if (Array.isArray(payload)) {
        return new Uint8Array(payload)
    }
    if (typeof payload === 'string') {
        try {
            const binary = atob(payload)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i)
            }
            return bytes
        } catch {
            return null
        }
    }
    return null
}

function parseTextureBytesPayload(payload: any, texturePaths: string[]): Map<string, Uint8Array> {
    const decoded = new Map<string, Uint8Array>()
    const bytes = toUint8Array(payload)
    if (!bytes || bytes.byteLength < 4) {
        if (payload) {
            const typeTag = Object.prototype.toString.call(payload)
            const info = Array.isArray(payload)
                ? `array len=${payload.length}`
                : typeof payload === 'string'
                    ? `string len=${payload.length}`
                    : payload && typeof payload === 'object'
                        ? `keys=${Object.keys(payload).slice(0, 5).join(',')}`
                        : ''
            console.warn(`[Texture] Batch payload invalid: ${typeTag} ${info}`)
        }
        return decoded
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    const count = view.getUint32(offset, true)
    offset += 4

    const total = Math.min(count, texturePaths.length)
    for (let i = 0; i < total; i++) {
        if (offset + 5 > bytes.byteLength) {
            break
        }
        const status = view.getUint8(offset)
        offset += 1
        const dataLen = view.getUint32(offset, true)
        offset += 4

        if (dataLen > 0 && offset + dataLen <= bytes.byteLength && status === 1) {
            const slice = bytes.subarray(offset, offset + dataLen)
            decoded.set(texturePaths[i], slice)
        }
        offset += dataLen
    }

    return decoded
}

function normalizeWorkers(worker?: WorkerLike | WorkerLike[]): WorkerLike[] {
    if (!worker) return []
    return Array.isArray(worker) ? worker.filter(Boolean) : [worker]
}

function toTightArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (
        bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength &&
        bytes.buffer instanceof ArrayBuffer
    ) {
        return bytes.buffer
    }
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

function ensureWorkerRpcState(worker: WorkerLike): WorkerRpcState {
    const cached = workerRpcMap.get(worker)
    if (cached) return cached

    const pendingSingle = new Map<string, (image: DecodedTextureImage | null) => void>()
    const pendingBatch = new Map<string, (result: WorkerBatchResultMap | null) => void>()
    const listener = (event: any) => {
        const type = event?.data?.type
        const payload = event?.data?.payload
        const id = payload?.id

        if (type === 'DECODE_BATCH_SUCCESS') {
            if (!id || !pendingBatch.has(id)) return
            const resolve = pendingBatch.get(id)!
            pendingBatch.delete(id)

            const decoded = new Map<string, DecodedTextureImage>()
            const failedPaths = new Set<string>()
            const resultList = Array.isArray(payload?.results) ? payload.results : []
            const errorList = Array.isArray(payload?.errors) ? payload.errors : []

            for (const item of resultList) {
                if (item?.path && item?.bitmap) {
                    decoded.set(item.path, item.bitmap as DecodedTextureImage)
                }
            }
            for (const item of errorList) {
                if (item?.path) {
                    failedPaths.add(item.path)
                }
            }

            resolve({ decoded, failedPaths })
            return
        }

        if (!id) return

        if (type === 'DECODE_SUCCESS' && pendingSingle.has(id)) {
            const resolve = pendingSingle.get(id)!
            pendingSingle.delete(id)
            resolve(payload.bitmap ?? null)
            return
        }

        if (type === 'ERROR') {
            if (pendingSingle.has(id)) {
                const resolve = pendingSingle.get(id)!
                pendingSingle.delete(id)
                resolve(null)
                return
            }
            if (pendingBatch.has(id)) {
                const resolve = pendingBatch.get(id)!
                pendingBatch.delete(id)
                resolve(null)
            }
        }
    }

    worker.addEventListener('message', listener)
    const state: WorkerRpcState = { pendingSingle, pendingBatch, listener }
    workerRpcMap.set(worker, state)
    return state
}

async function decodeBatchChunkWithWorker(
    worker: WorkerLike,
    tasks: WorkerBatchDecodeTask[]
): Promise<WorkerBatchResultMap | null> {
    if (tasks.length === 0) return { decoded: new Map(), failedPaths: new Set() }

    const rpc = ensureWorkerRpcState(worker)
    const id = `decode_batch_${++decodeRequestCounter}`
    const transfer: Transferable[] = []
    const payloadTasks = tasks.map((task) => {
        const tightBuffer = toTightArrayBuffer(task.bytes)
        transfer.push(tightBuffer)
        return {
            id: task.id,
            path: task.path,
            buffer: tightBuffer,
            maxDimension: task.maxDimension,
            preferBlpBaseMip: task.preferBlpBaseMip
        }
    })

    return await new Promise((resolve) => {
        const timeoutMs = Math.max(12000, 2500 * tasks.length)
        const timer = setTimeout(() => {
            rpc.pendingBatch.delete(id)
            resolve(null)
        }, timeoutMs)

        rpc.pendingBatch.set(id, (result) => {
            clearTimeout(timer)
            resolve(result)
        })

        worker.postMessage({
            type: 'DECODE_TEXTURE_BATCH',
            payload: {
                id,
                tasks: payloadTasks
            }
        }, transfer)
    })
}

function buildWorkerTaskQueues(
    tasks: WorkerBatchDecodeTask[],
    workerCount: number
): WorkerBatchDecodeTask[][] {
    const queues = Array.from({ length: workerCount }, () => [] as WorkerBatchDecodeTask[])
    const workerLoadBytes = Array.from({ length: workerCount }, () => 0)
    const sorted = [...tasks].sort((a, b) => b.bytes.byteLength - a.bytes.byteLength)

    for (const task of sorted) {
        let targetWorker = 0
        let minLoad = workerLoadBytes[0]
        for (let i = 1; i < workerLoadBytes.length; i++) {
            if (workerLoadBytes[i] < minLoad) {
                minLoad = workerLoadBytes[i]
                targetWorker = i
            }
        }
        queues[targetWorker].push(task)
        workerLoadBytes[targetWorker] += task.bytes.byteLength
    }

    return queues
}

function splitWorkerTaskChunks(
    queue: WorkerBatchDecodeTask[],
    maxChunkItems: number,
    maxChunkBytes: number
): WorkerBatchDecodeTask[][] {
    if (queue.length === 0) return []

    const chunks: WorkerBatchDecodeTask[][] = []
    let current: WorkerBatchDecodeTask[] = []
    let currentBytes = 0

    for (const task of queue) {
        const taskBytes = task.bytes.byteLength
        const shouldStartNewChunk =
            current.length > 0 &&
            (current.length >= maxChunkItems || currentBytes + taskBytes > maxChunkBytes)

        if (shouldStartNewChunk) {
            chunks.push(current)
            current = []
            currentBytes = 0
        }

        current.push(task)
        currentBytes += taskBytes
    }

    if (current.length > 0) {
        chunks.push(current)
    }

    return chunks
}

async function decodeBatchWithWorkerPool(
    entries: Array<[string, Uint8Array]>,
    workers: WorkerLike[],
    textureAdjustmentsByPath: Map<string, TextureAdjustments>,
    alphaRequiredTexturePaths: Set<string>,
    maxDimension?: number
): Promise<Map<string, DecodedTextureImage>> {
    const decoded = new Map<string, DecodedTextureImage>()
    if (entries.length === 0 || workers.length === 0) {
        return decoded
    }

    const workerEligibleTasks: WorkerBatchDecodeTask[] = []
    const workerByteMap = new Map<string, Uint8Array>()
    const mainThreadOnly = new Set<string>()

    for (const [path, bytes] of entries) {
        if (textureAdjustmentsByPath.has(path)) {
            mainThreadOnly.add(path)
            continue
        }
        workerByteMap.set(path, bytes)
        workerEligibleTasks.push({
            id: `task_${++decodeRequestCounter}`,
            path,
            bytes,
            maxDimension,
            preferBlpBaseMip: alphaRequiredTexturePaths.has(path)
        })
    }

    const workerChunkMaxItems = 8
    const workerChunkMaxBytes = 12 * 1024 * 1024
    const failedPaths = new Set<string>(mainThreadOnly)

    if (workerEligibleTasks.length > 0) {
        const queues = buildWorkerTaskQueues(workerEligibleTasks, workers.length)

        await Promise.all(workers.map(async (worker, workerIndex) => {
            const chunks = splitWorkerTaskChunks(
                queues[workerIndex],
                workerChunkMaxItems,
                workerChunkMaxBytes
            )
            for (const chunk of chunks) {
                const chunkResult = await decodeBatchChunkWithWorker(worker, chunk)
                if (!chunkResult) {
                    chunk.forEach((task) => failedPaths.add(task.path))
                    continue
                }
                chunkResult.decoded.forEach((image, path) => decoded.set(path, image))
                chunk.forEach((task) => {
                    if (!chunkResult.decoded.has(task.path) || chunkResult.failedPaths.has(task.path)) {
                        failedPaths.add(task.path)
                    }
                })
            }
        }))
    }

    for (const path of failedPaths) {
        const bytes = workerByteMap.get(path) || entries.find(([entryPath]) => entryPath === path)?.[1]
        if (!bytes) continue
        const imageData = decodeTextureData(toTightArrayBuffer(bytes), path, {
            adjustments: textureAdjustmentsByPath.get(path),
            maxDimension,
            preferBlpBaseMip: alphaRequiredTexturePaths.has(path)
        })
        if (imageData) {
            decoded.set(path, imageData)
        }
    }

    return decoded
}

export async function loadAllTextures(
    model: any,
    renderer: any,
    modelPath: string,
    worker?: WorkerLike | WorkerLike[],
    maxDimension?: number,
    options?: {
        yieldUploads?: boolean
        workerDecodeMinTextures?: number
        workerDecodeMinBytes?: number
        targetPaths?: string[]
    }
): Promise<TextureLoadResult[]> {
    const results: TextureLoadResult[] = []

    if (!model.Textures) {
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

    const texturePaths = new Set<string>(model.Textures
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

    const uniqueTexturePaths: string[] = Array.from(texturePaths);
    if (uniqueTexturePaths.length === 0) {
        return results
    }

    const targetPathSet = new Set((options?.targetPaths || []).filter(Boolean))
    const hasTargetPaths = targetPathSet.size > 0
    let effectiveTexturePaths: string[] = uniqueTexturePaths
    if (hasTargetPaths) {
        const fromModel = uniqueTexturePaths.filter((path) => targetPathSet.has(path))
        const extras = Array.from(targetPathSet).filter((path) => !fromModel.includes(path))
        effectiveTexturePaths = [...fromModel, ...extras]
    }
    if (effectiveTexturePaths.length === 0) {
        return results
    }

    const alphaRequiredTexturePaths = new Set<string>();

    if (model.Materials) {
        model.Materials.forEach((material: any) => {
            if (material.Layers) {
                material.Layers.forEach((layer: any) => {
                    // FilterMode > 0 indicates transparency/blending (e.g., Transparent, Blend, Additive)
                    if (layer.FilterMode > 0 && layer.TextureID !== undefined && model.Textures[layer.TextureID]) {
                        const img = model.Textures[layer.TextureID].Image;
                        if (img) alphaRequiredTexturePaths.add(img);
                    }
                });
            }
        });
    }

    if (model.ParticleEmitters2) {
        model.ParticleEmitters2.forEach((emitter: any) => {
            if (emitter.TextureID !== undefined && model.Textures[emitter.TextureID]) {
                const img = model.Textures[emitter.TextureID].Image;
                if (img) alphaRequiredTexturePaths.add(img);
            }
        });
    }

    // Include v1 Particle Emitters as they also rely heavily on alpha
    if (model.ParticleEmitters) {
        model.ParticleEmitters.forEach((emitter: any) => {
            if (emitter.FileName && typeof emitter.FileName === 'string') {
                alphaRequiredTexturePaths.add(emitter.FileName);
            }
        });
    }

    const textureAdjustmentsByPath = new Map<string, TextureAdjustments>()
    if (Array.isArray(model.Textures)) {
        for (const texture of model.Textures) {
            const texturePath = texture?.Image
            if (!texturePath || textureAdjustmentsByPath.has(texturePath)) continue
            const raw = texture?.[TEXTURE_ADJUSTMENTS_KEY]
            if (!raw) continue
            textureAdjustmentsByPath.set(texturePath, normalizeTextureAdjustments(raw))
        }
    }

    const decodedTextures = new Map<string, DecodedTextureImage>()
    const workers = normalizeWorkers(worker)

    try {
        const payload = await invoke<Uint8Array>('load_textures_batch_bin', {
            modelPath,
            texturePaths: effectiveTexturePaths
        })
        const decodedBatch = parseTextureBytesPayload(payload, effectiveTexturePaths)
        const entries = Array.from(decodedBatch.entries())
        const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0)
        const workerDecodeMinTextures = options?.workerDecodeMinTextures ?? 6
        const workerDecodeMinBytes = options?.workerDecodeMinBytes ?? (5 * 1024 * 1024)
        const useWorkerPool =
            workers.length > 0 &&
            entries.length >= workerDecodeMinTextures &&
            totalBytes >= workerDecodeMinBytes

        if (useWorkerPool) {
            const pooled = await decodeBatchWithWorkerPool(
                entries,
                workers,
                textureAdjustmentsByPath,
                alphaRequiredTexturePaths,
                maxDimension
            )
            for (const [path, image] of pooled.entries()) {
                decodedTextures.set(path, image)
            }
        } else {
            for (const [path, bytes] of entries) {
                const buffer = toTightArrayBuffer(bytes)
                const imageData = decodeTextureData(buffer, path, {
                    adjustments: textureAdjustmentsByPath.get(path),
                    maxDimension,
                    preferBlpBaseMip: alphaRequiredTexturePaths.has(path)
                })
                if (imageData) {
                    decodedTextures.set(path, imageData)
                }
            }
        }
    } catch (e) {
        console.error('[Viewer] Texture batch load failed:', e)
    }

    const missingPaths = effectiveTexturePaths.filter(path => !decodedTextures.has(path))
    if (missingPaths.length > 0) {
        const fallbackResults = await Promise.all(
            missingPaths.map(async (path) => {
                if (modelPath && !modelPath.startsWith('dropped:')) {
                    const candidates = getTextureCandidatePaths(modelPath, path)
                    for (const candidate of candidates) {
                        const buffer = await readFile(candidate).catch(() => null)
                        if (buffer) {
                            const imageData = decodeTextureData(buffer.buffer, path, {
                                adjustments: textureAdjustmentsByPath.get(path),
                                maxDimension,
                                preferBlpBaseMip: alphaRequiredTexturePaths.has(path)
                            })
                            if (imageData) {
                                return { path, imageData }
                            }
                        }
                    }
                }

                try {
                    const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizePath(path) })
                    if (mpqData && mpqData.length > 0) {
                        const imageData = decodeTextureData(mpqData.buffer as ArrayBuffer, path, {
                            adjustments: textureAdjustmentsByPath.get(path),
                            maxDimension,
                            preferBlpBaseMip: alphaRequiredTexturePaths.has(path)
                        })
                        if (imageData) {
                            return { path, imageData }
                        }
                    }
                } catch {
                    // ignore fallback failure
                }

                return { path, imageData: null as DecodedTextureImage | null }
            })
        )

        fallbackResults.forEach(result => {
            if (result.imageData) {
                decodedTextures.set(result.path, result.imageData)
            }
        })
    }

    const shouldYieldUploads = !!options?.yieldUploads
    const uploadYieldBatch = 4
    let uploadedSinceYield = 0
    for (const path of effectiveTexturePaths) {
        const imageData = decodedTextures.get(path)
        if (imageData && renderer.setTextureImageData) {
            renderer.setTextureImageData(path, [imageData])
            results.push({ path, loaded: true })
            if (shouldYieldUploads) {
                uploadedSinceYield++
            }
            if (shouldYieldUploads && uploadedSinceYield >= uploadYieldBatch) {
                uploadedSinceYield = 0
                await new Promise(r => requestAnimationFrame(r))
            }
        } else {
            results.push({ path, loaded: false, error: 'Not found in FS or MPQ' })
        }
    }

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

    await loadReplaceable(teamColorPath, 1)
    await loadReplaceable(teamGlowPath, 2)
}
