import type { Geoset } from '../../types/geoset'

export const computeGeosetExtents = (vertices: ArrayLike<number>): Pick<Geoset, 'MinimumExtent' | 'MaximumExtent' | 'BoundsRadius'> => {
    if (!vertices || vertices.length < 3) {
        return {
            MinimumExtent: [0, 0, 0],
            MaximumExtent: [0, 0, 0],
            BoundsRadius: 0,
        }
    }

    const minimumExtent: [number, number, number] = [Infinity, Infinity, Infinity]
    const maximumExtent: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    let boundsRadius = 0

    for (let index = 0; index + 2 < vertices.length; index += 3) {
        const x = Number(vertices[index] ?? 0)
        const y = Number(vertices[index + 1] ?? 0)
        const z = Number(vertices[index + 2] ?? 0)
        minimumExtent[0] = Math.min(minimumExtent[0], x)
        minimumExtent[1] = Math.min(minimumExtent[1], y)
        minimumExtent[2] = Math.min(minimumExtent[2], z)
        maximumExtent[0] = Math.max(maximumExtent[0], x)
        maximumExtent[1] = Math.max(maximumExtent[1], y)
        maximumExtent[2] = Math.max(maximumExtent[2], z)
        boundsRadius = Math.max(boundsRadius, Math.hypot(x, y, z))
    }

    return {
        MinimumExtent: minimumExtent,
        MaximumExtent: maximumExtent,
        BoundsRadius: boundsRadius,
    }
}
