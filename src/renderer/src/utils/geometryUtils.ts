/**
 * Geometry Utilities for Vertex Editing
 * Contains functions for recalculating normals after vertex modifications.
 */

import { vec3 } from 'gl-matrix'

/**
 * Calculate smooth vertex normals for a geoset.
 * This averages face normals for vertices that share the same position.
 * 
 * @param vertices - Float32Array of vertex positions (x, y, z, x, y, z, ...)
 * @param faces - Uint16Array or number[] of face indices (i0, i1, i2, i0, i1, i2, ...)
 * @returns Float32Array of vertex normals (same length as vertices)
 */
export function calculateNormals(
    vertices: Float32Array | number[],
    faces: Uint16Array | Uint32Array | number[]
): Float32Array {
    const vertexCount = vertices.length / 3
    const faceCount = faces.length / 3

    // Initialize normals to zero
    const normals = new Float32Array(vertices.length)

    // Calculate face normals and accumulate to vertices
    for (let f = 0; f < faceCount; f++) {
        const i0 = faces[f * 3]
        const i1 = faces[f * 3 + 1]
        const i2 = faces[f * 3 + 2]

        // Get vertex positions
        const v0 = vec3.fromValues(
            vertices[i0 * 3],
            vertices[i0 * 3 + 1],
            vertices[i0 * 3 + 2]
        )
        const v1 = vec3.fromValues(
            vertices[i1 * 3],
            vertices[i1 * 3 + 1],
            vertices[i1 * 3 + 2]
        )
        const v2 = vec3.fromValues(
            vertices[i2 * 3],
            vertices[i2 * 3 + 1],
            vertices[i2 * 3 + 2]
        )

        // Calculate edge vectors
        const edge1 = vec3.create()
        const edge2 = vec3.create()
        vec3.sub(edge1, v1, v0)
        vec3.sub(edge2, v2, v0)

        // Calculate face normal (cross product)
        const faceNormal = vec3.create()
        vec3.cross(faceNormal, edge1, edge2)

        // Accumulate face normal to each vertex of this face
        // (weighted by face area, which is implicit in the un-normalized cross product)
        for (const idx of [i0, i1, i2]) {
            normals[idx * 3] += faceNormal[0]
            normals[idx * 3 + 1] += faceNormal[1]
            normals[idx * 3 + 2] += faceNormal[2]
        }
    }

    // Normalize all vertex normals
    for (let v = 0; v < vertexCount; v++) {
        const n = vec3.fromValues(
            normals[v * 3],
            normals[v * 3 + 1],
            normals[v * 3 + 2]
        )
        vec3.normalize(n, n)
        normals[v * 3] = n[0]
        normals[v * 3 + 1] = n[1]
        normals[v * 3 + 2] = n[2]
    }

    return normals
}

/**
 * Calculate flat/hard-edge normals for a geoset.
 * Each face has its own normal, vertices are not averaged.
 * Note: This requires the mesh to have unique vertices per face (not shared).
 * For shared-vertex meshes, this will give the last face's normal to shared vertices.
 * 
 * @param vertices - Float32Array of vertex positions
 * @param faces - Face indices
 * @returns Float32Array of vertex normals
 */
export function calculateFlatNormals(
    vertices: Float32Array | number[],
    faces: Uint16Array | Uint32Array | number[]
): Float32Array {
    const normals = new Float32Array(vertices.length)
    const faceCount = faces.length / 3

    for (let f = 0; f < faceCount; f++) {
        const i0 = faces[f * 3]
        const i1 = faces[f * 3 + 1]
        const i2 = faces[f * 3 + 2]

        const v0 = vec3.fromValues(
            vertices[i0 * 3],
            vertices[i0 * 3 + 1],
            vertices[i0 * 3 + 2]
        )
        const v1 = vec3.fromValues(
            vertices[i1 * 3],
            vertices[i1 * 3 + 1],
            vertices[i1 * 3 + 2]
        )
        const v2 = vec3.fromValues(
            vertices[i2 * 3],
            vertices[i2 * 3 + 1],
            vertices[i2 * 3 + 2]
        )

        const edge1 = vec3.create()
        const edge2 = vec3.create()
        vec3.sub(edge1, v1, v0)
        vec3.sub(edge2, v2, v0)

        const faceNormal = vec3.create()
        vec3.cross(faceNormal, edge1, edge2)
        vec3.normalize(faceNormal, faceNormal)

        // Assign face normal to all vertices of this face
        for (const idx of [i0, i1, i2]) {
            normals[idx * 3] = faceNormal[0]
            normals[idx * 3 + 1] = faceNormal[1]
            normals[idx * 3 + 2] = faceNormal[2]
        }
    }

    return normals
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
    } else {
        console.log('[geometryUtils] updateGeosetNormals not available, GPU buffer not updated')
    }
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
    }

    console.log('[geometryUtils] Recalculated normals for', geosets.length, 'geosets')
}
