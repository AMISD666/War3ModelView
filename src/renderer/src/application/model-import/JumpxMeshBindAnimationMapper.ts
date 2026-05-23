import { quat } from 'gl-matrix'
import type { JumpxBoneDto, JumpxGeometryDto } from '../../types/jumpxImport'
import { transformJumpxMat4, transformJumpxQuat, transformJumpxVec3 } from './JumpxCoordinateTransform'

type War3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

type MeshBindFrame = {
    frame: number
    translation?: [number, number, number]
    rotation?: [number, number, number, number]
    scaling?: [number, number, number]
}

const SCALE_EPSILON = 1e-5
const JUMPX_TRACK_LINE_TYPE_LINEAR = 1
const IDENTITY_MAT4: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number] = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]

const makeTrack = (keys: Array<{ frame: number; vector: Float32Array }>): War3Track | null => {
    const sorted = keys
        .filter((key) => Number.isFinite(key.frame))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length === 0) {
        return null
    }
    return {
        LineType: JUMPX_TRACK_LINE_TYPE_LINEAR,
        InterpolationType: JUMPX_TRACK_LINE_TYPE_LINEAR,
        GlobalSeqId: null,
        Keys: sorted.map((key) => ({ Frame: key.frame, Vector: key.vector })),
    }
}

const normalizedQuat = (value: [number, number, number, number] | undefined): quat => {
    const transformed = transformJumpxQuat(value)
    const result = quat.fromValues(
        transformed[0],
        transformed[1],
        transformed[2],
        transformed[3],
    )
    if (quat.length(result) <= 0) {
        quat.identity(result)
    } else {
        quat.normalize(result, result)
    }
    return result
}

const multiplyMat4 = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => {
    const out = new Array<number>(16).fill(0)
    for (let col = 0; col < 4; col += 1) {
        for (let row = 0; row < 4; row += 1) {
            out[col * 4 + row] =
                Number(a[0 * 4 + row]) * Number(b[col * 4 + 0])
                + Number(a[1 * 4 + row]) * Number(b[col * 4 + 1])
                + Number(a[2 * 4 + row]) * Number(b[col * 4 + 2])
                + Number(a[3 * 4 + row]) * Number(b[col * 4 + 3])
        }
    }
    return out
}

const quatToMat4 = (value: quat): number[] => {
    const x = value[0]
    const y = value[1]
    const z = value[2]
    const w = value[3]
    const x2 = x + x
    const y2 = y + y
    const z2 = z + z
    const xx = x * x2
    const xy = x * y2
    const xz = x * z2
    const yy = y * y2
    const yz = y * z2
    const zz = z * z2
    const wx = w * x2
    const wy = w * y2
    const wz = w * z2
    return [
        1 - yy - zz, xy + wz, xz - wy, 0,
        xy - wz, 1 - xx - zz, yz + wx, 0,
        xz + wy, yz - wx, 1 - xx - yy, 0,
        0, 0, 0, 1,
    ]
}

const composeTrsMat4 = (
    translation: [number, number, number],
    rotation: quat,
    scale: [number, number, number],
): number[] => {
    const out = quatToMat4(rotation)
    out[0] *= scale[0]
    out[1] *= scale[0]
    out[2] *= scale[0]
    out[4] *= scale[1]
    out[5] *= scale[1]
    out[6] *= scale[1]
    out[8] *= scale[2]
    out[9] *= scale[2]
    out[10] *= scale[2]
    out[12] = translation[0]
    out[13] = translation[1]
    out[14] = translation[2]
    return out
}

const decomposeTrsMat4 = (matrix: ArrayLike<number>): { translation: [number, number, number]; rotation: quat; scaling: [number, number, number] } => {
    const translation: [number, number, number] = [
        Number(matrix[12]) || 0,
        Number(matrix[13]) || 0,
        Number(matrix[14]) || 0,
    ]
    const scaling: [number, number, number] = [
        Math.hypot(Number(matrix[0]) || 0, Number(matrix[1]) || 0, Number(matrix[2]) || 0) || 1,
        Math.hypot(Number(matrix[4]) || 0, Number(matrix[5]) || 0, Number(matrix[6]) || 0) || 1,
        Math.hypot(Number(matrix[8]) || 0, Number(matrix[9]) || 0, Number(matrix[10]) || 0) || 1,
    ]
    const m00 = Number(matrix[0]) / scaling[0]
    const m01 = Number(matrix[4]) / scaling[1]
    const m02 = Number(matrix[8]) / scaling[2]
    const m10 = Number(matrix[1]) / scaling[0]
    const m11 = Number(matrix[5]) / scaling[1]
    const m12 = Number(matrix[9]) / scaling[2]
    const m20 = Number(matrix[2]) / scaling[0]
    const m21 = Number(matrix[6]) / scaling[1]
    const m22 = Number(matrix[10]) / scaling[2]
    const trace = m00 + m11 + m22
    let result: quat
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2
        result = quat.fromValues((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s)
    } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2
        result = quat.fromValues(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2
        result = quat.fromValues((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    } else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2
        result = quat.fromValues((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
    }
    if (quat.length(result) <= 0) {
        quat.identity(result)
    } else {
        quat.normalize(result, result)
    }
    return { translation, rotation: result, scaling }
}

const collectMeshBindFrames = (
    bone: JumpxBoneDto,
    keyFrame: (key: { frame: number; timeMs?: number }) => number,
): MeshBindFrame[] => {
    const allFrames = new Map<number, MeshBindFrame>()
    const ensureFrame = (frame: number) => {
        let item = allFrames.get(frame)
        if (!item) {
            item = { frame }
            allFrames.set(frame, item)
        }
        return item
    }
    for (const key of bone.positionKeys) {
        ensureFrame(keyFrame(key)).translation = key.value
    }
    for (const key of bone.rotationKeys) {
        ensureFrame(keyFrame(key)).rotation = key.value
    }
    for (const key of bone.scaleKeys) {
        ensureFrame(keyFrame(key)).scaling = key.value
    }
    return Array.from(allFrames.values()).sort((a, b) => a.frame - b.frame)
}

export const buildMeshBindNodeBoneIds = (geometries: JumpxGeometryDto[]): Set<number> => {
    const result = new Set<number>()
    for (const geometry of geometries) {
        if (!Array.isArray(geometry.inverseBindMatrix) || geometry.inverseBindMatrix.length !== 16) {
            continue
        }
        const stride = Math.max(0, Math.floor(geometry.skinWeightStride || 0))
        const vertexCount = Math.max(0, Math.floor(geometry.vertexCount || geometry.skinWeightCounts.length || 0))
        if (stride <= 0 || geometry.skinWeightCounts.length < vertexCount || geometry.skinBoneIds.length < vertexCount * stride) {
            continue
        }
        let hasMultiBoneVertex = false
        const usedBoneIds = new Set<number>()
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
            const count = Math.min(stride, Math.max(0, Math.floor(geometry.skinWeightCounts[vertexIndex] ?? 0)))
            let usableCount = 0
            for (let weightIndex = 0; weightIndex < count; weightIndex += 1) {
                const sourceIndex = vertexIndex * stride + weightIndex
                const weight = Number(geometry.skinWeights[sourceIndex] ?? 0)
                const boneId = Number(geometry.skinBoneIds[sourceIndex])
                if (Number.isFinite(boneId) && weight > SCALE_EPSILON) {
                    usedBoneIds.add(boneId)
                    usableCount += 1
                }
            }
            if (usableCount > 1) {
                hasMultiBoneVertex = true
            }
        }
        if (hasMultiBoneVertex) {
            for (const boneId of usedBoneIds) {
                result.add(boneId)
            }
        }
    }
    return result
}

export const mapMeshBindTracks = (
    bone: JumpxBoneDto,
    keyFrame: (key: { frame: number; timeMs?: number }) => number,
    mapScaleKey: (value: [number, number, number] | undefined) => [number, number, number],
): { translation: War3Track | null; rotation: War3Track | null; scaling: War3Track | null } => {
    const inverseBindMatrix = Array.isArray(bone.inverseBindMatrix) && bone.inverseBindMatrix.length === 16
        ? transformJumpxMat4(bone.inverseBindMatrix)
        : IDENTITY_MAT4
    const translationKeys: Array<{ frame: number; vector: Float32Array }> = []
    const rotationKeys: Array<{ frame: number; vector: Float32Array }> = []
    const scalingKeys: Array<{ frame: number; vector: Float32Array }> = []
    let previousRotation: quat | null = null
    for (const item of collectMeshBindFrames(bone, keyFrame)) {
        const translation = transformJumpxVec3(item.translation ?? bone.worldTranslation)
        const rotation = normalizedQuat(item.rotation)
        const scaling = mapScaleKey(item.scaling)
        const finalMatrix = multiplyMat4(composeTrsMat4(translation, rotation, scaling), inverseBindMatrix)
        const decomposed = decomposeTrsMat4(finalMatrix)
        if (previousRotation && quat.dot(previousRotation, decomposed.rotation) < 0) {
            quat.scale(decomposed.rotation, decomposed.rotation, -1)
        }
        previousRotation = quat.clone(decomposed.rotation)
        translationKeys.push({ frame: item.frame, vector: new Float32Array(decomposed.translation) })
        rotationKeys.push({ frame: item.frame, vector: new Float32Array([decomposed.rotation[0], decomposed.rotation[1], decomposed.rotation[2], decomposed.rotation[3]]) })
        scalingKeys.push({ frame: item.frame, vector: new Float32Array(decomposed.scaling) })
    }
    return {
        translation: makeTrack(translationKeys),
        rotation: makeTrack(rotationKeys),
        scaling: makeTrack(scalingKeys),
    }
}
