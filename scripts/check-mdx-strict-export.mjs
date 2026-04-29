import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'
import { generateMDX, parseMDL, parseMDX } from 'war3-model'

const MDLX_TAG = 'MDLX'
const CHUNK_HEADER_SIZE = 8
const repoRoot = new URL('../', import.meta.url)
const defaultMdlUrl = new URL('testmodel/23.mdl', repoRoot)
const strictExportUrl = new URL('src/renderer/src/infrastructure/serialization/strictMdxExport.ts', repoRoot)

const fail = (message) => {
    throw new Error(message)
}

const readChunkTag = (bytes, offset) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const readUint32LE = (bytes, offset) =>
    (
        bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)
    ) >>> 0

const readMdxChunksStrict = (bytes, label) => {
    if (bytes.length < 4 || readChunkTag(bytes, 0) !== MDLX_TAG) {
        fail(`${label}: missing MDLX header`)
    }

    const chunks = []
    let offset = 4

    while (offset < bytes.length) {
        if (offset + CHUNK_HEADER_SIZE > bytes.length) {
            fail(`${label}: truncated chunk header at byte ${offset}`)
        }

        const tag = readChunkTag(bytes, offset)
        if (!/^[A-Z0-9]{4}$/.test(tag)) {
            fail(`${label}: invalid chunk tag "${tag}" at byte ${offset}`)
        }

        const size = readUint32LE(bytes, offset + 4)
        const nextOffset = offset + CHUNK_HEADER_SIZE + size
        if (nextOffset > bytes.length) {
            fail(`${label}: chunk ${tag} at byte ${offset} extends past EOF`)
        }

        chunks.push({ tag, offset, size })
        offset = nextOffset
    }

    return chunks
}

const summarizeChunks = (chunks) =>
    chunks.map((chunk) => `${chunk.tag}:${chunk.size}`).join(' -> ')

const loadStrictExportPostprocess = async () => {
    const source = await readFile(strictExportUrl, 'utf8')
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
    const module = await import(moduleUrl)

    if (typeof module.applyWar3GameMdxExportRules !== 'function') {
        fail('strictMdxExport.ts does not export applyWar3GameMdxExportRules')
    }

    return module.applyWar3GameMdxExportRules
}

const checkChunkOrder = (bytes, label) => {
    return readMdxChunksStrict(bytes, label)
}

const writeTag = (bytes, offset, tag) => {
    bytes[offset] = tag.charCodeAt(0)
    bytes[offset + 1] = tag.charCodeAt(1)
    bytes[offset + 2] = tag.charCodeAt(2)
    bytes[offset + 3] = tag.charCodeAt(3)
}

const writeUint32LE = (bytes, offset, value) => {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
    bytes[offset + 3] = (value >>> 24) & 0xff
}

const makeSyntheticMdx = (chunks) => {
    const byteLength = 4 + chunks.reduce((sum, chunk) => sum + CHUNK_HEADER_SIZE + chunk.size, 0)
    const bytes = new Uint8Array(byteLength)
    writeTag(bytes, 0, MDLX_TAG)

    let offset = 4
    for (const chunk of chunks) {
        writeTag(bytes, offset, chunk.tag)
        writeUint32LE(bytes, offset + 4, chunk.size)
        offset += CHUNK_HEADER_SIZE + chunk.size
    }

    return bytes
}

const assertPremBeforePre2 = (chunks, label) => {
    const premIndex = chunks.findIndex((chunk) => chunk.tag === 'PREM')
    const pre2Index = chunks.findIndex((chunk) => chunk.tag === 'PRE2')

    if (pre2Index === -1) {
        fail(`${label}: missing PRE2 chunk`)
    }
    if (premIndex === -1) {
        fail(`${label}: missing PREM chunk before PRE2`)
    }
    if (chunks[premIndex].size !== 0) {
        fail(`${label}: expected PREM:0, found PREM:${chunks[premIndex].size}`)
    }
    if (premIndex + 1 !== pre2Index) {
        fail(`${label}: expected PREM:0 -> PRE2, found ${summarizeChunks(chunks)}`)
    }
}

const sameBytes = (left, right) =>
    left.length === right.length && left.every((value, index) => value === right[index])

const checkSyntheticStrictExport = async () => {
    const applyWar3GameMdxExportRules = await loadStrictExportPostprocess()
    const rawBytes = makeSyntheticMdx([
        { tag: 'VERS', size: 4 },
        { tag: 'PIVT', size: 0 },
        { tag: 'PRE2', size: 0 },
    ])
    const processedBytes = applyWar3GameMdxExportRules(rawBytes)
    const processedChunks = checkChunkOrder(processedBytes, 'synthetic PRE2-only export')
    assertPremBeforePre2(processedChunks, 'synthetic PRE2-only export')

    const processedAgain = applyWar3GameMdxExportRules(processedBytes)
    if (!sameBytes(processedBytes, processedAgain)) {
        fail('synthetic PRE2-only export: postprocess is not idempotent')
    }

    const noPre2 = makeSyntheticMdx([{ tag: 'VERS', size: 4 }])
    if (!sameBytes(noPre2, applyWar3GameMdxExportRules(noPre2))) {
        fail('synthetic no-PRE2 export: postprocess should not change bytes')
    }

    const existingPrem = makeSyntheticMdx([
        { tag: 'VERS', size: 4 },
        { tag: 'PREM', size: 0 },
        { tag: 'PRE2', size: 0 },
    ])
    if (!sameBytes(existingPrem, applyWar3GameMdxExportRules(existingPrem))) {
        fail('synthetic PREM/PRE2 export: postprocess should not duplicate PREM')
    }

    console.log(`OK synthetic postprocess chunks: ${summarizeChunks(processedChunks)}`)
}

const check23MdlStrictExport = async () => {
    const applyWar3GameMdxExportRules = await loadStrictExportPostprocess()
    let mdlText
    try {
        mdlText = await readFile(defaultMdlUrl, 'utf8')
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            console.log('SKIP testmodel/23.mdl local regression fixture was not found')
            return
        }
        throw error
    }

    const model = parseMDL(mdlText)
    const rawBytes = new Uint8Array(generateMDX(model))
    const rawChunks = checkChunkOrder(rawBytes, 'war3-model raw export')
    const processedBytes = applyWar3GameMdxExportRules(rawBytes)
    const processedChunks = checkChunkOrder(processedBytes, 'project strict postprocess export')
    assertPremBeforePre2(processedChunks, 'project strict postprocess export')

    parseMDX(processedBytes.buffer.slice(processedBytes.byteOffset, processedBytes.byteOffset + processedBytes.byteLength))

    console.log(`OK testmodel/23.mdl raw chunks: ${summarizeChunks(rawChunks)}`)
    console.log(`OK testmodel/23.mdl postprocess chunks: ${summarizeChunks(processedChunks)}`)
}

await checkSyntheticStrictExport()
await check23MdlStrictExport()
