import type { PolygonOptimizationOptions } from './modelOptimization';
import { clamp, normalDot, uvDistanceSq, vertexDistanceSq } from './modelOptimizationShared';
import {
    buildBoundaryVertexSet,
    buildProtectedVertices,
    buildSkinSignatures,
    canCollapseSkinPair,
    getBonesForVertex,
    rebuildMesh,
    skinOverlapRatio,
    type CollapseConstraint,
    type PackedGeoset,
    type SkinConstraint
} from './modelPolygonMeshData';

export {
    buildBoundaryVertexSet,
    buildProtectedVertices,
    buildSkinSignatures,
    compactGroups,
    packGeoset,
    type CollapseConstraint,
    type PackedGeoset,
    type SkinConstraint
} from './modelPolygonMeshData';
export { weldRedundantVertices } from './modelPolygonWeld';

export const decimateByEdgeCollapse = (
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
