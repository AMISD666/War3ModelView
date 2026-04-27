// @ts-ignore war3-model does not ship complete TypeScript declarations for BLP helpers.
import { decodeBLP as war3DecodeBLP, getBLPImageData as war3GetBLPImageData } from 'war3-model'

export interface War3BlpMipData {
    data: Uint8Array | Uint8ClampedArray
    width: number
    height: number
}

export const decodeWar3Blp = (buffer: ArrayBuffer): unknown => war3DecodeBLP(buffer)

export const getWar3BlpImageData = (blp: any, mipLevel: number): War3BlpMipData =>
    war3GetBLPImageData(blp, mipLevel) as War3BlpMipData

export const decodeWar3BlpMipToImageData = (buffer: ArrayBuffer, mipLevel = 0): ImageData => {
    const blp = decodeWar3Blp(buffer)
    const mip = getWar3BlpImageData(blp, mipLevel)
    return new ImageData(new Uint8ClampedArray(mip.data), mip.width, mip.height)
}
