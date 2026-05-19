export function buildFallbackNormals(vertexCount: number): Float32Array {
    const normals = new Float32Array(vertexCount * 3)
    for (let i = 2; i < normals.length; i += 3) {
        normals[i] = 1
    }
    return normals
}

function objectToTypedArray<T extends Float32Array | Uint16Array | Uint8Array>(
    obj: any,
    Constructor: { new(length: number): T; new(values: ArrayLike<number>): T }
): T {
    const keys = Object.keys(obj);
    const numKeys = keys.filter(k => !isNaN(Number(k)) && Number(k) >= 0).map(Number);

    if (numKeys.length > 0) {
        const maxKey = Math.max(...numKeys);
        const arr = new Constructor(maxKey + 1);
        numKeys.forEach(k => arr[k] = Number(obj[k]));
        return arr;
    }

    return new Constructor(Object.values(obj).map(Number));
}

export function normalizeInterval(interval: any): Uint32Array {
    let start = 0;
    let end = 0;
    if (interval instanceof Uint32Array || ArrayBuffer.isView(interval)) {
        start = Number((interval as unknown as ArrayLike<number>)[0]);
        end = Number((interval as unknown as ArrayLike<number>)[1]);
    } else if (Array.isArray(interval)) {
        start = Number(interval[0]);
        end = Number(interval[1]);
    } else if (interval && typeof interval === 'object') {
        const values = Object.values(interval).map(Number);
        start = Number(values[0]);
        end = Number(values[1]);
    }
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = 0;
    start = Math.max(0, Math.floor(start));
    end = Math.max(0, Math.floor(end));
    if (start > end) {
        const temp = start;
        start = end;
        end = temp;
    }
    return new Uint32Array([start, end]);
}

export function toFloat32Array(arr: any, size: number = 3): Float32Array {
    const result = new Float32Array(size);

    if (arr instanceof Float32Array) {
        for (let i = 0; i < Math.min(size, arr.length); i++) {
            result[i] = arr[i];
        }
        return result;
    }
    if (Array.isArray(arr)) {
        for (let i = 0; i < Math.min(size, arr.length); i++) {
            result[i] = Number(arr[i]) || 0;
        }
        return result;
    }
    if (arr && typeof arr === 'object') {
        const values = Object.values(arr).map(Number);
        for (let i = 0; i < Math.min(size, values.length); i++) {
            result[i] = values[i] || 0;
        }
        return result;
    }
    return result;
}

export function toDynamicFloat32Array(arr: any): Float32Array {
    if (arr instanceof Float32Array) return arr;
    if (Array.isArray(arr)) return new Float32Array(arr);
    if (arr && typeof arr === 'object') {
        return objectToTypedArray(arr, Float32Array);
    }
    return new Float32Array(0);
}

export function toUint16Array(arr: any): Uint16Array {
    if (arr instanceof Uint16Array) return arr;
    if (Array.isArray(arr)) return new Uint16Array(arr);
    if (arr && typeof arr === 'object') {
        return objectToTypedArray(arr, Uint16Array);
    }
    return new Uint16Array(0);
}

export function toUint8Array(arr: any): Uint8Array {
    if (arr instanceof Uint8Array) return arr;
    if (Array.isArray(arr)) return new Uint8Array(arr);
    if (arr && typeof arr === 'object') {
        return objectToTypedArray(arr, Uint8Array);
    }
    return new Uint8Array(0);
}

export function toTypedVector(
    value: any,
    vectorSize: number,
    isInt: boolean,
    defaultVec?: number[] | ArrayLike<number>
): Int32Array | Float32Array {
    const Type = isInt ? Int32Array : Float32Array;
    const result = new Type(vectorSize);
    if (defaultVec) {
        const defArr = ArrayBuffer.isView(defaultVec) ? Array.from(defaultVec as unknown as ArrayLike<number>) : Array.from(defaultVec as number[]);
        for (let i = 0; i < vectorSize; i++) {
            const num = Number(defArr[i]);
            if (Number.isFinite(num)) {
                result[i] = num;
            }
        }
    }

    if (value === undefined || value === null) {
        return result;
    }

    const assignValue = (index: number, val: any) => {
        const num = Number(val);
        if (Number.isFinite(num) && index >= 0 && index < vectorSize) {
            result[index] = num;
        }
    };

    if (typeof value === 'number') {
        assignValue(0, value);
        return result;
    }

    if (value instanceof Uint8Array && value.length > 0 && value.length % 4 === 0) {
        const copy = new Uint8Array(value.length)
        copy.set(value)
        const decoded = isInt
            ? Array.from(new Int32Array(copy.buffer, 0, copy.length / 4))
            : Array.from(new Float32Array(copy.buffer, 0, copy.length / 4))
        for (let i = 0; i < Math.min(vectorSize, decoded.length); i++) {
            assignValue(i, decoded[i])
        }
        return result
    }

    if (value instanceof Type || ArrayBuffer.isView(value)) {
        const arr = Array.from(value as unknown as ArrayLike<number>);
        for (let i = 0; i < Math.min(vectorSize, arr.length); i++) {
            assignValue(i, arr[i]);
        }
        return result;
    }

    if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(vectorSize, value.length); i++) {
            assignValue(i, value[i]);
        }
        return result;
    }

    if (typeof value === 'object') {
        const numericKeys = Object.keys(value)
            .map(k => Number(k))
            .filter(k => Number.isFinite(k));
        if (numericKeys.length > 0) {
            numericKeys.forEach(k => assignValue(k, value[k]));
        } else {
            const arr = Object.values(value) as any[];
            for (let i = 0; i < Math.min(vectorSize, arr.length); i++) {
                assignValue(i, arr[i]);
            }
        }
    }

    return result;
}

function normalizeQuaternionValues(values: ArrayLike<number> | undefined | null): Float32Array {
    const x = Number(values?.[0] ?? 0)
    const y = Number(values?.[1] ?? 0)
    const z = Number(values?.[2] ?? 0)
    const w = Number(values?.[3] ?? 1)
    const length = Math.hypot(x, y, z, w)
    if (!Number.isFinite(length) || length < 1e-8) {
        return new Float32Array([0, 0, 0, 1])
    }
    return new Float32Array([x / length, y / length, z / length, w / length])
}

function normalizeQuaternionAnimVectorKeys(keys: any[]): any[] {
    if (keys.length <= 0) return keys

    const normalized = keys.map((key) => {
        const next = { ...key }
        next.Vector = normalizeQuaternionValues(key?.Vector)
        if (key?.InTan !== undefined) {
            next.InTan = normalizeQuaternionValues(key.InTan)
        }
        if (key?.OutTan !== undefined) {
            next.OutTan = normalizeQuaternionValues(key.OutTan)
        }
        return next
    })

    for (let i = 1; i < normalized.length; i++) {
        const previous = normalized[i - 1]?.Vector
        const current = normalized[i]?.Vector
        if (!previous || !current || previous.length < 4 || current.length < 4) continue

        const dot =
            previous[0] * current[0] +
            previous[1] * current[1] +
            previous[2] * current[2] +
            previous[3] * current[3]

        if (dot >= 0) continue

        normalized[i].Vector = new Float32Array([
            -current[0],
            -current[1],
            -current[2],
            -current[3],
        ])

        if (normalized[i].InTan) {
            normalized[i].InTan = new Float32Array([
                -normalized[i].InTan[0],
                -normalized[i].InTan[1],
                -normalized[i].InTan[2],
                -normalized[i].InTan[3],
            ])
        }

        if (normalized[i].OutTan) {
            normalized[i].OutTan = new Float32Array([
                -normalized[i].OutTan[0],
                -normalized[i].OutTan[1],
                -normalized[i].OutTan[2],
                -normalized[i].OutTan[3],
            ])
        }
    }

    return normalized
}

export function isAnimVector(val: any): boolean {
    return val && typeof val === 'object' && Array.isArray(val.Keys);
}

export function fixAnimVector(
    animVec: any,
    vectorSize: number = 3,
    isInt: boolean = false,
    defaultVec?: number[] | ArrayLike<number>,
    globalSeqCount?: number
): any {
    if (!animVec) return null;
    if (typeof animVec !== 'object') return null;
    const lineTypeMap: Record<string, number> = {
        DontInterp: 0,
        Linear: 1,
        Hermite: 2,
        Bezier: 3
    };
    if (typeof animVec.LineType === 'string' && animVec.LineType in lineTypeMap) {
        animVec.LineType = lineTypeMap[animVec.LineType];
    }
    if (animVec.Keys) {
        if (!Array.isArray(animVec.Keys)) {
            if (typeof animVec.Keys === 'object') {
                animVec.Keys = Object.values(animVec.Keys);
            } else {
                animVec.Keys = [];
            }
        }
        animVec.Keys.forEach((key: any) => {
            const frame = Number(key.Frame ?? key.Time ?? 0);
            key.Frame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;

            key.Vector = toTypedVector(key.Vector, vectorSize, isInt, defaultVec);

            const needsTangents = animVec.LineType === 2 || animVec.LineType === 3;
            if (needsTangents) {
                key.InTan = toTypedVector(key.InTan, vectorSize, isInt);
                key.OutTan = toTypedVector(key.OutTan, vectorSize, isInt);
            } else {
                if (key.InTan && !(key.InTan instanceof Float32Array) && !(key.InTan instanceof Int32Array)) {
                    key.InTan = toTypedVector(key.InTan, vectorSize, isInt);
                }
                if (key.OutTan && !(key.OutTan instanceof Float32Array) && !(key.OutTan instanceof Int32Array)) {
                    key.OutTan = toTypedVector(key.OutTan, vectorSize, isInt);
                }
            }
        });
        animVec.Keys = animVec.Keys
            .filter((key: any) => ArrayBuffer.isView(key?.Vector) && key.Vector.length === vectorSize)
            .sort((a: any, b: any) => a.Frame - b.Frame)
            .filter((key: any, index: number, keys: any[]) =>
                index === keys.length - 1 || key.Frame !== keys[index + 1].Frame
            );
        if (!isInt && vectorSize === 4) {
            animVec.Keys = normalizeQuaternionAnimVectorKeys(animVec.Keys);
        }
    } else {
        animVec.Keys = [];
    }
    if (animVec.LineType === undefined || animVec.LineType === null || ![0, 1, 2, 3].includes(animVec.LineType)) {
        animVec.LineType = 1;
    }
    if (animVec.GlobalSeqId === undefined) {
        animVec.GlobalSeqId = null;
    } else if (typeof animVec.GlobalSeqId !== 'number' || !Number.isFinite(animVec.GlobalSeqId)) {
        animVec.GlobalSeqId = null;
    }
    if (typeof animVec.GlobalSeqId === 'number' && animVec.GlobalSeqId < 0) {
        animVec.GlobalSeqId = null;
    }
    if (typeof globalSeqCount === 'number' && typeof animVec.GlobalSeqId === 'number') {
        if (globalSeqCount <= 0 || animVec.GlobalSeqId >= globalSeqCount) {
            animVec.GlobalSeqId = null;
        }
    }
    return animVec;
}

export function ensureAnimVector(
    value: any,
    vectorSize: number = 3,
    isInt: boolean = false,
    defaultVec?: number[] | ArrayLike<number>,
    globalSeqCount?: number
): any {
    if (!value) return null;
    if (value && typeof value === 'object' && Array.isArray(value.Keys)) {
        return fixAnimVector(value, vectorSize, isInt, defaultVec, globalSeqCount);
    }
    const vec = toTypedVector(value, vectorSize, isInt, defaultVec);
    return {
        LineType: 1,
        GlobalSeqId: null,
        Keys: [{ Frame: 0, Vector: vec }]
    };
}

function clampTextureTrackValue(value: unknown, textureCount: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return -1
    if (textureCount <= 0) return -1
    const normalized = Math.floor(parsed)
    if (normalized < 0 || normalized >= textureCount) return -1
    return normalized
}

export function normalizeTextureIdAnimVector(value: any, textureCount: number, globalSeqCount?: number): any {
    const anim = ensureAnimVector(value, 1, true, undefined, globalSeqCount)
    if (!anim || !Array.isArray(anim.Keys)) {
        return anim
    }

    anim.Keys.forEach((key: any) => {
        const nextTextureId = clampTextureTrackValue(key?.Vector?.[0], textureCount)
        key.Vector = new Int32Array([nextTextureId])
        if (key.InTan !== undefined) {
            key.InTan = new Int32Array([clampTextureTrackValue(key.InTan?.[0], textureCount)])
        }
        if (key.OutTan !== undefined) {
            key.OutTan = new Int32Array([clampTextureTrackValue(key.OutTan?.[0], textureCount)])
        }
    })

    return anim
}

export function fixNode(node: any, globalSeqCount?: number): void {
    if (!node) return;
    if (node.Translation) {
        node.Translation = ensureAnimVector(node.Translation, 3, false, [0, 0, 0], globalSeqCount);
        if (!node.Translation || !node.Translation.Keys || node.Translation.Keys.length === 0) {
            node.Translation = null;
        }
    }
    if (node.Rotation) {
        node.Rotation = ensureAnimVector(node.Rotation, 4, false, [0, 0, 0, 1], globalSeqCount);
        if (!node.Rotation || !node.Rotation.Keys || node.Rotation.Keys.length === 0) {
            node.Rotation = null;
        }
    }
    if (node.Scaling) {
        node.Scaling = ensureAnimVector(node.Scaling, 3, false, [1, 1, 1], globalSeqCount);
        if (!node.Scaling || !node.Scaling.Keys || node.Scaling.Keys.length === 0) {
            node.Scaling = null;
        }
    }
    if (node.Flags === undefined) node.Flags = 0;
    if (node.ObjectId === undefined) node.ObjectId = 0;
    if (node.Parent === undefined) node.Parent = -1;
    if (!node.Name) node.Name = 'UnnamedNode';
}
