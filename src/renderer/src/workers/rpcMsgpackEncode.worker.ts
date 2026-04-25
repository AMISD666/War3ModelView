/// <reference lib="webworker" />
import { encode } from '@msgpack/msgpack'

function uint8ToBase64(bytes: Uint8Array): string {
    const chunk = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

self.onmessage = (event: MessageEvent<{ id: number; payload: unknown }>) => {
    const { id, payload } = event.data
    try {
        const packed = encode(payload) as Uint8Array
        self.postMessage({ id, ok: true, msgpackB64: uint8ToBase64(packed) })
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        self.postMessage({ id, ok: false, error: message })
    }
}
