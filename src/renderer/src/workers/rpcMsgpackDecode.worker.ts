/// <reference lib="webworker" />
/**
 * 在 Worker 线程解码 MessagePack（大 base64 时减轻主线程阻塞）
 */
import { decode } from '@msgpack/msgpack'

function b64ToUint8(b64: string): Uint8Array {
    const bin = atob(b64)
    const len = bin.length
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        out[i] = bin.charCodeAt(i)
    }
    return out
}

self.onmessage = (e: MessageEvent<string>) => {
    const b64 = e.data
    try {
        const bytes = b64ToUint8(b64)
        const obj = decode(bytes)
        self.postMessage({ ok: true, obj })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        self.postMessage({ ok: false, error: msg })
    }
}
