import type { TextureDecodeGateway, TextureDecodeResult } from './TextureDecodeGateway'
import {
    getTextureCandidatePaths,
    loadTexturePreviewFromFile,
    loadTexturePreviewFromMpq,
    normalizeTexturePath,
} from './TexturePreviewSource'

export class ViewerTextureDecodeGateway implements TextureDecodeGateway {
    async decodeTexture(imagePath: string, modelPath: string): Promise<TextureDecodeResult> {
        const normalizedImagePath = normalizeTexturePath(imagePath)

        if (modelPath && !modelPath.startsWith('dropped:')) {
            const candidates = getTextureCandidatePaths(modelPath, normalizedImagePath)
            for (const candidate of candidates) {
                const imageData = await loadTexturePreviewFromFile(candidate)
                if (imageData) {
                    return { imageData }
                }
            }
        }

        const imageData = await loadTexturePreviewFromMpq(normalizedImagePath)
        return {
            imageData: imageData ?? null,
        }
    }
}

export const textureDecodeGateway: TextureDecodeGateway = new ViewerTextureDecodeGateway()
