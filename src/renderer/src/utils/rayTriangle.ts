/**
 * Ray-Triangle Intersection Utilities
 * Implements Möller–Trumbore intersection algorithm
 */

import { vec3 } from 'gl-matrix';

const EPSILON = 0.000001;

/**
 * Ray-Triangle intersection using Möller–Trumbore algorithm
 * Returns distance to intersection point, or null if no intersection
 */
export function rayTriangleIntersection(
    rayOrigin: vec3,
    rayDir: vec3,
    v0: vec3,
    v1: vec3,
    v2: vec3
): number | null {
    const edge1 = vec3.create();
    const edge2 = vec3.create();
    const h = vec3.create();
    const s = vec3.create();
    const q = vec3.create();

    vec3.subtract(edge1, v1, v0);
    vec3.subtract(edge2, v2, v0);
    vec3.cross(h, rayDir, edge2);
    const a = vec3.dot(edge1, h);

    if (a > -EPSILON && a < EPSILON) {
        return null; // Ray is parallel to triangle
    }

    const f = 1.0 / a;
    vec3.subtract(s, rayOrigin, v0);
    const u = f * vec3.dot(s, h);

    if (u < 0.0 || u > 1.0) {
        return null;
    }

    vec3.cross(q, s, edge1);
    const v = f * vec3.dot(rayDir, q);

    if (v < 0.0 || u + v > 1.0) {
        return null;
    }

    const t = f * vec3.dot(edge2, q);

    if (t > EPSILON) {
        return t; // Ray intersection distance
    }

    return null; // Line intersection but not ray intersection
}

export interface GeosetPickResult {
    geosetIndex: number;
    faceIndex: number;
    distance: number;
}

/**
 * Find the closest geoset hit by a ray
 * Tests all triangles and returns the one with minimum distance
 */
export function pickClosestGeoset(
    rayOrigin: vec3,
    rayDir: vec3,
    geosets: any[],
    skinnedVerticesMap?: Map<number, Float32Array | number[]>
): GeosetPickResult | null {
    let closestHit: GeosetPickResult | null = null;

    for (let geosetIndex = 0; geosetIndex < geosets.length; geosetIndex++) {
        const geoset = geosets[geosetIndex];
        if (!geoset.Vertices || !geoset.Faces) continue;

        // Use skinned vertices if available, otherwise bind-pose
        const vertices = skinnedVerticesMap?.get(geosetIndex) ?? geoset.Vertices;
        const faces = geoset.Faces;
        const numFaces = faces.length / 3;

        for (let faceIndex = 0; faceIndex < numFaces; faceIndex++) {
            const i0 = faces[faceIndex * 3];
            const i1 = faces[faceIndex * 3 + 1];
            const i2 = faces[faceIndex * 3 + 2];

            const v0 = vec3.fromValues(
                vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]
            );
            const v1 = vec3.fromValues(
                vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]
            );
            const v2 = vec3.fromValues(
                vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]
            );

            const distance = rayTriangleIntersection(rayOrigin, rayDir, v0, v1, v2);

            if (distance !== null) {
                if (closestHit === null || distance < closestHit.distance) {
                    closestHit = { geosetIndex, faceIndex, distance };
                }
            }
        }
    }

    return closestHit;
}
