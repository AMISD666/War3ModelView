import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const repoRoot = path.resolve(import.meta.dirname, '..')
const defaultJumpxPath = path.join(repoRoot, 'testmodel', 'tx_268_s04_5_01.x')
const jumpxPath = path.resolve(process.argv[2] ?? defaultJumpxPath)

const JUMPX_FILE_HEAD = Buffer.from([
    ...Buffer.from('JUMPX V5.01     WWW.JUMPW.COM   ', 'ascii'),
    0xb4, 0xac, 0xb3, 0xa4, 0x20, 0x20, 0xb0, 0xd1, 0xba, 0xda, 0xb6, 0xb4,
    0xd7, 0xb0, 0xd4, 0xda, 0xc6, 0xbf, 0xd7, 0xd3, 0xc0, 0xef, 0xb5, 0xc4,
    0xc8, 0xcb,
    ...Buffer.from('!WEIBO.COM/WUYAXIT', 'ascii'),
    0, 0, 0, 0,
])

const OFFSET_BIAS = 1_000_000_000
const MATERIAL_RECORD_SIZE = 0x30
const MATERIAL_SAMPLE_RECORD_SIZE = 16
const GEOMETRY_RECORD_SIZE = 0x7c

const RENDER_FLAGS = [
    ['SPECULARENABLE', 0x1000],
    ['SORTBYFARZ', 0x2000],
    ['ALPHABLEND', 0x4000],
    ['ALPHATEST', 0x8000],
    ['TWOSIDED', 0x10000],
    ['BLEND', 0x20000],
    ['ADD', 0x40000],
    ['MODULATE', 0x80000],
    ['MODULATE2X', 0x100000],
    ['MODULATE4X', 0x200000],
    ['ALPHAKEY', 0x400000],
    ['UNSHADED', 0x800000],
    ['UNFOGGED', 0x1000000],
    ['ZWRITEENABLE', 0x2000000],
    ['UVCLAMP', 0x4000000],
]

const FILTER_MODE_NONE = 'None(0)'
const FILTER_MODE_TRANSPARENT = 'Transparent(1)'
const FILTER_MODE_BLEND = 'Blend(2)'
const FILTER_MODE_ADDITIVE = 'Additive(3)'

const toHex = (value) => `0x${(value >>> 0).toString(16).padStart(8, '0')}`

const flagNames = (value) => {
    const names = RENDER_FLAGS
        .filter(([, bit]) => (value & bit) !== 0)
        .map(([name]) => name)
    return names.length > 0 ? names.join('|') : '0'
}

const mapJumpxPolygonFilterMode = (flags) => {
    if ((flags & 0x40000) !== 0) return FILTER_MODE_ADDITIVE
    if ((flags & (0x4000 | 0x20000)) !== 0) return FILTER_MODE_BLEND
    if ((flags & (0x8000 | 0x400000)) !== 0) return FILTER_MODE_TRANSPARENT
    return FILTER_MODE_NONE
}

const readJumpxContainer = (filePath) => {
    const bytes = fs.readFileSync(filePath)
    if (!bytes.subarray(0, JUMPX_FILE_HEAD.length).equals(JUMPX_FILE_HEAD)) {
        throw new Error(`Invalid JumpX file header: ${filePath}`)
    }

    let offset = JUMPX_FILE_HEAD.length
    const version = bytes.readInt32LE(offset)
    offset += 4
    const headerTableBytes = bytes.readUInt32LE(offset)
    offset += 4
    if (headerTableBytes % 12 !== 0) {
        throw new Error(`Corrupted JumpX header table size: ${headerTableBytes}`)
    }

    const dir = new Map()
    for (let index = 0; index < headerTableBytes / 12; index += 1) {
        const tag = bytes.toString('ascii', offset, offset + 4)
        const valueSize = bytes.readUInt32LE(offset + 4)
        const value = bytes.readUInt32LE(offset + 8)
        offset += 12
        if (valueSize !== 4) throw new Error(`Unexpected JumpX dir value size for ${tag}: ${valueSize}`)
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
        throw new Error(`JumpX inflated size mismatch: head=${head.length}/${headSize}, data=${data.length}/${dataSize}`)
    }

    return { version, dir, head, data }
}

const decryptOffset = (value) => {
    if (value < OFFSET_BIAS) return null
    return value - OFFSET_BIAS
}

const readGeosetMaterialUsage = ({ dir, head }) => {
    const count = dir.get('ngeo') ?? 0
    const base = dir.get('ageo') ?? 0
    const usage = new Map()
    const materialIds = []
    for (let index = 0; index < count; index += 1) {
        const offset = base + index * GEOMETRY_RECORD_SIZE
        const materialId = head.readInt32LE(offset + 16)
        materialIds.push(materialId)
        usage.set(materialId, (usage.get(materialId) ?? 0) + 1)
    }
    return { materialIds, usage }
}

const readMaterialBlendValues = (data, sampleAddr, sampleCount) => {
    const dataOffset = decryptOffset(sampleAddr)
    if (dataOffset === null || sampleCount === 0) return []
    const values = []
    for (let index = 0; index < sampleCount; index += 1) {
        values.push(data.readUInt32LE(dataOffset + index * MATERIAL_SAMPLE_RECORD_SIZE + 12))
    }
    return [...new Set(values)].sort((a, b) => a - b)
}

const readMaterialGroups = ({ dir, head, data }, usage) => {
    const count = dir.get('nmtl') ?? 0
    const base = dir.get('amtl') ?? 0
    const groups = new Map()
    for (let index = 0; index < count; index += 1) {
        const offset = base + index * MATERIAL_RECORD_SIZE
        const saveFlags = head.readUInt32LE(offset + 4)
        const rawFlags = head.readUInt32LE(offset + 8)
        const textureId = head.readInt32LE(offset + 12)
        const sampleCount = head.readUInt32LE(offset + 40)
        const sampleAddr = head.readUInt32LE(offset + 44)
        const blendValues = readMaterialBlendValues(data, sampleAddr, sampleCount)
        const blendFlags = blendValues.reduce((flags, value) => flags | value, 0) >>> 0
        const allFlags = (rawFlags | saveFlags | blendFlags) >>> 0
        const key = `${toHex(rawFlags)}|${toHex(saveFlags)}|${toHex(blendFlags)}`
        if (!groups.has(key)) {
            groups.set(key, {
                rawFlags,
                saveFlags,
                blendFlags,
                allFlags,
                materials: [],
                geosets: 0,
                textureIds: new Set(),
                sampleCounts: new Set(),
                blendValues: new Set(),
            })
        }
        const group = groups.get(key)
        group.materials.push(index)
        group.geosets += usage.get(index) ?? 0
        group.textureIds.add(textureId)
        group.sampleCounts.add(sampleCount)
        blendValues.forEach((value) => group.blendValues.add(value))
    }
    return [...groups.values()].sort((a, b) => a.allFlags - b.allFlags || a.materials[0] - b.materials[0])
}

const printMaterialGroups = (scene) => {
    const { usage, materialIds } = readGeosetMaterialUsage(scene)
    const groups = readMaterialGroups(scene, usage)
    console.log(`JumpX material flag summary: ${jumpxPath}`)
    console.log(`version=${scene.version} materials=${scene.dir.get('nmtl') ?? 0} geosets=${scene.dir.get('ngeo') ?? 0}`)
    console.log(`geoset material ids: ${materialIds.join(',')}`)
    console.log('')
    for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index]
        const blendValues = [...group.blendValues].sort((a, b) => a - b)
        console.log(`${index + 1}. materials=${group.materials.join(',')} geosets=${group.geosets}`)
        console.log(`   textures=${[...group.textureIds].join(',')} sampleCounts=${[...group.sampleCounts].join(',')}`)
        console.log(`   raw=${toHex(group.rawFlags)} [${flagNames(group.rawFlags)}]`)
        console.log(`   save=${toHex(group.saveFlags)} [${flagNames(group.saveFlags)}]`)
        console.log(`   sampleBlendOR=${toHex(group.blendFlags)} [${flagNames(group.blendFlags)}]`)
        console.log(`   all=${toHex(group.allFlags)} [${flagNames(group.allFlags)}]`)
        console.log(`   sampleBlendValues=${blendValues.map((value) => `${toHex(value)}[${flagNames(value)}]`).join(', ') || 'none'}`)
        console.log(`   proposedMdxFilterMode=${mapJumpxPolygonFilterMode(group.allFlags)}`)
    }
}

printMaterialGroups(readJumpxContainer(jumpxPath))
