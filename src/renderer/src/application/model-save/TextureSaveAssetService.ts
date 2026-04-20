import type { DesktopGateway } from '../../infrastructure/desktop'
import { desktopGateway } from '../../infrastructure/desktop'
import type { TextureDecodeGateway } from '../../infrastructure/texture'
import { textureDecodeGateway } from '../../infrastructure/texture'
import {
    applyTextureAdjustments,
    isDefaultTextureAdjustments,
    normalizeTextureAdjustments,
    TEXTURE_ADJUSTMENTS_KEY,
} from '../../utils/textureAdjustments'
import {
    buildTargetAssetPath,
    getDirname,
    getPathDir,
    isAbsoluteWindowsPath,
    joinPath,
    normalizeWindowsPath,
    splitPathFileName,
} from '../../utils/windowsPath'

type TextureRecord = Record<string, unknown>

export interface TextureAssetOperationResult {
    copiedCount: number
    encodedCount: number
    failed: string[]
}

export interface EncodeAdjustedTexturesOptions {
    textureSaveMode: string
    textureSaveSuffix?: string
}

const getModelTextures = (modelData: unknown): TextureRecord[] => {
    if (!modelData || typeof modelData !== 'object') return []
    const textures = (modelData as { Textures?: unknown }).Textures
    return Array.isArray(textures) ? textures.filter((texture): texture is TextureRecord => !!texture && typeof texture === 'object') : []
}

const toUint8ArrayPayload = (payload: unknown): Uint8Array | null => {
    if (!payload) return null
    if (payload instanceof Uint8Array) return payload
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
    if (ArrayBuffer.isView(payload)) {
        const source = new Uint8Array(payload.buffer as ArrayBuffer, payload.byteOffset, payload.byteLength)
        const bytes = new Uint8Array(source.byteLength)
        bytes.set(source)
        return bytes
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

export class TextureSaveAssetService {
    constructor(
        private readonly desktop: DesktopGateway,
        private readonly textureDecoder: TextureDecodeGateway,
    ) { }

    async copyReferencedTexturesToTarget(
        modelData: unknown,
        sourceModelPath: string | null,
        targetModelPath: string,
    ): Promise<TextureAssetOperationResult> {
        const textures = getModelTextures(modelData)
        if (textures.length === 0 || !sourceModelPath) {
            return { copiedCount: 0, encodedCount: 0, failed: [] }
        }

        const sourceModelDir = getDirname(sourceModelPath)
        const targetModelDir = getDirname(targetModelPath)
        if (!sourceModelDir || !targetModelDir) {
            return { copiedCount: 0, encodedCount: 0, failed: [] }
        }

        const normalizedSourceDir = normalizeWindowsPath(sourceModelDir).replace(/[\\/]+$/, '').toLowerCase()
        const normalizedTargetDir = normalizeWindowsPath(targetModelDir).replace(/[\\/]+$/, '').toLowerCase()
        if (normalizedSourceDir === normalizedTargetDir) {
            return { copiedCount: 0, encodedCount: 0, failed: [] }
        }

        const copied = new Set<string>()
        const failed: string[] = []
        let copiedCount = 0

        for (const texture of textures) {
            const imagePathRaw = texture.Image
            const replaceableId = Number(texture.ReplaceableId ?? 0)
            if (typeof imagePathRaw !== 'string' || !imagePathRaw || replaceableId > 0) {
                continue
            }

            const normalizedImagePath = normalizeWindowsPath(imagePathRaw)
            if (isAbsoluteWindowsPath(normalizedImagePath)) {
                continue
            }

            const sourceTexturePath = buildTargetAssetPath(sourceModelDir, normalizedImagePath)
            const targetTexturePath = buildTargetAssetPath(targetModelDir, normalizedImagePath)
            const dedupeKey = targetTexturePath.toLowerCase()
            if (copied.has(dedupeKey)) {
                continue
            }

            try {
                if (!(await this.desktop.exists(sourceTexturePath))) {
                    continue
                }

                const targetTextureDir = getDirname(targetTexturePath)
                if (targetTextureDir) {
                    await this.desktop.createDir(targetTextureDir, { recursive: true })
                }

                const bytes = await this.desktop.readFile(sourceTexturePath)
                await this.desktop.writeFile(targetTexturePath, bytes)
                copied.add(dedupeKey)
                copiedCount += 1
            } catch (error) {
                failed.push(`${normalizedImagePath} (${error instanceof Error ? error.message : String(error)})`)
            }
        }

        return { copiedCount, encodedCount: 0, failed }
    }

    async encodeAdjustedTexturesOnSave(
        modelData: unknown,
        sourceModelPath: string | null,
        targetModelPath: string,
        options: EncodeAdjustedTexturesOptions,
    ): Promise<TextureAssetOperationResult> {
        const textures = getModelTextures(modelData)
        if (textures.length === 0) {
            return { copiedCount: 0, encodedCount: 0, failed: [] }
        }

        const targetModelDir = getDirname(targetModelPath)
        const decodeModelPath = sourceModelPath || targetModelPath
        const saveAsMode = options.textureSaveMode === 'save_as'
        const baseSuffixRaw = typeof options.textureSaveSuffix === 'string' && options.textureSaveSuffix.trim().length > 0
            ? options.textureSaveSuffix.trim()
            : '_1'

        const usedPaths = new Set<string>()
        const normalizedPrefix = (input: string) => normalizeWindowsPath(input).toLowerCase()

        textures.forEach((texture) => {
            if (!texture.Image) return
            usedPaths.add(normalizedPrefix(String(texture.Image)))
        })

        const resolveSaveAsPath = async (imagePathRaw: string): Promise<{ imagePath: string; outputPath: string }> => {
            const normalizedImagePath = normalizeWindowsPath(imagePathRaw)
            const isAbsolute = isAbsoluteWindowsPath(normalizedImagePath)
            const originalDir = getPathDir(normalizedImagePath)
            const { stem, ext } = splitPathFileName(normalizedImagePath)

            const baseName = `${stem}${baseSuffixRaw}${ext}`
            const baseRelativePath = originalDir ? joinPath(originalDir, baseName) : baseName

            const buildOutput = (pathValue: string) => isAbsolute
                ? pathValue
                : buildTargetAssetPath(targetModelDir, pathValue)

            let candidatePath = baseRelativePath
            let outputPath = buildOutput(candidatePath)
            let attempt = 1

            while (usedPaths.has(normalizedPrefix(candidatePath)) || await this.desktop.exists(outputPath)) {
                const nextName = `${stem}${baseSuffixRaw}${attempt}${ext}`
                candidatePath = originalDir ? joinPath(originalDir, nextName) : nextName
                outputPath = buildOutput(candidatePath)
                attempt += 1
            }

            usedPaths.add(normalizedPrefix(candidatePath))
            return { imagePath: candidatePath, outputPath }
        }

        let encodedCount = 0
        const failed: string[] = []

        for (const texture of textures) {
            const imagePathRaw = texture.Image
            const adjustmentsRaw = texture[TEXTURE_ADJUSTMENTS_KEY]

            if (typeof imagePathRaw !== 'string' || !imagePathRaw || !adjustmentsRaw) {
                if (Object.prototype.hasOwnProperty.call(texture, TEXTURE_ADJUSTMENTS_KEY)) {
                    delete texture[TEXTURE_ADJUSTMENTS_KEY]
                }
                continue
            }

            const normalizedAdjustments = normalizeTextureAdjustments(adjustmentsRaw)
            const ext = imagePathRaw.toLowerCase().split('.').pop()
            if (isDefaultTextureAdjustments(normalizedAdjustments) || (ext !== 'blp' && ext !== 'tga')) {
                delete texture[TEXTURE_ADJUSTMENTS_KEY]
                continue
            }

            const decodeResult = await this.textureDecoder.decodeTexture(imagePathRaw, decodeModelPath)
            if (!decodeResult.imageData) {
                failed.push(`${imagePathRaw} (解码失败)`)
                continue
            }

            try {
                const adjusted = applyTextureAdjustments(decodeResult.imageData, normalizedAdjustments)
                const payload = await this.desktop.invoke<unknown>('encode_texture_image', {
                    rgba: Array.from(adjusted.data),
                    width: adjusted.width,
                    height: adjusted.height,
                    format: ext,
                    blpQuality: 90,
                })
                const bytes = toUint8ArrayPayload(payload)
                if (!bytes || bytes.byteLength === 0) {
                    failed.push(`${imagePathRaw} (编码失败)`)
                    continue
                }

                let outputPath: string
                if (saveAsMode) {
                    const resolved = await resolveSaveAsPath(imagePathRaw)
                    texture.Image = resolved.imagePath
                    if (texture.Path !== undefined) {
                        texture.Path = resolved.imagePath
                    }
                    outputPath = resolved.outputPath
                } else {
                    const normalizedImagePath = normalizeWindowsPath(imagePathRaw)
                    outputPath = isAbsoluteWindowsPath(normalizedImagePath)
                        ? normalizedImagePath
                        : buildTargetAssetPath(targetModelDir, normalizedImagePath)
                }

                const outputDir = getDirname(outputPath)
                if (outputDir) {
                    await this.desktop.createDir(outputDir, { recursive: true })
                }
                await this.desktop.writeFile(outputPath, bytes)
                delete texture[TEXTURE_ADJUSTMENTS_KEY]
                encodedCount += 1
            } catch (error) {
                failed.push(`${imagePathRaw} (${error instanceof Error ? error.message : String(error)})`)
            }
        }

        return { copiedCount: 0, encodedCount, failed }
    }
}

export const textureSaveAssetService = new TextureSaveAssetService(desktopGateway, textureDecodeGateway)
