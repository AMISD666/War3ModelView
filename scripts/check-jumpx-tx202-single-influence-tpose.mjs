import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { generateMDX, parseMDX } from '../vendor/war3-model/dist/war3-model.cjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_202_s03_2_01_skin1.x')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-jumpx-tx202-single-influence-'))
const bundlePath = path.join(distPath, 'jumpx-tx202-single-influence-check-bundle.mjs')
const DEFAULT_SAMPLE_START_FRAME = 320
const DEFAULT_SAMPLE_FPS = 30
const GEO_COMPRESSED_VERTEX = 1
const GEO_COMPRESSED_NORMAL = 2
const GEO_ENABLE_BONE_PALETTE = 64
const GEO_ENABLE_UV2 = 128
const EPSILON = 1e-4

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

const readTag = (bytes, offset) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const readMdxFormatVersion = (arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer)
    for (let offset = 0; offset + 8 <= bytes.length;) {
        const tag = readTag(bytes, offset)
        if (tag === 'VERS') {
            if (offset + 12 > bytes.length) fail('Malformed VERS chunk')
            return bytes[offset + 8]
                | (bytes[offset + 9] << 8)
                | (bytes[offset + 10] << 16)
                | (bytes[offset + 11] << 24)
        }
        if (offset === 0 && tag === 'MDLX') {
            offset += 4
            continue
        }
        const size = bytes[offset + 4]
            | (bytes[offset + 5] << 8)
            | (bytes[offset + 6] << 16)
            | (bytes[offset + 7] << 24)
        if (size < 0 || offset + 8 + size > bytes.length) break
        offset += 8 + size
    }
    fail('Missing VERS chunk in generated MDX')
}

const readCString = (buffer, offset) => {
    let end = offset
    while (end < buffer.length && buffer[end] !== 0) end += 1
    return buffer.toString('utf8', offset, end)
}

const decryptOffset = (addr) => {
    if (!addr || addr < 1_000_000_000) fail(`Invalid JumpX encrypted data offset ${addr}`)
    return addr - 1_000_000_000
}

const sampleFrame = (index) => DEFAULT_SAMPLE_START_FRAME + index
const sampleTimeMs = (frame) => frame * 1000 / DEFAULT_SAMPLE_FPS

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
    return { version, dir, head, data, headSize, dataSize, headCompressedSize, dataCompressedSize }
}

const identityMatrix = () => [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]

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
    out[12] = -(tx * out[0] + ty * out[4] + tz * out[8])
    out[13] = -(tx * out[1] + ty * out[5] + tz * out[9])
    out[14] = -(tx * out[2] + ty * out[6] + tz * out[10])
    return out
}

const computeBounds = (vertices) => {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index + 2 < vertices.length; index += 3) {
        min[0] = Math.min(min[0], vertices[index])
        min[1] = Math.min(min[1], vertices[index + 1])
        min[2] = Math.min(min[2], vertices[index + 2])
        max[0] = Math.max(max[0], vertices[index])
        max[1] = Math.max(max[1], vertices[index + 1])
        max[2] = Math.max(max[2], vertices[index + 2])
    }
    return min.every(Number.isFinite) && max.every(Number.isFinite) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] }
}

const computeRadius = (min, max) => Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2

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

const uncompressBBox = (packed, min, max) => {
    let value = packed
    const out = [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
        const component = value & 0x3ff
        value >>>= 10
        out[axis] = (max[axis] - min[axis]) * component / 1023 + min[axis]
    }
    return out
}

const readVertices = (data, saveFlags, rawAddr, compAddr, count, min, max) => {
    if ((saveFlags & GEO_COMPRESSED_VERTEX) !== 0 && compAddr !== 0) {
        const offset = decryptOffset(compAddr)
        const out = []
        for (let index = 0; index < count; index += 1) {
            out.push(...uncompressBBox(data.readUInt32LE(offset + index * 4), min, max))
        }
        return out
    }
    return readFloatArray(data, rawAddr, count * 3)
}

const readNormals = (data, saveFlags, rawAddr, compAddr, count) => {
    if ((saveFlags & GEO_COMPRESSED_NORMAL) !== 0 && compAddr !== 0) {
        const offset = decryptOffset(compAddr)
        const out = []
        for (let index = 0; index < count; index += 1) {
            const x = data.readInt8(offset + index * 3) / 127
            const y = data.readInt8(offset + index * 3 + 1) / 127
            const z = data.readInt8(offset + index * 3 + 2) / 127
            const length = Math.hypot(x, y, z)
            out.push(...(length > 0 ? [x / length, y / length, z / length] : [0, 0, 1]))
        }
        return out
    }
    return readFloatArray(data, rawAddr, count * 3)
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

const readVec3Keys = (data, addr, count) => {
    if (!addr || count <= 0) return []
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => {
        const frame = sampleFrame(index)
        return {
            frame,
            timeMs: sampleTimeMs(frame),
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
        const frame = sampleFrame(index)
        return {
            frame,
            timeMs: sampleTimeMs(frame),
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
        const frame = sampleFrame(index)
        return { frame, timeMs: sampleTimeMs(frame), value: data.readUInt32LE(offset + index * 4), rawFlags: 0 }
    })
}

const readBonePalette = (data, addr, vertexCount) => {
    const offset = decryptOffset(addr)
    const skinWeightCounts = []
    const skinBoneIds = []
    const skinWeights = []
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const base = offset + vertexIndex * 0x18
        const sourceCount = Math.min(4, data.readUInt8(base))
        const filtered = []
        for (let influenceIndex = 0; influenceIndex < sourceCount; influenceIndex += 1) {
            const boneId = data.readUInt8(base + 1 + influenceIndex)
            const weight = data.readFloatLE(base + 8 + influenceIndex * 4)
            if (weight >= EPSILON) filtered.push({ boneId, weight })
        }
        skinWeightCounts.push(filtered.length)
        for (let influenceIndex = 0; influenceIndex < 4; influenceIndex += 1) {
            skinBoneIds.push(filtered[influenceIndex]?.boneId ?? 0)
            skinWeights.push(filtered[influenceIndex]?.weight ?? 0)
        }
    }
    return { skinWeightCounts, skinBoneIds, skinWeights }
}

const defaultSingleBonePalette = (vertexCount, ancestorBoneId) => ({
    skinWeightCounts: Array.from({ length: vertexCount }, () => 1),
    skinBoneIds: Array.from({ length: vertexCount * 4 }, (_, index) => index % 4 === 0 ? Math.max(0, ancestorBoneId) : 0),
    skinWeights: Array.from({ length: vertexCount * 4 }, (_, index) => index % 4 === 0 ? 1 : 0),
})

const readMatrix = (head, offset) => Array.from({ length: 16 }, (_, index) => head.readFloatLE(offset + index * 4))

const readAncestorTransform = (head, dir, boneIndex) => {
    if (boneIndex < 0 || boneIndex >= (dir.get('nbon') ?? 0)) {
        return { pivot: [0, 0, 0], scale: [1, 1, 1], inverseBindMatrix: undefined }
    }
    const offset = (dir.get('abon') ?? 0) + boneIndex * 0xac
    const inverseBindMatrix = readMatrix(head, offset + 24)
    const bindMatrix = invertAffine(inverseBindMatrix)
    return {
        pivot: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
        scale: matrixAxisScales(inverseBindMatrix),
        inverseBindMatrix,
    }
}

const buildScene = () => {
    const { version, dir, head, data, headSize, dataSize, headCompressedSize, dataCompressedSize } = readJumpxContainer()
    const bones = []
    for (let index = 0; index < (dir.get('nbon') ?? 0); index += 1) {
        const offset = (dir.get('abon') ?? 0) + index * 0xac
        const inverseBindMatrix = readMatrix(head, offset + 24)
        const bindMatrix = invertAffine(inverseBindMatrix)
        bones.push({
            boneIndex: index,
            name: readCString(head, head.readUInt32LE(offset + 8)),
            parentId: head.readInt32LE(offset + 12),
            worldTranslation: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
            localTranslation: null,
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
        const saveFlags = head.readUInt32LE(offset + 4)
        const vertexCount = Math.max(0, head.readInt32LE(offset + 28))
        const faceCount = Math.max(0, head.readInt32LE(offset + 32))
        const storedMaximumExtent = [head.readFloatLE(offset + 96), head.readFloatLE(offset + 100), head.readFloatLE(offset + 104)]
        const storedMinimumExtent = [head.readFloatLE(offset + 108), head.readFloatLE(offset + 112), head.readFloatLE(offset + 116)]
        const vertices = readVertices(data, saveFlags, head.readUInt32LE(offset + 36), head.readUInt32LE(offset + 40), vertexCount, storedMinimumExtent, storedMaximumExtent)
        const normals = readNormals(data, saveFlags, head.readUInt32LE(offset + 44), head.readUInt32LE(offset + 48), vertexCount)
        const uvs = readFloatArray(data, head.readUInt32LE(offset + 52), vertexCount * 2)
        const indices = readUint16Array(data, head.readUInt32LE(offset + 76), faceCount * 3)
        const ancestorBoneId = head.readInt32LE(offset + 88)
        const paletteAddr = head.readUInt32LE(offset + 92)
        const palette = (saveFlags & GEO_ENABLE_BONE_PALETTE) !== 0 && paletteAddr !== 0
            ? readBonePalette(data, paletteAddr, vertexCount)
            : defaultSingleBonePalette(vertexCount, ancestorBoneId)
        const bounds = computeBounds(vertices)
        const transform = readAncestorTransform(head, dir, ancestorBoneId)
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
            uv2: (saveFlags & GEO_ENABLE_UV2) !== 0 ? readFloatArray(data, head.readUInt32LE(offset + 56), vertexCount * 2) : null,
            vertexColors: null,
            indices,
            skinWeightStride: 4,
            ...palette,
            minimumExtent: bounds.min,
            maximumExtent: bounds.max,
            boundsRadius: computeRadius(bounds.min, bounds.max) * Math.max(...transform.scale),
            objectPivot: transform.pivot,
            objectScale: transform.scale,
            inverseBindMatrix: transform.inverseBindMatrix,
            rawFlags: head.readUInt32LE(offset + 24) | head.readUInt32LE(offset + 20),
            saveFlags,
        })
    }

    return {
        probe: {
            ok: true,
            path: fixturePath,
            fileSize: fs.statSync(fixturePath).size,
            format: 'JumpX',
            version,
            headSize,
            dataSize,
            headCompressedSize,
            dataCompressedSize,
            textureCount: dir.get('ntex') ?? 0,
            materialCount: dir.get('nmtl') ?? 0,
            geometryCount: geometries.length,
            boneCount: bones.length,
            boneGroupCount: dir.get('nbgp') ?? 0,
            attachmentCount: dir.get('natt') ?? 0,
            ribbonCount: dir.get('nrib') ?? 0,
            particleCount: dir.get('nprt') ?? 0,
            actionCount: dir.get('nact') ?? 0,
            warnings: [],
        },
        textures: [],
        materials: [],
        geometries,
        bones,
        boneGroups: [],
        attachments: [],
        ribbons: [],
        particles: [],
        actions: [],
    }
}

const hasMultiBoneVertex = (geometry) => {
    for (let vertexIndex = 0; vertexIndex < geometry.vertexCount; vertexIndex += 1) {
        const count = Math.min(geometry.skinWeightStride, Math.max(0, Math.floor(geometry.skinWeightCounts[vertexIndex] ?? 0)))
        let usableCount = 0
        for (let weightIndex = 0; weightIndex < count; weightIndex += 1) {
            const sourceIndex = vertexIndex * geometry.skinWeightStride + weightIndex
            if (Number(geometry.skinWeights[sourceIndex]) > EPSILON) usableCount += 1
        }
        if (usableCount > 1) return true
    }
    return false
}

const transformJumpxVec3 = ([x, y, z]) => [-y, x, z]

const normalizeQuatForSynthetic = (value) => {
    const length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1)
    if (!Number.isFinite(length) || length <= 1e-8) return [0, 0, 0, 1]
    return value.map((item) => item / length)
}

const closeArray = (actual, expected, label, epsilon = 1e-5) => {
    if (actual.length !== expected.length) {
        fail(`${label} length mismatch: ${actual.length} vs ${expected.length}`)
    }
    actual.forEach((value, index) => {
        if (Math.abs(value - expected[index]) > epsilon) {
            fail(`${label}[${index}] mismatch: ${value} vs ${expected[index]}`)
        }
    })
}

const buildImportBundle = async () => {
    await esbuild.build({
        stdin: {
            contents: [
                "export { buildJumpxStaticModelData } from './src/renderer/src/application/model-import/JumpxModelBuilder.ts'",
                "export { applyJumpxAnimationTracks } from './src/renderer/src/application/model-import/JumpxAnimationMapper.ts'",
                "export { buildMeshBindNodeBoneIds } from './src/renderer/src/application/model-import/JumpxMeshBindAnimationMapper.ts'",
                "export { prepareModelDataForSave } from './src/renderer/src/application/model-save/prepareModelDataForSave.ts'",
            ].join('\n'),
            resolveDir: repoRoot,
            sourcefile: 'jumpx-tx202-single-influence-check-entry.ts',
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

const assertJumpxWorldSpaceNodes = (scene, nodeMapping, modelData) => {
    const parentedBones = scene.bones.filter((bone) => bone.parentId >= 0)
    if (parentedBones.length < 6) {
        fail(`tx_202_s03 should contain parented bones, got ${parentedBones.length}`)
    }
    for (const sourceBone of parentedBones) {
        const objectId = nodeMapping.objectIdByBoneId.get(sourceBone.boneIndex)
        const node = modelData.Bones?.find((item) => item.ObjectId === objectId)
        if (node?.Parent !== -1) {
            fail(`${sourceBone.name} should import as an independent JumpX world-space node, got parent ${node?.Parent}`)
        }
        closeArray(Array.from(node?.PivotPoint ?? []), [0, 0, 0], `${sourceBone.name} PivotPoint`)
        if (((node?.Flags ?? 0) & 7) !== 7) {
            fail(`${sourceBone.name} should disable inherited TRS, got Flags=${node?.Flags}`)
        }

        const meshObjectId = nodeMapping.meshObjectIdByBoneId.get(sourceBone.boneIndex)
        const meshNode = modelData.Bones?.find((item) => item.ObjectId === meshObjectId)
        if (meshNode?.Parent !== -1) {
            fail(`${sourceBone.name}_Mesh should import as an independent inverse-bind node, got parent ${meshNode?.Parent}`)
        }
        closeArray(Array.from(meshNode?.PivotPoint ?? []), [0, 0, 0], `${sourceBone.name}_Mesh PivotPoint`)
    }
}

const assertSingleInfluenceMeshNode = (scene, modelData, nodeMapping, geometry, geosetIndex) => {
    const geoset = modelData.Geosets?.[geosetIndex]
    if (!geoset) fail(`Missing imported geoset ${geosetIndex}`)
    if ('SkinWeights' in geoset) fail(`geoset ${geosetIndex} must remain classic MDX 800 without SkinWeights`)
    const group = geoset.Groups?.[geoset.VertexGroup?.[0] ?? 0] ?? []
    if (group.length !== 1) fail(`single-influence geoset ${geosetIndex} should have one matrix node, got ${JSON.stringify(group)}`)
    const meshObjectId = nodeMapping.meshObjectIdByBoneId.get(geometry.ancestorBoneId)
    const originalObjectId = nodeMapping.objectIdByBoneId.get(geometry.ancestorBoneId)
    if (group[0] !== meshObjectId) {
        fail(`single-influence geoset ${geosetIndex} should bind to *_Mesh node ${meshObjectId}, got ${group[0]} (original ${originalObjectId})`)
    }
    const sourceBone = scene.bones.find((bone) => bone.boneIndex === geometry.ancestorBoneId)
    const meshBone = modelData.Bones?.find((bone) => bone.ObjectId === meshObjectId)
    if (!sourceBone || !meshBone) fail(`Missing source/imported mesh bone for geoset ${geosetIndex}`)

    const expectedFrame0 = [0, 0, 0]
    const actualFrame0 = Array.from(meshBone.Translation?.Keys?.find((key) => key.Frame === 0)?.Vector ?? [])
    if (actualFrame0.length > 0) {
        closeArray(actualFrame0, expectedFrame0, `single-influence *_Mesh frame 0 translation for geoset ${geosetIndex}`)
    }
    const actualFrame0Rotation = Array.from(meshBone.Rotation?.Keys?.find((key) => key.Frame === 0)?.Vector ?? [])
    if (actualFrame0Rotation.length > 0) {
        closeArray(actualFrame0Rotation, [0, 0, 0, 1], `single-influence *_Mesh frame 0 rotation for geoset ${geosetIndex}`)
    }
    const actualFrame0Scaling = Array.from(meshBone.Scaling?.Keys?.find((key) => key.Frame === 0)?.Vector ?? [])
    if (actualFrame0Scaling.length > 0) {
        closeArray(actualFrame0Scaling, [1, 1, 1], `single-influence *_Mesh frame 0 scaling for geoset ${geosetIndex}`)
    }

    const firstImportedVertex = Array.from(geoset.Vertices ?? []).slice(0, 3)
    const firstSourceVertex = geometry.vertices.slice(0, 3)
    const sourceSpaceVertex = transformJumpxVec3(firstSourceVertex)
    closeArray(firstImportedVertex, sourceSpaceVertex, `single-influence geoset ${geosetIndex} bind-pose vertex`)
}

const assertSyntheticRotatedBindPose = (buildJumpxStaticModelData, applyJumpxAnimationTracks) => {
    const rotation90Z = normalizeQuatForSynthetic([0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)])
    const inverseBindMatrix = [
        0, -1, 0, 0,
        1, 0, 0, 0,
        0, 0, 1, 0,
        5, 7, 11, 1,
    ]
    const scene = {
        probe: {
            ok: true,
            path: 'synthetic-rotated-bind.x',
            fileSize: 0,
            format: 'JumpX',
            version: 8,
            headSize: 0,
            dataSize: 0,
            headCompressedSize: 0,
            dataCompressedSize: 0,
            textureCount: 0,
            materialCount: 0,
            geometryCount: 1,
            boneCount: 1,
            boneGroupCount: 0,
            attachmentCount: 0,
            ribbonCount: 0,
            particleCount: 0,
            actionCount: 0,
            warnings: [],
        },
        textures: [],
        materials: [],
        geometries: [{
            geometryIndex: 0,
            name: 'synthetic_rotated_bind',
            materialId: 0,
            geometryType: 0,
            ancestorBoneId: 0,
            vertexCount: 3,
            indexCount: 3,
            vertices: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 0, 1, 0, 0, 1],
            indices: [0, 1, 2],
            skinWeightStride: 4,
            skinWeightCounts: [1, 1, 1],
            skinBoneIds: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            skinWeights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            minimumExtent: [0, 0, 0],
            maximumExtent: [1, 1, 1],
            boundsRadius: 1,
            objectPivot: [0, 0, 0],
            objectScale: [1, 1, 1],
            inverseBindMatrix,
            rawFlags: 64,
            saveFlags: 64,
        }],
        bones: [{
            boneIndex: 0,
            name: 'SyntheticRotatedBind',
            parentId: -1,
            worldTranslation: [-7, 5, -11],
            localTranslation: null,
            inverseBindMatrix,
            bindMatrix: null,
            rawFlags: 1,
            saveFlags: 0,
            positionKeys: [{ frame: 320, timeMs: 1000, value: [-7, 5, -11], rawFlags: 0 }],
            rotationKeys: [{ frame: 320, timeMs: 1000, value: [0, 0, 0, 1], rawFlags: 0 }],
            scaleKeys: [],
            visibilityKeys: [],
        }],
        boneGroups: [],
        attachments: [],
        ribbons: [],
        particles: [],
        actions: [],
    }
    const { modelData, nodeMapping } = buildJumpxStaticModelData('synthetic-rotated-bind.x', scene)
    applyJumpxAnimationTracks(scene, modelData, nodeMapping)
    const geoset = modelData.Geosets?.[0]
    if (!geoset) fail('synthetic rotated bind scene produced no geoset')
    closeArray(Array.from(geoset.Vertices ?? []).slice(0, 3), [0, 1, 0], 'synthetic rotated bind-pose vertex')
    const meshBone = modelData.Bones?.find((bone) => bone.ObjectId === nodeMapping.meshObjectIdByBoneId.get(0))
    if (!meshBone) fail('synthetic rotated bind scene produced no mesh bone')
    closeArray(Array.from(meshBone.Translation?.Keys?.find((key) => key.Frame === 0)?.Vector ?? []), [0, 0, 0], 'synthetic mesh rest translation')
    closeArray(Array.from(meshBone.Rotation?.Keys?.find((key) => key.Frame === 0)?.Vector ?? []), [0, 0, 0, 1], 'synthetic mesh rest rotation')
    closeArray(Array.from(meshBone.Scaling?.Keys?.find((key) => key.Frame === 0)?.Vector ?? []), [1, 1, 1], 'synthetic mesh rest scaling')
    const animatedRotation = Array.from(meshBone.Rotation?.Keys?.find((key) => key.Frame === 1000)?.Vector ?? [])
    const rotationMagnitude = Math.hypot(animatedRotation[0] ?? 0, animatedRotation[1] ?? 0, animatedRotation[2] ?? 0)
    if (rotationMagnitude <= 1e-4) {
        fail(`synthetic mesh animated inverse-bind rotation was lost: ${JSON.stringify(animatedRotation)}`)
    }
}

const assertSyntheticObjectScaleDoesNotInflateBindPose = (buildJumpxStaticModelData) => {
    const scene = {
        probe: {
            ok: true,
            path: 'synthetic-scaled-bind.x',
            fileSize: 0,
            format: 'JumpX',
            version: 8,
            headSize: 0,
            dataSize: 0,
            headCompressedSize: 0,
            dataCompressedSize: 0,
            textureCount: 0,
            materialCount: 0,
            geometryCount: 1,
            boneCount: 1,
            boneGroupCount: 0,
            attachmentCount: 0,
            ribbonCount: 0,
            particleCount: 0,
            actionCount: 0,
            warnings: [],
        },
        textures: [],
        materials: [],
        geometries: [{
            geometryIndex: 0,
            name: 'synthetic_scaled_bind',
            materialId: 0,
            geometryType: 0,
            ancestorBoneId: 0,
            vertexCount: 3,
            indexCount: 3,
            vertices: [2, 3, 4, 0, 1, 0, 0, 0, 1],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 0, 1, 0, 0, 1],
            indices: [0, 1, 2],
            skinWeightStride: 4,
            skinWeightCounts: [1, 1, 1],
            skinBoneIds: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            skinWeights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            minimumExtent: [0, 0, 0],
            maximumExtent: [2, 3, 4],
            boundsRadius: 3,
            objectPivot: [100, 200, 300],
            objectScale: [25, 40, 60],
            inverseBindMatrix: [
                25, 0, 0, 0,
                0, 40, 0, 0,
                0, 0, 60, 0,
                0, 0, 0, 1,
            ],
            rawFlags: 64,
            saveFlags: 64,
        }],
        bones: [{
            boneIndex: 0,
            name: 'SyntheticScaledBind',
            parentId: -1,
            worldTranslation: [0, 0, 0],
            localTranslation: null,
            inverseBindMatrix: [
                25, 0, 0, 0,
                0, 40, 0, 0,
                0, 0, 60, 0,
                0, 0, 0, 1,
            ],
            bindMatrix: null,
            rawFlags: 1,
            saveFlags: 0,
            positionKeys: [],
            rotationKeys: [],
            scaleKeys: [],
            visibilityKeys: [],
        }],
        boneGroups: [],
        attachments: [],
        ribbons: [],
        particles: [],
        actions: [],
    }
    const { modelData } = buildJumpxStaticModelData('synthetic-scaled-bind.x', scene)
    const geoset = modelData.Geosets?.[0]
    if (!geoset) fail('synthetic scaled bind scene produced no geoset')
    closeArray(Array.from(geoset.Vertices ?? []).slice(0, 3), [-3, 2, 4], 'synthetic scaled bind-pose vertex')
}

const main = async () => {
    if (!fs.existsSync(fixturePath)) {
        console.log('JumpX tx_202_s03 fixture not present; skipping single-influence T-pose check')
        return
    }

    const scene = buildScene()
    if (scene.probe.version !== 8) fail(`Expected tx_202_s03 JumpX version 8, got ${scene.probe.version}`)
    if (scene.geometries.length !== 12) fail(`Expected 12 tx_202_s03 geometries, got ${scene.geometries.length}`)
    if (scene.bones.length !== 12) fail(`Expected 12 tx_202_s03 bones, got ${scene.bones.length}`)
    const multiBoneGeometries = scene.geometries.filter(hasMultiBoneVertex)
    if (multiBoneGeometries.length > 0) {
        fail(`tx_202_s03 regression fixture should stay single-influence only, got multi-influence geosets: ${multiBoneGeometries.map((item) => item.name).join(', ')}`)
    }

    await buildImportBundle()
    const {
        applyJumpxAnimationTracks,
        buildJumpxStaticModelData,
        buildMeshBindNodeBoneIds,
        prepareModelDataForSave,
    } = await import(pathToFileURL(bundlePath).href)

    const meshBindBoneIds = buildMeshBindNodeBoneIds(scene.geometries)
    if (meshBindBoneIds.size === 0) {
        fail('single-influence tx_202_s03 must use mesh-bind animation bones when inverse bind matrices are available')
    }

    const { modelData, nodeMapping } = buildJumpxStaticModelData(fixturePath, scene)
    applyJumpxAnimationTracks(scene, modelData, nodeMapping)
    assertSyntheticRotatedBindPose(buildJumpxStaticModelData, applyJumpxAnimationTracks)
    assertSyntheticObjectScaleDoesNotInflateBindPose(buildJumpxStaticModelData)
    if (modelData.Version?.FormatVersion !== 800) {
        fail(`JumpX single-influence import must stay MDX 800, got ${modelData.Version?.FormatVersion}`)
    }
    if ((modelData.Geosets ?? []).length !== scene.geometries.length) {
        fail(`Expected one imported geoset per tx_202_s03 geometry, got ${modelData.Geosets?.length}`)
    }

    for (let geosetIndex = 0; geosetIndex < scene.geometries.length; geosetIndex += 1) {
        assertSingleInfluenceMeshNode(scene, modelData, nodeMapping, scene.geometries[geosetIndex], geosetIndex)
    }
    assertJumpxWorldSpaceNodes(scene, nodeMapping, modelData)

    const generatedMdx = generateMDX(prepareModelDataForSave(modelData))
    const roundTripBuffer = generatedMdx instanceof ArrayBuffer
        ? generatedMdx
        : generatedMdx.buffer.slice(generatedMdx.byteOffset, generatedMdx.byteOffset + generatedMdx.byteLength)
    const roundTripFormatVersion = readMdxFormatVersion(roundTripBuffer)
    if (roundTripFormatVersion !== 800) {
        fail(`Round-trip tx_202_s03 output must remain MDX 800, got ${roundTripFormatVersion}`)
    }
    const roundTrip = parseMDX(roundTripBuffer)
    if ((roundTrip.Geosets ?? []).some((item) => 'SkinWeights' in item)) {
        fail('Round-trip classic MDX 800 output must not contain SkinWeights')
    }

    console.log('JumpX tx_202_s03 single-influence T-pose check passed')
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
