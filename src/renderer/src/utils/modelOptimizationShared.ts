export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const toFloatArray = (value: any): Float32Array => {
    if (value instanceof Float32Array) return value;
    if (ArrayBuffer.isView(value)) return new Float32Array(Array.from(value as unknown as ArrayLike<number>));
    if (Array.isArray(value)) return new Float32Array(value.map((n) => Number(n) || 0));
    if (value && typeof value === 'object') return new Float32Array(Object.values(value).map((n) => Number(n) || 0));
    return new Float32Array(0);
};

export const toUint32FaceArray = (faces: any): Uint32Array => {
    if (faces instanceof Uint32Array) return faces;
    if (faces instanceof Uint16Array) return new Uint32Array(faces);
    if (ArrayBuffer.isView(faces)) return new Uint32Array(Array.from(faces as unknown as ArrayLike<number>));
    if (Array.isArray(faces)) return new Uint32Array(faces.map((n) => Number(n) || 0));
    if (faces && typeof faces === 'object') return new Uint32Array(Object.values(faces).map((n) => Number(n) || 0));
    return new Uint32Array(0);
};

export const toGroupsMatrix = (groups: any): number[][] => {
    if (!Array.isArray(groups)) return [];
    return groups.map((g: any) => {
        if (Array.isArray(g)) return g.map((n) => Number(n) || 0);
        if (g && Array.isArray(g.matrices)) return g.matrices.map((n: any) => Number(n) || 0);
        return [];
    });
};

export const quantize = (v: number, step: number) => Math.round(v / Math.max(step, 1e-8));

export const vertexDistanceSq = (arr: Float32Array, ia: number, ib: number): number => {
    const ax = arr[ia * 3];
    const ay = arr[ia * 3 + 1];
    const az = arr[ia * 3 + 2];
    const bx = arr[ib * 3];
    const by = arr[ib * 3 + 1];
    const bz = arr[ib * 3 + 2];
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    return dx * dx + dy * dy + dz * dz;
};

export const uvDistanceSq = (uv: Float32Array | null, ia: number, ib: number): number => {
    if (!uv) return 0;
    const au = uv[ia * 2];
    const av = uv[ia * 2 + 1];
    const bu = uv[ib * 2];
    const bv = uv[ib * 2 + 1];
    const du = au - bu;
    const dv = av - bv;
    return du * du + dv * dv;
};

export const normalDot = (normals: Float32Array | null, ia: number, ib: number): number => {
    if (!normals) return 1;
    const ax = normals[ia * 3];
    const ay = normals[ia * 3 + 1];
    const az = normals[ia * 3 + 2];
    const bx = normals[ib * 3];
    const by = normals[ib * 3 + 1];
    const bz = normals[ib * 3 + 2];
    return ax * bx + ay * by + az * bz;
};

export const toVector = (value: any): number[] => {
    if (typeof value === 'number') return [Number.isFinite(value) ? value : 0];
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>).map((n) => Number(n) || 0);
    if (Array.isArray(value)) return value.map((n) => Number(n) || 0);
    if (value && typeof value === 'object') return Object.values(value).map((n) => Number(n) || 0);
    return [0];
};

export const fromVector = (template: any, vec: number[]): any => {
    if (typeof template === 'number') return vec[0] ?? 0;
    if (template instanceof Float32Array) return new Float32Array(vec);
    if (template instanceof Int32Array) return new Int32Array(vec.map((n) => Math.round(n)));
    if (template instanceof Uint32Array) return new Uint32Array(vec.map((n) => Math.max(0, Math.round(n))));
    if (template instanceof Uint16Array) return new Uint16Array(vec.map((n) => Math.max(0, Math.round(n))));
    if (template instanceof Uint8Array) return new Uint8Array(vec.map((n) => clamp(Math.round(n), 0, 255)));
    if (ArrayBuffer.isView(template)) {
        const Ctor = (template as any).constructor;
        return new Ctor(vec);
    }
    if (Array.isArray(template)) return [...vec];
    return new Float32Array(vec);
};

export const vectorMaxAbsDiff = (a: number[], b: number[]) => {
    const len = Math.max(a.length, b.length);
    let m = 0;
    for (let i = 0; i < len; i++) {
        const diff = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
        if (diff > m) m = diff;
    }
    return m;
};

export const lerpVector = (a: number[], b: number[], t: number): number[] => {
    const len = Math.max(a.length, b.length);
    const out = new Array<number>(len);
    for (let i = 0; i < len; i++) {
        out[i] = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
    }
    return out;
};

export const normalizeQuaternion = (q: number[]): number[] => {
    const x = q[0] ?? 0;
    const y = q[1] ?? 0;
    const z = q[2] ?? 0;
    const w = q[3] ?? 1;
    const len = Math.sqrt(x * x + y * y + z * z + w * w);
    if (!Number.isFinite(len) || len < 1e-8) return [0, 0, 0, 1];
    return [x / len, y / len, z / len, w / len];
};

export const nlerpQuaternion = (a: number[], b: number[], t: number): number[] => {
    let qa = normalizeQuaternion(a);
    let qb = normalizeQuaternion(b);
    const dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
    if (dot < 0) qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    return normalizeQuaternion([
        qa[0] + (qb[0] - qa[0]) * t,
        qa[1] + (qb[1] - qa[1]) * t,
        qa[2] + (qb[2] - qa[2]) * t,
        qa[3] + (qb[3] - qa[3]) * t
    ]);
};

export const slerpQuaternion = (a: number[], b: number[], t: number): number[] => {
    const qa = normalizeQuaternion(a);
    let qb = normalizeQuaternion(b);
    let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
    if (dot < 0) {
        qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
        dot = -dot;
    }
    if (dot > 0.9995) {
        return nlerpQuaternion(qa, qb, t);
    }
    const safeDot = clamp(dot, -1, 1);
    const theta0 = Math.acos(safeDot);
    const theta = theta0 * t;
    const sinTheta0 = Math.sin(theta0);
    const sinTheta = Math.sin(theta);
    const s0 = Math.cos(theta) - safeDot * sinTheta / sinTheta0;
    const s1 = sinTheta / sinTheta0;
    return normalizeQuaternion([
        qa[0] * s0 + qb[0] * s1,
        qa[1] * s0 + qb[1] * s1,
        qa[2] * s0 + qb[2] * s1,
        qa[3] * s0 + qb[3] * s1
    ]);
};

export const quaternionAngleDeg = (a: number[], b: number[]): number => {
    const qa = normalizeQuaternion(a);
    const qb = normalizeQuaternion(b);
    const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
    const safeDot = clamp(dot, -1, 1);
    return (2 * Math.acos(safeDot) * 180) / Math.PI;
};

export const quaternionConjugate = (q: number[]): number[] => {
    const nq = normalizeQuaternion(q);
    return [-nq[0], -nq[1], -nq[2], nq[3]];
};

export const quaternionMultiply = (a: number[], b: number[]): number[] => {
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    const az = a[2] ?? 0;
    const aw = a[3] ?? 1;
    const bx = b[0] ?? 0;
    const by = b[1] ?? 0;
    const bz = b[2] ?? 0;
    const bw = b[3] ?? 1;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz
    ];
};

export const quaternionVelocityVector = (a: number[], b: number[], dt: number): number[] => {
    const safeDt = Math.max(dt, 1);
    const qa = normalizeQuaternion(a);
    let qb = normalizeQuaternion(b);
    const dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
    if (dot < 0) qb = [-qb[0], -qb[1], -qb[2], -qb[3]];

    const dq = normalizeQuaternion(quaternionMultiply(qb, quaternionConjugate(qa)));
    const w = clamp(dq[3], -1, 1);
    const angle = 2 * Math.acos(w);
    const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    if (sinHalf < 1e-8 || angle < 1e-8) return [0, 0, 0];

    const axis = [dq[0] / sinHalf, dq[1] / sinHalf, dq[2] / sinHalf];
    const angularSpeedDeg = (angle * 180) / (Math.PI * safeDt);
    return [axis[0] * angularSpeedDeg, axis[1] * angularSpeedDeg, axis[2] * angularSpeedDeg];
};

export const makeTypedFaceArray = (values: number[]): Uint16Array | Uint32Array => {
    let maxIndex = 0;
    for (let i = 0; i < values.length; i++) {
        if (values[i] > maxIndex) maxIndex = values[i];
    }
    return maxIndex < 65536 ? new Uint16Array(values) : new Uint32Array(values);
};

