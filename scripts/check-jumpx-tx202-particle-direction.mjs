import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { generateMDX, parseMDX } from '../vendor/war3-model/dist/war3-model.cjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_202_s03_3_01_skin1.x')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-jumpx-tx202-check-'))
const bundlePath = path.join(distPath, 'jumpx-tx202-check-bundle.mjs')

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
        fail('JumpX inflated size mismatch')
    }
    return { version, dir, head, data }
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
            localTranslation: null,
            inverseBindMatrix: inverseMatrix,
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
        const inverseBindMatrix = ancestorBoneId >= 0 && ancestorBoneId < (dir.get('nbon') ?? 0)
            ? Array.from({ length: 16 }, (_, matrixIndex) => head.readFloatLE((dir.get('abon') ?? 0) + ancestorBoneId * 0xac + 24 + matrixIndex * 4))
            : undefined
        const bindMatrix = inverseBindMatrix ? invertAffine(inverseBindMatrix) : identityMatrix()
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
            boundsRadius: computeRadius(bounds.min, bounds.max),
            objectPivot: [bindMatrix[12], bindMatrix[13], bindMatrix[14]],
            objectScale: matrixAxisScales(inverseBindMatrix ?? identityMatrix()),
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
            uvAnimFps: head.readUInt32LE(offset + 224),
            useTimeBasedCell: head[offset + 500] !== 0,
            matchLife: head[offset + 508] !== 0,
            numLoop: head.readInt32LE(offset + 512),
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
            sourcefile: 'jumpx-tx202-check-entry.ts',
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

const main = async () => {
    if (!fs.existsSync(fixturePath)) {
        console.log('JumpX tx_202 fixture not present; skipping particle direction check')
        return
    }
    const scene = buildScene()
    await buildImportBundle()
    const { buildJumpxStaticModelData, applyJumpxAnimationTracks, prepareModelDataForSave } = await import(pathToFileURL(bundlePath).href)
    const { modelData, nodeMapping } = buildJumpxStaticModelData(fixturePath, scene)
    applyJumpxAnimationTracks(scene, modelData, nodeMapping)

    const source = scene.particles.find((particle) => particle.name === 'part.9hy')
    const imported = modelData.ParticleEmitters2?.find((emitter) => emitter.Name === 'part_9hy')
    if (!source || !imported) {
        fail(`Missing tx_202 part.9hy mapping: source=${!!source} imported=${!!imported}`)
    }
    const importedParent = modelData.Bones?.find((bone) => bone.ObjectId === imported.Parent)
    if (!importedParent) {
        fail(`Missing tx_202 part.9hy imported parent ${imported.Parent}`)
    }
    for (const trackName of ['Translation', 'Rotation', 'Scaling']) {
        const firstFrame = importedParent[trackName]?.Keys?.[0]?.Frame
        if (firstFrame !== 0) {
            fail(`part.9hy parent ${importedParent.Name} ${trackName} must have a frame-0 pose for initial particle emission, got ${firstFrame}`)
        }
    }
    const importedLocalDirection = normalize(rotateLocalZ(Array.from(imported.Rotation?.Keys?.[0]?.Vector ?? [])))

    vectorClose(importedLocalDirection, [0, 0, 1], 1e-5, 'part.9hy imported local emission direction')
    if ((imported.Flags & 0x2) === 0 || imported.DontInherit?.Rotation !== true) {
        fail(`part.9hy must not inherit parent rotation after JumpX import, got Flags=${imported.Flags}`)
    }
    for (const particle of scene.particles) {
        const emitter = modelData.ParticleEmitters2?.find((candidate) => candidate.Name === particle.name.trim().replace(/\./g, '_'))
        if (!emitter) {
            fail(`Missing imported particle ${particle.name}`)
        }
        vectorClose(
            normalize(rotateLocalZ(Array.from(emitter.Rotation?.Keys?.[0]?.Vector ?? []))),
            normalize(transformJumpxVec3(particle.normal)),
            1e-5,
            `${particle.name} imported local emission direction`,
        )
    }
    if (JSON.stringify(imported.LifeSpanUVAnim) !== JSON.stringify([0, 7, 1])) {
        fail(`part.9hy LifeSpanUVAnim should cover frames 0..7: ${JSON.stringify(imported.LifeSpanUVAnim)}`)
    }
    if (JSON.stringify(imported.DecayUVAnim) !== JSON.stringify([8, 15, 1])) {
        fail(`part.9hy DecayUVAnim should cover frames 8..15 without wrapping: ${JSON.stringify(imported.DecayUVAnim)}`)
    }
    const generatedMdx = generateMDX(prepareModelDataForSave(modelData))
    const roundTripBuffer = generatedMdx instanceof ArrayBuffer
        ? generatedMdx
        : generatedMdx.buffer.slice(generatedMdx.byteOffset, generatedMdx.byteOffset + generatedMdx.byteLength)
    if (process.env.JUMPX_TX202_WRITE_MDX === '1') {
        fs.writeFileSync(path.join(repoRoot, 'testmodel', 'tx_202_s03_3_01_skin1.mdx'), new Uint8Array(roundTripBuffer))
    }
    const roundTripModel = parseMDX(roundTripBuffer)
    const roundTripEmitter = roundTripModel.ParticleEmitters2?.find((emitter) => emitter.Name === 'part_9hy')
    if (!roundTripEmitter) {
        fail('Round-trip MDX is missing part_9hy')
    }
    vectorClose(normalize(rotateLocalZ(Array.from(roundTripEmitter.Rotation?.Keys?.[0]?.Vector ?? []))), [0, 0, 1], 1e-5, 'round-trip part.9hy local emission direction')
    if ((roundTripEmitter.Flags & 0x2) === 0) {
        fail(`Round-trip part.9hy must preserve DontInheritRotation, got Flags=${roundTripEmitter.Flags}`)
    }
    if (JSON.stringify(Array.from(roundTripEmitter.DecayUVAnim ?? [])) !== JSON.stringify([8, 15, 1])) {
        fail(`Round-trip part.9hy DecayUVAnim should stay 8..15: ${JSON.stringify(roundTripEmitter.DecayUVAnim)}`)
    }
    console.log('JumpX tx_202 particle direction check passed')
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
}).finally(() => {
    fs.rmSync(distPath, { recursive: true, force: true })
})
