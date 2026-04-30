import type { PolygonOptimizationOptions } from './modelOptimization';
import {
    quantize,
    toFloatArray,
    toGroupsMatrix,
    toUint32FaceArray
} from './modelOptimizationShared';

export type PackedGeoset = {
    vertices: Float32Array;
    normals: Float32Array | null;
    faces: Uint32Array;
    tVertices: Float32Array[];
    vertexGroup: Uint16Array;
    groups: number[][];
};

export type SkinConstraint = {
    mode: 'strict' | 'overlap' | 'off';
    minOverlap: number;
};

export type CollapseConstraint = {
    checkUv: boolean;
    checkNormal: boolean;
};

export const packGeoset = (geoset: any): PackedGeoset => {
    const vertices = toFloatArray(geoset?.Vertices);
    const vertexCount = Math.floor(vertices.length / 3);
    const normalsRaw = toFloatArray(geoset?.Normals);
    const normals = normalsRaw.length >= vertexCount * 3 ? normalsRaw.subarray(0, vertexCount * 3) : null;
    const faces = toUint32FaceArray(geoset?.Faces);
    const groups = toGroupsMatrix(geoset?.Groups);

    const rawVertexGroup = geoset?.VertexGroup;
    const vertexGroup = new Uint16Array(vertexCount);
    if (rawVertexGroup && (Array.isArray(rawVertexGroup) || ArrayBuffer.isView(rawVertexGroup))) {
        const src = ArrayBuffer.isView(rawVertexGroup) ? Array.from(rawVertexGroup as unknown as ArrayLike<number>) : rawVertexGroup;
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

export const buildBoundaryVertexSet = (faces: Uint32Array): Set<number> => {
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

export const buildSkinSignatures = (vertexGroup: Uint16Array, groups: number[][]): string[] => {
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

export const getBonesForVertex = (
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

export const skinOverlapRatio = (a: number[], b: number[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let inter = 0;
    setA.forEach((v) => {
        if (setB.has(v)) inter++;
    });
    return inter / Math.max(setA.size, setB.size);
};

export const canCollapseSkinPair = (
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

export const buildProtectedVertices = (
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

export const compactGroups = (vertexGroup: Uint16Array, groups: number[][]) => {
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

export const buildKeyHash = (
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

export const rebuildMesh = (
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
