import type { Model } from './model';

/** 从任意 byteOffset 读 3×float32 LE（避免 byteOffset 非 4 对齐时 new Float32Array(buffer, off, 3) 抛 RangeError） */
function float32Vec3LEFromBuffer(buf: ArrayBuffer, byteOffset: number): Float32Array | null {
    if (byteOffset + 12 > buf.byteLength) return null;
    const out = new Float32Array(3);
    if (byteOffset % 4 === 0) {
        return new Float32Array(buf, byteOffset, 3);
    }
    const dv = new DataView(buf);
    out[0] = dv.getFloat32(byteOffset, true);
    out[1] = dv.getFloat32(byteOffset + 4, true);
    out[2] = dv.getFloat32(byteOffset + 8, true);
    return out;
}

/**
 * 将 PivotPoints 的一项统一为 Float32Array(3)（小端 IEEE754）。
 * 部分管线会把 Float32Array 序列成 Uint8Array；若再被截成仅 3 个字节，会误把「首 float 的前三字节」
 *（如 214,168,178）当成 X/Y/Z，导出 MDL 会变成整数。若底层 ArrayBuffer 仍有连续 12 字节，则按 3×float32 解码。
 */
export function coercePivotFloat3(
    p: Float32Array | Uint8Array | number[] | undefined | null
): Float32Array | null {
    if (p == null) return null;
    if (p instanceof Float32Array && p.length >= 3) {
        // 拷贝元素，避免对底层 buffer 的 byteOffset 对齐依赖（极端视图可能非 4 对齐）
        return new Float32Array([p[0], p[1], p[2]]);
    }
    if (Array.isArray(p) && p.length >= 3) {
        return new Float32Array([Number(p[0]), Number(p[1]), Number(p[2])]);
    }
    if (p instanceof Uint8Array) {
        if (p.byteLength >= 12) {
            return float32Vec3LEFromBuffer(p.buffer, p.byteOffset);
        }
        if (p.buffer.byteLength >= p.byteOffset + 12) {
            return float32Vec3LEFromBuffer(p.buffer, p.byteOffset);
        }
    }
    return null;
}

/**
 * MDX800：PIVT 与 MDL 的 PivotPoints 块均为「按 ObjectId 升序」排列的 N 个 float[3]，
 * 应对应稀疏 Nodes 的下标，而非稠密 0..N-1。解析时先写入 PivotPointsSequential，全部解析完再映射。
 */
export function applySequentialPivotPoints(model: Model): void {
    const seq = model.PivotPointsSequential;
    if (!seq?.length) {
        delete model.PivotPointsSequential;
        return;
    }

    const objectIds: number[] = [];
    for (let i = 0; i < model.Nodes.length; ++i) {
        if (model.Nodes[i]) {
            objectIds.push(i);
        }
    }
    objectIds.sort((a, b) => a - b);

    model.PivotPoints = [];
    const n = Math.min(seq.length, objectIds.length);
    for (let k = 0; k < n; ++k) {
        model.PivotPoints[objectIds[k]] = seq[k];
    }

    delete model.PivotPointsSequential;
}

/** 按 ObjectId 升序收集非空 PivotPoints，用于写出 PIVT / MDL */
export function pivotPointsInObjectIdOrder(model: Model): Float32Array[] {
    const objectIds: number[] = [];
    for (let i = 0; i < model.PivotPoints.length; ++i) {
        if (model.PivotPoints[i]) {
            objectIds.push(i);
        }
    }
    objectIds.sort((a, b) => a - b);
    return objectIds.map((id) => {
        const raw = model.PivotPoints[id];
        const coerced = coercePivotFloat3(raw as Float32Array | Uint8Array | number[]);
        // 勿回退为「原始」Uint8Array(3) 等，否则 MDL generateArray 会把字节写成整数
        return coerced ?? new Float32Array([0, 0, 0]);
    });
}
