import { desktopGateway } from '../desktop'
import { invokeReadMpqFile } from '../../utils/mpqPerf'
import { decodeWar3Blp, getWar3BlpImageData } from './war3TextureDecoder'

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

const TGA_TYPE_RLE_INDEXED = 9
const TGA_TYPE_RLE_RGB = 10
const TGA_TYPE_RLE_GREY = 11
const TGA_ORIGIN_MASK = 0x30
const TGA_ORIGIN_SHIFT = 0x04

export const normalizeTexturePath = (path: string): string => {
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

export const REPLACEABLE_TEXTURES: Record<number, string> = {
    1: 'TeamColor\\TeamColor00',
    2: 'TeamGlow\\TeamGlow00',
    11: 'Cliff\\Cliff0',
    21: '',
    31: 'LordaeronTree\\LordaeronSummerTree',
    32: 'AshenvaleTree\\AshenTree',
    33: 'BarrensTree\\BarrensTree',
    34: 'NorthrendTree\\NorthTree',
    35: 'Mushroom\\MushroomTree',
    36: 'RuinsTree\\RuinsTree',
    37: 'OutlandMushroomTree\\MushroomTree',
}

export const isMpqTexturePath = (path: string): boolean => MPQ_PATH_REGEX.test(path)

export const getTextureCandidatePaths = (modelPath: string, texturePath: string): string[] => {
    const textureRelPath = normalizeTexturePath(texturePath)
    const normalizedModelPath = normalizeTexturePath(modelPath)
    const lastSlash = normalizedModelPath.lastIndexOf('\\')
    const modelDir = lastSlash >= 0 ? normalizedModelPath.substring(0, lastSlash) : normalizedModelPath

    const candidates: string[] = [`${modelDir}\\${textureRelPath}`]

    const filename = textureRelPath.split('\\').pop() || ''
    if (filename !== textureRelPath) {
        candidates.push(`${modelDir}\\${filename}`)
    }

    let currentDir = modelDir
    while (true) {
        const parentSlash = currentDir.lastIndexOf('\\')
        if (parentSlash === -1) break
        currentDir = currentDir.substring(0, parentSlash)
        if (currentDir === '' || currentDir.endsWith(':')) {
            candidates.push(`${currentDir}\\${textureRelPath}`)
            break
        }
        candidates.push(`${currentDir}\\${textureRelPath}`)
    }

    return Array.from(new Set(candidates))
}

const toTightArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return buffer
}

const decodePngImageData = async (bytes: Uint8Array): Promise<ImageData | null> => {
    try {
        const blob = new Blob([toTightArrayBuffer(bytes)], { type: 'image/png' })
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
    } catch {
        return null
    }
}

const decodeTgaImageData = (buffer: ArrayBuffer): ImageData => {
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
        imageDesc: view.getUint8(17),
    }

    if (
        header.width <= 0 ||
        header.height <= 0 ||
        ![8, 16, 24, 32].includes(header.pixelDepth)
    ) {
        throw new Error('Invalid TGA header')
    }

    const colorMapBytes = header.colorMapType === 1 ? header.colorMapLength * (header.colorMapDepth >> 3) : 0
    const tgaData = new Uint8Array(buffer, 18 + header.idLength + colorMapBytes)
    const pixelCount = header.width * header.height
    const bytesPerPixel = header.pixelDepth >> 3
    const outputData = new Uint8ClampedArray(pixelCount * 4)

    const getPixel = (data: Uint8Array, idx: number, depth: number): number[] => {
        if (depth === 24) return [data[idx + 2], data[idx + 1], data[idx], 255]
        if (depth === 32) return [data[idx + 2], data[idx + 1], data[idx], data[idx + 3]]
        if (depth === 8) {
            const value = data[idx]
            return [value, value, value, 255]
        }
        if (depth === 16) {
            const value = data[idx] | (data[idx + 1] << 8)
            const r = (value & 0x7c00) >> 10
            const g = (value & 0x03e0) >> 5
            const b = value & 0x001f
            return [(r * 255) / 31, (g * 255) / 31, (b * 255) / 31, value & 0x8000 ? 255 : 0]
        }
        return [0, 0, 0, 0]
    }

    let offset = 0
    let pixelIndex = 0
    const isRle =
        header.imageType === TGA_TYPE_RLE_RGB ||
        header.imageType === TGA_TYPE_RLE_GREY ||
        header.imageType === TGA_TYPE_RLE_INDEXED

    if (isRle) {
        let pixelsProcessed = 0
        while (pixelsProcessed < pixelCount) {
            const chunkHeader = tgaData[offset++]
            const chunkPixelCount = (chunkHeader & 0x7f) + 1
            const isRleChunk = (chunkHeader & 0x80) !== 0

            if (isRleChunk) {
                const pixelValue = getPixel(tgaData, offset, header.pixelDepth)
                offset += bytesPerPixel
                for (let i = 0; i < chunkPixelCount; i++) {
                    outputData[pixelIndex * 4] = pixelValue[0]
                    outputData[pixelIndex * 4 + 1] = pixelValue[1]
                    outputData[pixelIndex * 4 + 2] = pixelValue[2]
                    outputData[pixelIndex * 4 + 3] = pixelValue[3]
                    pixelIndex++
                }
            } else {
                for (let i = 0; i < chunkPixelCount; i++) {
                    const pixelValue = getPixel(tgaData, offset, header.pixelDepth)
                    outputData[pixelIndex * 4] = pixelValue[0]
                    outputData[pixelIndex * 4 + 1] = pixelValue[1]
                    outputData[pixelIndex * 4 + 2] = pixelValue[2]
                    outputData[pixelIndex * 4 + 3] = pixelValue[3]
                    offset += bytesPerPixel
                    pixelIndex++
                }
            }
            pixelsProcessed += chunkPixelCount
        }
    } else {
        for (let i = 0; i < pixelCount; i++) {
            const pixelValue = getPixel(tgaData, offset, header.pixelDepth)
            outputData[i * 4] = pixelValue[0]
            outputData[i * 4 + 1] = pixelValue[1]
            outputData[i * 4 + 2] = pixelValue[2]
            outputData[i * 4 + 3] = pixelValue[3]
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
            const bottomRowIdx = (header.height - 1 - y) * rowBytes
            tempRow.set(outputData.subarray(topRowIdx, topRowIdx + rowBytes))
            outputData.set(outputData.subarray(bottomRowIdx, bottomRowIdx + rowBytes), topRowIdx)
            outputData.set(tempRow, bottomRowIdx)
        }
    }

    return new ImageData(outputData, header.width, header.height)
}

export const decodeTexturePreviewImageData = async (bytes: Uint8Array, path: string): Promise<ImageData | null> => {
    const lowerPath = path.toLowerCase()
    if (lowerPath.endsWith('.png')) {
        return decodePngImageData(bytes)
    }
    if (lowerPath.endsWith('.tga')) {
        return decodeTgaImageData(toTightArrayBuffer(bytes))
    }

    const blp = decodeWar3Blp(toTightArrayBuffer(bytes))
    const mip = getWar3BlpImageData(blp, 0)
    return new ImageData(new Uint8ClampedArray(mip.data), mip.width, mip.height)
}

export const loadTexturePreviewFromMpq = async (texturePath: string): Promise<ImageData | null> => {
    try {
        const mpqData = await invokeReadMpqFile<Uint8Array>(
            normalizeTexturePath(texturePath),
            'texturePreviewSource.loadTexturePreviewFromMpq',
        )
        if (mpqData && mpqData.length > 0) {
            return decodeTexturePreviewImageData(mpqData, texturePath)
        }
    } catch {
        // Missing MPQ textures are expected for custom models; callers fall back to null previews.
    }
    return null
}

export const loadTexturePreviewFromFile = async (filePath: string): Promise<ImageData | null> => {
    try {
        const bytes = await desktopGateway.readFile(filePath)
        return decodeTexturePreviewImageData(bytes, filePath)
    } catch {
        // Missing local texture candidates are expected during fallback probing.
    }
    return null
}

export const loadTexturePreviewIntoRenderer = async (
    renderer: { setTextureImageData?: (texturePath: string, images: ImageData[]) => void },
    texturePath: string,
    modelPath: string,
): Promise<boolean> => {
    if (!texturePath || !renderer?.setTextureImageData) return false

    if (modelPath && !modelPath.startsWith('dropped:')) {
        for (const candidate of getTextureCandidatePaths(modelPath, texturePath)) {
            const imageData = await loadTexturePreviewFromFile(candidate)
            if (imageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                return true
            }
        }
    }

    const imageData = await loadTexturePreviewFromMpq(texturePath)
    if (!imageData) return false
    renderer.setTextureImageData(texturePath, [imageData])
    return true
}
