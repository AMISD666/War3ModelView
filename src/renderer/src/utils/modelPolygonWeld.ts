import type { PolygonOptimizationOptions } from './modelOptimization';
import {
    buildBoundaryVertexSet,
    buildKeyHash,
    buildProtectedVertices,
    buildSkinSignatures,
    rebuildMesh,
    type PackedGeoset
} from './modelPolygonMeshData';

export const weldRedundantVertices = (
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

