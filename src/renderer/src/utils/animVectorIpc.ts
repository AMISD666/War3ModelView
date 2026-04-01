/**
 * AnimVector 跨 WebView / MessagePack 的序列化辅助。
 * - Tauri emit 无法传 Float32Array（会变成 {}）。
 * - @msgpack/msgpack 会把 Float32Array/Int32Array 编成二进制，解码成 Uint8Array（原始字节），
 *   若用 Array.from 会当成 0–255 的整数或截断错位，导致旋转等关键帧中间帧全 0、末帧 w 错。
 */

/** MDX INT1 动画轨道字段名（与 mdx/parse AnimVectorType.INT1 对应），用于按 int32 解释 Uint8Array 字节 */
const INT1_ANIM_FIELD_NAMES = new Set([
    'TextureID',
    'NormalTextureID',
    'ORMTextureID',
    'EmissiveTextureID',
    'TeamColorTextureID',
    'ReflectionsTextureID',
    'TextureSlot',
    'AttenuationStart',
    'AttenuationEnd',
])

/** 关键帧编辑器 payload 中的 fieldName 是否为整型轨道（Vector 为 Int32，MsgPack 后常为 Uint8Array(4n)） */
export function isKeyframeAnimVectorIntTrack(fieldName?: string): boolean {
    if (!fieldName) return false
    return INT1_ANIM_FIELD_NAMES.has(fieldName)
}

export type VectorPlainOptions = {
    /** true：按 int32 解释每 4 字节；false：按 float32 解释 */
    isInt?: boolean
}

/** 将 MsgPack 还原的 Uint8Array（长度需为 4 的倍数）按小端 float32 解释为 number[] */
function uint8ToFloat32Numbers(u8: Uint8Array): number[] {
    if (u8.length === 0 || u8.length % 4 !== 0) {
        return Array.from(u8, (b) => b)
    }
    const copy = new Uint8Array(u8.length)
    copy.set(u8)
    return Array.from(new Float32Array(copy.buffer, 0, copy.length / 4))
}

/** 将 MsgPack 还原的 Uint8Array 按小端 int32 解释为 number[] */
function uint8ToInt32Numbers(u8: Uint8Array): number[] {
    if (u8.length === 0 || u8.length % 4 !== 0) {
        return Array.from(u8, (b) => b)
    }
    const copy = new Uint8Array(u8.length)
    copy.set(u8)
    return Array.from(new Int32Array(copy.buffer, 0, copy.length / 4))
}

/**
 * 四元数 w=1.0 在部分序列化路径上会被错成 128（误把 float 首字节 0x80 当整数）。
 * 仅对典型单位四元数形态做纠正，避免关键帧编辑器显示 {0,0,0,128}。
 */
function fixLikelyQuaternionWCorruption(nums: number[]): number[] {
    if (nums.length !== 4) return nums
    const [a, b, c, d] = nums
    if (a === 0 && b === 0 && c === 0 && d === 128) {
        return [0, 0, 0, 1]
    }
    return nums
}

/**
 * 将关键帧向量转为普通 number[]（供 JSON / IPC / 编辑器使用）。
 * @param opts.isInt 整型轨道（TextureID 等）时，Uint8Array 按 int32 解释；否则按 float32。
 */
export function vectorToPlainArray(v: unknown, opts?: VectorPlainOptions): number[] {
    let out: number[] = []
    if (v === undefined || v === null) return []
    if (typeof v === 'number') out = [v]
    else if (Array.isArray(v)) out = v.map((x) => Number(x))
    else if (v instanceof Float32Array) {
        out = Array.from(v)
    } else if (v instanceof Int32Array) {
        out = Array.from(v)
    } else if (v instanceof Uint8Array) {
        out = opts?.isInt ? uint8ToInt32Numbers(v) : uint8ToFloat32Numbers(v)
    } else if (ArrayBuffer.isView(v)) {
        // 其他 TypedArray（如 Uint16）：保持按元素枚举；若遇 MsgPack 异常再单独处理
        out = Array.from(v as ArrayLike<number>)
    } else if (typeof v === 'object') {
        const keys = Object.keys(v as object)
            .map((n) => parseInt(n, 10))
            .filter((n) => !Number.isNaN(n))
            .sort((a, b) => a - b)
        if (keys.length === 0) return []
        out = keys.map((i) => Number((v as Record<number | string, unknown>)[i]))
    } else {
        return []
    }
    return fixLikelyQuaternionWCorruption(out)
}

export type CloneAnimVectorForIpcOpts = VectorPlainOptions

export function cloneAnimVectorForIpc(anim: unknown, opts?: CloneAnimVectorForIpcOpts): unknown {
    if (!anim || typeof anim !== 'object') return anim
    const a = anim as { Keys?: unknown[]; LineType?: unknown; GlobalSeqId?: unknown }
    if (!Array.isArray(a.Keys)) return anim
    const lineOpts = opts
    return {
        ...a,
        Keys: a.Keys.map((k: unknown) => {
            const key = k as Record<string, unknown>
            const next: Record<string, unknown> = {
                Frame: key.Frame ?? key.Time ?? 0,
                Vector: vectorToPlainArray(key.Vector ?? key.Value, lineOpts),
            }
            if (key.InTan !== undefined) next.InTan = vectorToPlainArray(key.InTan, lineOpts)
            if (key.OutTan !== undefined) next.OutTan = vectorToPlainArray(key.OutTan, lineOpts)
            return next
        }),
    }
}

export type SerializeAnimVectorForKeyframeIpcOpts = CloneAnimVectorForIpcOpts

/**
 * 关键帧子窗口 IPC：必须整段走 JSON 字符串。
 * Tauri WebView 间传递嵌套对象时，纯数组里的 float 可能被错误落成整数（如四元数 w=1 变成 128）。
 */
export function serializeAnimVectorForKeyframeIpc(
    anim: unknown,
    opts?: SerializeAnimVectorForKeyframeIpcOpts
): string {
    return JSON.stringify(cloneAnimVectorForIpc(anim, opts))
}
