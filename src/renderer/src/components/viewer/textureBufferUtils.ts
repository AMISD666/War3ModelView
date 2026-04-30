export function toUint8Array(payload: any): Uint8Array | null {
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

export function parseTextureBytesPayload(payload: any, texturePaths: string[]): Map<string, Uint8Array> {
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

export function toTightArrayBuffer(bytes: Uint8Array): ArrayBuffer {
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
