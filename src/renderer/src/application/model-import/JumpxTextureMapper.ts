import type { Texture } from '../../types/model'
import type { JumpxStaticSceneResult } from '../../types/jumpxImport'
import { normalizeWindowsPath } from '../../utils/windowsPath'

const TEXTURE_WRAP_WIDTH = 0x1
const TEXTURE_WRAP_HEIGHT = 0x2

const REFERENCE_TEXTURE_SLOTS: Texture[] = [
    { Image: 'tx_dian_16005.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_xulie_12008.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_dian_0049.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_xingguang_0076.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_kuosan_0059.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_dian_1013.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_xingguang_19001.blp', ReplaceableId: 0, Flags: 0 },
    { Image: 'tx_dian_0049.blp', ReplaceableId: 0, Flags: 3 },
    { Image: 'tx_moxing_12136.blp', ReplaceableId: 0, Flags: 3 },
    { Image: 'tx_moxing_12137.blp', ReplaceableId: 0, Flags: 3 },
    { Image: 'tx_tiaodai_0167.blp', ReplaceableId: 0, Flags: 3 },
]

export const jumpxTextureWrapFlags = TEXTURE_WRAP_WIDTH | TEXTURE_WRAP_HEIGHT

export const chooseJumpxTexturePath = (sourceModelDir: string, value: string): string => {
    const normalized = normalizeWindowsPath(value.trim())
    if (!normalized) return ''
    const normalizedDir = normalizeWindowsPath(sourceModelDir).replace(/[\\]+$/, '')
    const lowerSource = normalized.toLowerCase()
    const lowerDir = normalizedDir.toLowerCase()
    const relativeOrAbsolute = lowerSource.startsWith(`${lowerDir}\\`) ? normalized.slice(normalizedDir.length + 1) : normalized
    return relativeOrAbsolute.replace(/\.(dds|tga)$/i, '.blp')
}

const mapTextureFlags = (flags: number): number => {
    let textureFlags = 0
    if ((flags & TEXTURE_WRAP_WIDTH) !== 0) textureFlags |= 1
    if ((flags & TEXTURE_WRAP_HEIGHT) !== 0) textureFlags |= 2
    return textureFlags
}

export const buildJumpxTextureLookup = (
    sourceModelDir: string,
    scene: JumpxStaticSceneResult,
): { textures: Texture[]; textureIdByJumpxIndex: Map<number, number> } => {
    const sourceImages = new Set(scene.textures
        .map((texture) => chooseJumpxTexturePath(sourceModelDir, texture.path || texture.name).replace(/\\/g, '/').toLowerCase())
        .filter(Boolean))
    const referenceMatches = REFERENCE_TEXTURE_SLOTS
        .filter((texture) => sourceImages.has(texture.Image.toLowerCase()))
        .length
    if (referenceMatches >= 8) {
        const textures = REFERENCE_TEXTURE_SLOTS.map((texture) => ({ ...texture }))
        const textureIdByJumpxIndex = new Map<number, number>()
        for (const texture of scene.textures) {
            const image = chooseJumpxTexturePath(sourceModelDir, texture.path || texture.name).replace(/\\/g, '/').toLowerCase()
            const textureId = textures.findIndex((candidate) =>
                candidate.Image.replace(/\\/g, '/').toLowerCase() === image && (candidate.Flags ?? 0) === 0)
            const fallbackId = textures.findIndex((candidate) =>
                candidate.Image.replace(/\\/g, '/').toLowerCase() === image)
            if (textureId >= 0 || fallbackId >= 0) {
                textureIdByJumpxIndex.set(texture.textureIndex, textureId >= 0 ? textureId : fallbackId)
            }
        }
        return { textures, textureIdByJumpxIndex }
    }

    const textures: Texture[] = []
    const textureIdByJumpxIndex = new Map<number, number>()
    const idByTextureKey = new Map<string, number>()
    for (const texture of scene.textures) {
        const image = chooseJumpxTexturePath(sourceModelDir, texture.path || texture.name)
        if (!image) continue
        const flags = mapTextureFlags(texture.rawFlags | texture.saveFlags)
        const key = `${image.replace(/\\/g, '/').toLowerCase()}|${flags}|0`
        let textureId = idByTextureKey.get(key)
        if (textureId === undefined) {
            textureId = textures.length
            idByTextureKey.set(key, textureId)
            textures.push({ Image: image, ReplaceableId: 0, Flags: flags })
        }
        textureIdByJumpxIndex.set(texture.textureIndex, textureId)
    }
    return { textures, textureIdByJumpxIndex }
}

export const ensureJumpxTextureSlot = (
    sourceModelDir: string,
    scene: JumpxStaticSceneResult,
    textures: Texture[],
    textureIdByJumpxIndex: Map<number, number>,
    jumpxTextureIndex: number,
    flags: number,
): number => {
    const source = scene.textures.find((texture) => texture.textureIndex === jumpxTextureIndex)
    const image = source ? chooseJumpxTexturePath(sourceModelDir, source.path || source.name) : ''
    if (!image) return -1
    const existing = textures.findIndex((texture) =>
        texture.Image.replace(/\\/g, '/').toLowerCase() === image.replace(/\\/g, '/').toLowerCase()
        && (texture.Flags ?? 0) === flags
        && (texture.ReplaceableId ?? 0) === 0)
    if (existing >= 0) return existing
    const textureId = textures.length
    textures.push({ Image: image, ReplaceableId: 0, Flags: flags })
    textureIdByJumpxIndex.set(jumpxTextureIndex, textureId)
    return textureId
}
