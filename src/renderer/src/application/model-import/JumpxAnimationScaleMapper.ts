import type { JumpxGeometryDto } from '../../types/jumpxImport'
import { transformJumpxScale } from './JumpxCoordinateTransform'

const SCALE_EPSILON = 1e-5
const FLAT_GEOMETRY_EPSILON = 1e-3
const CIRCULAR_PLANE_RATIO_LIMIT = 1.05

const close = (a: number, b: number): boolean => Math.abs(a - b) <= SCALE_EPSILON

const transformJumpxAxis = (sourceAxis: number): number =>
    sourceAxis === 0 ? 1 : sourceAxis === 1 ? 0 : 2

const circularPlaneNormalAxis = (geometry: JumpxGeometryDto): number | null => {
    const size = [
        Math.abs(geometry.maximumExtent[0] - geometry.minimumExtent[0]),
        Math.abs(geometry.maximumExtent[1] - geometry.minimumExtent[1]),
        Math.abs(geometry.maximumExtent[2] - geometry.minimumExtent[2]),
    ]
    let flatAxis = 0
    for (let axis = 1; axis < 3; axis += 1) {
        if (size[axis] < size[flatAxis]) {
            flatAxis = axis
        }
    }
    const planeAxes = [0, 1, 2].filter((axis) => axis !== flatAxis)
    const planeMax = Math.max(size[planeAxes[0]], size[planeAxes[1]])
    const planeMin = Math.min(size[planeAxes[0]], size[planeAxes[1]])
    if (planeMax <= FLAT_GEOMETRY_EPSILON) {
        return null
    }
    if (size[flatAxis] > Math.max(FLAT_GEOMETRY_EPSILON, planeMax * 0.01)) {
        return null
    }
    if (planeMax / Math.max(FLAT_GEOMETRY_EPSILON, planeMin) > CIRCULAR_PLANE_RATIO_LIMIT) {
        return null
    }
    return transformJumpxAxis(flatAxis)
}

export const buildCircularScaleNormalAxisByBone = (geometries: JumpxGeometryDto[]): Map<number, number> => {
    const axisVotesByBone = new Map<number, Map<number, number>>()
    for (const geometry of geometries) {
        const axis = circularPlaneNormalAxis(geometry)
        if (axis === null || geometry.ancestorBoneId < 0) {
            continue
        }
        let votes = axisVotesByBone.get(geometry.ancestorBoneId)
        if (!votes) {
            votes = new Map<number, number>()
            axisVotesByBone.set(geometry.ancestorBoneId, votes)
        }
        votes.set(axis, (votes.get(axis) ?? 0) + 1)
    }
    const result = new Map<number, number>()
    for (const [boneId, votes] of axisVotesByBone) {
        const [axis] = Array.from(votes).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
        result.set(boneId, axis)
    }
    return result
}

export const mapJumpxBoneScaleKey = (
    value: [number, number, number] | undefined,
    circularNormalAxis: number | undefined,
): [number, number, number] => {
    const x = Math.abs(Number(value?.[0] ?? 1))
    const y = Math.abs(Number(value?.[1] ?? 1))
    const z = Math.abs(Number(value?.[2] ?? 1))
    if (circularNormalAxis !== undefined) {
        if (close(x, y) && !close(y, z)) {
            const mapped = [x, x, x] as [number, number, number]
            mapped[circularNormalAxis] = z
            return mapped
        }
        if (close(x, z) && !close(x, y)) {
            const mapped = [x, x, x] as [number, number, number]
            mapped[circularNormalAxis] = y
            return mapped
        }
        if (close(y, z) && !close(x, y)) {
            const mapped = [y, y, y] as [number, number, number]
            mapped[circularNormalAxis] = x
            return mapped
        }
    }
    return transformJumpxScale(value)
}
