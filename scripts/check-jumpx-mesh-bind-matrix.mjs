import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { generateMDX, parseMDX } from '../vendor/war3-model/dist/war3-model.cjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_268_s04_5_01_skin2.x')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-jumpx-mesh-bind-'))
const bundlePath = path.join(distPath, 'jumpx-mesh-bind-check-bundle.mjs')
const targetGeosets = [0, 1, 2, 3]
const sampleKeyIndexes = [0, 15, 30, 60]
const RMS_EPSILON = 1e-3

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

const readCString = (buffer, offset) => {
    let end = offset
    while (end < buffer.length && buffer[end] !== 0) end += 1
    return buffer.toString('utf8', offset, end)
}

const decryptOffset = (addr) => {
    if (addr < 1_000_000_000) fail(`Invalid JumpX encrypted data offset ${addr}`)
    return addr - 1_000_000_000
}

const readJumpxContainer = () => {
    const bytes = fs.readFileSync(fixturePath)
    if (!bytes.subarray(0, JUMPX_FILE_HEAD.length).equals(JUMPX_FILE_HEAD)) {
        fail(`Invalid JumpX fixture header for ${fixturePath}`)
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
            value: invertQuat([
                data.readFloatLE(offset + index * 16),
                data.readFloatLE(offset + index * 16 + 4),
                data.readFloatLE(offset + index * 16 + 8),
                data.readFloatLE(offset + index * 16 + 12),
            ]),
            rawFlags: 0,
        }
    })
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

const identityMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const matrixAxisScales = (matrix) => [
    Math.hypot(matrix[0], matrix[1], matrix[2]),
    Math.hypot(matrix[4], matrix[5], matrix[6]),
    Math.hypot(matrix[8], matrix[9], matrix[10]),
]

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
    out[1] = (a02 * a21 - a01 * a22) * invDet
    out[2] = (a01 * a12 - a02 * a11) * invDet
    out[4] = (a12 * a20 - a10 * a22) * invDet
    out[5] = (a00 * a22 - a02 * a20) * invDet
    out[6] = (a02 * a10 - a00 * a12) * invDet
    out[8] = (a10 * a21 - a11 * a20) * invDet
    out[9] = (a01 * a20 - a00 * a21) * invDet
    out[10] = (a00 * a11 - a01 * a10) * invDet
    out[15] = 1
    const tx = matrix[12]
    const ty = matrix[13]
    const tz = matrix[14]
    out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz)
    out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz)
    out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz)
    return out
}

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
        return { pivot: [0, 0, 0], scale: [1, 1, 1], inverseBindMatrix: undefined }
    }
    const offset = (dir.get('abon') ?? 0) + boneIndex * 0xac
    const inverseBindMatrix = Array.from({ length: 16 }, (_, index) => head.readFloatLE(offset + 24 + index * 4))
    const bindMatrix = invertAffine(inverseBindMatrix)
    return {
        pivot: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
        scale: matrixAxisScales(inverseBindMatrix),
        inverseBindMatrix,
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
        const inverseBindMatrix = Array.from({ length: 16 }, (_, matrixIndex) => head.readFloatLE(offset + 24 + matrixIndex * 4))
        const bindMatrix = invertAffine(inverseBindMatrix)
        bones.push({
            boneIndex: index,
            name: readCString(head, head.readUInt32LE(offset + 8)),
            parentId: head.readInt32LE(offset + 12),
            worldTranslation: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
            inverseBindMatrix,
            bindMatrix,
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
            inverseBindMatrix: transform.inverseBindMatrix,
            rawFlags: head.readUInt32LE(offset + 24) | head.readUInt32LE(offset + 20),
            saveFlags: head.readUInt32LE(offset + 4),
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
            particleCount: dir.get('nprt') ?? 0,
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
        particles: [],
        actions: [],
    }
}

const normalizeQuat = (value) => {
    const x = Number(value?.[0] ?? 0)
    const y = Number(value?.[1] ?? 0)
    const z = Number(value?.[2] ?? 0)
    const w = Number(value?.[3] ?? 1)
    const length = Math.hypot(x, y, z, w)
    if (!Number.isFinite(length) || length <= 1e-8) return [0, 0, 0, 1]
    return [x / length, y / length, z / length, w / length]
}

const invertQuat = (value) => {
    const quat = normalizeQuat(value)
    return [-quat[0], -quat[1], -quat[2], quat[3]]
}

const transformPoint = (matrix, point) => [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
]

const multiplyMat4 = (a, b) => {
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

const quatToMat4 = (value) => {
    const [x, y, z, w] = normalizeQuat(value)
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
        1 - (yy + zz), xy + wz, xz - wy, 0,
        xy - wz, 1 - (xx + zz), yz + wx, 0,
        xz + wy, yz - wx, 1 - (xx + yy), 0,
        0, 0, 0, 1,
    ]
}

const translationMatrix = (value) => [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    value[0], value[1], value[2], 1,
]

const scaleMatrix = (value) => [
    value[0], 0, 0, 0,
    0, value[1], 0, 0,
    0, 0, value[2], 0,
    0, 0, 0, 1,
]

const composeTrs = (translation, rotation, scale) =>
    multiplyMat4(multiplyMat4(translationMatrix(translation), quatToMat4(rotation)), scaleMatrix(scale))

const cMatrix = [
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]
const cInverseMatrix = [
    0, -1, 0, 0,
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]

const transformJumpxPoint = ([x, y, z]) => [-y, x, z]
const transformJumpxScale = ([x, y, z]) => [Math.abs(y), Math.abs(x), Math.abs(z)]
const transformJumpxMat4 = (matrix) => multiplyMat4(multiplyMat4(cMatrix, matrix), cInverseMatrix)
const transformJumpxQuat = (value) => {
    const transformed = transformJumpxMat4(quatToMat4(value))
    const trace = transformed[0] + transformed[5] + transformed[10]
    let result
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2
        result = [
            (transformed[6] - transformed[9]) / s,
            (transformed[8] - transformed[2]) / s,
            (transformed[1] - transformed[4]) / s,
            0.25 * s,
        ]
    } else if (transformed[0] > transformed[5] && transformed[0] > transformed[10]) {
        const s = Math.sqrt(1 + transformed[0] - transformed[5] - transformed[10]) * 2
        result = [
            0.25 * s,
            (transformed[1] + transformed[4]) / s,
            (transformed[8] + transformed[2]) / s,
            (transformed[6] - transformed[9]) / s,
        ]
    } else if (transformed[5] > transformed[10]) {
        const s = Math.sqrt(1 + transformed[5] - transformed[0] - transformed[10]) * 2
        result = [
            (transformed[1] + transformed[4]) / s,
            0.25 * s,
            (transformed[6] + transformed[9]) / s,
            (transformed[8] - transformed[2]) / s,
        ]
    } else {
        const s = Math.sqrt(1 + transformed[10] - transformed[0] - transformed[5]) * 2
        result = [
            (transformed[8] + transformed[2]) / s,
            (transformed[6] + transformed[9]) / s,
            0.25 * s,
            (transformed[1] - transformed[4]) / s,
        ]
    }
    return normalizeQuat(result)
}

const sourceAnimatedMatrix = (bone, keyIndex) => {
    const translation = bone.positionKeys[keyIndex]?.value ?? bone.worldTranslation
    const rotation = bone.rotationKeys[keyIndex]?.value ?? [0, 0, 0, 1]
    const scale = bone.scaleKeys[keyIndex]?.value ?? [1, 1, 1]
    return composeTrs(translation, rotation, scale)
}

const importedAnimatedMatrix = (bone, keyIndex) => {
    const translation = Array.from(bone.Translation?.Keys?.[keyIndex]?.Vector ?? [0, 0, 0])
    const rotation = Array.from(bone.Rotation?.Keys?.[keyIndex]?.Vector ?? [0, 0, 0, 1])
    const scale = Array.from(bone.Scaling?.Keys?.[keyIndex]?.Vector ?? [1, 1, 1])
    return composeTrs(translation, rotation, scale)
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
            sourcefile: 'jumpx-mesh-bind-check-entry.ts',
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

const assertMeshNodeShape = (node, label) => {
    if (!node) fail(`Missing ${label}`)
    if (node.Parent !== -1 && node.Parent !== null) fail(`${label} Parent should be -1/null, got ${node.Parent}`)
    const pivot = Array.from(node.PivotPoint ?? [])
    if (pivot.length !== 3 || pivot.some((value) => Math.abs(value) > 1e-7)) {
        fail(`${label} PivotPoint should be [0,0,0], got ${JSON.stringify(pivot)}`)
    }
    if (((node.Flags ?? 0) & 7) !== 7) {
        fail(`${label} Flags should include DontInherit Translation/Rotation/Scaling, got ${node.Flags}`)
    }
}

const assertJumpxAbsoluteNodeShape = (node, sourceBone) => {
    if (!node) fail(`Missing imported node for ${sourceBone.name}`)
    if (node.Parent !== -1 && node.Parent !== null) fail(`${sourceBone.name} should not inherit a parent in JumpX world-track mode, got ${node.Parent}`)
    const pivot = Array.from(node.PivotPoint ?? [])
    if (pivot.length !== 3 || pivot.some((value) => Math.abs(value) > 1e-7)) {
        fail(`${sourceBone.name} PivotPoint should be [0,0,0] for JumpX absolute TRS tracks, got ${JSON.stringify(pivot)}`)
    }
    if (((node.Flags ?? 0) & 7) !== 7) {
        fail(`${sourceBone.name} Flags should include all DontInherit bits, got ${node.Flags}`)
    }
    const firstSourceRotation = transformJumpxQuat(sourceBone.rotationKeys[0]?.value ?? [0, 0, 0, 1])
    const firstImportedRotation = Array.from(node.Rotation?.Keys?.[0]?.Vector ?? [])
    if (firstImportedRotation.length !== 4) fail(`${sourceBone.name} is missing first imported rotation key`)
    const dotValue = Math.abs(firstImportedRotation.reduce((sum, value, index) => sum + value * firstSourceRotation[index], 0))
    if (dotValue < 0.999) {
        fail(`${sourceBone.name} first Rotation key should preserve JumpX absolute rotation, imported=${JSON.stringify(firstImportedRotation)} expected=${JSON.stringify(firstSourceRotation)}`)
    }
    if (sourceBone.parentId >= 0) {
        const identityLike = Math.abs(firstImportedRotation[0]) + Math.abs(firstImportedRotation[1]) + Math.abs(firstImportedRotation[2])
        if (identityLike < 1e-5 && Math.abs(Math.abs(firstImportedRotation[3]) - 1) < 1e-5) {
            fail(`${sourceBone.name} first Rotation key was collapsed to identity; JumpX source tracks are world-space, not first-key deltas`)
        }
    }
}

const geosetVertices = (geoset) => Array.from(geoset.Vertices ?? geoset.vertices ?? [])

const calculateRmsForGeoset = (scene, modelData, geosetIndex, keyIndex) => {
    const sourceGeometry = scene.geometries[geosetIndex]
    const sourceBone = scene.bones.find((bone) => bone.boneIndex === sourceGeometry.ancestorBoneId)
    if (!sourceBone) fail(`Missing source ancestor bone ${sourceGeometry.ancestorBoneId} for geoset ${geosetIndex}`)
    const importedGeoset = modelData.Geosets?.[geosetIndex]
    const group = importedGeoset?.Groups?.[0] ?? []
    const meshNodeId = group[0]
    const meshNode = modelData.Bones?.find((bone) => bone.ObjectId === meshNodeId)
    assertMeshNodeShape(meshNode, `geoset ${geosetIndex} mesh node`)

    const sourceFinalMatrix = multiplyMat4(transformJumpxMat4(sourceAnimatedMatrix(sourceBone, keyIndex)), transformJumpxMat4(sourceGeometry.inverseBindMatrix))
    const importedMatrix = importedAnimatedMatrix(meshNode, keyIndex)
    const importedVertices = geosetVertices(importedGeoset)
    if (importedVertices.length !== sourceGeometry.vertices.length) {
        fail(`geoset ${geosetIndex} vertex array length mismatch: imported=${importedVertices.length} source=${sourceGeometry.vertices.length}`)
    }

    let sumSquares = 0
    let count = 0
    for (let index = 0; index + 2 < sourceGeometry.vertices.length; index += 3) {
        const sourceVertex = [
            sourceGeometry.vertices[index],
            sourceGeometry.vertices[index + 1],
            sourceGeometry.vertices[index + 2],
        ]
        const importedVertex = [
            importedVertices[index],
            importedVertices[index + 1],
            importedVertices[index + 2],
        ]
        const expected = transformPoint(sourceFinalMatrix, transformJumpxPoint(sourceVertex))
        const actual = transformPoint(importedMatrix, importedVertex)
        for (let axis = 0; axis < 3; axis += 1) {
            const delta = actual[axis] - expected[axis]
            sumSquares += delta * delta
            count += 1
        }
    }
    return Math.sqrt(sumSquares / Math.max(1, count))
}

const assertRoundTripMeshBinding = (modelData, prepareModelDataForSave) => {
    const generatedMdx = generateMDX(prepareModelDataForSave(modelData))
    const roundTripBuffer = generatedMdx instanceof ArrayBuffer
        ? generatedMdx
        : generatedMdx.buffer.slice(generatedMdx.byteOffset, generatedMdx.byteOffset + generatedMdx.byteLength)
    const roundTripModel = parseMDX(roundTripBuffer)
    for (const geosetIndex of targetGeosets) {
        const group = roundTripModel.Geosets?.[geosetIndex]?.Groups?.[0] ?? []
        if (group.length !== 1) fail(`round-trip geoset ${geosetIndex} should keep a single matrix group, got ${JSON.stringify(group)}`)
        const node = roundTripModel.Bones?.find((bone) => bone.ObjectId === group[0])
        assertMeshNodeShape(node, `round-trip geoset ${geosetIndex} mesh node`)
        if (!/_Mesh$/.test(node.Name ?? '')) {
            fail(`round-trip geoset ${geosetIndex} should bind to *_Mesh node, got ${node.Name}`)
        }
    }
}

const main = async () => {
    if (!fs.existsSync(fixturePath)) fail(`Missing fixture ${fixturePath}`)
    const scene = buildScene()
    await buildImportBundle()
    const { buildJumpxStaticModelData, applyJumpxAnimationTracks, prepareModelDataForSave } = await import(pathToFileURL(bundlePath).href)
    const { modelData, nodeMapping } = buildJumpxStaticModelData(fixturePath, scene)
    applyJumpxAnimationTracks(scene, modelData, nodeMapping)

    if ((scene.bones ?? []).length !== 9) fail(`Expected 9 source bones, got ${scene.bones?.length}`)
    if ((modelData.Bones ?? []).length !== 18) fail(`Expected original+mesh bones (18), got ${modelData.Bones?.length}`)
    for (const geosetIndex of targetGeosets) {
        const sourceGeometry = scene.geometries[geosetIndex]
        if (sourceGeometry.geometryType !== 6 || sourceGeometry.ancestorBoneId !== 3) {
            fail(`fixture geoset ${geosetIndex} changed: type=${sourceGeometry.geometryType} ancestor=${sourceGeometry.ancestorBoneId}`)
        }
        const group = modelData.Geosets?.[geosetIndex]?.Groups?.[0] ?? []
        if (group.length !== 1) fail(`geoset ${geosetIndex} should have one classic matrix group, got ${JSON.stringify(group)}`)
        const originalNodeId = nodeMapping.objectIdByBoneId.get(sourceGeometry.ancestorBoneId)
        const meshNodeId = nodeMapping.meshObjectIdByBoneId.get(sourceGeometry.ancestorBoneId)
        if (group[0] !== meshNodeId) {
            fail(`geoset ${geosetIndex} should bind to mesh node ${meshNodeId}, got ${group[0]} (original ${originalNodeId})`)
        }
        if (group[0] === originalNodeId) fail(`geoset ${geosetIndex} is still bound to original node ${originalNodeId}`)
    }

    const sourceBoneWithParent = scene.bones.find((bone) => bone.parentId >= 0 && bone.rotationKeys.length > 0)
    if (!sourceBoneWithParent) fail('Fixture should contain a parented animated bone for absolute-node validation')
    assertJumpxAbsoluteNodeShape(
        modelData.Bones?.find((bone) => bone.ObjectId === nodeMapping.objectIdByBoneId.get(sourceBoneWithParent.boneIndex)),
        sourceBoneWithParent,
    )

    const rmsLines = []
    for (const geosetIndex of targetGeosets) {
        for (const keyIndex of sampleKeyIndexes) {
            const rms = calculateRmsForGeoset(scene, modelData, geosetIndex, keyIndex)
            rmsLines.push(`geo${geosetIndex}@key${keyIndex}=${rms.toExponential(3)}`)
            if (rms > RMS_EPSILON) {
                fail(`geoset ${geosetIndex} key ${keyIndex} mesh bind RMS too high: ${rms}`)
            }
        }
    }

    assertRoundTripMeshBinding(modelData, prepareModelDataForSave)
    console.log(`JumpX mesh bind matrix check passed: ${rmsLines.join(', ')}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
