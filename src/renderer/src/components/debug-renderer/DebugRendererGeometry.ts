export interface SolidGeometry {
    verts: Float32Array
    normals: Float32Array
}

export const generateSphereGeometry = (radius: number, segments: number): SolidGeometry => {
    const verts: number[] = []
    const normals: number[] = []

    for (let lat = 0; lat <= segments; lat++) {
        const theta = lat * Math.PI / segments
        const sinTheta = Math.sin(theta)
        const cosTheta = Math.cos(theta)

        for (let lon = 0; lon <= segments; lon++) {
            const phi = lon * 2 * Math.PI / segments
            const sinPhi = Math.sin(phi)
            const cosPhi = Math.cos(phi)

            const x = cosPhi * sinTheta
            const y = cosTheta
            const z = sinPhi * sinTheta

            normals.push(x, y, z)
            verts.push(radius * x, radius * y, radius * z)
        }
    }

    const triVerts: number[] = []
    const triNormals: number[] = []

    for (let lat = 0; lat < segments; lat++) {
        for (let lon = 0; lon < segments; lon++) {
            const first = (lat * (segments + 1)) + lon
            const second = first + segments + 1

            triVerts.push(verts[first * 3], verts[first * 3 + 1], verts[first * 3 + 2])
            triVerts.push(verts[second * 3], verts[second * 3 + 1], verts[second * 3 + 2])
            triVerts.push(verts[(first + 1) * 3], verts[(first + 1) * 3 + 1], verts[(first + 1) * 3 + 2])

            triNormals.push(normals[first * 3], normals[first * 3 + 1], normals[first * 3 + 2])
            triNormals.push(normals[second * 3], normals[second * 3 + 1], normals[second * 3 + 2])
            triNormals.push(normals[(first + 1) * 3], normals[(first + 1) * 3 + 1], normals[(first + 1) * 3 + 2])

            triVerts.push(verts[(first + 1) * 3], verts[(first + 1) * 3 + 1], verts[(first + 1) * 3 + 2])
            triVerts.push(verts[second * 3], verts[second * 3 + 1], verts[second * 3 + 2])
            triVerts.push(verts[(second + 1) * 3], verts[(second + 1) * 3 + 1], verts[(second + 1) * 3 + 2])

            triNormals.push(normals[(first + 1) * 3], normals[(first + 1) * 3 + 1], normals[(first + 1) * 3 + 2])
            triNormals.push(normals[second * 3], normals[second * 3 + 1], normals[second * 3 + 2])
            triNormals.push(normals[(second + 1) * 3], normals[(second + 1) * 3 + 1], normals[(second + 1) * 3 + 2])
        }
    }

    return {
        verts: new Float32Array(triVerts),
        normals: new Float32Array(triNormals),
    }
}

const calculateNormal = (p1: number[], p2: number[], p3: number[]): number[] => {
    const u = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
    const v = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]]
    const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ]
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2])
    return [n[0] / len, n[1] / len, n[2] / len]
}

export const generateTetrahedronGeometry = (size: number): SolidGeometry => {
    const s = size
    const v0 = [0, s, 0]
    const v1 = [-s * 0.94, -s * 0.33, s * 0.54]
    const v2 = [s * 0.94, -s * 0.33, s * 0.54]
    const v3 = [0, -s * 0.33, -s * 1.0]

    const triVerts: number[] = [
        ...v0, ...v2, ...v1,
        ...v0, ...v3, ...v2,
        ...v0, ...v1, ...v3,
        ...v1, ...v2, ...v3,
    ]

    const n1 = calculateNormal(v0, v2, v1)
    const n2 = calculateNormal(v0, v3, v2)
    const n3 = calculateNormal(v0, v1, v3)
    const n4 = calculateNormal(v1, v2, v3)

    const triNormals: number[] = [
        ...n1, ...n1, ...n1,
        ...n2, ...n2, ...n2,
        ...n3, ...n3, ...n3,
        ...n4, ...n4, ...n4,
    ]

    return {
        verts: new Float32Array(triVerts),
        normals: new Float32Array(triNormals),
    }
}
