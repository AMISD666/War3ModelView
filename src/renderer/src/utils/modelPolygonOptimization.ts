import { calculateNormals } from './geometryUtils';
import type { PolygonOptimizationOptions } from './modelOptimization';
import { clamp, makeTypedFaceArray } from './modelOptimizationShared';
import {
    buildBoundaryVertexSet,
    buildProtectedVertices,
    buildSkinSignatures,
    compactGroups,
    decimateByEdgeCollapse,
    packGeoset,
    weldRedundantVertices,
    type CollapseConstraint,
    type PackedGeoset,
    type SkinConstraint
} from './modelPolygonMeshOptimization';

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

export const optimizeSingleGeoset = (
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
