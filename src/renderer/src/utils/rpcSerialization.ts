/**
 * 独立窗口 RPC：MessagePack 压缩快照，减少跨 WebView 传输体积与 JSON.parse 压力。
 */
import { decode, encode } from '@msgpack/msgpack'

export const RPC_ENCODING_KEY = '__rpcEncoding'
export const RPC_PAYLOAD_KEY = '__rpcPayload'
export const RPC_ENCODING_MSGPACK = 'msgpack'

/** 超过此 base64 字符长度时在 Worker 中 decode，减轻主线程卡顿 */
const MSGPACK_DECODE_WORKER_THRESHOLD_CHARS = 320_000

let decodeWorker: Worker | null = null

function getMsgpackDecodeWorker(): Worker {
    if (!decodeWorker) {
        decodeWorker = new Worker(new URL('../workers/rpcMsgpackDecode.worker.ts', import.meta.url), {
            type: 'module'
        })
    }
    return decodeWorker
}

function uint8ToBase64(bytes: Uint8Array): string {
    const chunk = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

/**
 * 为跨 WebView 传输选择 JSON 字符串或 MessagePack+base64 包装（取更短的一种）。
 */
export function chooseRpcEmitEncoding(payload: unknown): {
    mode: 'json' | 'msgpack'
    json?: string
    msgpackB64?: string
} {
    const json = JSON.stringify(payload)
    let packed: Uint8Array
    try {
        packed = encode(payload) as Uint8Array
    } catch {
        return { mode: 'json', json }
    }

    const msgpackB64 = uint8ToBase64(packed)
    if (msgpackB64.length < json.length) {
        return { mode: 'msgpack', msgpackB64 }
    }
    return { mode: 'json', json }
}

function decodeMsgpackB64Sync(b64: string): unknown {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i)
    }
    return decode(bytes)
}

export function decodeMsgpackB64InWorker(b64: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const w = getMsgpackDecodeWorker()
        const onMsg = (e: MessageEvent<{ ok: boolean; obj?: unknown; error?: string }>) => {
            w.removeEventListener('message', onMsg)
            if (e.data.ok && e.data.obj !== undefined) {
                resolve(e.data.obj)
            } else {
                reject(new Error(e.data.error || 'Worker MessagePack 解码失败'))
            }
        }
        w.addEventListener('message', onMsg)
        w.postMessage(b64)
    })
}

/**
 * 解析 rpc-sync 收到的 payload（普通对象或 MessagePack 包装）。
 */
export async function normalizeRpcSyncPayload<T = unknown>(raw: unknown): Promise<T> {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>
        if (o[RPC_ENCODING_KEY] === RPC_ENCODING_MSGPACK && typeof o[RPC_PAYLOAD_KEY] === 'string') {
            const b64 = o[RPC_PAYLOAD_KEY] as string
            try {
                if (b64.length >= MSGPACK_DECODE_WORKER_THRESHOLD_CHARS) {
                    return (await decodeMsgpackB64InWorker(b64)) as T
                }
                return decodeMsgpackB64Sync(b64) as T
            } catch (e) {
                console.warn('[rpcSerialization] MessagePack 解码失败，尝试同步路径', e)
                return decodeMsgpackB64Sync(b64) as T
            }
        }
    }
    return raw as T
}
