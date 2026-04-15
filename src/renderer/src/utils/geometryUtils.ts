/**
 * Geometry Utilities for Vertex Editing
 * Contains functions for recalculating normals after vertex modifications.
 */

import { vec3 } from 'gl-matrix'

/**
 * Calculate smooth vertex normals for a geoset.
 * This averages face normals for vertices that share the same position.
 * Optimized: Reuses vec3 objects to avoid GC pressure.
 */
export function calculateNormals(
    vertices: Float32Array | number[],
    faces: Uint16Array | Uint32Array | number[]
): Float32Array {
    const vertexCount = vertices.length / 3;
    const faceCount = faces.length / 3;
    const normals = new Float32Array(vertices.length);

    // Reusable scratch variables to avoid allocations in loop
    const v0 = vec3.create();
    const v1 = vec3.create();
    const v2 = vec3.create();
    const edge1 = vec3.create();
    const edge2 = vec3.create();
    const faceNormal = vec3.create();
    const tempN = vec3.create();

    // Calculate face normals and accumulate to vertices
    for (let f = 0; f < faceCount; f++) {
        const i0 = faces[f * 3];
        const i1 = faces[f * 3 + 1];
        const i2 = faces[f * 3 + 2];

        // Set vertex positions from buffer
        vec3.set(v0, vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]);
        vec3.set(v1, vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]);
        vec3.set(v2, vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]);

        // Calculate edge vectors and cross product
        vec3.sub(edge1, v1, v0);
        vec3.sub(edge2, v2, v0);
        vec3.cross(faceNormal, edge1, edge2);

        // Accumulate face normal to each vertex
        const f0 = i0 * 3, f1 = i1 * 3, f2 = i2 * 3;

        normals[f0] += faceNormal[0];
        normals[f0 + 1] += faceNormal[1];
        normals[f0 + 2] += faceNormal[2];

        normals[f1] += faceNormal[0];
        normals[f1 + 1] += faceNormal[1];
        normals[f1 + 2] += faceNormal[2];

        normals[f2] += faceNormal[0];
        normals[f2 + 1] += faceNormal[1];
        normals[f2 + 2] += faceNormal[2];
    }

    // Normalize all vertex normals
    for (let v = 0; v < vertexCount; v++) {
        const off = v * 3;
        vec3.set(tempN, normals[off], normals[off + 1], normals[off + 2]);
        vec3.normalize(tempN, tempN);
        normals[off] = tempN[0];
        normals[off + 1] = tempN[1];
        normals[off + 2] = tempN[2];
    }

    return normals;
}

/**
 * Calculate flat/hard-edge normals for a geoset.
 * Optimized: Reuses vec3 objects to avoid GC pressure.
 */
export function calculateFlatNormals(
    vertices: Float32Array | number[],
    faces: Uint16Array | Uint32Array | number[]
): Float32Array {
    const normals = new Float32Array(vertices.length);
    const faceCount = faces.length / 3;

    // Reusable scratch variables
    const v0 = vec3.create();
    const v1 = vec3.create();
    const v2 = vec3.create();
    const edge1 = vec3.create();
    const edge2 = vec3.create();
    const faceNormal = vec3.create();

    for (let f = 0; f < faceCount; f++) {
        const i0 = faces[f * 3];
        const i1 = faces[f * 3 + 1];
        const i2 = faces[f * 3 + 2];

        vec3.set(v0, vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]);
        vec3.set(v1, vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]);
        vec3.set(v2, vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]);

        vec3.sub(edge1, v1, v0);
        vec3.sub(edge2, v2, v0);
        vec3.cross(faceNormal, edge1, edge2);
        vec3.normalize(faceNormal, faceNormal);

        // Assign face normal to all vertices of this face
        const f0 = i0 * 3, f1 = i1 * 3, f2 = i2 * 3;

        normals[f0] = faceNormal[0];
        normals[f0 + 1] = faceNormal[1];
        normals[f0 + 2] = faceNormal[2];

        normals[f1] = faceNormal[0];
        normals[f1 + 1] = faceNormal[1];
        normals[f1 + 2] = faceNormal[2];

        normals[f2] = faceNormal[0];
        normals[f2 + 1] = faceNormal[1];
        normals[f2 + 2] = faceNormal[2];
    }

    return normals;
}

/**
 * Recalculate normals for a specific geoset and update the GPU buffer.
 * This is the main entry point called when vertices are edited.
 * 
 * @param renderer - The ModelRenderer instance
 * @param geosetIndex - Index of the geoset to update
 * @param smooth - If true, use smooth normals; if false, use flat normals
 */
export function recalculateGeosetNormals(
    renderer: any,
    geosetIndex: number,
    smooth: boolean = true
): void {
    if (!renderer || !renderer.model || !renderer.model.Geosets) {
        console.warn('[geometryUtils] Renderer or geosets not available')
        return
    }

    const geoset = renderer.model.Geosets[geosetIndex]
    if (!geoset || !geoset.Vertices || !geoset.Faces) {
        console.warn('[geometryUtils] Invalid geoset at index', geosetIndex)
        return
    }

    const newNormals = smooth
        ? calculateNormals(geoset.Vertices, geoset.Faces)
        : calculateFlatNormals(geoset.Vertices, geoset.Faces)

    // Update geoset data
    geoset.Normals = newNormals

    // Update GPU buffer if the method exists
    if (typeof renderer.updateGeosetNormals === 'function') {
        renderer.updateGeosetNormals(geosetIndex, newNormals)
    } else {    }
}

/**
 * Recalculate normals for all geosets in the model.
 * 
 * @param renderer - The ModelRenderer instance
 * @param smooth - If true, use smooth normals; if false, use flat normals
 */
export function recalculateAllNormals(
    renderer: any,
    smooth: boolean = true
): void {
    if (!renderer || !renderer.model || !renderer.model.Geosets) {
        console.warn('[geometryUtils] Renderer or geosets not available')
        return
    }

    const geosets = renderer.model.Geosets
    for (let i = 0; i < geosets.length; i++) {
        recalculateGeosetNormals(renderer, i, smooth)
    }}

/**
 * Calculate the bounding box and radius for a geoset.
 * Optimized: Uses basic loops to avoid object allocations per vertex.
 */
export function calculateGeosetExtent(geoset: any): void {
    if (!geoset?.Vertices || geoset.Vertices.length === 0) {
        geoset.MinimumExtent = undefined;
        geoset.MaximumExtent = undefined;
        geoset.BoundsRadius = 0;
        return;
    }

    const vertices = geoset.Vertices;
    const vertexCount = vertices.length / 3;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
        const x = vertices[i * 3];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }

    // Update extent
    geoset.MinimumExtent = new Float32Array([minX, minY, minZ]);
    geoset.MaximumExtent = new Float32Array([maxX, maxY, maxZ]);

    // Calculate BoundsRadius as half the diagonal
    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    geoset.BoundsRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

/**
 * Calculate model-level extent by aggregating all geoset extents.
 */
export function calculateModelExtent(modelData: any): void {
    if (!modelData?.Geosets) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasValidExtent = false;

    for (const geoset of modelData.Geosets) {
        // Manual recalc must always use the latest vertex data, not stale cached extents.
        calculateGeosetExtent(geoset);

        if (geoset.MinimumExtent && geoset.MaximumExtent) {
            const min = geoset.MinimumExtent;
            const max = geoset.MaximumExtent;

            if (min[0] < minX) minX = min[0];
            if (min[1] < minY) minY = min[1];
            if (min[2] < minZ) minZ = min[2];

            if (max[0] > maxX) maxX = max[0];
            if (max[1] > maxY) maxY = max[1];
            if (max[2] > maxZ) maxZ = max[2];

            hasValidExtent = true;
        }
    }

    if (hasValidExtent) {
        const minimumExtent = new Float32Array([minX, minY, minZ]);
        const maximumExtent = new Float32Array([maxX, maxY, maxZ]);
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        const boundsRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;

        // Keep both legacy Info.* and top-level model extents in sync.
        modelData.MinimumExtent = minimumExtent;
        modelData.MaximumExtent = maximumExtent;
        modelData.BoundsRadius = boundsRadius;

        if (!modelData.Info) {
            modelData.Info = {};
        }
        modelData.Info.MinimumExtent = new Float32Array(minimumExtent);
        modelData.Info.MaximumExtent = new Float32Array(maximumExtent);
        modelData.Info.BoundsRadius = boundsRadius;
    }
}

/**
 * Recalculate normals for all geosets in a model data object.
 */
export function calculateModelNormals(modelData: any): void {
    if (!modelData?.Geosets) return;

    for (const geoset of modelData.Geosets) {
        if (!geoset.Vertices || !geoset.Faces) continue;
        geoset.Normals = calculateNormals(geoset.Vertices, geoset.Faces);
    }
}
