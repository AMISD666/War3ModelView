export interface MdxChunkInfo {
    tag: string
    offset: number
    size: number
}

const MDLX_TAG = 'MDLX'
const PREM_TAG = 'PREM'
const PRE2_TAG = 'PRE2'
const CHUNK_HEADER_SIZE = 8

const readChunkTag = (bytes: Uint8Array, offset: number): string =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const writeChunkTag = (bytes: Uint8Array, offset: number, tag: string): void => {
    bytes[offset] = tag.charCodeAt(0)
    bytes[offset + 1] = tag.charCodeAt(1)
    bytes[offset + 2] = tag.charCodeAt(2)
    bytes[offset + 3] = tag.charCodeAt(3)
}

const readUint32LE = (bytes: Uint8Array, offset: number): number =>
    (
        bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)
    ) >>> 0

const writeUint32LE = (bytes: Uint8Array, offset: number, value: number): void => {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
    bytes[offset + 3] = (value >>> 24) & 0xff
}

const isMdx = (bytes: Uint8Array): boolean =>
    bytes.length >= 4 && readChunkTag(bytes, 0) === MDLX_TAG

export const readMdxChunks = (bytes: Uint8Array): MdxChunkInfo[] => {
    if (!isMdx(bytes)) {
        return []
    }

    const chunks: MdxChunkInfo[] = []
    let offset = 4

    while (offset + CHUNK_HEADER_SIZE <= bytes.length) {
        const tag = readChunkTag(bytes, offset)
        const size = readUint32LE(bytes, offset + 4)
        const nextOffset = offset + CHUNK_HEADER_SIZE + size

        if (nextOffset > bytes.length) {
            break
        }

        chunks.push({ tag, offset, size })
        offset = nextOffset
    }

    return chunks
}

const insertEmptyChunk = (bytes: Uint8Array, offset: number, tag: string): Uint8Array => {
    const patched = new Uint8Array(bytes.length + CHUNK_HEADER_SIZE)
    patched.set(bytes.subarray(0, offset), 0)
    writeChunkTag(patched, offset, tag)
    writeUint32LE(patched, offset + 4, 0)
    patched.set(bytes.subarray(offset), offset + CHUNK_HEADER_SIZE)
    return patched
}

const ensureParticleEmitterChunkBeforeParticleEmitter2 = (bytes: Uint8Array): Uint8Array => {
    const chunks = readMdxChunks(bytes)
    const particleEmitterChunk = chunks.find((chunk) => chunk.tag === PREM_TAG)
    const particleEmitter2Chunk = chunks.find((chunk) => chunk.tag === PRE2_TAG)

    if (particleEmitterChunk || !particleEmitter2Chunk) {
        return bytes
    }

    return insertEmptyChunk(bytes, particleEmitter2Chunk.offset, PREM_TAG)
}

export const applyWar3GameMdxExportRules = (bytes: Uint8Array): Uint8Array => {
    let result = bytes

    result = ensureParticleEmitterChunkBeforeParticleEmitter2(result)

    return result
}
