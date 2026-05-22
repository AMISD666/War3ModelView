import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = process.cwd()
const sourcePath = path.join(repoRoot, 'testmodel', 'tx_053_s03_2_03_skin10_zhibao1.mdx')
const brokenPath = path.join(repoRoot, 'testmodel', '001.mdx')
const tempDir = path.join(repoRoot, '.tmp-check-geoset-delete-preserves-bones')
const war3Model = await import(pathToFileURL(path.join(repoRoot, 'vendor', 'war3-model', 'dist', 'war3-model.cjs')).href)

const assert = (condition, message) => {
    if (!condition) throw new Error(message)
}

const readBytes = (filePath) => fs.readFileSync(filePath)
const parseModel = (filePathOrBytes) => {
    const bytes = filePathOrBytes instanceof Uint8Array ? filePathOrBytes : readBytes(filePathOrBytes)
    return war3Model.parseMDX(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

const readTag = (bytes, offset) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const readUint32 = (bytes, offset) =>
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0

const listChunkTags = (bytes) => {
    const tags = []
    let offset = 4
    while (offset + 8 <= bytes.length) {
        const tag = readTag(bytes, offset)
        const size = readUint32(bytes, offset + 4)
        tags.push(tag)
        offset += 8 + size
    }
    return tags
}

const compileSupportModules = () => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.mkdirSync(tempDir, { recursive: true })

    return Promise.all([
        esbuild.build({
            entryPoints: ['src/renderer/src/commands/geosetDeletionReferenceRemap.ts'],
            outfile: path.join(tempDir, 'geosetDeletionReferenceRemap.mjs'),
            bundle: true,
            format: 'esm',
            platform: 'node',
            logLevel: 'silent',
        }),
        esbuild.build({
            entryPoints: ['src/renderer/src/store/modelStore.ts'],
            outfile: path.join(tempDir, 'modelStore.mjs'),
            bundle: true,
            format: 'esm',
            platform: 'node',
            logLevel: 'silent',
            external: ['@tauri-apps/*', 'antd', 'zustand', 'gl-matrix'],
        }),
        esbuild.build({
            entryPoints: ['src/renderer/src/application/model-save/prepareModelDataForSave.ts'],
            outfile: path.join(tempDir, 'prepareModelDataForSave.mjs'),
            bundle: true,
            format: 'esm',
            platform: 'node',
            logLevel: 'silent',
        }),
        esbuild.build({
            entryPoints: ['src/renderer/src/infrastructure/serialization/strictMdxExport.ts'],
            outfile: path.join(tempDir, 'strictMdxExport.mjs'),
            bundle: true,
            format: 'esm',
            platform: 'node',
            logLevel: 'silent',
        }),
    ])
}

try {
    await compileSupportModules()

    const { buildModelDataWithGeosetRemovalReferences } = await import(pathToFileURL(path.join(tempDir, 'geosetDeletionReferenceRemap.mjs')).href)
    const { extractNodesFromModel, updateModelDataWithNodes } = await import(pathToFileURL(path.join(tempDir, 'modelStore.mjs')).href)
    const { prepareModelDataForSave } = await import(pathToFileURL(path.join(tempDir, 'prepareModelDataForSave.mjs')).href)
    const { applyWar3GameMdxExportRules } = await import(pathToFileURL(path.join(tempDir, 'strictMdxExport.mjs')).href)

    const source = parseModel(sourcePath)
    assert(source.Geosets.length === 71, 'fixture sanity expected 71 geosets before deletion')
    assert(source.GeosetAnims.length === 71, 'fixture sanity expected 71 geoset anims before deletion')
    assert(source.Bones.length === 218, 'fixture sanity expected 218 bones before deletion')
    assert(source.Helpers.length === 0, 'fixture sanity expected no helpers before deletion')
    assert(source.Bones.every((bone) => bone.GeosetId === null && bone.GeosetAnimId === null), 'fixture sanity expected unbound bones')

    if (fs.existsSync(brokenPath)) {
        const broken = parseModel(brokenPath)
        assert(broken.Bones.length === 0 && broken.Helpers.length === 218, 'broken fixture should demonstrate BONE to HELP regression')
    }

    const nextGeosets = source.Geosets.slice(1)
    const afterDelete = buildModelDataWithGeosetRemovalReferences(source, nextGeosets, [0])
    assert(afterDelete.Geosets.length === 70, 'delete simulation expected 70 geosets')
    assert(afterDelete.GeosetAnims.length === 70, 'delete simulation expected 70 geoset anims')

    const nodesFromUntypedModel = extractNodesFromModel({
        ...afterDelete,
        Bones: [],
        Helpers: [],
        Nodes: afterDelete.Bones.map((bone) => {
            const { type, ...rawBone } = bone
            return rawBone
        }),
    })
    assert(nodesFromUntypedModel.filter((node) => node.type === 'Bone').length === 218, 'raw Nodes fallback should recover all bone nodes')
    assert(nodesFromUntypedModel.filter((node) => node.type === 'Helper').length === 0, 'raw Nodes fallback must not classify bone-like nodes as Helper')

    const rebuiltAfterPotentialSnapshotDrift = updateModelDataWithNodes(afterDelete, nodesFromUntypedModel, false)
    assert(rebuiltAfterPotentialSnapshotDrift.Bones.length === 218, 'rebuilt model should preserve bones after fallback extraction')
    assert(rebuiltAfterPotentialSnapshotDrift.Helpers.length === 0, 'rebuilt model should not turn bones into helpers')

    const prepared = prepareModelDataForSave(rebuiltAfterPotentialSnapshotDrift)
    const generatedBytes = applyWar3GameMdxExportRules(new Uint8Array(war3Model.generateMDX(prepared)))
    const roundTrip = parseModel(generatedBytes)
    const chunkTags = listChunkTags(generatedBytes)

    assert(roundTrip.Geosets.length === 70, 'roundtrip should keep 70 geosets')
    assert(roundTrip.GeosetAnims.length === 70, 'roundtrip should keep 70 geoset anims')
    assert(roundTrip.Bones.length === 218, 'roundtrip should keep 218 bones')
    assert(roundTrip.Helpers.length === 0, 'roundtrip should not write the deleted model bones as helpers')
    assert(roundTrip.Info.NumBones === 218, 'roundtrip Info.NumBones should stay 218')
    assert(chunkTags.includes('BONE'), 'saved MDX should contain a BONE chunk')
    assert(!chunkTags.includes('HELP'), 'saved MDX should not contain the accidental HELP chunk for this fixture')

    console.log('ok - deleting first geoset preserves BONE nodes for tx_053_s03_2_03_skin10_zhibao1.mdx')
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
}
