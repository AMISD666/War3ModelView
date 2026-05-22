import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { generateMDX, parseMDX } from '../vendor/war3-model/dist/war3-model.cjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_268_s04_2_01_skin2.x')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-jumpx-tx268-check-'))
const bundlePath = path.join(distPath, 'jumpx-tx268-check-bundle.mjs')
const verbose = process.env.JUMPX_TX268_VERBOSE === '1'

const JUMPX_FILE_HEAD = Buffer.from([
    ...Buffer.from('JUMPX V5.01     WWW.JUMPW.COM   ', 'ascii'),
    0xb4, 0xac, 0xb3, 0xa4, 0x20, 0x20, 0xb0, 0xd1, 0xba, 0xda, 0xb6, 0xb4,
    0xd7, 0xb0, 0xd4, 0xda, 0xc6, 0xbf, 0xd7, 0xd3, 0xc0, 0xef, 0xb5, 0xc4,
    0xc8, 0xcb,
    ...Buffer.from('!WEIBO.COM/WUYAXIT', 'ascii'),
    0, 0, 0, 0,
])

const fail = (message) => {
    throw new Error(message)
}

const close = (actual, expected, epsilon, label) => {
    if (Math.abs(actual - expected) > epsilon) {
        fail(`${label} mismatch: ${actual} vs ${expected}`)
    }
}

const vectorClose = (actual, expected, epsilon, label) => {
    if (actual.length !== expected.length) {
        fail(`${label} length mismatch: ${actual.length} vs ${expected.length}`)
    }
    actual.forEach((value, index) => close(value, expected[index], epsilon, `${label}[${index}]`))
}

const normalize = (vector) => {
    const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0)
    if (length <= 1e-8) return [0, 0, 0]
    return vector.map((value) => value / length)
}

const transformJumpxVec3 = ([x, y, z]) => [-y, x, z]

const quatToMat3 = ([x, y, z, w]) => {
    const x2 = x + x
    const y2 = y + y
    const z2 = z + z
    const xx = x * x2
    const yx = y * x2
    const yy = y * y2
    const zx = z * x2
    const zy = z * y2
    const zz = z * z2
    const wx = w * x2
    const wy = w * y2
    const wz = w * z2
    return [
        1 - yy - zz, yx + wz, zx - wy,
        yx - wz, 1 - xx - zz, zy + wx,
        zx + wy, zy - wx, 1 - xx - yy,
    ]
}

const rotateLocalZ = (quat) => {
    const matrix = quatToMat3(quat)
    return normalize([matrix[6], matrix[7], matrix[8]])
}

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)

const normalizeQuat = (value) => {
    const x = Number(value?.[0] ?? 0)
    const y = Number(value?.[1] ?? 0)
    const z = Number(value?.[2] ?? 0)
    const w = Number(value?.[3] ?? 1)
    const length = Math.hypot(x, y, z, w)
    if (!Number.isFinite(length) || length <= 1e-8) return [0, 0, 0, 1]
    return [x / length, y / length, z / length, w / length]
}

const quatMultiply = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]

const quatInvert = (value) => {
    const quat = normalizeQuat(value)
    return [-quat[0], -quat[1], -quat[2], quat[3]]
}

const quatStepAngleDegrees = (left, right) => {
    const a = normalizeQuat(left)
    let b = normalizeQuat(right)
    if (dot(a, b) < 0) {
        b = b.map((value) => -value)
    }
    const delta = normalizeQuat(quatMultiply(quatInvert(a), b))
    return 2 * Math.acos(Math.min(1, Math.abs(delta[3]))) * 180 / Math.PI
}

const cumulativeQuatAngleDegrees = (values) => {
    let sum = 0
    for (let index = 1; index < values.length; index += 1) {
        sum += quatStepAngleDegrees(values[index - 1], values[index])
    }
    return sum
}

const transformJumpxQuatForCheck = (value) => {
    const [x, y, z, w] = normalizeQuat(value)
    const xx = x * x
    const yy = y * y
    const zz = z * z
    const xy = x * y
    const xz = x * z
    const yz = y * z
    const wx = w * x
    const wy = w * y
    const wz = w * z
    const source = [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
    ]
    const transform = [
        0, 1, 0,
        -1, 0, 0,
        0, 0, 1,
    ]
    const inverse = [
        0, -1, 0,
        1, 0, 0,
        0, 0, 1,
    ]
    const multiplyMat3 = (a, b) => {
        const out = new Array(9)
        for (let col = 0; col < 3; col += 1) {
            for (let row = 0; row < 3; row += 1) {
                out[col * 3 + row] =
                    a[0 * 3 + row] * b[col * 3 + 0]
                    + a[1 * 3 + row] * b[col * 3 + 1]
                    + a[2 * 3 + row] * b[col * 3 + 2]
            }
        }
        return out
    }
    const transformed = multiplyMat3(multiplyMat3(transform, source), inverse)
    const trace = transformed[0] + transformed[4] + transformed[8]
    let result
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2
        result = [
            (transformed[5] - transformed[7]) / s,
            (transformed[6] - transformed[2]) / s,
            (transformed[1] - transformed[3]) / s,
            0.25 * s,
        ]
    } else if (transformed[0] > transformed[4] && transformed[0] > transformed[8]) {
        const s = Math.sqrt(1 + transformed[0] - transformed[4] - transformed[8]) * 2
        result = [
            0.25 * s,
            (transformed[1] + transformed[3]) / s,
            (transformed[6] + transformed[2]) / s,
            (transformed[5] - transformed[7]) / s,
        ]
    } else if (transformed[4] > transformed[8]) {
        const s = Math.sqrt(1 + transformed[4] - transformed[0] - transformed[8]) * 2
        result = [
            (transformed[1] + transformed[3]) / s,
            0.25 * s,
            (transformed[5] + transformed[7]) / s,
            (transformed[6] - transformed[2]) / s,
        ]
    } else {
        const s = Math.sqrt(1 + transformed[8] - transformed[0] - transformed[4]) * 2
        result = [
            (transformed[6] + transformed[2]) / s,
            (transformed[5] + transformed[7]) / s,
            0.25 * s,
            (transformed[1] - transformed[3]) / s,
        ]
    }
    return normalizeQuat(result)
}

const transformedSourceRelativeRotationValues = (bone) => {
    const sourceValues = bone.rotationKeys.map((key) => transformJumpxQuatForCheck(key.value))
    if (sourceValues.length === 0) return []
    const baseInverse = quatInvert(sourceValues[0])
    const relativeValues = sourceValues.map((value) => normalizeQuat(quatMultiply(baseInverse, value)))
    for (let index = 1; index < relativeValues.length; index += 1) {
        if (dot(relativeValues[index - 1], relativeValues[index]) < 0) {
            relativeValues[index] = relativeValues[index].map((value) => -value)
        }
    }
    return relativeValues
}

const readCString = (buffer, offset) => {
    let end = offset
    while (end < buffer.length && buffer[end] !== 0) end += 1
    return buffer.toString('utf8', offset, end)
}

const readFixedString = (buffer, offset, length) => {
    let end = offset
    const limit = offset + length
    while (end < limit && buffer[end] !== 0) end += 1
    return buffer.toString('utf8', offset, end)
}

const decryptOffset = (addr) => {
    if (addr < 1_000_000_000) fail(`Invalid JumpX encrypted data offset ${addr}`)
    return addr - 1_000_000_000
}

const readJumpxContainer = () => {
    const bytes = fs.readFileSync(fixturePath)
    if (!bytes.subarray(0, JUMPX_FILE_HEAD.length).equals(JUMPX_FILE_HEAD)) {
        fail('Invalid JumpX fixture header')
    }

    let offset = JUMPX_FILE_HEAD.length
    const version = bytes.readInt32LE(offset)
    offset += 4
    const headerTableBytes = bytes.readUInt32LE(offset)
    offset += 4
    const dir = new Map()
    for (let index = 0; index < headerTableBytes / 12; index += 1) {
        const tag = bytes.toString('ascii', offset, offset + 4)
        const valueSize = bytes.readUInt32LE(offset + 4)
        const value = bytes.readUInt32LE(offset + 8)
        offset += 12
        if (valueSize !== 4) fail(`Unexpected JumpX directory value size for ${tag}`)
        dir.set(tag, value)
    }

    const headSize = bytes.readUInt32LE(offset)
    const dataSize = bytes.readUInt32LE(offset + 4)
    const headCompressedSize = bytes.readUInt32LE(offset + 8)
    const dataCompressedSize = bytes.readUInt32LE(offset + 12)
    offset += 16
    const head = zlib.inflateSync(bytes.subarray(offset, offset + headCompressedSize))
    offset += headCompressedSize
    const data = zlib.inflateSync(bytes.subarray(offset, offset + dataCompressedSize))
    if (head.length !== headSize || data.length !== dataSize) {
        fail(`JumpX inflated size mismatch: head=${head.length}/${headSize}, data=${data.length}/${dataSize}`)
    }
    return { version, dir, head, data }
}

const readVisibilityKeys = (data, addr, count) => {
    if (!addr || count <= 0) return []
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => {
        const frame = 320 + index
        return {
            frame,
            timeMs: frame * 1000 / 30,
            value: data.readUInt32LE(offset + index * 4) > 0 ? 1 : 0,
            rawFlags: 0,
        }
    })
}

const readVec3Keys = (data, addr, count) => {
    if (!addr || count <= 0) return []
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => {
        const frame = 320 + index
        return {
            frame,
            timeMs: frame * 1000 / 30,
            value: [
                data.readFloatLE(offset + index * 12),
                data.readFloatLE(offset + index * 12 + 4),
                data.readFloatLE(offset + index * 12 + 8),
            ],
            rawFlags: 0,
        }
    })
}

const readQuatKeys = (data, addr, count) => {
    if (!addr || count <= 0) return []
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => {
        const frame = 320 + index
        return {
            frame,
            timeMs: frame * 1000 / 30,
            value: [
                data.readFloatLE(offset + index * 16),
                data.readFloatLE(offset + index * 16 + 4),
                data.readFloatLE(offset + index * 16 + 8),
                data.readFloatLE(offset + index * 16 + 12),
            ],
            rawFlags: 0,
        }
    })
}

const readMaterialSampleTracks = (data, addr, count) => {
    if (!addr || count <= 0) return { alphaKeys: [], colorKeys: [], uvOffsetKeys: [], blendKeys: [] }
    const offset = decryptOffset(addr)
    const alphaKeys = []
    const colorKeys = []
    const uvOffsetKeys = []
    const blendKeys = []
    for (let index = 0; index < count; index += 1) {
        const frame = 320 + index
        const timeMs = frame * 1000 / 30
        const sampleOffset = offset + index * 16
        const colorSample = data.readUInt32LE(sampleOffset)
        alphaKeys.push({ frame, timeMs, value: ((colorSample >>> 24) & 0xff) / 255, rawFlags: 1 })
        colorKeys.push({
            frame,
            timeMs,
            value: [
                (colorSample & 0xff) / 255,
                ((colorSample >>> 8) & 0xff) / 255,
                ((colorSample >>> 16) & 0xff) / 255,
            ],
            rawFlags: 1,
        })
        uvOffsetKeys.push({
            frame,
            timeMs,
            value: [data.readFloatLE(sampleOffset + 4), data.readFloatLE(sampleOffset + 8), 0],
            rawFlags: 1,
        })
        blendKeys.push({ frame, timeMs, value: data.readUInt32LE(sampleOffset + 12), rawFlags: 1 })
    }
    return { alphaKeys, colorKeys, uvOffsetKeys, blendKeys }
}

const readFloatArray = (data, addr, count) => {
    if (!addr || count <= 0) return []
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => data.readFloatLE(offset + index * 4))
}

const readUint16Array = (data, addr, count) => {
    if (!addr || count <= 0) return []
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => data.readUInt16LE(offset + index * 2))
}

const identityMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const invertAffine = (matrix) => {
    const a00 = matrix[0]
    const a01 = matrix[1]
    const a02 = matrix[2]
    const a10 = matrix[4]
    const a11 = matrix[5]
    const a12 = matrix[6]
    const a20 = matrix[8]
    const a21 = matrix[9]
    const a22 = matrix[10]
    const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20)
    if (Math.abs(det) <= 1e-8) return identityMatrix()
    const invDet = 1 / det
    const out = new Array(16).fill(0)
    out[0] = (a11 * a22 - a12 * a21) * invDet
    out[1] = (a12 * a20 - a10 * a22) * invDet
    out[2] = (a10 * a21 - a11 * a20) * invDet
    out[4] = (a02 * a21 - a01 * a22) * invDet
    out[5] = (a00 * a22 - a02 * a20) * invDet
    out[6] = (a01 * a20 - a00 * a21) * invDet
    out[8] = (a01 * a12 - a02 * a11) * invDet
    out[9] = (a02 * a10 - a00 * a12) * invDet
    out[10] = (a00 * a11 - a01 * a10) * invDet
    out[15] = 1
    const tx = matrix[12]
    const ty = matrix[13]
    const tz = matrix[14]
    out[12] = -(tx * out[0] + ty * out[4] + tz * out[8])
    out[13] = -(tx * out[1] + ty * out[5] + tz * out[9])
    out[14] = -(tx * out[2] + ty * out[6] + tz * out[10])
    return out
}

const matrixAxisScales = (matrix) => [
    Math.hypot(matrix[0], matrix[1], matrix[2]),
    Math.hypot(matrix[4], matrix[5], matrix[6]),
    Math.hypot(matrix[8], matrix[9], matrix[10]),
]

const computeBounds = (vertices) => {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index + 2 < vertices.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], vertices[index + axis])
            max[axis] = Math.max(max[axis], vertices[index + axis])
        }
    }
    return { min, max }
}

const computeRadius = (min, max) => Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2

const readAncestorTransform = (head, dir, boneIndex) => {
    if (boneIndex < 0 || boneIndex >= (dir.get('nbon') ?? 0)) {
        return { pivot: [0, 0, 0], scale: [1, 1, 1] }
    }
    const offset = (dir.get('abon') ?? 0) + boneIndex * 0xac
    const inverseMatrix = Array.from({ length: 16 }, (_, index) => head.readFloatLE(offset + 24 + index * 4))
    const bindMatrix = invertAffine(inverseMatrix)
    return {
        pivot: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
        scale: matrixAxisScales(inverseMatrix),
    }
}

const buildScene = () => {
    const { version, dir, head, data } = readJumpxContainer()
    const textures = []
    for (let index = 0; index < (dir.get('ntex') ?? 0); index += 1) {
        const offset = (dir.get('atex') ?? 0) + index * 8
        const name = readCString(head, head.readUInt32LE(offset + 4))
        textures.push({ textureIndex: index, name, path: name, rawFlags: 0, saveFlags: 0 })
    }

    const materials = []
    for (let index = 0; index < (dir.get('nmtl') ?? 0); index += 1) {
        const offset = (dir.get('amtl') ?? 0) + index * 0x30
        const tracks = readMaterialSampleTracks(data, head.readUInt32LE(offset + 44), head.readUInt32LE(offset + 40))
        materials.push({
            materialIndex: index,
            name: `JumpX_Material_${index}`,
            textureId: head.readInt32LE(offset + 12),
            rawFlags: head.readUInt32LE(offset + 8),
            saveFlags: head.readUInt32LE(offset + 4),
            sampleCount: head.readUInt32LE(offset + 40),
            ...tracks,
            uvSpeed: [head.readFloatLE(offset + 32), head.readFloatLE(offset + 36)],
        })
    }

    const bones = []
    for (let index = 0; index < (dir.get('nbon') ?? 0); index += 1) {
        const offset = (dir.get('abon') ?? 0) + index * 0xac
        const inverseMatrix = Array.from({ length: 16 }, (_, matrixIndex) => head.readFloatLE(offset + 24 + matrixIndex * 4))
        const bindMatrix = invertAffine(inverseMatrix)
        bones.push({
            boneIndex: index,
            name: readCString(head, head.readUInt32LE(offset + 8)),
            parentId: head.readInt32LE(offset + 12),
            worldTranslation: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
            rawFlags: head.readInt32LE(offset + 16) > 0 ? 1 : 0,
            saveFlags: head.readUInt32LE(offset + 4),
            positionKeys: readVec3Keys(data, head.readUInt32LE(offset + 144), Math.max(0, head.readInt32LE(offset + 140))),
            rotationKeys: readQuatKeys(data, head.readUInt32LE(offset + 156), Math.max(0, head.readInt32LE(offset + 152))),
            scaleKeys: readVec3Keys(data, head.readUInt32LE(offset + 168), Math.max(0, head.readInt32LE(offset + 164))),
            visibilityKeys: readVisibilityKeys(data, head.readUInt32LE(offset + 136), Math.max(0, head.readInt32LE(offset + 132))),
        })
    }

    const geometries = []
    for (let index = 0; index < (dir.get('ngeo') ?? 0); index += 1) {
        const offset = (dir.get('ageo') ?? 0) + index * 0x7c
        const vertexCount = Math.max(0, head.readInt32LE(offset + 28))
        const faceCount = Math.max(0, head.readInt32LE(offset + 32))
        const vertices = readFloatArray(data, head.readUInt32LE(offset + 36), vertexCount * 3)
        const normals = readFloatArray(data, head.readUInt32LE(offset + 44), vertexCount * 3)
        const uvs = readFloatArray(data, head.readUInt32LE(offset + 52), vertexCount * 2)
        const indices = readUint16Array(data, head.readUInt32LE(offset + 76), faceCount * 3)
        const ancestorBoneId = head.readInt32LE(offset + 88)
        const transform = readAncestorTransform(head, dir, ancestorBoneId)
        const bounds = computeBounds(vertices)
        const inverseBindMatrix = ancestorBoneId >= 0 && ancestorBoneId < (dir.get('nbon') ?? 0)
            ? Array.from({ length: 16 }, (_, matrixIndex) => head.readFloatLE((dir.get('abon') ?? 0) + ancestorBoneId * 0xac + 24 + matrixIndex * 4))
            : undefined
        geometries.push({
            geometryIndex: index,
            name: readCString(head, head.readUInt32LE(offset + 8)),
            materialId: head.readInt32LE(offset + 16),
            geometryType: head.readUInt32LE(offset + 20),
            ancestorBoneId,
            vertexCount,
            indexCount: indices.length,
            vertices,
            normals,
            uvs,
            indices,
            skinWeightStride: 4,
            skinWeightCounts: Array.from({ length: vertexCount }, () => 1),
            skinBoneIds: Array.from({ length: vertexCount * 4 }, (_, weightIndex) => weightIndex % 4 === 0 ? ancestorBoneId : 0),
            skinWeights: Array.from({ length: vertexCount * 4 }, (_, weightIndex) => weightIndex % 4 === 0 ? 1 : 0),
            minimumExtent: bounds.min,
            maximumExtent: bounds.max,
            boundsRadius: computeRadius(bounds.min, bounds.max) * Math.max(...transform.scale),
            objectPivot: transform.pivot,
            objectScale: transform.scale,
            inverseBindMatrix,
            rawFlags: head.readUInt32LE(offset + 24) | head.readUInt32LE(offset + 20),
            saveFlags: head.readUInt32LE(offset + 4),
        })
    }

    const particles = []
    const particleStride = version >= 8 ? 0x42c : 0x418
    for (let index = 0; index < (dir.get('nprt') ?? 0); index += 1) {
        const offset = (dir.get('aprt') ?? 0) + index * particleStride
        const parentBoneId = head.readInt32LE(offset + 88)
        const parentVisibility = bones[parentBoneId]?.visibilityKeys ?? []
        const emissionRate = head.readFloatLE(offset + 128)
        particles.push({
            particleIndex: index,
            name: readFixedString(head, offset + 8, 80),
            parentBoneId,
            pivot: [head.readFloatLE(offset + 92), head.readFloatLE(offset + 96), head.readFloatLE(offset + 100)],
            textureId: head.readInt32LE(offset + 276),
            rawFlags: head.readUInt32LE(offset + 4),
            saveFlags: 0,
            rawDataAddr: head.readUInt32LE(offset),
            particleFlags: head.readUInt32LE(offset + 4),
            blendMode: head.readUInt32LE(offset + 140),
            partFlags: head.readUInt32LE(offset + 152),
            emissionRate,
            speed: head.readFloatLE(offset + 108),
            speedVariation: head.readFloatLE(offset + 112),
            coneAngle: head.readFloatLE(offset + 116),
            gravity: head.readFloatLE(offset + 120),
            gravityX: version >= 8 ? head.readFloatLE(offset + 0x418 + 12) : undefined,
            gravityY: version >= 8 ? head.readFloatLE(offset + 0x418 + 16) : undefined,
            lifeRandom: null,
            lifeSpan: head.readFloatLE(offset + 124),
            width: head.readFloatLE(offset + 132),
            height: head.readFloatLE(offset + 136),
            rows: head.readInt32LE(offset + 144),
            columns: head.readInt32LE(offset + 148),
            priorityPlane: head.readInt32LE(offset + 280),
            startColor: [head.readInt32LE(offset + 164), head.readInt32LE(offset + 168), head.readInt32LE(offset + 172)],
            midColor: [head.readInt32LE(offset + 176), head.readInt32LE(offset + 180), head.readInt32LE(offset + 184)],
            endColor: [head.readInt32LE(offset + 188), head.readInt32LE(offset + 192), head.readInt32LE(offset + 196)],
            alpha: [head.readInt32LE(offset + 200), head.readInt32LE(offset + 204), head.readInt32LE(offset + 208)],
            particleScaling: [head.readFloatLE(offset + 212), head.readFloatLE(offset + 216), head.readFloatLE(offset + 220)],
            middleTime: head.readFloatLE(offset + 160),
            tailLength: head.readFloatLE(offset + 156),
            normal: [head.readFloatLE(offset + 284), head.readFloatLE(offset + 288), head.readFloatLE(offset + 292)],
            xAxis: [head.readFloatLE(offset + 296), head.readFloatLE(offset + 300), head.readFloatLE(offset + 304)],
            yAxis: [head.readFloatLE(offset + 308), head.readFloatLE(offset + 312), head.readFloatLE(offset + 316)],
            rotVec: [head.readFloatLE(offset + 320), head.readFloatLE(offset + 324), head.readFloatLE(offset + 328)],
            rotVel: [head.readFloatLE(offset + 332), head.readFloatLE(offset + 336), head.readFloatLE(offset + 340)],
            lifeSpanHeadUVAnim: [head.readUInt32LE(offset + 228), head.readUInt32LE(offset + 232), head.readUInt32LE(offset + 236)],
            decayHeadUVAnim: [head.readUInt32LE(offset + 240), head.readUInt32LE(offset + 244), head.readUInt32LE(offset + 248)],
            lifeSpanTailUVAnim: [head.readUInt32LE(offset + 252), head.readUInt32LE(offset + 256), head.readUInt32LE(offset + 260)],
            decayTailUVAnim: [head.readUInt32LE(offset + 264), head.readUInt32LE(offset + 268), head.readUInt32LE(offset + 272)],
            emissionRateKeys: parentVisibility.map((key) => ({ ...key, value: key.value > 0 ? emissionRate : 0 })),
            visibilityKeys: parentVisibility,
        })
    }

    return {
        probe: {
            ok: true,
            path: fixturePath,
            fileSize: fs.statSync(fixturePath).size,
            format: 'JumpX',
            version,
            headSize: head.length,
            dataSize: data.length,
            headCompressedSize: 0,
            dataCompressedSize: 0,
            textureCount: textures.length,
            materialCount: materials.length,
            geometryCount: geometries.length,
            boneCount: bones.length,
            boneGroupCount: dir.get('nbgp') ?? 0,
            attachmentCount: dir.get('natt') ?? 0,
            ribbonCount: dir.get('nrib') ?? 0,
            particleCount: particles.length,
            actionCount: dir.get('nact') ?? 0,
            warnings: [],
        },
        textures,
        materials,
        geometries,
        bones,
        boneGroups: [],
        attachments: [],
        ribbons: [],
        particles,
        actions: [],
    }
}

const buildImportBundle = async () => {
    await esbuild.build({
        stdin: {
            contents: [
                "export { buildJumpxStaticModelData } from './src/renderer/src/application/model-import/JumpxModelBuilder.ts'",
                "export { applyJumpxAnimationTracks } from './src/renderer/src/application/model-import/JumpxAnimationMapper.ts'",
                "export { prepareModelDataForSave } from './src/renderer/src/application/model-save/prepareModelDataForSave.ts'",
            ].join('\n'),
            resolveDir: repoRoot,
            sourcefile: 'jumpx-tx268-check-entry.ts',
            loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: bundlePath,
        tsconfig: path.join(repoRoot, 'tsconfig.web.json'),
        logLevel: 'silent',
    })
}

const assertRendererSupportsDontInheritScaling = () => {
    const source = fs.readFileSync(path.join(repoRoot, 'vendor', 'war3-model', 'renderer', 'modelInstance.ts'), 'utf8')
    if (!source.includes('dontInheritScaling && !dontInheritTranslation && !dontInheritRotation')) {
        fail('Renderer must support standalone DontInheritScaling for JumpX parent-scale isolation')
    }
}

const trackSummary = (track) => ({
    count: track?.Keys?.length ?? 0,
    firstFrame: track?.Keys?.[0]?.Frame,
    lastFrame: track?.Keys?.at(-1)?.Frame,
    firstVector: Array.from(track?.Keys?.[0]?.Vector ?? []),
    lastVector: Array.from(track?.Keys?.at(-1)?.Vector ?? []),
})

const assertNoInventedPe2Translation = (emitter) => {
    if (emitter?.Translation !== undefined) {
        fail(`${emitter.Name} should not invent a PE2 Translation track; JumpX particles have static pivot data and inherit motion from their parent bone`)
    }
}

const assertTrackHasEqualCircleAxes = (track, label) => {
    const keys = track?.Keys ?? []
    if (keys.length === 0) fail(`${label} is missing scaling keys`)
    for (const key of keys) {
        const vector = Array.from(key.Vector ?? [])
        const equalPairs = [
            Math.abs((vector[0] ?? 0) - (vector[1] ?? 0)),
            Math.abs((vector[0] ?? 0) - (vector[2] ?? 0)),
            Math.abs((vector[1] ?? 0) - (vector[2] ?? 0)),
        ]
        if (Math.min(...equalPairs) > 1e-5) {
            fail(`${label} scaling key at ${key.Frame} would squash a circular plane into an ellipse: ${JSON.stringify(vector)}`)
        }
    }
}

const assertCirclePlaneScale = (track, label) => {
    const first = Array.from(track?.Keys?.[0]?.Vector ?? [])
    close(first[0], first[1], 1e-6, `${label} first circle-plane XY scale`)
    if ((first[2] ?? 0) <= (first[0] ?? 0)) {
        fail(`${label} first circle-plane normal scale should stay on Z after geometry-driven mapping: ${JSON.stringify(first)}`)
    }
}

const assertRotationTrackMatchesSourceSpeed = (sourceBone, importedBone) => {
    const sourceValues = transformedSourceRelativeRotationValues(sourceBone)
    const importedTrack = importedBone?.Rotation
    const importedValues = (importedTrack?.Keys ?? []).map((key) => Array.from(key.Vector ?? []))
    if (sourceValues.length === 0 || importedValues.length === 0) {
        fail(`${sourceBone.name} is missing rotation data for speed comparison`)
    }
    if (importedTrack.LineType !== 1 || importedTrack.InterpolationType !== 1) {
        fail(`${sourceBone.name} rotation should use Linear/slerp interpolation, got LineType=${importedTrack.LineType} InterpolationType=${importedTrack.InterpolationType}`)
    }
    if (sourceValues.length !== importedValues.length) {
        fail(`${sourceBone.name} rotation key count changed: source=${sourceValues.length} imported=${importedValues.length}`)
    }
    for (let index = 1; index < importedValues.length; index += 1) {
        if (dot(normalizeQuat(importedValues[index - 1]), normalizeQuat(importedValues[index])) < 0) {
            fail(`${sourceBone.name} imported rotation key ${index} flips quaternion sign and can slerp the long way`)
        }
    }
    const sourceAngle = cumulativeQuatAngleDegrees(sourceValues)
    const importedAngle = cumulativeQuatAngleDegrees(importedValues)
    if (verbose) {
        console.log(`${sourceBone.name} rotation cumulative degrees: source=${sourceAngle.toFixed(2)} imported=${importedAngle.toFixed(2)}`)
    }
    close(importedAngle, sourceAngle, 0.75, `${sourceBone.name} cumulative rotation speed`)
    if (importedAngle > 370) {
        fail(`${sourceBone.name} imported cumulative rotation should stay near one turn, got ${importedAngle.toFixed(2)} degrees`)
    }
}

const main = async () => {
    assertRendererSupportsDontInheritScaling()
    const scene = buildScene()
    await buildImportBundle()
    const { buildJumpxStaticModelData, applyJumpxAnimationTracks, prepareModelDataForSave } = await import(pathToFileURL(bundlePath).href)
    const { modelData, nodeMapping } = buildJumpxStaticModelData(fixturePath, scene)
    const mappedKeys = applyJumpxAnimationTracks(scene, modelData, nodeMapping)

    if (scene.particles.length !== 11) fail(`Expected source fixture to contain 11 particles, got ${scene.particles.length}`)
    if ((modelData.ParticleEmitters2 ?? []).length !== 11) fail(`Expected 11 imported PE2 nodes, got ${modelData.ParticleEmitters2?.length}`)
    if ((modelData.Textures ?? []).length < 15) fail(`Expected imported texture slots for all source textures, got ${modelData.Textures?.length}`)
    if ((modelData.Bones ?? []).length !== 12) fail(`Expected 12 imported bones, got ${modelData.Bones?.length}`)
    if (mappedKeys < 12 * 31 * 3) fail(`Expected mapped bone TRS keys for the fixture, got ${mappedKeys}`)
    for (const bone of modelData.Bones ?? []) {
        if (((bone.Flags ?? 0) & 4) === 0) {
            fail(`JumpX imported bone ${bone.Name} must disable inherited parent scaling`)
        }
    }

    const interval = modelData.Sequences?.[0]?.Interval
    if (!interval || interval[0] !== 10667 || interval[1] !== 11667) {
        fail(`Expected sequence interval to cover tx_268 source timeMs 10667..11667, got ${JSON.stringify(interval)}`)
    }

    const firstBone = modelData.Bones?.find((bone) => bone.Name === 'Bone002')
    const sourceFirstBone = scene.bones.find((bone) => bone.name === 'Bone002')
    if (!firstBone) fail('Missing imported Bone002')
    if (!sourceFirstBone) fail('Missing source Bone002')
    const firstBoneScale = trackSummary(firstBone.Scaling)
    if (firstBoneScale.count !== 31 || firstBoneScale.firstFrame !== 10667 || firstBoneScale.lastFrame !== 11667) {
        fail(`Bone002 scaling range is wrong: ${JSON.stringify(firstBoneScale)}`)
    }
    vectorClose(firstBoneScale.firstVector, [sourceFirstBone.scaleKeys[0].value[1], sourceFirstBone.scaleKeys[0].value[0], sourceFirstBone.scaleKeys[0].value[2]], 1e-6, 'Bone002 first absolute scaling')
    vectorClose(firstBoneScale.lastVector, [sourceFirstBone.scaleKeys.at(-1).value[1], sourceFirstBone.scaleKeys.at(-1).value[0], sourceFirstBone.scaleKeys.at(-1).value[2]], 1e-5, 'Bone002 last absolute scaling')
    for (const name of ['Bone005quan268', 'Bone006quan268', 'Bone_waiquan0268', 'Bone_zhongxin268']) {
        const circleBone = modelData.Bones?.find((bone) => bone.Name === name)
        if (!circleBone) fail(`Missing imported circle bone ${name}`)
        assertTrackHasEqualCircleAxes(circleBone.Scaling, name)
    }
    assertCirclePlaneScale(
        modelData.Bones?.find((bone) => bone.Name === 'Bone_waiquan0268')?.Scaling,
        'Bone_waiquan0268',
    )
    assertCirclePlaneScale(
        modelData.Bones?.find((bone) => bone.Name === 'Bone_zhongxin268')?.Scaling,
        'Bone_zhongxin268',
    )
    for (const name of ['Bone2111212123', 'Bone2111212125']) {
        const sourceBone = scene.bones.find((bone) => bone.name === name)
        const importedBone = modelData.Bones?.find((bone) => bone.Name === name)
        if (!sourceBone) fail(`Missing source rotation-speed bone ${name}`)
        if (!importedBone) fail(`Missing imported rotation-speed bone ${name}`)
        assertRotationTrackMatchesSourceSpeed(sourceBone, importedBone)
    }

    const generatedMdx = generateMDX(prepareModelDataForSave(modelData))
    const roundTripBuffer = generatedMdx instanceof ArrayBuffer
        ? generatedMdx
        : generatedMdx.buffer.slice(generatedMdx.byteOffset, generatedMdx.byteOffset + generatedMdx.byteLength)
    const roundTripModel = parseMDX(roundTripBuffer)
    const roundTripBoneScale = trackSummary(roundTripModel.Bones?.find((bone) => bone.Name === 'Bone002')?.Scaling)
    vectorClose(roundTripBoneScale.firstVector, firstBoneScale.firstVector, 1e-6, 'round-trip Bone002 first absolute scaling')
    vectorClose(roundTripBoneScale.lastVector, firstBoneScale.lastVector, 1e-5, 'round-trip Bone002 last absolute scaling')
    if (roundTripBoneScale.firstVector.every((value) => Math.abs(value - 1) < 1e-6)) {
        fail('Round-trip MDX must not force the first JumpX scale key to identity')
    }
    for (const emitter of roundTripModel.ParticleEmitters2 ?? []) {
        assertNoInventedPe2Translation(emitter)
    }

    const firstPe2 = modelData.ParticleEmitters2?.find((emitter) => emitter.Name === 'part_9lizi009')
    const sourceFirstParticle = scene.particles.find((particle) => particle.name === 'part.9lizi009')
    if (!firstPe2) fail('Missing imported part_9lizi009 PE2')
    if (!sourceFirstParticle) fail('Missing source part.9lizi009 particle')
    if (((firstPe2.Flags ?? 0) & 4) === 0) fail('part_9lizi009 must disable inherited parent scaling')
    if (firstPe2.TextureID !== 6) fail(`part_9lizi009 should reference texture slot 6, got ${firstPe2.TextureID}`)
    assertNoInventedPe2Translation(firstPe2)
    close(firstPe2.Speed ?? -1, sourceFirstParticle.speed, 1e-5, 'part_9lizi009 Speed should preserve source JumpX value')
    close(firstPe2.EmissionRate?.Keys?.[2]?.Vector?.[0] ?? -1, 40, 1e-6, 'part_9lizi009 emission sample')
    close(firstPe2.Visibility?.Keys?.[2]?.Vector?.[0] ?? -1, 1, 1e-6, 'part_9lizi009 visibility sample')
    if ((firstPe2.Visibility?.Keys?.length ?? 0) < 3) fail(`part_9lizi009 visibility should keep visible/invisible step boundaries, got ${firstPe2.Visibility?.Keys?.length}`)
    if (firstPe2.Visibility?.Keys?.[0]?.Frame !== 10667 || firstPe2.Visibility?.Keys?.at(-1)?.Frame !== 11667) {
        fail(`part_9lizi009 visibility range is wrong: ${JSON.stringify(trackSummary(firstPe2.Visibility))}`)
    }
    vectorClose(firstPe2.PivotPoint ?? [], transformJumpxVec3(sourceFirstParticle.pivot), 1e-5, 'part_9lizi009 transformed pivot')
    close(firstPe2.TailLength ?? -1, sourceFirstParticle.tailLength, 1e-6, 'part_9lizi009 tail length')
    const importedEmissionDir = rotateLocalZ(Array.from(firstPe2.Rotation?.Keys?.at(-1)?.Vector ?? []))
    const expectedEmissionDir = normalize(transformJumpxVec3(sourceFirstParticle.normal))
    if (dot(importedEmissionDir, expectedEmissionDir) < 0.99) {
        fail(`part_9lizi009 local +Z emission direction must align to transformed JumpX normal: imported=${JSON.stringify(importedEmissionDir)} expected=${JSON.stringify(expectedEmissionDir)}`)
    }

    const staticPe2 = modelData.ParticleEmitters2?.find((emitter) => emitter.Name === 'part_lizi001')
    if (!staticPe2) fail('Missing imported part_lizi001 PE2')
    for (const emitter of modelData.ParticleEmitters2 ?? []) {
        assertNoInventedPe2Translation(emitter)
    }
    const staticTexture = modelData.Textures?.[staticPe2.TextureID]
    if (staticTexture?.Image !== 'tx_dian_0006.blp') {
        fail(`part_lizi001 should reference the deduped tx_dian_0006.blp texture, got ${JSON.stringify(staticTexture)}`)
    }
    if (staticPe2.Visibility !== undefined) fail('part_lizi001 should not invent visibility keys when its parent has no visibility track')

    console.log('JumpX tx_268 fixture mapping check passed')
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
}).finally(() => {
    fs.rmSync(distPath, { recursive: true, force: true })
})
