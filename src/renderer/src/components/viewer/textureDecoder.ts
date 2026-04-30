import {
    decodeWar3Blp,
    getWar3BlpImageData,
} from '../../infrastructure/texture'
import {
    applyTextureAdjustments,
    normalizeTextureAdjustments,
    TextureAdjustments
} from '../../utils/textureAdjustments'

export interface DecodeTextureOptions {
    // For thumbnail/batch use-cases: decode a smaller texture representation.
    maxDimension?: number
    // Use BLP mip0 to avoid broken lower mips on some custom models.
    preferBlpBaseMip?: boolean
    // Ignore source alpha and force fully opaque pixels.
    forceOpaqueAlpha?: boolean
    adjustments?: TextureAdjustments
}

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

export async function decodePngImageData(bytes: Uint8Array): Promise<ImageData | null> {
    try {
        const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const blob = new Blob([blobBytes], { type: 'image/png' })
        const bitmap = await createImageBitmap(blob)
        const canvas =
            typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(bitmap.width, bitmap.height)
                : document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true }) as
            | OffscreenCanvasRenderingContext2D
            | CanvasRenderingContext2D
            | null
        if (!ctx) return null
        ctx.clearRect(0, 0, bitmap.width, bitmap.height)
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    } catch (e) {
        return null
    }
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
            const blp = decodeWar3Blp(buffer);
            const preferredMip = options?.preferBlpBaseMip ? 0 : chooseBlpMipLevel(blp, options?.maxDimension);

            let mip: any;
            try {
                mip = getWar3BlpImageData(blp, preferredMip);
            } catch {
                mip = getWar3BlpImageData(blp, 0);
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
                    const baseMip = getWar3BlpImageData(blp, 0);
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

const TGA_TYPE_RLE_INDEXED = 9
const TGA_TYPE_RLE_RGB = 10
const TGA_TYPE_RLE_GREY = 11

const TGA_ORIGIN_MASK = 0x30
const TGA_ORIGIN_SHIFT = 0x04

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
        colorMapLength: view.getUint16(5, true),
        colorMapDepth: view.getUint8(7),
        width: view.getUint16(12, true),
        height: view.getUint16(14, true),
        pixelDepth: view.getUint8(16),
        imageDesc: view.getUint8(17)
    }

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

    const getPixel = (data: Uint8Array, idx: number, depth: number): number[] => {
        if (depth === 24) {
            return [data[idx + 2], data[idx + 1], data[idx], 255]
        } else if (depth === 32) {
            return [data[idx + 2], data[idx + 1], data[idx], data[idx + 3]]
        } else if (depth === 8) {
            const v = data[idx]
            return [v, v, v, 255]
        } else if (depth === 16) {
            const val = data[idx] | (data[idx + 1] << 8)
            const r = (val & 0x7C00) >> 10
            const g = (val & 0x03E0) >> 5
            const b = (val & 0x001F)
            return [(r * 255) / 31, (g * 255) / 31, (b * 255) / 31, (val & 0x8000) ? 255 : 0]
        }
        return [0, 0, 0, 0]
    }

    const isRLE = header.imageType === TGA_TYPE_RLE_RGB || header.imageType === TGA_TYPE_RLE_GREY || header.imageType === TGA_TYPE_RLE_INDEXED

    if (isRLE) {
        let pixelsProcessed = 0
        while (pixelsProcessed < pixelCount) {
            const chunkHeader = tgaData[offset++]
            const chunkPixelCount = (chunkHeader & 0x7F) + 1
            const isRLEChunk = (chunkHeader & 0x80) !== 0

            if (isRLEChunk) {
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
        for (let i = 0; i < pixelCount; i++) {
            const pixelVal = getPixel(tgaData, offset, header.pixelDepth)
            outputData[i * 4] = pixelVal[0]
            outputData[i * 4 + 1] = pixelVal[1]
            outputData[i * 4 + 2] = pixelVal[2]
            outputData[i * 4 + 3] = pixelVal[3]
            offset += bytesPerPixel
        }
    }

    const origin = (header.imageDesc & TGA_ORIGIN_MASK) >> TGA_ORIGIN_SHIFT

    if (origin === 0 || origin === 1) {
        const rowBytes = header.width * 4
        const halfHeight = Math.floor(header.height / 2)
        const tempRow = new Uint8ClampedArray(rowBytes)
        for (let y = 0; y < halfHeight; y++) {
            const topRowIdx = y * rowBytes
            const botRowIdx = (header.height - 1 - y) * rowBytes

            tempRow.set(outputData.subarray(topRowIdx, topRowIdx + rowBytes))
            outputData.set(outputData.subarray(botRowIdx, botRowIdx + rowBytes), topRowIdx)
            outputData.set(tempRow, botRowIdx)
        }
    }

    return new ImageData(outputData, header.width, header.height)
}
