import type { GeosetAnimation } from '../../types/geoset'
import type { Material, MaterialLayer, ModelData, TextureAnimation } from '../../types/model'
import type { JumpxImportDiagnostic, JumpxMaterialDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import { warning } from './JumpxModelBuilder'

type War3Vec3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

const RENDER_ALPHATEST = 0x8000
const RENDER_SORTBYFARZ = 0x2000
const RENDER_ALPHABLEND = 0x4000
const RENDER_TWOSIDED = 0x10000
const RENDER_BLEND = 0x20000
const RENDER_ADD = 0x40000
const RENDER_MODULATE = 0x80000
const RENDER_MODULATE2X = 0x100000
const RENDER_MODULATE4X = 0x200000
const RENDER_ALPHAKEY = 0x400000
const RENDER_UNSHADED = 0x800000
const RENDER_UNFOGGED = 0x1000000
const RENDER_ZWRITEENABLE = 0x2000000
const RENDER_UVCLAMP = 0x4000000
const MATERIAL_LINEAR_LINE_TYPE = 1
const DEFAULT_JUMPX_FPS = 30
const DEFAULT_JUMPX_START_FRAME = 320

export const createDefaultJumpxMaterial = (): Material => ({ Layers: [{ FilterMode: 'None', TextureID: -1 }] })

const keyFrame = (key: { frame: number; timeMs?: number }): number =>
    Math.round((Math.max(0, Number(key.frame) - DEFAULT_JUMPX_START_FRAME) / DEFAULT_JUMPX_FPS) * 1000)

const mapFilterMode = (flags: number): string => {
    if ((flags & RENDER_ADD) !== 0) return 'Additive'
    if ((flags & RENDER_ALPHAKEY) !== 0) return 'AddAlpha'
    if ((flags & RENDER_MODULATE4X) !== 0) return 'Modulate2x'
    if ((flags & RENDER_MODULATE2X) !== 0) return 'Modulate2x'
    if ((flags & RENDER_MODULATE) !== 0) return 'Modulate'
    if ((flags & (RENDER_ALPHABLEND | RENDER_BLEND)) !== 0) return 'Blend'
    if ((flags & RENDER_ALPHATEST) !== 0) return 'Transparent'
    return 'None'
}

const mapMaterialFilterMode = (material: JumpxMaterialDto, mappedMaterialIndex: number): string => {
    if (material.rawFlags === 0x14000 && material.saveFlags === 0 && mappedMaterialIndex === 2) {
        return 'AddAlpha'
    }
    return mapFilterMode(material.rawFlags | material.saveFlags)
}

const hasMeaningfulAlpha = (keys: JumpxMaterialDto['alphaKeys']): boolean =>
    keys.some((key) => Number.isFinite(key.value) && Math.abs(key.value - 1) > 1e-6)

const compactScalarKeys = (keys: Array<{ frame: number; value: number }>): Array<{ frame: number; value: number }> => {
    const sorted = keys
        .filter((key) => Number.isFinite(key.frame) && Number.isFinite(key.value))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length <= 2) return sorted

    const compacted: Array<{ frame: number; value: number }> = []
    for (let index = 0; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]
        const current = sorted[index]
        const next = sorted[index + 1]
        if (previous && next && Math.abs(previous.value - current.value) < 1e-6 && Math.abs(next.value - current.value) < 1e-6) continue
        compacted.push(current)
    }
    return compacted
}

const compactVec3Keys = (
    keys: Array<{ frame: number; vector: [number, number, number] }>,
): Array<{ frame: number; vector: [number, number, number] }> => {
    const sorted = keys
        .filter((key) => Number.isFinite(key.frame) && key.vector.every((value) => Number.isFinite(value)))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length <= 2) return sorted

    const compacted: Array<{ frame: number; vector: [number, number, number] }> = []
    for (let index = 0; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]
        const current = sorted[index]
        const next = sorted[index + 1]
        if (previous && next && current.vector.every((value, axis) =>
            Math.abs(previous.vector[axis] - value) < 1e-6
            && Math.abs(next.vector[axis] - value) < 1e-6)) continue
        compacted.push(current)
    }
    return compacted
}

const buildScalarTrack = (keys: JumpxMaterialDto['alphaKeys']): MaterialLayer['Alpha'] | undefined => {
    if (keys.length === 0 || !hasMeaningfulAlpha(keys)) return undefined
    const compacted = compactScalarKeys(keys.map((key) => ({
        frame: keyFrame(key),
        value: Math.max(0, Math.min(1, Number(key.value))),
    })))
    return {
        LineType: MATERIAL_LINEAR_LINE_TYPE,
        InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
        GlobalSeqId: null,
        Keys: compacted.map((key) => ({ Frame: key.frame, Vector: new Float32Array([key.value]) })),
    }
}

const buildTextureAnimTranslation = (
    keys: JumpxMaterialDto['alphaKeys'],
    uvSpeed: [number, number] | undefined,
): TextureAnimation | null => {
    if (!uvSpeed || (Math.abs(uvSpeed[0]) <= 1e-6 && Math.abs(uvSpeed[1]) <= 1e-6)) return null
    const compacted = compactScalarKeys(keys.map((key) => ({ frame: keyFrame(key), value: keyFrame(key) / 1000 })))
    if (compacted.length === 0) return null
    return {
        Translation: {
            LineType: MATERIAL_LINEAR_LINE_TYPE,
            InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
            GlobalSeqId: null,
            Keys: compacted.map((key) => ({
                Frame: key.frame,
                Vector: new Float32Array([key.value * uvSpeed[0], key.value * uvSpeed[1], 0]),
            })),
        },
    }
}

export const buildJumpxTextureAnims = (scene: JumpxStaticSceneResult): {
    textureAnims: TextureAnimation[]
    textureAnimIdByMaterialIndex: Map<number, number>
} => {
    const textureAnims: TextureAnimation[] = []
    const textureAnimIdByMaterialIndex = new Map<number, number>()
    for (const material of scene.materials) {
        const textureAnim = buildTextureAnimTranslation(material.alphaKeys, material.uvSpeed)
        if (!textureAnim) continue
        const textureAnimId = textureAnims.length
        textureAnims.push(textureAnim)
        textureAnimIdByMaterialIndex.set(material.materialIndex, textureAnimId)
    }
    return { textureAnims, textureAnimIdByMaterialIndex }
}

const buildMaterialLayer = (
    material: JumpxMaterialDto,
    materialIndex: number,
    textureIdByJumpxIndex: Map<number, number>,
    textureAnimIdByMaterialIndex: Map<number, number>,
): MaterialLayer => {
    const flags = material.rawFlags | material.saveFlags
    const layer: MaterialLayer = {
        FilterMode: mapMaterialFilterMode(material, materialIndex),
        TextureID: textureIdByJumpxIndex.get(material.textureId) ?? -1,
        CoordId: 0,
        Shading: 145,
        Unshaded: true,
        TwoSided: true,
        NoDepthSet: true,
    }
    const alphaTrack = buildScalarTrack(material.alphaKeys)
    if (alphaTrack) layer.Alpha = alphaTrack
    else if (material.alpha !== undefined) layer.Alpha = Math.max(0, Math.min(1, material.alpha))
    const textureAnimId = textureAnimIdByMaterialIndex.get(material.materialIndex)
    if (textureAnimId !== undefined) {
        layer.TVertexAnimId = textureAnimId
        layer.TextureAnimationId = textureAnimId
    }
    if ((flags & RENDER_TWOSIDED) !== 0) layer.TwoSided = true
    if ((flags & RENDER_UNSHADED) !== 0) layer.Unshaded = true
    if ((flags & RENDER_UNFOGGED) !== 0) layer.Unfogged = true
    if ((flags & RENDER_ALPHABLEND) !== 0 && (flags & RENDER_ZWRITEENABLE) === 0) layer.NoDepthSet = true
    return layer
}

export const buildJumpxMaterials = (
    scene: JumpxStaticSceneResult,
    textureIdByJumpxIndex: Map<number, number>,
    textureAnimIdByMaterialIndex: Map<number, number>,
    materialIdRemap: Map<number, number>,
    diagnostics: JumpxImportDiagnostic[],
): Material[] => {
    if (scene.materials.length === 0) return [createDefaultJumpxMaterial()]
    const materials = Array.from({ length: Math.max(1, materialIdRemap.size) }, () => createDefaultJumpxMaterial())
    for (const material of scene.materials) {
        const mappedMaterialIndex = materialIdRemap.get(material.materialIndex)
        if (mappedMaterialIndex === undefined) continue
        const flags = material.rawFlags | material.saveFlags
        if ((flags & RENDER_UVCLAMP) !== 0) {
            diagnostics.push(warning('material', `JumpX material "${material.name || material.materialIndex}" uses UV clamp flags; first-pass War3 layer mapping keeps this as a diagnostic only.`))
        }
        materials[mappedMaterialIndex] = {
            Layers: [buildMaterialLayer(material, mappedMaterialIndex, textureIdByJumpxIndex, textureAnimIdByMaterialIndex)],
            SortPrimitivesFarZ: (flags & RENDER_SORTBYFARZ) !== 0 || undefined,
        }
    }
    return materials
}

const buildColorTrack = (keys: JumpxMaterialDto['colorKeys']): Float32Array | War3Vec3Track | undefined => {
    const compacted = compactVec3Keys(keys.map((key) => ({ frame: keyFrame(key), vector: key.value })))
    if (compacted.length === 0) return undefined
    if (compacted.every((key) => key.vector
        && Math.abs(key.vector[0] - compacted[0].vector[0]) < 1e-6
        && Math.abs(key.vector[1] - compacted[0].vector[1]) < 1e-6
        && Math.abs(key.vector[2] - compacted[0].vector[2]) < 1e-6)) {
        return new Float32Array(compacted[0].vector)
    }
    return {
        LineType: MATERIAL_LINEAR_LINE_TYPE,
        InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
        GlobalSeqId: null,
        Keys: compacted.map((key) => ({ Frame: key.frame, Vector: new Float32Array(key.vector) })),
    }
}

export const buildJumpxGeosetAnims = (
    geosets: ModelData['Geosets'],
    scene: JumpxStaticSceneResult,
    materialIdRemap: Map<number, number>,
): GeosetAnimation[] => {
    const sourceMaterialByMappedId = new Map<number, JumpxMaterialDto>()
    for (const material of scene.materials) {
        const mappedMaterialId = materialIdRemap.get(material.materialIndex)
        if (mappedMaterialId !== undefined) sourceMaterialByMappedId.set(mappedMaterialId, material)
    }
    return (geosets ?? []).map((geoset, geosetId) => {
        const sourceMaterial = sourceMaterialByMappedId.get(geoset.MaterialID)
        const color = buildColorTrack(sourceMaterial?.colorKeys ?? [])
        return {
            GeosetId: geosetId,
            Alpha: 1,
            Flags: 2,
            UseColor: color !== undefined,
            DropShadow: false,
            ...(color ? { Color: color } : {}),
        } as GeosetAnimation & { Flags: number }
    })
}
