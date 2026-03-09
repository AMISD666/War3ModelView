import {
    applyTextureAdjustments,
    DEFAULT_TEXTURE_ADJUSTMENTS,
    TextureAdjustments,
    isDefaultTextureAdjustments,
    normalizeTextureAdjustments,
} from '../utils/textureAdjustments'

type SetSourceMessage = {
    type: 'set-source'
    key: string
    width: number
    height: number
    buffer: ArrayBuffer
}

type ApplyMessage = {
    type: 'apply'
    key: string
    requestId: number
    adjustments: TextureAdjustments
}

type ClearMessage = {
    type: 'clear'
}

type WorkerMessage = SetSourceMessage | ApplyMessage | ClearMessage

let sourceKey: string | null = null
let sourceWidth = 0
let sourceHeight = 0
let sourcePixels: Uint8ClampedArray | null = null

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const payload = event.data

    if (!payload) {
        return
    }

    if (payload.type === 'clear') {
        sourceKey = null
        sourceWidth = 0
        sourceHeight = 0
        sourcePixels = null
        return
    }

    if (payload.type === 'set-source') {
        sourceKey = payload.key
        sourceWidth = payload.width
        sourceHeight = payload.height
        sourcePixels = new Uint8ClampedArray(payload.buffer)
        return
    }

    if (payload.type === 'apply') {
        if (!sourcePixels || payload.key !== sourceKey || sourceWidth <= 0 || sourceHeight <= 0) {
            return
        }

        const normalizedAdjustments = normalizeTextureAdjustments(payload.adjustments)
        let outputPixels: Uint8ClampedArray

        if (isDefaultTextureAdjustments(normalizedAdjustments)) {
            outputPixels = new Uint8ClampedArray(sourcePixels)
        } else {
            const sourceImageData = new ImageData(new Uint8ClampedArray(sourcePixels), sourceWidth, sourceHeight)
            outputPixels = applyTextureAdjustments(sourceImageData, normalizedAdjustments).data
        }

        ;(self as DedicatedWorkerGlobalScope).postMessage(
            {
                type: 'result',
                key: payload.key,
                requestId: payload.requestId,
                width: sourceWidth,
                height: sourceHeight,
                adjustments: normalizedAdjustments,
                buffer: outputPixels.buffer,
            },
            [outputPixels.buffer]
        )
    }
}
