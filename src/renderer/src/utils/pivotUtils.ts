function float32Vec3LEFromBuffer(buf: ArrayBufferLike, byteOffset: number): Float32Array | null {
    if (byteOffset + 12 > buf.byteLength) return null
    const out = new Float32Array(3)
    if (buf instanceof ArrayBuffer && byteOffset % 4 === 0) {
        return new Float32Array(buf, byteOffset, 3)
    }
    const dv = new DataView(buf, byteOffset, 12)
    out[0] = dv.getFloat32(0, true)
    out[1] = dv.getFloat32(4, true)
    out[2] = dv.getFloat32(8, true)
    return out
}

export function coercePivotFloat3(
    value: Float32Array | Uint8Array | number[] | undefined | null
): Float32Array | null {
    if (value == null) return null
    if (value instanceof Float32Array && value.length >= 3) {
        return new Float32Array([value[0], value[1], value[2]])
    }
    if (Array.isArray(value) && value.length >= 3) {
        return new Float32Array([Number(value[0]), Number(value[1]), Number(value[2])])
    }
    if (value instanceof Uint8Array && value.buffer.byteLength >= value.byteOffset + 12) {
        return float32Vec3LEFromBuffer(value.buffer, value.byteOffset)
    }
    return null
}
