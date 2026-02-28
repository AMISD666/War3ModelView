import { calculateNormals } from './geometryUtils';
import { isAnimVector } from './modelUtils';

export interface PolygonOptimizationOptions {
    removeRedundantVertices?: boolean;
    decimateModel?: boolean;
    decimateRatio?: number; // keep ratio in percentage, 0-100
    positionTolerance?: number;
    uvTolerance?: number;
    normalDotThreshold?: number;
    boundaryLock?: boolean;
    qemLambdaUv?: number;
    qemLambdaSkin?: number;
    qemFeaturePenalty?: number;
    qemBoundaryPenalty?: number;
    qemFlipDotThreshold?: number;
}

export interface PolygonOptimizationStats {
    geosetsProcessed: number;
    verticesBefore: number;
    verticesAfter: number;
    facesBefore: number;
    facesAfter: number;
    degenerateFacesRemoved: number;
    collapsedEdges: number;
}

export interface KeyframeOptimizationOptions {
    removeRedundantFrames?: boolean;
    optimizeKeyframes?: boolean;
    scalarTolerance?: number;
    vectorTolerance?: number;
    rotationToleranceDeg?: number;
}

export interface KeyframeOptimizationStats {
    tracksProcessed: number;
    keysBefore: number;
    keysAfter: number;
    keysRemoved: number;
}

const GEOMETRY_SKIP_KEYS = new Set([
    'Vertices',
    'Faces',
    'Normals',
    'TVertices',
    'Tangents',
    'VertexGroup',
    'Groups',
    'PivotPoints'
]);

const DISCRETE_TRACK_TOKENS = [
    'visibility',
    'textureid',
    'replaceableid',
    'geosetid',
    'eventtrack'
];

const DEFAULT_POLYGON_OPTIONS: Required<PolygonOptimizationOptions> = {
    removeRedundantVertices: true,
    decimateModel: true,
    decimateRatio: 75,
    positionTolerance: 1e-4,
    uvTolerance: 1e-4,
    normalDotThreshold: 0.97,
    boundaryLock: false,
    qemLambdaUv: 2.4,
    qemLambdaSkin: 4.5,
    qemFeaturePenalty: 2.2,
    qemBoundaryPenalty: 6.0,
    qemFlipDotThreshold: 0.1
};

const DEFAULT_KEYFRAME_OPTIONS: Required<KeyframeOptimizationOptions> = {
    removeRedundantFrames: true,
    optimizeKeyframes: true,
    scalarTolerance: 3e-4,
    vectorTolerance: 1.2e-3,
    rotationToleranceDeg: 0.22
};

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const toFloatArray = (value: any): Float32Array => {
    if (value instanceof Float32Array) return value;
    if (ArrayBuffer.isView(value)) return new Float32Array(Array.from(value as ArrayLike<number>));
    if (Array.isArray(value)) return new Float32Array(value.map((n) => Number(n) || 0));
    if (value && typeof value === 'object') return new Float32Array(Object.values(value).map((n) => Number(n) || 0));
    return new Float32Array(0);
};

const toUint32FaceArray = (faces: any): Uint32Array => {
    if (faces instanceof Uint32Array) return faces;
    if (faces instanceof Uint16Array) return new Uint32Array(faces);
    if (ArrayBuffer.isView(faces)) return new Uint32Array(Array.from(faces as ArrayLike<number>));
    if (Array.isArray(faces)) return new Uint32Array(faces.map((n) => Number(n) || 0));
    if (faces && typeof faces === 'object') return new Uint32Array(Object.values(faces).map((n) => Number(n) || 0));
    return new Uint32Array(0);
};

const toGroupsMatrix = (groups: any): number[][] => {
    if (!Array.isArray(groups)) return [];
    return groups.map((g: any) => {
        if (Array.isArray(g)) return g.map((n) => Number(n) || 0);
        if (g && Array.isArray(g.matrices)) return g.matrices.map((n: any) => Number(n) || 0);
        return [];
    });
};

const quantize = (v: number, step: number) => Math.round(v / Math.max(step, 1e-8));

const vertexDistanceSq = (arr: Float32Array, ia: number, ib: number): number => {
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

const uvDistanceSq = (uv: Float32Array | null, ia: number, ib: number): number => {
    if (!uv) return 0;
    const au = uv[ia * 2];
    const av = uv[ia * 2 + 1];
    const bu = uv[ib * 2];
    const bv = uv[ib * 2 + 1];
    const du = au - bu;
    const dv = av - bv;
    return du * du + dv * dv;
};

const normalDot = (normals: Float32Array | null, ia: number, ib: number): number => {
    if (!normals) return 1;
    const ax = normals[ia * 3];
    const ay = normals[ia * 3 + 1];
    const az = normals[ia * 3 + 2];
    const bx = normals[ib * 3];
    const by = normals[ib * 3 + 1];
    const bz = normals[ib * 3 + 2];
    return ax * bx + ay * by + az * bz;
};

const toVector = (value: any): number[] => {
    if (typeof value === 'number') return [Number.isFinite(value) ? value : 0];
    if (ArrayBuffer.isView(value)) return Array.from(value as ArrayLike<number>).map((n) => Number(n) || 0);
    if (Array.isArray(value)) return value.map((n) => Number(n) || 0);
    if (value && typeof value === 'object') return Object.values(value).map((n) => Number(n) || 0);
    return [0];
};

const fromVector = (template: any, vec: number[]): any => {
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

const vectorMaxAbsDiff = (a: number[], b: number[]) => {
    const len = Math.max(a.length, b.length);
    let m = 0;
    for (let i = 0; i < len; i++) {
        const diff = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
        if (diff > m) m = diff;
    }
    return m;
};

const lerpVector = (a: number[], b: number[], t: number): number[] => {
    const len = Math.max(a.length, b.length);
    const out = new Array<number>(len);
    for (let i = 0; i < len; i++) {
        out[i] = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
    }
    return out;
};

const normalizeQuaternion = (q: number[]): number[] => {
    const x = q[0] ?? 0;
    const y = q[1] ?? 0;
    const z = q[2] ?? 0;
    const w = q[3] ?? 1;
    const len = Math.sqrt(x * x + y * y + z * z + w * w);
    if (!Number.isFinite(len) || len < 1e-8) return [0, 0, 0, 1];
    return [x / len, y / len, z / len, w / len];
};

const nlerpQuaternion = (a: number[], b: number[], t: number): number[] => {
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

const slerpQuaternion = (a: number[], b: number[], t: number): number[] => {
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

const quaternionAngleDeg = (a: number[], b: number[]): number => {
    const qa = normalizeQuaternion(a);
    const qb = normalizeQuaternion(b);
    const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
    const safeDot = clamp(dot, -1, 1);
    return (2 * Math.acos(safeDot) * 180) / Math.PI;
};

const quaternionConjugate = (q: number[]): number[] => {
    const nq = normalizeQuaternion(q);
    return [-nq[0], -nq[1], -nq[2], nq[3]];
};

const quaternionMultiply = (a: number[], b: number[]): number[] => {
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

const quaternionVelocityVector = (a: number[], b: number[], dt: number): number[] => {
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

const makeTypedFaceArray = (values: number[]): Uint16Array | Uint32Array => {
    let maxIndex = 0;
    for (let i = 0; i < values.length; i++) {
        if (values[i] > maxIndex) maxIndex = values[i];
    }
    return maxIndex < 65536 ? new Uint16Array(values) : new Uint32Array(values);
};

type PackedGeoset = {
    vertices: Float32Array;
    normals: Float32Array | null;
    faces: Uint32Array;
    tVertices: Float32Array[];
    vertexGroup: Uint16Array;
    groups: number[][];
};

type SkinConstraint = {
    mode: 'strict' | 'overlap' | 'off';
    minOverlap: number;
};

type CollapseConstraint = {
    checkUv: boolean;
    checkNormal: boolean;
};

const packGeoset = (geoset: any): PackedGeoset => {
    const vertices = toFloatArray(geoset?.Vertices);
    const vertexCount = Math.floor(vertices.length / 3);
    const normalsRaw = toFloatArray(geoset?.Normals);
    const normals = normalsRaw.length >= vertexCount * 3 ? normalsRaw.subarray(0, vertexCount * 3) : null;
    const faces = toUint32FaceArray(geoset?.Faces);
    const groups = toGroupsMatrix(geoset?.Groups);

    const rawVertexGroup = geoset?.VertexGroup;
    const vertexGroup = new Uint16Array(vertexCount);
    if (rawVertexGroup && (Array.isArray(rawVertexGroup) || ArrayBuffer.isView(rawVertexGroup))) {
        const src = ArrayBuffer.isView(rawVertexGroup) ? Array.from(rawVertexGroup as ArrayLike<number>) : rawVertexGroup;
        for (let i = 0; i < Math.min(vertexCount, src.length); i++) {
            vertexGroup[i] = Math.max(0, Number(src[i]) || 0);
        }
    }

    const tVertices: Float32Array[] = [];
    if (Array.isArray(geoset?.TVertices)) {
        for (const uv of geoset.TVertices) {
            const channel = toFloatArray(uv);
            if (channel.length >= vertexCount * 2) {
                tVertices.push(channel.subarray(0, vertexCount * 2));
            } else {
                const fixed = new Float32Array(vertexCount * 2);
                fixed.set(channel.subarray(0, Math.min(channel.length, fixed.length)));
                tVertices.push(fixed);
            }
        }
    } else if (geoset?.TVertices) {
        const flat = toFloatArray(geoset.TVertices);
        const fixed = new Float32Array(vertexCount * 2);
        fixed.set(flat.subarray(0, Math.min(flat.length, fixed.length)));
        tVertices.push(fixed);
    }

    return { vertices, normals, faces, tVertices, vertexGroup, groups };
};

const buildBoundaryVertexSet = (faces: Uint32Array): Set<number> => {
    const edgeCount = new Map<string, number>();
    for (let i = 0; i + 2 < faces.length; i += 3) {
        const tri = [faces[i], faces[i + 1], faces[i + 2]];
        for (let e = 0; e < 3; e++) {
            const a = tri[e];
            const b = tri[(e + 1) % 3];
            const min = Math.min(a, b);
            const max = Math.max(a, b);
            const key = `${min}_${max}`;
            edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        }
    }
    const out = new Set<number>();
    edgeCount.forEach((count, key) => {
        if (count !== 1) return;
        const [a, b] = key.split('_').map((n) => Number(n));
        out.add(a);
        out.add(b);
    });
    return out;
};

const buildSkinSignatures = (vertexGroup: Uint16Array, groups: number[][]): string[] => {
    const groupSignature = groups.map((g) => {
        if (!Array.isArray(g) || g.length === 0) return '';
        // Normalize matrices so identical bone sets with different group index can still collapse.
        const normalized = [...g].map((n) => Number(n) || 0).sort((a, b) => a - b);
        return normalized.join(',');
    });
    const signatures = new Array<string>(vertexGroup.length);
    for (let i = 0; i < vertexGroup.length; i++) {
        const g = vertexGroup[i];
        signatures[i] = groupSignature[g] ?? `gid:${g}`;
    }
    return signatures;
};

const getBonesForVertex = (
    vertexIndex: number,
    vertexGroup: Uint16Array,
    groups: number[][]
): number[] => {
    const gid = vertexGroup[vertexIndex];
    const src = groups[gid];
    if (!Array.isArray(src) || src.length === 0) return [];
    const unique = Array.from(new Set(src.map((n) => Number(n) || 0)));
    unique.sort((a, b) => a - b);
    return unique;
};

const skinOverlapRatio = (a: number[], b: number[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let inter = 0;
    setA.forEach((v) => {
        if (setB.has(v)) inter++;
    });
    return inter / Math.max(setA.size, setB.size);
};

const canCollapseSkinPair = (
    a: number,
    b: number,
    skinSignature: string[],
    vertexGroup: Uint16Array,
    groups: number[][],
    constraint: SkinConstraint
): boolean => {
    if (constraint.mode === 'off') return true;
    if (skinSignature[a] === skinSignature[b]) return true;
    if (constraint.mode === 'strict') return false;

    const bonesA = getBonesForVertex(a, vertexGroup, groups);
    const bonesB = getBonesForVertex(b, vertexGroup, groups);
    const overlap = skinOverlapRatio(bonesA, bonesB);
    if (overlap < constraint.minOverlap) return false;

    // Keep one anchor bone consistent in overlap mode to avoid severe rig jumps.
    if (bonesA.length > 0 && bonesB.length > 0 && bonesA[0] !== bonesB[0]) {
        return overlap >= Math.min(1, constraint.minOverlap + 0.25);
    }
    return true;
};

const buildProtectedVertices = (
    vertices: Float32Array,
    uv0: Float32Array | null,
    skinSignature: string[],
    boundary: Set<number>,
    positionTolerance: number,
    uvQuantTolerance: number = 1e-5
) => {
    const protectedSet = new Set<number>(boundary);
    const buckets = new Map<string, number[]>();
    const posStep = Math.max(positionTolerance * 2, 1e-6);
    for (let i = 0; i < vertices.length / 3; i++) {
        const key = `${quantize(vertices[i * 3], posStep)}_${quantize(vertices[i * 3 + 1], posStep)}_${quantize(vertices[i * 3 + 2], posStep)}`;
        const list = buckets.get(key);
        if (list) list.push(i);
        else buckets.set(key, [i]);
    }

    buckets.forEach((indices) => {
        if (indices.length <= 1) return;
        const uvSet = new Set<string>();
        const skinSet = new Set<string>();
        for (const idx of indices) {
            skinSet.add(skinSignature[idx]);
            if (uv0) {
                uvSet.add(
                    `${quantize(uv0[idx * 2], Math.max(uvQuantTolerance, 1e-6))}_${quantize(uv0[idx * 2 + 1], Math.max(uvQuantTolerance, 1e-6))}`
                );
            }
        }
        if (uvSet.size > 1 || skinSet.size > 1) {
            for (const idx of indices) protectedSet.add(idx);
        }
    });

    return protectedSet;
};

const compactGroups = (vertexGroup: Uint16Array, groups: number[][]) => {
    const used = new Set<number>();
    for (let i = 0; i < vertexGroup.length; i++) used.add(vertexGroup[i]);
    const sorted = Array.from(used.values()).sort((a, b) => a - b);
    const remap = new Map<number, number>();
    sorted.forEach((oldId, newId) => remap.set(oldId, newId));

    const nextVertexGroup = new Uint16Array(vertexGroup.length);
    for (let i = 0; i < vertexGroup.length; i++) {
        nextVertexGroup[i] = remap.get(vertexGroup[i]) || 0;
    }

    const nextGroups = sorted.map((oldId) => {
        const source = groups[oldId];
        return Array.isArray(source) ? [...source] : [];
    });

    return { vertexGroup: nextVertexGroup, groups: nextGroups };
};

const buildKeyHash = (
    i: number,
    vertices: Float32Array,
    normals: Float32Array | null,
    uv0: Float32Array | null,
    skinSignature: string[],
    protectedSet: Set<number>,
    options: Required<PolygonOptimizationOptions>
) => {
    if (protectedSet.has(i)) return `LOCK_${i}`;
    const x = quantize(vertices[i * 3], options.positionTolerance);
    const y = quantize(vertices[i * 3 + 1], options.positionTolerance);
    const z = quantize(vertices[i * 3 + 2], options.positionTolerance);
    const nx = normals ? quantize(normals[i * 3], 1e-4) : 0;
    const ny = normals ? quantize(normals[i * 3 + 1], 1e-4) : 0;
    const nz = normals ? quantize(normals[i * 3 + 2], 1e-4) : 0;
    const u = uv0 ? quantize(uv0[i * 2], options.uvTolerance) : 0;
    const v = uv0 ? quantize(uv0[i * 2 + 1], options.uvTolerance) : 0;
    return `${x}_${y}_${z}|${nx}_${ny}_${nz}|${u}_${v}|${skinSignature[i]}`;
};

const rebuildMesh = (
    vertices: Float32Array,
    normals: Float32Array | null,
    uvs: Float32Array[],
    vertexGroup: Uint16Array,
    faces: Uint32Array,
    remapSource: Uint32Array
) => {
    const indexMap = new Map<number, number>();
    const nextVertices: number[] = [];
    const nextNormals: number[] = [];
    const nextUVs: number[][] = uvs.map(() => []);
    const nextVertexGroup: number[] = [];

    const getNextIndex = (oldIndex: number) => {
        const root = remapSource[oldIndex];
        const cached = indexMap.get(root);
        if (cached !== undefined) return cached;
        const newIndex = indexMap.size;
        indexMap.set(root, newIndex);

        nextVertices.push(vertices[root * 3], vertices[root * 3 + 1], vertices[root * 3 + 2]);
        if (normals) nextNormals.push(normals[root * 3], normals[root * 3 + 1], normals[root * 3 + 2]);
        for (let c = 0; c < uvs.length; c++) {
            const channel = uvs[c];
            nextUVs[c].push(channel[root * 2], channel[root * 2 + 1]);
        }
        nextVertexGroup.push(vertexGroup[root] || 0);
        return newIndex;
    };

    const nextFaces: number[] = [];
    let degenerateFaces = 0;
    for (let i = 0; i + 2 < faces.length; i += 3) {
        const a = getNextIndex(faces[i]);
        const b = getNextIndex(faces[i + 1]);
        const c = getNextIndex(faces[i + 2]);
        if (a === b || b === c || a === c) {
            degenerateFaces++;
            continue;
        }
        nextFaces.push(a, b, c);
    }

    return {
        vertices: new Float32Array(nextVertices),
        normals: normals ? new Float32Array(nextNormals) : null,
        uvs: nextUVs.map((channel) => new Float32Array(channel)),
        vertexGroup: new Uint16Array(nextVertexGroup),
        faces: new Uint32Array(nextFaces),
        degenerateFaces
    };
};

const weldRedundantVertices = (
    packed: PackedGeoset,
    options: Required<PolygonOptimizationOptions>
) => {
    const vertexCount = packed.vertices.length / 3;
    if (vertexCount === 0) {
        return {
            ...packed,
            degenerateFacesRemoved: 0,
            changed: false,
            collapsedEdges: 0,
            protectedSet: new Set<number>()
        };
    }

    const boundary = buildBoundaryVertexSet(packed.faces);
    const skinSignature = buildSkinSignatures(packed.vertexGroup, packed.groups);
    const uv0 = packed.tVertices.length > 0 ? packed.tVertices[0] : null;
    const protectedSet = buildProtectedVertices(
        packed.vertices,
        uv0,
        skinSignature,
        boundary,
        options.positionTolerance,
        options.uvTolerance
    );

    const remap = new Uint32Array(vertexCount);
    const keyToRoot = new Map<string, number>();
    const accumCount: number[] = [];

    const vertices = new Float32Array(packed.vertices);
    const normals = packed.normals ? new Float32Array(packed.normals) : null;
    const uvs = packed.tVertices.map((uv) => new Float32Array(uv));
    const vertexGroup = new Uint16Array(packed.vertexGroup);

    for (let i = 0; i < vertexCount; i++) {
        const key = buildKeyHash(i, vertices, normals, uv0, skinSignature, protectedSet, options);
        const existing = keyToRoot.get(key);
        if (existing === undefined) {
            keyToRoot.set(key, i);
            remap[i] = i;
            accumCount[i] = 1;
            continue;
        }

        remap[i] = existing;
        const prevCount = accumCount[existing] || 1;
        const nextCount = prevCount + 1;
        accumCount[existing] = nextCount;

        vertices[existing * 3] = (vertices[existing * 3] * prevCount + vertices[i * 3]) / nextCount;
        vertices[existing * 3 + 1] = (vertices[existing * 3 + 1] * prevCount + vertices[i * 3 + 1]) / nextCount;
        vertices[existing * 3 + 2] = (vertices[existing * 3 + 2] * prevCount + vertices[i * 3 + 2]) / nextCount;

        if (normals) {
            normals[existing * 3] = (normals[existing * 3] * prevCount + normals[i * 3]) / nextCount;
            normals[existing * 3 + 1] = (normals[existing * 3 + 1] * prevCount + normals[i * 3 + 1]) / nextCount;
            normals[existing * 3 + 2] = (normals[existing * 3 + 2] * prevCount + normals[i * 3 + 2]) / nextCount;
        }

        for (let c = 0; c < uvs.length; c++) {
            const uv = uvs[c];
            uv[existing * 2] = (uv[existing * 2] * prevCount + uv[i * 2]) / nextCount;
            uv[existing * 2 + 1] = (uv[existing * 2 + 1] * prevCount + uv[i * 2 + 1]) / nextCount;
        }
    }

    const rebuilt = rebuildMesh(vertices, normals, uvs, vertexGroup, packed.faces, remap);
    const rebuiltSkinSignature = buildSkinSignatures(rebuilt.vertexGroup, packed.groups);
    const rebuiltUv0 = rebuilt.uvs.length > 0 ? rebuilt.uvs[0] : null;
    const rebuiltBoundary = buildBoundaryVertexSet(rebuilt.faces);
    const rebuiltProtected = buildProtectedVertices(
        rebuilt.vertices,
        rebuiltUv0,
        rebuiltSkinSignature,
        rebuiltBoundary,
        options.positionTolerance,
        options.uvTolerance
    );
    return {
        vertices: rebuilt.vertices,
        normals: rebuilt.normals,
        faces: rebuilt.faces,
        tVertices: rebuilt.uvs,
        vertexGroup: rebuilt.vertexGroup,
        groups: packed.groups,
        degenerateFacesRemoved: rebuilt.degenerateFaces,
        changed: rebuilt.vertices.length !== packed.vertices.length || rebuilt.faces.length !== packed.faces.length,
        collapsedEdges: Math.max(0, vertexCount - rebuilt.vertices.length / 3),
        protectedSet: rebuiltProtected
    };
};

const decimateByEdgeCollapse = (
    packed: PackedGeoset,
    protectedVertices: Set<number>,
    options: Required<PolygonOptimizationOptions>,
    absoluteTargetFaceCount?: number,
    skinConstraint: SkinConstraint = { mode: 'strict', minOverlap: 1 },
    collapseConstraint: CollapseConstraint = { checkUv: true, checkNormal: true }
) => {
    const vertexCount = packed.vertices.length / 3;
    const faceCount = Math.floor(packed.faces.length / 3);
    const ratioTargetFaceCount = Math.floor(faceCount * clamp(options.decimateRatio, 0, 100) / 100);
    const targetFaceCount = absoluteTargetFaceCount === undefined
        ? ratioTargetFaceCount
        : Math.max(0, Math.min(faceCount, Math.floor(absoluteTargetFaceCount)));

    if (faceCount <= targetFaceCount || vertexCount < 3) {
        return { ...packed, changed: false, collapsedEdges: 0, degenerateFacesRemoved: 0 };
    }

    type EdgeCandidate = {
        a: number;
        b: number;
        cost: number;
        va: number;
        vb: number;
        nx: number;
        ny: number;
        nz: number;
    };

    const skinSignature = buildSkinSignatures(packed.vertexGroup, packed.groups);
    const uv0 = packed.tVertices.length > 0 ? packed.tVertices[0] : null;
    const boundaryVertices = buildBoundaryVertexSet(packed.faces);
    const uvTolSq = options.uvTolerance * options.uvTolerance * 4;

    const parent = new Uint32Array(vertexCount);
    const weight = new Float64Array(vertexCount);
    const version = new Uint32Array(vertexCount);
    const alive = new Uint8Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        parent[i] = i;
        weight[i] = 1;
        alive[i] = 1;
    }

    const find = (x: number): number => {
        let r = x;
        while (parent[r] !== r) r = parent[r];
        while (parent[x] !== x) {
            const p = parent[x];
            parent[x] = r;
            x = p;
        }
        return r;
    };

    const neighbors: Array<Set<number>> = Array.from({ length: vertexCount }, () => new Set<number>());
    const rootFaces: Array<Set<number>> = Array.from({ length: vertexCount }, () => new Set<number>());

    const addNeighbor = (a: number, b: number) => {
        if (a === b) return;
        neighbors[a].add(b);
        neighbors[b].add(a);
    };

    const position = new Float32Array(packed.vertices);
    const normals = packed.normals ? new Float32Array(packed.normals) : null;
    const uvs = packed.tVertices.map((uv) => new Float32Array(uv));

    const quadrics: Float64Array[] = Array.from({ length: vertexCount }, () => new Float64Array(16));
    const planeOuterAccumulate = (q: Float64Array, a: number, b: number, c: number, d: number) => {
        const p = [a, b, c, d];
        let idx = 0;
        for (let r = 0; r < 4; r++) {
            for (let col = 0; col < 4; col++) {
                q[idx++] += p[r] * p[col];
            }
        }
    };

    const evalQuadric = (q: Float64Array, x: number, y: number, z: number) => {
        const v = [x, y, z, 1];
        let sum = 0;
        for (let r = 0; r < 4; r++) {
            let row = 0;
            for (let c = 0; c < 4; c++) {
                row += q[r * 4 + c] * v[c];
            }
            sum += v[r] * row;
        }
        return sum;
    };

    const solveOptimalPosition = (q: Float64Array, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        const a00 = q[0], a01 = q[1], a02 = q[2];
        const a10 = q[4], a11 = q[5], a12 = q[6];
        const a20 = q[8], a21 = q[9], a22 = q[10];
        const b0 = -q[3], b1 = -q[7], b2 = -q[11];

        const det =
            a00 * (a11 * a22 - a12 * a21) -
            a01 * (a10 * a22 - a12 * a20) +
            a02 * (a10 * a21 - a11 * a20);

        if (Math.abs(det) < 1e-12 || !Number.isFinite(det)) {
            return { x: (ax + bx) * 0.5, y: (ay + by) * 0.5, z: (az + bz) * 0.5 };
        }

        const inv00 = (a11 * a22 - a12 * a21) / det;
        const inv01 = (a02 * a21 - a01 * a22) / det;
        const inv02 = (a01 * a12 - a02 * a11) / det;
        const inv10 = (a12 * a20 - a10 * a22) / det;
        const inv11 = (a00 * a22 - a02 * a20) / det;
        const inv12 = (a02 * a10 - a00 * a12) / det;
        const inv20 = (a10 * a21 - a11 * a20) / det;
        const inv21 = (a01 * a20 - a00 * a21) / det;
        const inv22 = (a00 * a11 - a01 * a10) / det;

        const x = inv00 * b0 + inv01 * b1 + inv02 * b2;
        const y = inv10 * b0 + inv11 * b1 + inv12 * b2;
        const z = inv20 * b0 + inv21 * b1 + inv22 * b2;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            return { x: (ax + bx) * 0.5, y: (ay + by) * 0.5, z: (az + bz) * 0.5 };
        }
        return { x, y, z };
    };

    const triangleNormal = (
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number
    ) => {
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        return {
            x: aby * acz - abz * acy,
            y: abz * acx - abx * acz,
            z: abx * acy - aby * acx
        };
    };

    const faceCountByRoots = () => {
        let count = 0;
        for (let i = 0; i + 2 < packed.faces.length; i += 3) {
            const a = find(packed.faces[i]);
            const b = find(packed.faces[i + 1]);
            const c = find(packed.faces[i + 2]);
            if (a !== b && b !== c && a !== c) count++;
        }
        return count;
    };

    const wouldFlipLocally = (ra: number, rb: number, nx: number, ny: number, nz: number) => {
        const affected = new Set<number>();
        rootFaces[ra].forEach((fi) => affected.add(fi));
        rootFaces[rb].forEach((fi) => affected.add(fi));
        const dotThreshold = options.qemFlipDotThreshold;

        for (const fi of affected) {
            const i0 = packed.faces[fi * 3];
            const i1 = packed.faces[fi * 3 + 1];
            const i2 = packed.faces[fi * 3 + 2];
            const r0 = find(i0);
            const r1 = find(i1);
            const r2 = find(i2);
            if (r0 === r1 || r1 === r2 || r0 === r2) continue;
            if (r0 !== ra && r0 !== rb && r1 !== ra && r1 !== rb && r2 !== ra && r2 !== rb) continue;

            const p0x = position[r0 * 3], p0y = position[r0 * 3 + 1], p0z = position[r0 * 3 + 2];
            const p1x = position[r1 * 3], p1y = position[r1 * 3 + 1], p1z = position[r1 * 3 + 2];
            const p2x = position[r2 * 3], p2y = position[r2 * 3 + 1], p2z = position[r2 * 3 + 2];
            const before = triangleNormal(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z);
            const beforeLen = Math.sqrt(before.x * before.x + before.y * before.y + before.z * before.z);
            if (beforeLen < 1e-10) continue;

            const q0 = r0 === rb ? ra : r0;
            const q1 = r1 === rb ? ra : r1;
            const q2 = r2 === rb ? ra : r2;
            if (q0 === q1 || q1 === q2 || q0 === q2) continue;

            const n0x = q0 === ra ? nx : position[q0 * 3];
            const n0y = q0 === ra ? ny : position[q0 * 3 + 1];
            const n0z = q0 === ra ? nz : position[q0 * 3 + 2];
            const n1x = q1 === ra ? nx : position[q1 * 3];
            const n1y = q1 === ra ? ny : position[q1 * 3 + 1];
            const n1z = q1 === ra ? nz : position[q1 * 3 + 2];
            const n2x = q2 === ra ? nx : position[q2 * 3];
            const n2y = q2 === ra ? ny : position[q2 * 3 + 1];
            const n2z = q2 === ra ? nz : position[q2 * 3 + 2];
            const after = triangleNormal(n0x, n0y, n0z, n1x, n1y, n1z, n2x, n2y, n2z);
            const afterLen = Math.sqrt(after.x * after.x + after.y * after.y + after.z * after.z);
            if (afterLen < beforeLen * 0.02) return true;
            const cos = (before.x * after.x + before.y * after.y + before.z * after.z) / (beforeLen * afterLen);
            if (!Number.isFinite(cos) || cos < dotThreshold) return true;
        }
        return false;
    };

    const edgeHeap: EdgeCandidate[] = [];
    const heapSwap = (i: number, j: number) => {
        const t = edgeHeap[i];
        edgeHeap[i] = edgeHeap[j];
        edgeHeap[j] = t;
    };
    const heapPush = (entry: EdgeCandidate) => {
        edgeHeap.push(entry);
        let i = edgeHeap.length - 1;
        while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (edgeHeap[p].cost <= edgeHeap[i].cost) break;
            heapSwap(i, p);
            i = p;
        }
    };
    const heapPop = (): EdgeCandidate | undefined => {
        if (edgeHeap.length === 0) return undefined;
        const top = edgeHeap[0];
        const tail = edgeHeap.pop()!;
        if (edgeHeap.length > 0) {
            edgeHeap[0] = tail;
            let i = 0;
            while (true) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < edgeHeap.length && edgeHeap[l].cost < edgeHeap[m].cost) m = l;
                if (r < edgeHeap.length && edgeHeap[r].cost < edgeHeap[m].cost) m = r;
                if (m === i) break;
                heapSwap(i, m);
                i = m;
            }
        }
        return top;
    };

    for (let i = 0; i + 2 < packed.faces.length; i += 3) {
        const a = packed.faces[i];
        const b = packed.faces[i + 1];
        const c = packed.faces[i + 2];
        const fi = i / 3;
        rootFaces[a].add(fi);
        rootFaces[b].add(fi);
        rootFaces[c].add(fi);
        addNeighbor(a, b);
        addNeighbor(b, c);
        addNeighbor(c, a);

        const ax = packed.vertices[a * 3], ay = packed.vertices[a * 3 + 1], az = packed.vertices[a * 3 + 2];
        const bx = packed.vertices[b * 3], by = packed.vertices[b * 3 + 1], bz = packed.vertices[b * 3 + 2];
        const cx = packed.vertices[c * 3], cy = packed.vertices[c * 3 + 1], cz = packed.vertices[c * 3 + 2];
        const n = triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
        const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (len < 1e-12) continue;
        const nx = n.x / len;
        const ny = n.y / len;
        const nz = n.z / len;
        const d = -(nx * ax + ny * ay + nz * az);
        planeOuterAccumulate(quadrics[a], nx, ny, nz, d);
        planeOuterAccumulate(quadrics[b], nx, ny, nz, d);
        planeOuterAccumulate(quadrics[c], nx, ny, nz, d);
    }

    const computeCandidate = (aRaw: number, bRaw: number): EdgeCandidate | null => {
        let ra = find(aRaw);
        let rb = find(bRaw);
        if (ra === rb) return null;
        if (ra > rb) {
            const t = ra;
            ra = rb;
            rb = t;
        }
        if (!alive[ra] || !alive[rb]) return null;
        if (options.boundaryLock && (boundaryVertices.has(ra) || boundaryVertices.has(rb))) return null;
        if (!canCollapseSkinPair(ra, rb, skinSignature, packed.vertexGroup, packed.groups, skinConstraint)) return null;

        const uvDist = uvDistanceSq(uv0, ra, rb);
        const uvGate = Math.max(uvTolSq * 12000, 0.0025);
        if (collapseConstraint.checkUv && uvDist > uvGate) return null;
        const nDot = normalDot(normals, ra, rb);
        const normalGate = Math.max(-0.2, Math.min(0.45, options.normalDotThreshold - 0.75));
        if (collapseConstraint.checkNormal && nDot < normalGate) return null;

        const q = new Float64Array(16);
        for (let i = 0; i < 16; i++) q[i] = quadrics[ra][i] + quadrics[rb][i];
        const ax = position[ra * 3], ay = position[ra * 3 + 1], az = position[ra * 3 + 2];
        const bx = position[rb * 3], by = position[rb * 3 + 1], bz = position[rb * 3 + 2];
        const opt = solveOptimalPosition(q, ax, ay, az, bx, by, bz);
        const qemCost = Math.max(0, evalQuadric(q, opt.x, opt.y, opt.z));

        const bonesA = getBonesForVertex(ra, packed.vertexGroup, packed.groups);
        const bonesB = getBonesForVertex(rb, packed.vertexGroup, packed.groups);
        const overlap = skinOverlapRatio(bonesA, bonesB);
        const skinPenalty = options.qemLambdaSkin * Math.pow(Math.max(0, 1 - overlap), 2);

        let featurePenalty = 0;
        if (boundaryVertices.has(ra) || boundaryVertices.has(rb)) featurePenalty += options.qemBoundaryPenalty;
        if (protectedVertices.has(ra) || protectedVertices.has(rb)) featurePenalty += options.qemFeaturePenalty;
        if (collapseConstraint.checkNormal) {
            const curvaturePenalty = Math.max(0, 1 - clamp(nDot, -1, 1)) * 0.5;
            featurePenalty += curvaturePenalty;
        }

        const cost = qemCost + uvDist * options.qemLambdaUv + skinPenalty + featurePenalty;
        if (!Number.isFinite(cost)) return null;
        return {
            a: ra,
            b: rb,
            cost,
            va: version[ra],
            vb: version[rb],
            nx: opt.x,
            ny: opt.y,
            nz: opt.z
        };
    };

    const pushEdge = (a: number, b: number) => {
        const candidate = computeCandidate(a, b);
        if (candidate) heapPush(candidate);
    };

    for (let v = 0; v < vertexCount; v++) {
        neighbors[v].forEach((nb) => {
            if (v < nb) pushEdge(v, nb);
        });
    }

    let collapses = 0;
    let currentFaceCount = faceCount;
    while (edgeHeap.length > 0 && currentFaceCount > targetFaceCount) {
        const edge = heapPop();
        if (!edge) break;
        const ra = find(edge.a);
        const rb = find(edge.b);
        if (ra === rb) continue;
        if (edge.va !== version[ra] || edge.vb !== version[rb]) continue;

        const refresh = computeCandidate(ra, rb);
        if (!refresh) continue;
        if (wouldFlipLocally(refresh.a, refresh.b, refresh.nx, refresh.ny, refresh.nz)) continue;

        let keep = refresh.a;
        let drop = refresh.b;
        if (weight[drop] > weight[keep]) {
            const t = keep;
            keep = drop;
            drop = t;
        }

        parent[drop] = keep;
        alive[drop] = 0;
        const wk = weight[keep];
        const wd = weight[drop];
        const sum = wk + wd;
        weight[keep] = sum;

        position[keep * 3] = refresh.nx;
        position[keep * 3 + 1] = refresh.ny;
        position[keep * 3 + 2] = refresh.nz;

        if (normals) {
            normals[keep * 3] = (normals[keep * 3] * wk + normals[drop * 3] * wd) / sum;
            normals[keep * 3 + 1] = (normals[keep * 3 + 1] * wk + normals[drop * 3 + 1] * wd) / sum;
            normals[keep * 3 + 2] = (normals[keep * 3 + 2] * wk + normals[drop * 3 + 2] * wd) / sum;
        }
        for (let c = 0; c < uvs.length; c++) {
            const uv = uvs[c];
            uv[keep * 2] = (uv[keep * 2] * wk + uv[drop * 2] * wd) / sum;
            uv[keep * 2 + 1] = (uv[keep * 2 + 1] * wk + uv[drop * 2 + 1] * wd) / sum;
        }

        for (let i = 0; i < 16; i++) quadrics[keep][i] += quadrics[drop][i];

        rootFaces[drop].forEach((fi) => rootFaces[keep].add(fi));
        rootFaces[drop].clear();

        const mergedNeighbors = new Set<number>();
        neighbors[keep].forEach((n) => mergedNeighbors.add(find(n)));
        neighbors[drop].forEach((n) => mergedNeighbors.add(find(n)));
        mergedNeighbors.delete(keep);
        mergedNeighbors.delete(drop);

        neighbors[keep].clear();
        mergedNeighbors.forEach((n) => {
            neighbors[keep].add(n);
            neighbors[n].delete(drop);
            neighbors[n].add(keep);
        });
        neighbors[drop].clear();

        version[keep]++;
        version[drop]++;
        collapses++;

        if (collapses < 8 || collapses % 24 === 0) {
            currentFaceCount = faceCountByRoots();
        }

        neighbors[keep].forEach((n) => pushEdge(keep, n));
    }

    if (collapses === 0) {
        return { ...packed, changed: false, collapsedEdges: 0, degenerateFacesRemoved: 0 };
    }

    const remap = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) remap[i] = find(i);
    const rebuilt = rebuildMesh(position, normals, uvs, packed.vertexGroup, packed.faces, remap);
    return {
        vertices: rebuilt.vertices,
        normals: rebuilt.normals,
        faces: rebuilt.faces,
        tVertices: rebuilt.uvs,
        vertexGroup: rebuilt.vertexGroup,
        groups: packed.groups,
        changed: rebuilt.faces.length !== packed.faces.length || rebuilt.vertices.length !== packed.vertices.length,
        collapsedEdges: collapses,
        degenerateFacesRemoved: rebuilt.degenerateFaces
    };
};

type PolygonOptimizeResult = {
    geoset: any;
    stats: {
        verticesBefore: number;
        verticesAfter: number;
        facesBefore: number;
        facesAfter: number;
        degenerateFacesRemoved: number;
        collapsedEdges: number;
    };
};

const optimizeSingleGeoset = (
    geoset: any,
    options: Required<PolygonOptimizationOptions>
): PolygonOptimizeResult => {
    const original = packGeoset(geoset);
    const targetFaceCount = Math.floor((original.faces.length / 3) * clamp(options.decimateRatio, 0, 100) / 100);
    let working = original;
    let degenerateFacesRemoved = 0;
    let collapsedEdges = 0;
    const runVQESDecimation = (source: PackedGeoset) => {
        let current = source;
        let removedFaces = 0;
        let collapsed = 0;
        const overlapFloor = options.decimateRatio <= 50 ? 0.45 : 0.65;
        const strategies: Array<{ skin: SkinConstraint; collapse: CollapseConstraint }> = [
            {
                skin: { mode: options.decimateRatio <= 35 ? 'off' : 'overlap', minOverlap: overlapFloor },
                collapse: { checkUv: true, checkNormal: true }
            },
            {
                skin: { mode: 'overlap', minOverlap: 0.3 },
                collapse: { checkUv: false, checkNormal: true }
            },
            {
                skin: { mode: 'off', minOverlap: 0 },
                collapse: { checkUv: false, checkNormal: false }
            }
        ];

        for (const strategy of strategies) {
            const skinSignature = buildSkinSignatures(current.vertexGroup, current.groups);
            const uv0 = current.tVertices.length > 0 ? current.tVertices[0] : null;
            const boundary = options.boundaryLock ? buildBoundaryVertexSet(current.faces) : new Set<number>();
            const protectedSet = buildProtectedVertices(
                current.vertices,
                uv0,
                skinSignature,
                boundary,
                options.positionTolerance,
                options.uvTolerance
            );

            const decimated = decimateByEdgeCollapse(
                current,
                protectedSet,
                options,
                targetFaceCount,
                strategy.skin,
                strategy.collapse
            );

            if (!decimated.changed) continue;
            current = {
                vertices: decimated.vertices,
                normals: decimated.normals,
                faces: decimated.faces,
                tVertices: decimated.tVertices,
                vertexGroup: decimated.vertexGroup,
                groups: decimated.groups
            };
            removedFaces += decimated.degenerateFacesRemoved;
            collapsed += decimated.collapsedEdges;

            const currentFaceCount = Math.floor(current.faces.length / 3);
            if (currentFaceCount <= targetFaceCount) break;
        }

        return {
            geoset: current,
            degenerateFacesRemoved: removedFaces,
            collapsedEdges: collapsed
        };
    };

    if (options.removeRedundantVertices) {
        const welded = weldRedundantVertices(working, options);
        working = {
            vertices: welded.vertices,
            normals: welded.normals,
            faces: welded.faces,
            tVertices: welded.tVertices,
            vertexGroup: welded.vertexGroup,
            groups: welded.groups
        };
        degenerateFacesRemoved += welded.degenerateFacesRemoved;
        collapsedEdges += welded.collapsedEdges;

        if (options.decimateModel) {
            const decimateResult = runVQESDecimation(working);
            working = decimateResult.geoset;
            degenerateFacesRemoved += decimateResult.degenerateFacesRemoved;
            collapsedEdges += decimateResult.collapsedEdges;
        }
    } else if (options.decimateModel) {
        const decimateResult = runVQESDecimation(working);
        working = decimateResult.geoset;
        degenerateFacesRemoved += decimateResult.degenerateFacesRemoved;
        collapsedEdges += decimateResult.collapsedEdges;
    }

    const compacted = compactGroups(working.vertexGroup, working.groups);
    working.vertexGroup = compacted.vertexGroup;
    working.groups = compacted.groups;

    if (working.vertices.length !== original.vertices.length || working.faces.length !== original.faces.length) {
        working.normals = calculateNormals(working.vertices, working.faces);
    }

    const nextGeoset: any = {
        ...geoset,
        Vertices: working.vertices,
        Faces: makeTypedFaceArray(Array.from(working.faces)),
        VertexGroup: working.vertexGroup,
        Groups: working.groups
    };
    if (working.normals) nextGeoset.Normals = working.normals;
    if (working.tVertices.length > 0) nextGeoset.TVertices = working.tVertices;

    return {
        geoset: nextGeoset,
        stats: {
            verticesBefore: original.vertices.length / 3,
            verticesAfter: working.vertices.length / 3,
            facesBefore: original.faces.length / 3,
            facesAfter: working.faces.length / 3,
            degenerateFacesRemoved,
            collapsedEdges
        }
    };
};

const isDiscreteTrack = (trackPath: string, keys: any[]): boolean => {
    const lower = trackPath.toLowerCase();
    if (DISCRETE_TRACK_TOKENS.some((token) => lower.includes(token))) return true;
    if (keys.length === 0) return false;
    const sample = toVector(keys[0]?.Vector);
    if (sample.length !== 1) return false;
    let intLikeCount = 0;
    for (const key of keys) {
        const v = toVector(key?.Vector)[0] ?? 0;
        if (Math.abs(v - Math.round(v)) < 1e-6) intLikeCount++;
    }
    return intLikeCount === keys.length;
};

const isRotationTrack = (trackPath: string, sampleVec: number[]) => {
    return trackPath.toLowerCase().includes('rotation') && sampleVec.length >= 4;
};

const interpolateVectors = (a: number[], b: number[], t: number, rotationTrack: boolean): number[] => {
    if (rotationTrack && a.length >= 4 && b.length >= 4) {
        return slerpQuaternion(a, b, t);
    }
    return lerpVector(a, b, t);
};

const valueErrorBetween = (a: number[], b: number[], rotationTrack: boolean): number => {
    if (rotationTrack && a.length >= 4 && b.length >= 4) {
        return quaternionAngleDeg(a, b);
    }
    return vectorMaxAbsDiff(a, b);
};

const velocityErrorBetween = (
    a0: number[],
    a1: number[],
    b0: number[],
    b1: number[],
    rotationTrack: boolean,
    dt: number
): number => {
    const safeDt = Math.max(dt, 1);
    if (rotationTrack && a0.length >= 4 && a1.length >= 4 && b0.length >= 4 && b1.length >= 4) {
        const va = quaternionVelocityVector(a0, a1, safeDt);
        const vb = quaternionVelocityVector(b0, b1, safeDt);
        return vectorMaxAbsDiff(va, vb);
    }

    const dims = Math.max(a0.length, a1.length, b0.length, b1.length);
    let maxDiff = 0;
    for (let i = 0; i < dims; i++) {
        const da = ((a1[i] ?? 0) - (a0[i] ?? 0)) / safeDt;
        const db = ((b1[i] ?? 0) - (b0[i] ?? 0)) / safeDt;
        const diff = Math.abs(da - db);
        if (diff > maxDiff) maxDiff = diff;
    }
    return maxDiff;
};

const sampleLinearTrackValueAtFrame = (
    left: any,
    right: any,
    frame: number,
    trackPath: string
): number[] => {
    const f0 = Number(left?.Frame);
    const f1 = Number(right?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) {
        return toVector(left?.Vector);
    }
    const t = clamp((frame - f0) / (f1 - f0), 0, 1);
    const v0 = toVector(left?.Vector);
    const v1 = toVector(right?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v0);
    return interpolateVectors(v0, v1, t, rotationTrack);
};

const sampleCollapsedIntervalErrors = (
    prev: any,
    current: any,
    next: any,
    trackPath: string
): { valueError: number; velocityError: number } => {
    const f0 = Number(prev?.Frame);
    const f1 = Number(current?.Frame);
    const f2 = Number(next?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || f2 <= f0 || f1 <= f0 || f1 >= f2) {
        return { valueError: Number.POSITIVE_INFINITY, velocityError: Number.POSITIVE_INFINITY };
    }

    const v1 = toVector(current?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v1);
    const sampleFractions = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    let maxValueError = 0;
    const totalSpan = f2 - f0;
    for (const frac of sampleFractions) {
        const frame = f0 + totalSpan * frac;
        const original = frame <= f1
            ? sampleLinearTrackValueAtFrame(prev, current, frame, trackPath)
            : sampleLinearTrackValueAtFrame(current, next, frame, trackPath);
        const simplified = sampleLinearTrackValueAtFrame(prev, next, frame, trackPath);
        const err = valueErrorBetween(original, simplified, rotationTrack);
        if (err > maxValueError) maxValueError = err;
    }

    let maxVelocityError = 0;
    const velocityFractions = [0.2, 0.4, 0.6, 0.8];
    const h = Math.max(1, totalSpan / 40);
    for (const frac of velocityFractions) {
        const center = f0 + totalSpan * frac;
        const left = Math.max(f0, center - h);
        const right = Math.min(f2, center + h);
        if (!(right > left)) continue;

        const originalLeft = left <= f1
            ? sampleLinearTrackValueAtFrame(prev, current, left, trackPath)
            : sampleLinearTrackValueAtFrame(current, next, left, trackPath);
        const originalRight = right <= f1
            ? sampleLinearTrackValueAtFrame(prev, current, right, trackPath)
            : sampleLinearTrackValueAtFrame(current, next, right, trackPath);

        const simplifiedLeft = sampleLinearTrackValueAtFrame(prev, next, left, trackPath);
        const simplifiedRight = sampleLinearTrackValueAtFrame(prev, next, right, trackPath);

        const velErr = velocityErrorBetween(
            originalLeft,
            originalRight,
            simplifiedLeft,
            simplifiedRight,
            rotationTrack,
            right - left
        );
        if (velErr > maxVelocityError) maxVelocityError = velErr;
    }

    return { valueError: maxValueError, velocityError: maxVelocityError };
};

const interpolationError = (
    prev: any,
    current: any,
    next: any,
    trackPath: string
) => {
    const f0 = Number(prev?.Frame);
    const f1 = Number(current?.Frame);
    const f2 = Number(next?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || f2 <= f0 || f1 <= f0 || f1 >= f2) {
        return Number.POSITIVE_INFINITY;
    }

    const t = (f1 - f0) / (f2 - f0);
    const v0 = toVector(prev?.Vector);
    const v1 = toVector(current?.Vector);
    const v2 = toVector(next?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v1);
    const interp = interpolateVectors(v0, v2, t, rotationTrack);
    return valueErrorBetween(interp, v1, rotationTrack);
};

const localCollapseVelocityError = (
    prev: any,
    current: any,
    next: any,
    trackPath: string
) => {
    const f0 = Number(prev?.Frame);
    const f1 = Number(current?.Frame);
    const f2 = Number(next?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || f2 <= f0 || f1 <= f0 || f1 >= f2) {
        return Number.POSITIVE_INFINITY;
    }

    const v0 = toVector(prev?.Vector);
    const v1 = toVector(current?.Vector);
    const v2 = toVector(next?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v1);
    const midT = (f1 - f0) / (f2 - f0);
    const simplifiedMid = interpolateVectors(v0, v2, midT, rotationTrack);

    const leftErr = velocityErrorBetween(v0, v1, v0, simplifiedMid, rotationTrack, f1 - f0);
    const rightErr = velocityErrorBetween(v1, v2, simplifiedMid, v2, rotationTrack, f2 - f1);
    return Math.max(leftErr, rightErr);
};

const canRemoveMiddleKey = (
    prev: any,
    current: any,
    next: any,
    trackPath: string,
    valueTolerance: number,
    velocityTolerance: number
): boolean => {
    const valueErr = interpolationError(prev, current, next, trackPath);
    if (!Number.isFinite(valueErr) || valueErr > valueTolerance) return false;
    const velocityErr = localCollapseVelocityError(prev, current, next, trackPath);
    if (!Number.isFinite(velocityErr) || velocityErr > velocityTolerance) return false;

    const sampled = sampleCollapsedIntervalErrors(prev, current, next, trackPath);
    if (!Number.isFinite(sampled.valueError) || !Number.isFinite(sampled.velocityError)) return false;

    const rotationTrack = isRotationTrack(trackPath, toVector(current?.Vector));
    const safeValueTol = rotationTrack ? valueTolerance * 0.82 : valueTolerance;
    const safeVelocityTol = rotationTrack ? velocityTolerance * 0.75 : velocityTolerance;

    return sampled.valueError <= safeValueTol && sampled.velocityError <= safeVelocityTol;
};

const normalizeAndSortKeys = (keys: any[]): any[] => {
    const normalized = keys
        .filter((k) => k && Number.isFinite(Number(k.Frame)))
        .map((k) => ({ ...k, Frame: Number(k.Frame) }))
        .sort((a, b) => a.Frame - b.Frame);

    if (normalized.length <= 1) return normalized;
    const dedup: any[] = [];
    for (let i = 0; i < normalized.length; i++) {
        const key = normalized[i];
        if (dedup.length > 0 && dedup[dedup.length - 1].Frame === key.Frame) {
            dedup[dedup.length - 1] = key;
        } else {
            dedup.push(key);
        }
    }
    return dedup;
};

const normalizeQuaternionFrame = (key: any): any => {
    const vector = toVector(key?.Vector);
    if (vector.length < 4) return key;
    const next: any = {
        ...key,
        Vector: normalizeQuaternion(vector)
    };
    if (key?.InTan !== undefined) {
        const inTan = toVector(key.InTan);
        if (inTan.length >= 4) next.InTan = normalizeQuaternion(inTan);
    }
    if (key?.OutTan !== undefined) {
        const outTan = toVector(key.OutTan);
        if (outTan.length >= 4) next.OutTan = normalizeQuaternion(outTan);
    }
    return next;
};

const enforceQuaternionContinuity = (keys: any[]): any[] => {
    if (keys.length <= 1) return keys;
    const out = keys.map((k) => normalizeQuaternionFrame(k));
    for (let i = 1; i < out.length; i++) {
        const prev = toVector(out[i - 1]?.Vector);
        const curr = toVector(out[i]?.Vector);
        if (prev.length < 4 || curr.length < 4) continue;
        const dot = prev[0] * curr[0] + prev[1] * curr[1] + prev[2] * curr[2] + prev[3] * curr[3];
        if (dot >= 0) continue;
        out[i] = {
            ...out[i],
            Vector: curr.map((n) => -n),
            InTan: out[i]?.InTan !== undefined ? toVector(out[i].InTan).map((n) => -n) : out[i]?.InTan,
            OutTan: out[i]?.OutTan !== undefined ? toVector(out[i].OutTan).map((n) => -n) : out[i]?.OutTan
        };
    }
    return out;
};

const computeAdaptiveTolerance = (
    keys: any[],
    trackPath: string,
    options: Required<KeyframeOptimizationOptions>
) => {
    const lower = trackPath.toLowerCase();
    const sample = keys.length > 0 ? toVector(keys[0]?.Vector) : [0];
    const isRotationTrack = lower.includes('rotation') && sample.length >= 4;
    if (isRotationTrack) return options.rotationToleranceDeg;

    const dims = sample.length || 1;
    const mins = new Array<number>(dims).fill(Number.POSITIVE_INFINITY);
    const maxs = new Array<number>(dims).fill(Number.NEGATIVE_INFINITY);
    for (const key of keys) {
        const v = toVector(key?.Vector);
        for (let i = 0; i < dims; i++) {
            const cur = Number(v[i] ?? 0);
            if (cur < mins[i]) mins[i] = cur;
            if (cur > maxs[i]) maxs[i] = cur;
        }
    }
    let peakRange = 0;
    for (let i = 0; i < dims; i++) {
        const range = Number.isFinite(mins[i]) && Number.isFinite(maxs[i]) ? (maxs[i] - mins[i]) : 0;
        if (range > peakRange) peakRange = range;
    }
    const scale = clamp(Math.sqrt(Math.max(peakRange, 1e-8)), 0.6, 10);
    if (dims <= 1) return options.scalarTolerance * scale;
    return options.vectorTolerance * scale;
};

const computeVelocityTolerance = (
    keys: any[],
    trackPath: string,
    valueTolerance: number,
    options: Required<KeyframeOptimizationOptions>
) => {
    let totalDt = 0;
    let count = 0;
    for (let i = 1; i < keys.length; i++) {
        const dt = Number(keys[i].Frame) - Number(keys[i - 1].Frame);
        if (Number.isFinite(dt) && dt > 0) {
            totalDt += dt;
            count++;
        }
    }
    const avgDt = Math.max(1, count > 0 ? totalDt / count : 33);
    const sample = keys.length > 0 ? toVector(keys[0]?.Vector) : [0];
    const rotationTrack = isRotationTrack(trackPath, sample);
    if (rotationTrack) {
        return Math.max((options.rotationToleranceDeg / avgDt) * 2.5, 0.0015);
    }
    return Math.max((valueTolerance / avgDt) * 2.5, options.scalarTolerance / avgDt);
};

const collectExtremaFrames = (keys: any[], tolerance: number): Set<number> => {
    const protectedFrames = new Set<number>();
    if (keys.length <= 2) return protectedFrames;

    const dims = Math.max(1, toVector(keys[0]?.Vector).length);
    for (let i = 1; i < keys.length - 1; i++) {
        const prev = toVector(keys[i - 1]?.Vector);
        const curr = toVector(keys[i]?.Vector);
        const next = toVector(keys[i + 1]?.Vector);
        let isExtrema = false;
        for (let d = 0; d < dims; d++) {
            const a = (curr[d] ?? 0) - (prev[d] ?? 0);
            const b = (next[d] ?? 0) - (curr[d] ?? 0);
            if (Math.abs(a) <= tolerance && Math.abs(b) <= tolerance) continue;
            if (a === 0 || b === 0 || a * b < 0) {
                isExtrema = true;
                break;
            }
        }
        if (isExtrema) protectedFrames.add(Number(keys[i].Frame));
    }
    return protectedFrames;
};

const collectRotationVelocityChangeFrames = (keys: any[], toleranceDeg: number): Set<number> => {
    const protectedFrames = new Set<number>();
    if (keys.length <= 2) return protectedFrames;
    for (let i = 1; i < keys.length - 1; i++) {
        const f0 = Number(keys[i - 1]?.Frame);
        const f1 = Number(keys[i]?.Frame);
        const f2 = Number(keys[i + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2)) continue;
        const dt1 = Math.max(1, f1 - f0);
        const dt2 = Math.max(1, f2 - f1);
        const v0 = toVector(keys[i - 1]?.Vector);
        const v1 = toVector(keys[i]?.Vector);
        const v2 = toVector(keys[i + 1]?.Vector);
        if (v0.length < 4 || v1.length < 4 || v2.length < 4) continue;
        const velL = quaternionVelocityVector(v0, v1, dt1);
        const velR = quaternionVelocityVector(v1, v2, dt2);
        const velJump = vectorMaxAbsDiff(velL, velR);
        if (velJump > Math.max(toleranceDeg * 0.2, 0.0015)) {
            protectedFrames.add(Number(keys[i].Frame));
        }
    }
    return protectedFrames;
};

const computeRotationSafetyFactor = (keys: any[], toleranceDeg: number): number => {
    if (keys.length <= 2) return 1;
    let samples = 0;
    let spikeScore = 0;
    for (let i = 1; i < keys.length - 1; i++) {
        const f0 = Number(keys[i - 1]?.Frame);
        const f1 = Number(keys[i]?.Frame);
        const f2 = Number(keys[i + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || !(f1 > f0) || !(f2 > f1)) continue;
        const dt1 = f1 - f0;
        const dt2 = f2 - f1;
        const v0 = toVector(keys[i - 1]?.Vector);
        const v1 = toVector(keys[i]?.Vector);
        const v2 = toVector(keys[i + 1]?.Vector);
        if (v0.length < 4 || v1.length < 4 || v2.length < 4) continue;
        const velL = quaternionVelocityVector(v0, v1, dt1);
        const velR = quaternionVelocityVector(v1, v2, dt2);
        const jump = vectorMaxAbsDiff(velL, velR);
        const normalized = jump / Math.max(toleranceDeg * 0.22, 0.0012);
        spikeScore += clamp(normalized - 1, 0, 4);
        samples++;
    }
    if (samples === 0) return 1;
    const avgSpike = spikeScore / samples;
    return clamp(1 - avgSpike * 0.12, 0.55, 1);
};

const getAnimLineType = (anim: any): number => {
    const raw = Number(anim?.LineType ?? anim?.InterpolationType ?? 1);
    if (!Number.isFinite(raw)) return 1;
    return clamp(Math.round(raw), 0, 3);
};

const interpolateBezier = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

const interpolateHermite = (p0: number, p1: number, m0: number, m1: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
};

const interpolateKeyPairAtFrame = (
    left: any,
    right: any,
    frame: number,
    trackPath: string,
    lineType: number
): number[] => {
    const f0 = Number(left?.Frame);
    const f1 = Number(right?.Frame);
    const v0 = toVector(left?.Vector);
    const v1 = toVector(right?.Vector);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) return v0;
    if (lineType === 0) return v0;
    const t = clamp((frame - f0) / (f1 - f0), 0, 1);
    const rotationTrack = isRotationTrack(trackPath, v0);
    if (rotationTrack) {
        return slerpQuaternion(v0, v1, t);
    }
    if (lineType === 1) {
        return lerpVector(v0, v1, t);
    }

    const outTan = toVector(left?.OutTan ?? left?.Vector);
    const inTan = toVector(right?.InTan ?? right?.Vector);
    const dims = Math.max(v0.length, v1.length, outTan.length, inTan.length, 1);
    const out = new Array<number>(dims);
    for (let i = 0; i < dims; i++) {
        const p0 = v0[i] ?? 0;
        const p1 = v1[i] ?? 0;
        if (lineType === 3) {
            const c0 = outTan[i] ?? p0;
            const c1 = inTan[i] ?? p1;
            out[i] = interpolateBezier(p0, c0, c1, p1, t);
        } else {
            const m0 = (outTan[i] ?? p0) - p0;
            const m1 = p1 - (inTan[i] ?? p1);
            out[i] = interpolateHermite(p0, p1, m0, m1, t);
        }
    }
    return out;
};

const findSegmentIndexForFrame = (keys: any[], startIdx: number, endIdx: number, frame: number): number => {
    if (endIdx - startIdx <= 1) return startIdx;
    let lo = startIdx;
    let hi = endIdx - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const fMid = Number(keys[mid]?.Frame);
        const fNext = Number(keys[mid + 1]?.Frame);
        if (frame < fMid) {
            hi = mid - 1;
            continue;
        }
        if (frame > fNext) {
            lo = mid + 1;
            continue;
        }
        return mid;
    }
    return clamp(lo, startIdx, endIdx - 1);
};

const sampleTrackValueAtFrame = (
    keys: any[],
    startIdx: number,
    endIdx: number,
    frame: number,
    trackPath: string,
    lineType: number
): number[] => {
    if (startIdx >= endIdx) return toVector(keys[startIdx]?.Vector);
    const startFrame = Number(keys[startIdx]?.Frame);
    const endFrame = Number(keys[endIdx]?.Frame);
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
        return toVector(keys[startIdx]?.Vector);
    }
    if (frame <= startFrame) return toVector(keys[startIdx]?.Vector);
    if (frame >= endFrame) return toVector(keys[endIdx]?.Vector);
    const segIdx = findSegmentIndexForFrame(keys, startIdx, endIdx, frame);
    return interpolateKeyPairAtFrame(keys[segIdx], keys[segIdx + 1], frame, trackPath, lineType);
};

const computeTrackCurvatureScores = (
    keys: any[],
    trackPath: string,
    velocityTolerance: number
): number[] => {
    const n = keys.length;
    const scores = new Array<number>(n).fill(0);
    if (n <= 2) return scores;
    const rotationTrack = isRotationTrack(trackPath, toVector(keys[0]?.Vector));
    const safeVelTol = Math.max(velocityTolerance, 1e-6);
    for (let i = 1; i < n - 1; i++) {
        const f0 = Number(keys[i - 1]?.Frame);
        const f1 = Number(keys[i]?.Frame);
        const f2 = Number(keys[i + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || !(f1 > f0) || !(f2 > f1)) {
            continue;
        }
        const dt1 = f1 - f0;
        const dt2 = f2 - f1;
        const v0 = toVector(keys[i - 1]?.Vector);
        const v1 = toVector(keys[i]?.Vector);
        const v2 = toVector(keys[i + 1]?.Vector);
        let curvature = 0;
        if (rotationTrack && v0.length >= 4 && v1.length >= 4 && v2.length >= 4) {
            const velL = quaternionVelocityVector(v0, v1, dt1);
            const velR = quaternionVelocityVector(v1, v2, dt2);
            curvature = vectorMaxAbsDiff(velL, velR);
        } else {
            const dims = Math.max(v0.length, v1.length, v2.length);
            for (let d = 0; d < dims; d++) {
                const vl = ((v1[d] ?? 0) - (v0[d] ?? 0)) / Math.max(dt1, 1);
                const vr = ((v2[d] ?? 0) - (v1[d] ?? 0)) / Math.max(dt2, 1);
                curvature = Math.max(curvature, Math.abs(vr - vl));
            }
        }
        scores[i] = clamp(curvature / safeVelTol, 0, 8);
    }

    const smoothed = [...scores];
    for (let i = 1; i < n - 1; i++) {
        smoothed[i] = (scores[i - 1] + scores[i] * 2 + scores[i + 1]) * 0.25;
    }
    return smoothed;
};

type SPOSEdgeContext = {
    keys: any[];
    trackPath: string;
    lineType: number;
    valueTolerance: number;
    velocityTolerance: number;
    curvatureScores: number[];
    rotationTrack: boolean;
};

const validateSPOSEdge = (
    i: number,
    j: number,
    ctx: SPOSEdgeContext
): boolean => {
    if (j <= i) return false;
    if (j - i <= 1) return true;

    const { keys, trackPath, lineType, valueTolerance, velocityTolerance, curvatureScores, rotationTrack } = ctx;
    const fStart = Number(keys[i]?.Frame);
    const fEnd = Number(keys[j]?.Frame);
    if (!Number.isFinite(fStart) || !Number.isFinite(fEnd) || fEnd <= fStart) return false;

    const samples: Array<{ frame: number; curvature: number }> = [];
    for (let k = i + 1; k < j; k++) {
        samples.push({ frame: Number(keys[k]?.Frame), curvature: curvatureScores[k] || 0 });
    }
    for (let k = i; k < j; k++) {
        const f0 = Number(keys[k]?.Frame);
        const f1 = Number(keys[k + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) continue;
        samples.push({
            frame: (f0 + f1) * 0.5,
            curvature: ((curvatureScores[k] || 0) + (curvatureScores[k + 1] || 0)) * 0.5
        });
    }

    const maxSamples = 96;
    if (samples.length > maxSamples) {
        const reduced: Array<{ frame: number; curvature: number }> = [];
        for (let s = 0; s < maxSamples; s++) {
            const idx = Math.floor((s * (samples.length - 1)) / (maxSamples - 1));
            reduced.push(samples[idx]);
        }
        samples.splice(0, samples.length, ...reduced);
    }

    const span = fEnd - fStart;
    const derivativeWindowBase = Math.max(1, span / Math.max(20, (j - i) * 3));
    for (const sample of samples) {
        if (!Number.isFinite(sample.frame) || sample.frame <= fStart || sample.frame >= fEnd) continue;
        const curvature = clamp(sample.curvature, 0, 8);
        const valuePenalty = 1 + curvature * (rotationTrack ? 0.5 : 0.35);
        const velocityPenalty = 1 + curvature * (rotationTrack ? 0.32 : 0.22);
        const effectiveValueTol = valueTolerance / valuePenalty;
        const effectiveVelocityTol = velocityTolerance / velocityPenalty;

        const original = sampleTrackValueAtFrame(keys, i, j, sample.frame, trackPath, lineType);
        const simplified = interpolateKeyPairAtFrame(keys[i], keys[j], sample.frame, trackPath, lineType);
        const valueErr = valueErrorBetween(original, simplified, rotationTrack);
        if (!Number.isFinite(valueErr) || valueErr > effectiveValueTol) return false;

        const h = Math.max(1, Math.min(derivativeWindowBase, sample.frame - fStart, fEnd - sample.frame));
        const left = sample.frame - h;
        const right = sample.frame + h;
        if (!(right > left)) continue;

        const originalLeft = sampleTrackValueAtFrame(keys, i, j, left, trackPath, lineType);
        const originalRight = sampleTrackValueAtFrame(keys, i, j, right, trackPath, lineType);
        const simplifiedLeft = interpolateKeyPairAtFrame(keys[i], keys[j], left, trackPath, lineType);
        const simplifiedRight = interpolateKeyPairAtFrame(keys[i], keys[j], right, trackPath, lineType);
        const velocityErr = velocityErrorBetween(
            originalLeft,
            originalRight,
            simplifiedLeft,
            simplifiedRight,
            rotationTrack,
            right - left
        );
        if (!Number.isFinite(velocityErr) || velocityErr > effectiveVelocityTol) return false;

        if (!rotationTrack && lineType > 1) {
            const tangentTol = velocityTolerance * (lineType === 3 ? 0.9 : 1);
            const effectiveTangentTol = tangentTol / (1 + curvature * 0.2);
            if (velocityErr > effectiveTangentTol) return false;
        }
    }

    // Momentum safety: preserve start/end kinematic behavior.
    const dtStart = Math.max(1, Math.min((Number(keys[Math.min(i + 1, j)]?.Frame) - fStart) * 0.5, span * 0.15));
    const dtEnd = Math.max(1, Math.min((fEnd - Number(keys[Math.max(i, j - 1)]?.Frame)) * 0.5, span * 0.15));

    const startLeft = fStart;
    const startRight = Math.min(fEnd, fStart + dtStart);
    if (startRight > startLeft) {
        const originalStartL = sampleTrackValueAtFrame(keys, i, j, startLeft, trackPath, lineType);
        const originalStartR = sampleTrackValueAtFrame(keys, i, j, startRight, trackPath, lineType);
        const simplifiedStartL = interpolateKeyPairAtFrame(keys[i], keys[j], startLeft, trackPath, lineType);
        const simplifiedStartR = interpolateKeyPairAtFrame(keys[i], keys[j], startRight, trackPath, lineType);
        const startMomentumErr = velocityErrorBetween(
            originalStartL,
            originalStartR,
            simplifiedStartL,
            simplifiedStartR,
            rotationTrack,
            startRight - startLeft
        );
        if (startMomentumErr > velocityTolerance * (rotationTrack ? 0.9 : 1.1)) return false;
    }

    const endRight = fEnd;
    const endLeft = Math.max(fStart, fEnd - dtEnd);
    if (endRight > endLeft) {
        const originalEndL = sampleTrackValueAtFrame(keys, i, j, endLeft, trackPath, lineType);
        const originalEndR = sampleTrackValueAtFrame(keys, i, j, endRight, trackPath, lineType);
        const simplifiedEndL = interpolateKeyPairAtFrame(keys[i], keys[j], endLeft, trackPath, lineType);
        const simplifiedEndR = interpolateKeyPairAtFrame(keys[i], keys[j], endRight, trackPath, lineType);
        const endMomentumErr = velocityErrorBetween(
            originalEndL,
            originalEndR,
            simplifiedEndL,
            simplifiedEndR,
            rotationTrack,
            endRight - endLeft
        );
        if (endMomentumErr > velocityTolerance * (rotationTrack ? 0.9 : 1.1)) return false;
    }

    return true;
};

const solveSPOSSegment = (
    keys: any[],
    startIdx: number,
    endIdx: number,
    ctx: SPOSEdgeContext
): number[] => {
    if (endIdx <= startIdx) return [startIdx];
    if (endIdx - startIdx <= 1) return [startIdx, endIdx];

    const count = endIdx - startIdx + 1;
    const dist = new Array<number>(count).fill(Number.POSITIVE_INFINITY);
    const prev = new Array<number>(count).fill(-1);
    dist[0] = 1;
    const maxBackward = Math.min(count - 1, 220);

    for (let localJ = 1; localJ < count; localJ++) {
        const from = Math.max(0, localJ - maxBackward);
        for (let localI = localJ - 1; localI >= from; localI--) {
            if (!Number.isFinite(dist[localI])) continue;
            const globalI = startIdx + localI;
            const globalJ = startIdx + localJ;
            if (!validateSPOSEdge(globalI, globalJ, ctx)) continue;
            const candidate = dist[localI] + 1;
            if (candidate < dist[localJ]) {
                dist[localJ] = candidate;
                prev[localJ] = localI;
            }
        }

        // Always keep graph connected as a safe fallback.
        if (prev[localJ] === -1 && Number.isFinite(dist[localJ - 1])) {
            dist[localJ] = dist[localJ - 1] + 1;
            prev[localJ] = localJ - 1;
        }
    }

    const out: number[] = [];
    let cursor = count - 1;
    while (cursor >= 0) {
        out.push(startIdx + cursor);
        if (cursor === 0) break;
        const p = prev[cursor];
        if (p < 0) {
            out.push(startIdx);
            break;
        }
        cursor = p;
    }
    out.reverse();
    return out;
};

const simplifySegmentRdp = (
    keys: any[],
    startIdx: number,
    endIdx: number,
    trackPath: string,
    valueTolerance: number,
    velocityTolerance: number,
    keep: Set<number>
) => {
    if (endIdx - startIdx <= 1) return;
    let maxScore = -1;
    let maxIndex = -1;
    const startFrame = Number(keys[startIdx]?.Frame);
    const endFrame = Number(keys[endIdx]?.Frame);
    const startVec = toVector(keys[startIdx]?.Vector);
    const endVec = toVector(keys[endIdx]?.Vector);
    const rotationTrack = isRotationTrack(trackPath, startVec);
    for (let i = startIdx + 1; i < endIdx; i++) {
        if (keep.has(i)) continue;
        const valueErr = interpolationError(keys[startIdx], keys[i], keys[endIdx], trackPath);
        const velocityErr = localCollapseVelocityError(keys[i - 1], keys[i], keys[i + 1], trackPath);
        let score = Math.max(
            valueErr / Math.max(valueTolerance, 1e-8),
            velocityErr / Math.max(velocityTolerance, 1e-8)
        );

        const sampled = sampleCollapsedIntervalErrors(keys[i - 1], keys[i], keys[i + 1], trackPath);
        if (Number.isFinite(sampled.valueError) && Number.isFinite(sampled.velocityError)) {
            score = Math.max(
                score,
                sampled.valueError / Math.max(valueTolerance, 1e-8),
                sampled.velocityError / Math.max(velocityTolerance, 1e-8)
            );
        }

        // Midpoint sampling catches jitter between sparse keys.
        if (i < endIdx) {
            const leftFrame = Number(keys[i]?.Frame);
            const rightFrame = Number(keys[i + 1]?.Frame);
            if (Number.isFinite(leftFrame) && Number.isFinite(rightFrame) && rightFrame > leftFrame && endFrame > startFrame) {
                const midFrame = (leftFrame + rightFrame) * 0.5;
                const originalMid = interpolateVectors(
                    toVector(keys[i]?.Vector),
                    toVector(keys[i + 1]?.Vector),
                    0.5,
                    rotationTrack
                );
                const tMid = (midFrame - startFrame) / (endFrame - startFrame);
                const simplifiedMid = interpolateVectors(startVec, endVec, tMid, rotationTrack);
                const midErr = valueErrorBetween(originalMid, simplifiedMid, rotationTrack);
                score = Math.max(score, (midErr / Math.max(valueTolerance, 1e-8)) * 0.9);
            }
        }

        if (score > maxScore) {
            maxScore = score;
            maxIndex = i;
        }
    }
    if (maxIndex === -1 || maxScore <= 1) return;
    keep.add(maxIndex);
    simplifySegmentRdp(keys, startIdx, maxIndex, trackPath, valueTolerance, velocityTolerance, keep);
    simplifySegmentRdp(keys, maxIndex, endIdx, trackPath, valueTolerance, velocityTolerance, keep);
};

const optimizeAnimVector = (
    anim: any,
    trackPath: string,
    preserveFrames: Set<number>,
    options: Required<KeyframeOptimizationOptions>
): { changed: boolean; before: number; after: number } => {
    const keys = normalizeAndSortKeys(Array.isArray(anim?.Keys) ? anim.Keys : []);
    if (keys.length <= 1) return { changed: false, before: keys.length, after: keys.length };

    const before = keys.length;
    const discrete = isDiscreteTrack(trackPath, keys);
    const rotationTrack = isRotationTrack(trackPath, toVector(keys[0]?.Vector));
    let stage = rotationTrack ? enforceQuaternionContinuity(keys) : keys;
    let adaptiveTol = computeAdaptiveTolerance(stage, trackPath, options);
    let adaptiveVelocityTol = computeVelocityTolerance(stage, trackPath, adaptiveTol, options);
    if (rotationTrack) {
        const safetyFactor = computeRotationSafetyFactor(stage, options.rotationToleranceDeg);
        adaptiveTol *= safetyFactor;
        adaptiveVelocityTol *= Math.max(0.62, safetyFactor * 0.9);
    }

    if (options.removeRedundantFrames) {
        const filtered: any[] = [stage[0]];
        for (let i = 1; i < stage.length; i++) {
            const curr = stage[i];
            const prev = filtered[filtered.length - 1];
            if (preserveFrames.has(curr.Frame)) {
                filtered.push(curr);
                continue;
            }
            const sameVector = vectorMaxAbsDiff(toVector(prev.Vector), toVector(curr.Vector)) <= Math.max(options.scalarTolerance, adaptiveTol * 0.15);
            if (sameVector) continue;
            filtered.push(curr);
        }
        stage = filtered;
        if (rotationTrack) {
            stage = enforceQuaternionContinuity(stage);
        }
        adaptiveTol = computeAdaptiveTolerance(stage, trackPath, options);
        adaptiveVelocityTol = computeVelocityTolerance(stage, trackPath, adaptiveTol, options);
        if (rotationTrack) {
            const safetyFactor = computeRotationSafetyFactor(stage, options.rotationToleranceDeg);
            adaptiveTol *= safetyFactor;
            adaptiveVelocityTol *= Math.max(0.62, safetyFactor * 0.9);
        }
    }

    if (options.optimizeKeyframes && !discrete && stage.length > 2) {
        const lineType = getAnimLineType(anim);
        if (lineType !== 0) {
            const forceFrames = new Set<number>(preserveFrames);
            const lower = trackPath.toLowerCase();
            if (!lower.includes('rotation')) {
                const extremaFrames = collectExtremaFrames(stage, adaptiveTol * 0.45);
                extremaFrames.forEach((f) => forceFrames.add(f));
            } else {
                const rotationTurnFrames = collectRotationVelocityChangeFrames(stage, options.rotationToleranceDeg);
                rotationTurnFrames.forEach((f) => forceFrames.add(f));
            }

            const anchorIndices = new Set<number>([0, stage.length - 1]);
            for (let i = 1; i < stage.length - 1; i++) {
                if (forceFrames.has(Number(stage[i].Frame))) anchorIndices.add(i);
            }
            const anchors = Array.from(anchorIndices.values()).sort((a, b) => a - b);

            const curvatureScores = computeTrackCurvatureScores(stage, trackPath, adaptiveVelocityTol);
            const edgeCtx: SPOSEdgeContext = {
                keys: stage,
                trackPath,
                lineType,
                valueTolerance: adaptiveTol,
                velocityTolerance: adaptiveVelocityTol,
                curvatureScores,
                rotationTrack
            };

            const keepIndices = new Set<number>();
            for (let seg = 0; seg < anchors.length - 1; seg++) {
                const startIdx = anchors[seg];
                const endIdx = anchors[seg + 1];
                const segmentPath = solveSPOSSegment(stage, startIdx, endIdx, edgeCtx);
                for (const idx of segmentPath) keepIndices.add(idx);
            }
            anchors.forEach((idx) => keepIndices.add(idx));

            stage = stage.filter((_, idx) => keepIndices.has(idx));
            if (rotationTrack) {
                stage = enforceQuaternionContinuity(stage);
            }
        }
    }

    if (stage.length === before) return { changed: false, before, after: stage.length };
    anim.Keys = stage.map((k: any) => ({
        ...k,
        Vector: fromVector(k.Vector, toVector(k.Vector)),
        InTan: k.InTan !== undefined ? fromVector(k.InTan, toVector(k.InTan)) : k.InTan,
        OutTan: k.OutTan !== undefined ? fromVector(k.OutTan, toVector(k.OutTan)) : k.OutTan
    }));
    return { changed: true, before, after: anim.Keys.length };
};

const collectSequenceBoundaryFrames = (modelData: any): Set<number> => {
    const frames = new Set<number>([0]);
    const seqs = Array.isArray(modelData?.Sequences) ? modelData.Sequences : [];
    for (const seq of seqs) {
        const interval = Array.isArray(seq?.Interval)
            ? seq.Interval
            : (seq?.Interval ? Array.from(seq.Interval as ArrayLike<number>) : null);
        if (!interval || interval.length < 2) continue;
        const start = Number(interval[0]);
        const end = Number(interval[1]);
        if (Number.isFinite(start)) frames.add(start);
        if (Number.isFinite(end)) frames.add(end);
    }
    return frames;
};

export async function optimizeModelPolygons(
    sourceModel: any,
    options: PolygonOptimizationOptions = {},
    onProgress?: (ratio: number, message: string) => void
): Promise<{ model: any; stats: PolygonOptimizationStats; changed: boolean }> {
    const opts = { ...DEFAULT_POLYGON_OPTIONS, ...options };
    const model = sourceModel;
    const geosets = Array.isArray(model?.Geosets) ? model.Geosets : [];

    const stats: PolygonOptimizationStats = {
        geosetsProcessed: 0,
        verticesBefore: 0,
        verticesAfter: 0,
        facesBefore: 0,
        facesAfter: 0,
        degenerateFacesRemoved: 0,
        collapsedEdges: 0
    };

    if (geosets.length === 0) return { model, stats, changed: false };

    const nextGeosets: any[] = [];
    let changed = false;

    for (let i = 0; i < geosets.length; i++) {
        const result = optimizeSingleGeoset(geosets[i], opts);
        nextGeosets.push(result.geoset);
        stats.geosetsProcessed++;
        stats.verticesBefore += result.stats.verticesBefore;
        stats.verticesAfter += result.stats.verticesAfter;
        stats.facesBefore += result.stats.facesBefore;
        stats.facesAfter += result.stats.facesAfter;
        stats.degenerateFacesRemoved += result.stats.degenerateFacesRemoved;
        stats.collapsedEdges += result.stats.collapsedEdges;

        if (
            result.stats.verticesAfter !== result.stats.verticesBefore ||
            result.stats.facesAfter !== result.stats.facesBefore
        ) {
            changed = true;
        }

        onProgress?.((i + 1) / geosets.length, `优化几何 ${i + 1}/${geosets.length}`);
        await nextTick();
    }

    model.Geosets = nextGeosets;
    return { model, stats, changed };
}

export async function optimizeModelKeyframes(
    sourceModel: any,
    options: KeyframeOptimizationOptions = {},
    onProgress?: (ratio: number, message: string) => void
): Promise<{ model: any; stats: KeyframeOptimizationStats; changed: boolean }> {
    const opts = { ...DEFAULT_KEYFRAME_OPTIONS, ...options };
    const model = sourceModel;
    const preserveFrames = collectSequenceBoundaryFrames(model);

    const stats: KeyframeOptimizationStats = {
        tracksProcessed: 0,
        keysBefore: 0,
        keysAfter: 0,
        keysRemoved: 0
    };

    let changed = false;
    let visited = 0;
    let totalEstimated = 1;

    const estimateTracks = (obj: any): number => {
        if (!obj || typeof obj !== 'object') return 0;
        if (Array.isArray(obj)) return obj.reduce((sum, item) => sum + estimateTracks(item), 0);
        if (isAnimVector(obj)) return 1;
        let count = 0;
        for (const key of Object.keys(obj)) {
            if (GEOMETRY_SKIP_KEYS.has(key)) continue;
            count += estimateTracks((obj as any)[key]);
        }
        return count;
    };

    totalEstimated = Math.max(estimateTracks(model), 1);

    const traverse = async (obj: any, path: string): Promise<void> => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                await traverse(obj[i], `${path}[${i}]`);
            }
            return;
        }

        if (isAnimVector(obj)) {
            const result = optimizeAnimVector(obj, path, preserveFrames, opts);
            stats.tracksProcessed++;
            stats.keysBefore += result.before;
            stats.keysAfter += result.after;
            if (result.changed) {
                changed = true;
                stats.keysRemoved += Math.max(0, result.before - result.after);
            }
            visited++;
            onProgress?.(visited / totalEstimated, `优化关键帧轨道 ${visited}/${totalEstimated}`);
            if (visited % 10 === 0) await nextTick();
            return;
        }

        for (const key of Object.keys(obj)) {
            if (GEOMETRY_SKIP_KEYS.has(key)) continue;
            await traverse(obj[key], path ? `${path}.${key}` : key);
        }
    };

    await traverse(model, 'model');
    return { model, stats, changed };
}
