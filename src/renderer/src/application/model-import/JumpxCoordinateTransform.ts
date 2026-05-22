import { mat3, mat4, quat } from 'gl-matrix'

export const transformJumpxVec3 = (value: [number, number, number] | undefined): [number, number, number] => {
    const x = Number(value?.[0] ?? 0)
    const y = Number(value?.[1] ?? 0)
    const z = Number(value?.[2] ?? 0)
    return [
        Number.isFinite(y) ? -y : 0,
        Number.isFinite(x) ? x : 0,
        Number.isFinite(z) ? z : 0,
    ]
}

export const transformJumpxMat4 = (matrix: ArrayLike<number>): [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number] => {
    const get = (index: number): number => {
        const value = Number(matrix[index])
        return Number.isFinite(value) ? value : (index % 5 === 0 ? 1 : 0)
    }
    const transform = [
        0, 1, 0, 0,
        -1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]
    const inverse = [
        0, -1, 0, 0,
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]
    const source = Array.from({ length: 16 }, (_, index) => get(index))
    const multiply = (a: number[], b: number[]): number[] => {
        const out = new Array(16).fill(0)
        for (let col = 0; col < 4; col += 1) {
            for (let row = 0; row < 4; row += 1) {
                out[col * 4 + row] =
                    a[0 * 4 + row] * b[col * 4 + 0]
                    + a[1 * 4 + row] * b[col * 4 + 1]
                    + a[2 * 4 + row] * b[col * 4 + 2]
                    + a[3 * 4 + row] * b[col * 4 + 3]
            }
        }
        return out
    }
    return multiply(multiply(transform, source), inverse) as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]
}

export const transformJumpxScale = (value: [number, number, number] | undefined): [number, number, number] => {
    const x = Number(value?.[0] ?? 1)
    const y = Number(value?.[1] ?? 1)
    const z = Number(value?.[2] ?? 1)
    return [
        Number.isFinite(y) ? Math.abs(y) : 1,
        Number.isFinite(x) ? Math.abs(x) : 1,
        Number.isFinite(z) ? Math.abs(z) : 1,
    ]
}

const transformMatrix = mat3.fromValues(
    0, 1, 0,
    -1, 0, 0,
    0, 0, 1,
)
const inverseTransformMatrix = mat3.transpose(mat3.create(), transformMatrix)

export const transformJumpxQuat = (value: [number, number, number, number] | undefined): [number, number, number, number] => {
    const source = quat.fromValues(
        Number(value?.[0] ?? 0),
        Number(value?.[1] ?? 0),
        Number(value?.[2] ?? 0),
        Number(value?.[3] ?? 1),
    )
    if (quat.length(source) <= 0) {
        return [0, 0, 0, 1]
    }
    quat.normalize(source, source)

    const rotationMatrix4 = mat4.fromQuat(mat4.create(), source)
    const rotationMatrix = mat3.fromMat4(mat3.create(), rotationMatrix4)
    const transformed = mat3.create()
    mat3.multiply(transformed, transformMatrix, rotationMatrix)
    mat3.multiply(transformed, transformed, inverseTransformMatrix)

    const transformedMatrix4 = mat4.fromValues(
        transformed[0], transformed[1], transformed[2], 0,
        transformed[3], transformed[4], transformed[5], 0,
        transformed[6], transformed[7], transformed[8], 0,
        0, 0, 0, 1,
    )
    const result = quat.fromMat3(quat.create(), mat3.fromMat4(mat3.create(), transformedMatrix4))
    if (quat.length(result) <= 0) {
        return [0, 0, 0, 1]
    }
    quat.normalize(result, result)
    return [result[0], result[1], result[2], result[3]]
}

export const transformJumpxFlatVec3Array = (values: ArrayLike<number>): Float32Array => {
    const out = new Float32Array(values.length)
    for (let index = 0; index + 2 < values.length; index += 3) {
        const transformed = transformJumpxVec3([
            Number(values[index]),
            Number(values[index + 1]),
            Number(values[index + 2]),
        ])
        out[index] = transformed[0]
        out[index + 1] = transformed[1]
        out[index + 2] = transformed[2]
    }
    return out
}

export const rotateFlatVec3ArrayAroundX = (
    values: ArrayLike<number>,
    radians: number,
    pivot: [number, number, number] = [0, 0, 0],
): Float32Array => {
    const out = new Float32Array(values.length)
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    for (let index = 0; index + 2 < values.length; index += 3) {
        const x = Number(values[index])
        const y = Number(values[index + 1])
        const z = Number(values[index + 2])
        const localY = (Number.isFinite(y) ? y : 0) - pivot[1]
        const localZ = (Number.isFinite(z) ? z : 0) - pivot[2]
        out[index] = Number.isFinite(x) ? x : 0
        out[index + 1] = pivot[1] + localY * cos - localZ * sin
        out[index + 2] = pivot[2] + localY * sin + localZ * cos
    }
    return out
}

export const scaleJumpxFlatVec3ArrayAroundPivot = (
    values: ArrayLike<number>,
    pivot: [number, number, number],
    scale: [number, number, number],
): Float32Array => {
    const out = new Float32Array(values.length)
    for (let index = 0; index + 2 < values.length; index += 3) {
        out[index] = pivot[0] + (Number(values[index]) - pivot[0]) * scale[0]
        out[index + 1] = pivot[1] + (Number(values[index + 1]) - pivot[1]) * scale[1]
        out[index + 2] = pivot[2] + (Number(values[index + 2]) - pivot[2]) * scale[2]
    }
    return out
}

export const transformJumpxExtents = (
    min: [number, number, number],
    max: [number, number, number],
): { min: [number, number, number]; max: [number, number, number] } => {
    const corners: Array<[number, number, number]> = [
        [min[0], min[1], min[2]],
        [min[0], min[1], max[2]],
        [min[0], max[1], min[2]],
        [min[0], max[1], max[2]],
        [max[0], min[1], min[2]],
        [max[0], min[1], max[2]],
        [max[0], max[1], min[2]],
        [max[0], max[1], max[2]],
    ]
    const nextMin: [number, number, number] = [Infinity, Infinity, Infinity]
    const nextMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const corner of corners) {
        const transformed = transformJumpxVec3(corner)
        for (let axis = 0; axis < 3; axis += 1) {
            nextMin[axis] = Math.min(nextMin[axis], transformed[axis])
            nextMax[axis] = Math.max(nextMax[axis], transformed[axis])
        }
    }
    return { min: nextMin, max: nextMax }
}

export const rotateExtentsAroundX = (
    min: [number, number, number],
    max: [number, number, number],
    radians: number,
    pivot: [number, number, number] = [0, 0, 0],
): { min: [number, number, number]; max: [number, number, number] } => {
    const corners: Array<[number, number, number]> = [
        [min[0], min[1], min[2]],
        [min[0], min[1], max[2]],
        [min[0], max[1], min[2]],
        [min[0], max[1], max[2]],
        [max[0], min[1], min[2]],
        [max[0], min[1], max[2]],
        [max[0], max[1], min[2]],
        [max[0], max[1], max[2]],
    ]
    const rotated = rotateFlatVec3ArrayAroundX(corners.flat(), radians, pivot)
    const nextMin: [number, number, number] = [Infinity, Infinity, Infinity]
    const nextMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index + 2 < rotated.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
            const value = rotated[index + axis]
            nextMin[axis] = Math.min(nextMin[axis], value)
            nextMax[axis] = Math.max(nextMax[axis], value)
        }
    }
    return { min: nextMin, max: nextMax }
}
