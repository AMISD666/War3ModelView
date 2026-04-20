import type { TextureDecodeGateway, TextureDecodeResult } from './TextureDecodeGateway'

export class ViewerTextureDecodeGateway implements TextureDecodeGateway {
    async decodeTexture(imagePath: string, modelPath: string): Promise<TextureDecodeResult> {
        const { decodeTexture } = await import('../../components/viewer/textureLoader')
        const result = await decodeTexture(imagePath, modelPath)
        return {
            imageData: result.imageData ?? null,
        }
    }
}

export const textureDecodeGateway: TextureDecodeGateway = new ViewerTextureDecodeGateway()
