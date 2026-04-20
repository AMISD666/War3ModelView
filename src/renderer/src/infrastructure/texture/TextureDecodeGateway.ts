export interface TextureDecodeResult {
    imageData: ImageData | null
}

export interface TextureDecodeGateway {
    decodeTexture(imagePath: string, modelPath: string): Promise<TextureDecodeResult>
}
