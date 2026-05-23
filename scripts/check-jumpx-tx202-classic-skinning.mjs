import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { generateMDX, parseMDX } from '../vendor/war3-model/dist/war3-model.cjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_202_s06_2_02_skin1.x')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-jumpx-tx202-classic-'))
const bundlePath = path.join(distPath, 'jumpx-tx202-classic-check-bundle.mjs')

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
            const size = bytes[offset + 4]
                | (bytes[offset + 5] << 8)
                | (bytes[offset + 6] << 16)
                | (bytes[offset + 7] << 24)
            if (size < 4 || offset + 12 > bytes.length) fail(`Malformed VERS chunk size ${size}`)
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

const normalizeInfluences = (items) => {
    const total = items.reduce((sum, item) => sum + item.weight, 0)
    return [...items]
        .sort((a, b) => b.weight - a.weight || a.boneId - b.boneId)
        .map((item) => ({ boneId: item.boneId, weight: item.weight / total }))
}

const transformJumpxVec3 = ([x, y, z]) => [-y, x, z]

const readPaletteInfluences = (data, addr, vertexCount) => {
    const offset = decryptOffset(addr)
    const out = []
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const base = offset + vertexIndex * 0x18
        const sourceCount = Math.min(4, data.readUInt8(base))
        const influences = []
        for (let influenceIndex = 0; influenceIndex < sourceCount; influenceIndex += 1) {
            const boneId = data.readUInt8(base + 1 + influenceIndex)
            const weight = data.readFloatLE(base + 8 + influenceIndex * 4)
            if (weight >= 1e-4) influences.push({ boneId, weight })
        }
        out.push(normalizeInfluences(influences))
    }
    return out
}

const readFloatArray = (data, addr, count) => {
    const offset = decryptOffset(addr)
    return Array.from({ length: count }, (_, index) => data.readFloatLE(offset + index * 4))
}

const findFixtureSamples = () => {
    const { version, dir, head, data } = readJumpxContainer()
    let dominant = null
    let balanced = null
    let single = null
    let firstWingVertex = null
    let wingPaletteGeosets = 0
    let dominantCandidateCount = 0

    for (let index = 0; index < (dir.get('ngeo') ?? 0); index += 1) {
        const offset = (dir.get('ageo') ?? 0) + index * 0x7c
        const saveFlags = head.readUInt32LE(offset + 4)
        const name = readCString(head, head.readUInt32LE(offset + 8))
        const vertexCount = head.readInt32LE(offset + 28)
        const paletteAddr = head.readUInt32LE(offset + 92)
        const vertexAddr = head.readUInt32LE(offset + 36)
        if (!/wing/i.test(name) || (saveFlags & 64) === 0 || paletteAddr === 0) continue
        wingPaletteGeosets += 1
        if (!firstWingVertex) {
            firstWingVertex = readFloatArray(data, vertexAddr, 3)
        }
        for (const influences of readPaletteInfluences(data, paletteAddr, vertexCount)) {
            if (influences.length === 0) continue
            const top = influences[0]?.weight ?? 0
            const second = influences[1]?.weight ?? 0
            if (top >= 0.65 && top - second >= 0.35) dominantCandidateCount += 1
            if (!dominant && influences.length >= 3 && top >= 0.65 && top - second >= 0.35) {
                dominant = influences
            }
            if (!balanced && influences.length >= 2 && Math.abs(top - second) <= 0.03 && top >= 0.45) {
                balanced = influences.slice(0, 2)
            }
            if (!single && influences.length === 1) {
                single = influences
            }
        }
    }

    if (wingPaletteGeosets < 5) fail(`Expected tx_202 wing palette geosets, got ${wingPaletteGeosets}`)
    if (dominantCandidateCount < 1000) fail(`Expected many dominant wing vertices, got ${dominantCandidateCount}`)
    if (!dominant || !balanced || !single || !firstWingVertex) fail('Missing dominant/balanced/single wing skinning samples from tx_202 fixture')
    const sourceBones = new Map()
    for (let index = 0; index < (dir.get('nbon') ?? 0); index += 1) {
        const offset = (dir.get('abon') ?? 0) + index * 0xac
        sourceBones.set(index, {
            name: readCString(head, head.readUInt32LE(offset + 8)),
            positionKeyCount: Math.max(0, head.readInt32LE(offset + 140)),
            positionKeyAddr: head.readUInt32LE(offset + 144),
        })
    }
    return { version, dominant, balanced, single, firstWingVertex, sourceBones, data }
}

const padInfluences = (influences) => {
    const boneIds = []
    const weights = []
    for (let index = 0; index < 4; index += 1) {
        boneIds.push(influences[index]?.boneId ?? 0)
        weights.push(influences[index]?.weight ?? 0)
    }
    return { boneIds, weights }
}

const makeBone = (boneId, worldTranslation, positionKeys = []) => ({
    boneIndex: boneId,
    name: `Bone${String(boneId).padStart(3, '0')}`,
    parentId: -1,
    worldTranslation,
    localTranslation: null,
    inverseBindMatrix: null,
    bindMatrix: null,
    rawFlags: 0,
    saveFlags: 0,
    positionKeys,
    rotationKeys: [],
    scaleKeys: [],
    visibilityKeys: [],
})

const buildSyntheticScene = (samples) => {
    const allBoneIds = Array.from(new Set([
        ...samples.dominant.map((item) => item.boneId),
        ...samples.balanced.map((item) => item.boneId),
        ...samples.single.map((item) => item.boneId),
    ])).sort((a, b) => a - b)
    const worldTranslationByBoneId = new Map(allBoneIds.map((boneId, index) => [
        boneId,
        [10 + index * 7, 20 + index * 11, 30 + index * 13],
    ]))
    const animatedBoneId = samples.dominant[0].boneId
    const animatedSourcePosition = [42, 64, 86]
    const padded = [samples.dominant, samples.balanced, samples.single].map(padInfluences)
    const expectedFirstWingWar3Vertex = transformJumpxVec3(samples.firstWingVertex)
    return {
        expectedFirstWingWar3Vertex,
        probe: {
            ok: true,
            path: fixturePath,
            fileSize: fs.statSync(fixturePath).size,
            format: 'JumpX',
            version: samples.version,
            headSize: 0,
            dataSize: 0,
            headCompressedSize: 0,
            dataCompressedSize: 0,
            textureCount: 0,
            materialCount: 0,
            geometryCount: 1,
            boneCount: allBoneIds.length,
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
            name: 'tx_202_s06_2_02_skin1_wing_classic_probe',
            materialId: 0,
            geometryType: 0,
            ancestorBoneId: samples.dominant[0].boneId,
            vertexCount: 3,
            indexCount: 3,
            vertices: [...samples.firstWingVertex, 32, 0, 0, 0, 32, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 0, 1, 0, 0, 1],
            uv2: null,
            vertexColors: null,
            indices: [0, 1, 2],
            skinWeightStride: 4,
            skinWeightCounts: [samples.dominant.length, samples.balanced.length, samples.single.length],
            skinBoneIds: padded.flatMap((item) => item.boneIds),
            skinWeights: padded.flatMap((item) => item.weights),
            minimumExtent: [
                Math.min(samples.firstWingVertex[0], 0),
                Math.min(samples.firstWingVertex[1], 0),
                Math.min(samples.firstWingVertex[2], 0),
            ],
            maximumExtent: [
                Math.max(samples.firstWingVertex[0], 32),
                Math.max(samples.firstWingVertex[1], 32),
                Math.max(samples.firstWingVertex[2], 0),
            ],
            boundsRadius: 23,
            objectPivot: [101, 202, 303],
            objectScale: [1, 1, 1],
            inverseBindMatrix: [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                900, 800, 700, 1,
            ],
            rawFlags: 64,
            saveFlags: 64,
        }],
        bones: allBoneIds.map((boneId) => makeBone(
            boneId,
            worldTranslationByBoneId.get(boneId),
            boneId === animatedBoneId
                ? [{ frame: 320, timeMs: 1000, value: animatedSourcePosition, rawFlags: 0 }]
                : [],
        )),
        boneGroups: [],
        attachments: [],
        ribbons: [],
        particles: [],
        actions: [],
    }
}

const buildImportBundle = async () => {
    await esbuild.build({
        stdin: {
            contents: [
                "export { buildJumpxStaticModelData } from './src/renderer/src/application/model-import/JumpxModelBuilder.ts'",
                "export { applyJumpxAnimationTracks } from './src/renderer/src/application/model-import/JumpxAnimationMapper.ts'",
                "export { chooseClassicInfluencesForJumpxWeights } from './src/renderer/src/application/model-import/JumpxGeosetMapper.ts'",
                "export { prepareModelDataForSave } from './src/renderer/src/application/model-save/prepareModelDataForSave.ts'",
            ].join('\n'),
            resolveDir: repoRoot,
            sourcefile: 'jumpx-tx202-classic-check-entry.ts',
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

const assertGroup = (geoset, vertexIndex, expectedObjectIds, label) => {
    const groupIndex = geoset.VertexGroup?.[vertexIndex]
    const actual = Array.from(geoset.Groups?.[groupIndex] ?? [])
    if (JSON.stringify(actual) !== JSON.stringify(expectedObjectIds)) {
        fail(`${label} classic group mismatch: ${JSON.stringify(actual)} vs ${JSON.stringify(expectedObjectIds)}`)
    }
}

const main = async () => {
    if (!fs.existsSync(fixturePath)) {
        console.log('JumpX tx_202_s06 fixture not present; skipping classic skinning check')
        return
    }

    const samples = findFixtureSamples()
    await buildImportBundle()
    const {
        applyJumpxAnimationTracks,
        buildJumpxStaticModelData,
        chooseClassicInfluencesForJumpxWeights,
        prepareModelDataForSave,
    } = await import(pathToFileURL(bundlePath).href)

    const chosenDominant = chooseClassicInfluencesForJumpxWeights(samples.dominant.map((item) => ({
        objectId: item.boneId,
        weight: item.weight,
    })))
    if (chosenDominant.length !== 1 || chosenDominant[0].objectId !== samples.dominant[0].boneId) {
        fail(`Dominant tx_202 wing weights should collapse to the strongest classic bone, got ${JSON.stringify(chosenDominant)}`)
    }

    const chosenBalanced = chooseClassicInfluencesForJumpxWeights(samples.balanced.map((item) => ({
        objectId: item.boneId,
        weight: item.weight,
    })))
    if (chosenBalanced.length !== 2) {
        fail(`Balanced tx_202 wing weights should remain a 2-bone classic group, got ${JSON.stringify(chosenBalanced)}`)
    }

    const scene = buildSyntheticScene(samples)
    const { modelData, nodeMapping } = buildJumpxStaticModelData(fixturePath, scene)
    applyJumpxAnimationTracks(scene, modelData, nodeMapping)
    if (modelData.Version?.FormatVersion !== 800) {
        fail(`JumpX classic import must stay MDX 800, got ${modelData.Version?.FormatVersion}`)
    }
    const geoset = modelData.Geosets?.[0]
    if (!geoset) fail('Synthetic tx_202 classic skinning scene produced no geoset')
    if ('SkinWeights' in geoset) fail('JumpX classic 800 geoset must not carry HD SkinWeights')
    const firstImportedVertex = Array.from(geoset.Vertices ?? []).slice(0, 3)
    if (firstImportedVertex.some((value, index) => Math.abs(value - scene.expectedFirstWingWar3Vertex[index]) > 1e-5)) {
        fail(`Multi-bone tx_202 wing T-pose vertex should stay in source mesh space ${JSON.stringify(scene.expectedFirstWingWar3Vertex)}, got ${JSON.stringify(firstImportedVertex)}`)
    }

    const dominantObjectId = nodeMapping.objectIdByBoneId.get(samples.dominant[0].boneId)
    const balancedObjectIds = samples.balanced.map((item) => nodeMapping.objectIdByBoneId.get(item.boneId))
    const singleObjectId = nodeMapping.objectIdByBoneId.get(samples.single[0].boneId)
    if (dominantObjectId === undefined || balancedObjectIds.some((value) => value === undefined) || singleObjectId === undefined) {
        fail('Missing synthetic node mapping for tx_202 sampled bones')
    }
    const dominantMeshObjectId = nodeMapping.meshObjectIdByBoneId.get(samples.dominant[0].boneId)
    const balancedMeshObjectIds = samples.balanced.map((item) => nodeMapping.meshObjectIdByBoneId.get(item.boneId))
    const singleMeshObjectId = nodeMapping.meshObjectIdByBoneId.get(samples.single[0].boneId)
    if (dominantMeshObjectId === undefined || balancedMeshObjectIds.some((value) => value === undefined) || singleMeshObjectId === undefined) {
        fail('Missing synthetic mesh-node mapping for tx_202 sampled bones')
    }
    assertGroup(geoset, 0, [dominantMeshObjectId], 'dominant tx_202 wing vertex')
    assertGroup(geoset, 1, balancedMeshObjectIds, 'balanced tx_202 wing vertex')
    assertGroup(geoset, 2, [singleMeshObjectId], 'single tx_202 wing vertex')

    const dominantBone = modelData.Bones?.find((bone) => bone.ObjectId === dominantObjectId)
    const sourceDominantBone = scene.bones.find((bone) => bone.boneIndex === samples.dominant[0].boneId)
    if (!dominantBone || !sourceDominantBone) fail('Missing dominant bone for tx_202 pivot check')
    const expectedPivot = transformJumpxVec3(sourceDominantBone.worldTranslation)
    const actualPivot = Array.from(dominantBone.PivotPoint ?? [])
    if (actualPivot.some((value, index) => Math.abs(value - expectedPivot[index]) > 1e-6)) {
        fail(`Dominant tx_202 bone pivot should preserve bind position ${JSON.stringify(expectedPivot)}, got ${JSON.stringify(actualPivot)}`)
    }
    const expectedTranslation = transformJumpxVec3(sourceDominantBone.positionKeys[0].value)
        .map((value, index) => value - expectedPivot[index])
    const actualTranslation = Array.from(dominantBone.Translation?.Keys?.[0]?.Vector ?? [])
    if (actualTranslation.some((value, index) => Math.abs(value - expectedTranslation[index]) > 1e-6)) {
        fail(`Dominant tx_202 bone translation should be key minus pivot ${JSON.stringify(expectedTranslation)}, got ${JSON.stringify(actualTranslation)}`)
    }
    const meshBone = modelData.Bones?.find((bone) => bone.ObjectId === dominantMeshObjectId)
    const meshPivot = Array.from(meshBone?.PivotPoint ?? [])
    if (meshPivot.some((value) => Math.abs(value) > 1e-7)) {
        fail(`JumpX *_Mesh helper bone should keep origin pivot for inverse-bind path, got ${JSON.stringify(meshPivot)}`)
    }
    const meshRestTranslation = Array.from(meshBone?.Translation?.Keys?.find((key) => key.Frame === 0)?.Vector ?? [])
    const meshRestRotation = Array.from(meshBone?.Rotation?.Keys?.find((key) => key.Frame === 0)?.Vector ?? [])
    const meshRestScaling = Array.from(meshBone?.Scaling?.Keys?.find((key) => key.Frame === 0)?.Vector ?? [])
    if (
        JSON.stringify(meshRestTranslation) !== JSON.stringify([0, 0, 0])
        || JSON.stringify(meshRestRotation) !== JSON.stringify([0, 0, 0, 1])
        || JSON.stringify(meshRestScaling) !== JSON.stringify([1, 1, 1])
    ) {
        fail(`JumpX *_Mesh helper bone must keep identity T-pose keys, got T=${JSON.stringify(meshRestTranslation)} R=${JSON.stringify(meshRestRotation)} S=${JSON.stringify(meshRestScaling)}`)
    }
    const meshAnimatedTranslation = Array.from(meshBone?.Translation?.Keys?.find((key) => key.Frame === 1000)?.Vector ?? [])
    if (meshAnimatedTranslation.length !== 3 || meshAnimatedTranslation.every((value) => Math.abs(value) < 1e-7)) {
        fail(`JumpX *_Mesh helper bone should carry animated TRS*inverseBind keys after T-pose, got ${JSON.stringify(meshAnimatedTranslation)}`)
    }

    const generatedMdx = generateMDX(prepareModelDataForSave(modelData))
    const roundTripBuffer = generatedMdx instanceof ArrayBuffer
        ? generatedMdx
        : generatedMdx.buffer.slice(generatedMdx.byteOffset, generatedMdx.byteOffset + generatedMdx.byteLength)
    const roundTripFormatVersion = readMdxFormatVersion(roundTripBuffer)
    if (roundTripFormatVersion !== 800) {
        fail(`Round-trip JumpX skinning check must remain MDX 800, got ${roundTripFormatVersion}`)
    }
    const roundTrip = parseMDX(roundTripBuffer)
    if ((roundTrip.Geosets ?? []).some((item) => 'SkinWeights' in item)) {
        fail('Round-trip classic MDX 800 output must not contain SkinWeights')
    }

    console.log('JumpX tx_202 classic skinning check passed')
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
