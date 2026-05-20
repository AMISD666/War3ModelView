import type { GeosetAnimation } from '../../types/geoset'
import type { Material, MaterialLayer, ModelData, TextureAnimation } from '../../types/model'
import type { JumpxImportDiagnostic, JumpxMaterialDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import { warning } from './JumpxModelBuilder'

const XGEO_NORMAL_MESH = 0
const RENDER_ALPHATEST = 0x8000
const RENDER_SORTBYFARZ = 0x2000
const RENDER_ALPHABLEND = 0x4000
const RENDER_BLEND = 0x20000
const RENDER_ADD = 0x40000
const RENDER_MODULATE = 0x80000
const RENDER_MODULATE2X = 0x100000
const RENDER_MODULATE4X = 0x200000
const RENDER_ALPHAKEY = 0x400000
const RENDER_UVCLAMP = 0x4000000
const LAYER_SHADING_UNSHADED = 1
const LAYER_SHADING_TWOSIDED = 16
const LAYER_SHADING_NODEPTHSET = 128
const DEFAULT_JUMPX_LAYER_SHADING = LAYER_SHADING_UNSHADED | LAYER_SHADING_TWOSIDED | LAYER_SHADING_NODEPTHSET
const MATERIAL_LINEAR_LINE_TYPE = 1
const DEFAULT_JUMPX_START_FRAME = 320
const DEFAULT_JUMPX_FPS = 30

type TextureAnimSampleKey = {
    frame: number
    timeMs?: number
    value: number | [number, number, number]
}

const FILTER_MODE_NONE = 0
const FILTER_MODE_TRANSPARENT = 1
const FILTER_MODE_BLEND = 2
const FILTER_MODE_ADDITIVE = 3
const FILTER_MODE_ADD_ALPHA = 4

export const createDefaultJumpxMaterial = (): Material => ({ Layers: [{ FilterMode: FILTER_MODE_NONE, TextureID: -1 }] })

const keyFrame = (key: { frame: number; timeMs?: number }): number =>
    Number.isFinite(key.timeMs) ? Math.round(Number(key.timeMs)) : Math.round(Number(key.frame))

const normalizedSampleFrame = (key: { frame: number; timeMs?: number }): number =>
    Math.round((Math.max(0, Number(key.frame) - DEFAULT_JUMPX_START_FRAME) / DEFAULT_JUMPX_FPS) * 1000)

const sampleVecValue = (key: TextureAnimSampleKey, axis: 0 | 1): number =>
    Array.isArray(key.value) ? Number(key.value[axis]) : 0

const materialAlphaKeys = (material: JumpxMaterialDto): JumpxMaterialDto['alphaKeys'] =>
    material.alphaKeys ?? []

const materialColorKeys = (material: JumpxMaterialDto): JumpxMaterialDto['colorKeys'] =>
    material.colorKeys ?? []

const materialUvOffsetKeys = (material: JumpxMaterialDto): JumpxMaterialDto['uvOffsetKeys'] =>
    material.uvOffsetKeys ?? []

const materialBlendKeys = (material: JumpxMaterialDto): JumpxMaterialDto['blendKeys'] =>
    material.blendKeys ?? []

const materialBlendFlags = (material: JumpxMaterialDto): number =>
    materialBlendKeys(material).reduce((flags, key) => flags | (Number(key.value) >>> 0), 0)

const materialAllFlags = (material: JumpxMaterialDto): number =>
    material.rawFlags | material.saveFlags | materialBlendFlags(material)

export const getJumpxMaterialTextureFlags = (material: JumpxMaterialDto, repeatFlags: number): number =>
    (materialBlendFlags(material) & RENDER_UVCLAMP) !== 0 ? 0 : repeatFlags

const mapFilterMode = (flags: number): number => {
    if ((flags & RENDER_ADD) !== 0) return FILTER_MODE_ADDITIVE
    if ((flags & RENDER_ALPHAKEY) !== 0) return FILTER_MODE_ADD_ALPHA
    // JumpX's reference renderer leaves the Modulate/Modulate2x blend funcs disabled.
    // Mapping them to War3 Modulate modes makes large translucent planes darken the scene.
    if ((flags & (RENDER_ALPHABLEND | RENDER_BLEND)) !== 0) return FILTER_MODE_BLEND
    if ((flags & RENDER_ALPHATEST) !== 0) return FILTER_MODE_TRANSPARENT
    return FILTER_MODE_NONE
}

const mapMaterialFilterMode = (material: JumpxMaterialDto): number =>
    mapFilterMode(materialAllFlags(material))

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

const compactColorKeys = (keys: Array<{ frame: number; value: [number, number, number] }>): Array<{ frame: number; value: [number, number, number] }> => {
    const sorted = keys
        .filter((key) => Number.isFinite(key.frame) && key.value.every(Number.isFinite))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length <= 2) return sorted

    const compacted: Array<{ frame: number; value: [number, number, number] }> = []
    for (let index = 0; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]
        const current = sorted[index]
        const next = sorted[index + 1]
        if (previous && next
            && current.value.every((value, axis) => Math.abs(value - previous.value[axis]) < 1e-6)
            && current.value.every((value, axis) => Math.abs(value - next.value[axis]) < 1e-6)) continue
        compacted.push(current)
    }
    return compacted
}

const toWar3GeosetAnimColor = (value: [number, number, number]): [number, number, number] => [
    value[2],
    value[1],
    value[0],
]

const buildScalarTrack = (keys: JumpxMaterialDto['alphaKeys']): MaterialLayer['Alpha'] | undefined => {
    if (keys.length === 0 || !hasMeaningfulAlpha(keys)) return undefined
    const compacted = compactScalarKeys(keys.map((key) => ({
        frame: normalizedSampleFrame(key),
        value: Math.max(0, Math.min(1, Number(key.value))),
    })))
    return {
        LineType: MATERIAL_LINEAR_LINE_TYPE,
        InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
        GlobalSeqId: null,
        Keys: compacted.map((key) => ({ Frame: key.frame, Vector: new Float32Array([key.value]) })),
    }
}

const geosetVisibilitySamples = (
    geometry: JumpxStaticSceneResult['geometries'][number] | undefined,
    bones: JumpxStaticSceneResult['bones'] = [],
): Array<{ frame: number; value: number }> => {
    const samplesByFrame = new Map<number, number>()
    const setSample = (frame: number, value: number): void => {
        samplesByFrame.set(frame, value > 0 ? 1 : 0)
    }

    const ancestorBone = geometry && geometry.ancestorBoneId >= 0
        ? bones.find((bone) => bone.boneIndex === geometry.ancestorBoneId)
        : undefined
    for (const key of ancestorBone?.visibilityKeys ?? []) {
        setSample(normalizedSampleFrame(key), key.value > 0 ? 1 : 0)
    }

    return compactScalarKeys(Array.from(samplesByFrame, ([frame, value]) => ({ frame, value })))
}

const buildGeosetAlpha = (
    geometry: JumpxStaticSceneResult['geometries'][number] | undefined,
    bones: JumpxStaticSceneResult['bones'] = [],
): GeosetAnimation['Alpha'] => {
    const compacted = geosetVisibilitySamples(geometry, bones)
    if (compacted.length === 0) return 1
    if (compacted.length === 1) return compacted[0].value
    return {
        LineType: MATERIAL_LINEAR_LINE_TYPE,
        InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
        GlobalSeqId: null,
        Keys: compacted.map((key) => ({ Frame: key.frame, Vector: new Float32Array([key.value]) })),
    }
}

const buildTextureAnimTranslation = (
    material: JumpxMaterialDto,
    uvSpeed: [number, number] | undefined,
): TextureAnimation | null => {
    const hasUvSpeed = !!uvSpeed && (Math.abs(uvSpeed[0]) > 1e-6 || Math.abs(uvSpeed[1]) > 1e-6)
    const uvOffsetKeys = materialUvOffsetKeys(material)
    const alphaKeys = materialAlphaKeys(material)
    const colorKeys = materialColorKeys(material)
    const hasUvOffsetKeys = uvOffsetKeys.length > 0
        && uvOffsetKeys.some((key) => Math.abs(key.value[0]) > 1e-6 || Math.abs(key.value[1]) > 1e-6)
    const hasMaterialSamples = uvOffsetKeys.length > 0 || alphaKeys.length > 0 || colorKeys.length > 0
    if (!hasUvSpeed && !hasUvOffsetKeys && !hasMaterialSamples && material.sampleCount <= 0) return null

    const sourceKeys: TextureAnimSampleKey[] = uvOffsetKeys.length > 0
        ? uvOffsetKeys
        : alphaKeys.length > 0
            ? alphaKeys
            : colorKeys
    const fallbackSampleKeys: TextureAnimSampleKey[] = [
        { frame: DEFAULT_JUMPX_START_FRAME, value: [0, 0, 0] },
        { frame: DEFAULT_JUMPX_START_FRAME + Math.max(1, material.sampleCount - 1), value: [0, 0, 0] },
    ]
    const sampleKeys = sourceKeys.length > 0
        ? sourceKeys
        : fallbackSampleKeys
    const uvSpeedX = uvSpeed?.[0] ?? 0
    const uvSpeedY = uvSpeed?.[1] ?? 0
    const compactedX = compactScalarKeys(sampleKeys.map((key) => ({
        frame: normalizedSampleFrame(key),
        value: sampleVecValue(key, 0) + (Math.max(0, Number(key.frame) - DEFAULT_JUMPX_START_FRAME) / 100) * uvSpeedX * 3.125,
    })))
    const compactedY = compactScalarKeys(sampleKeys.map((key) => ({
        frame: normalizedSampleFrame(key),
        value: sampleVecValue(key, 1) + (Math.max(0, Number(key.frame) - DEFAULT_JUMPX_START_FRAME) / 100) * uvSpeedY * 3.125,
    })))
    const frameByIndex = new Map<number, [number, number]>()
    compactedX.forEach((key) => frameByIndex.set(key.frame, [key.value, 0]))
    compactedY.forEach((key) => {
        const existing = frameByIndex.get(key.frame) ?? [0, 0]
        existing[1] = key.value
        frameByIndex.set(key.frame, existing)
    })
    const frames = Array.from(frameByIndex.entries()).sort((a, b) => a[0] - b[0])
    if (frames.length === 0) return null
    return {
        Translation: {
            LineType: MATERIAL_LINEAR_LINE_TYPE,
            InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
            GlobalSeqId: null,
            Keys: frames.map(([frame, value]) => ({
                Frame: frame,
                Vector: new Float32Array([value[0], value[1], 0]),
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
        const textureAnim = buildTextureAnimTranslation(material, material.uvSpeed)
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
    const layer: MaterialLayer = {
        FilterMode: mapMaterialFilterMode(material),
        TextureID: textureIdByJumpxIndex.get(material.textureId) ?? -1,
        CoordId: 0,
        Shading: DEFAULT_JUMPX_LAYER_SHADING,
        Unshaded: true,
        TwoSided: true,
        NoDepthSet: true,
    }
    const alphaTrack = buildScalarTrack(materialAlphaKeys(material))
    if (alphaTrack) layer.Alpha = alphaTrack
    else if (material.alpha !== undefined) layer.Alpha = Math.max(0, Math.min(1, material.alpha))
    const textureAnimId = textureAnimIdByMaterialIndex.get(material.materialIndex)
    if (textureAnimId !== undefined) {
        layer.TVertexAnimId = textureAnimId
        layer.TextureAnimationId = textureAnimId
    }
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
        const flags = materialAllFlags(material)
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

export const buildJumpxGeosetAnims = (
    geosets: ModelData['Geosets'],
    geosetSourceGeometries: JumpxStaticSceneResult['geometries'] = [],
    materials: JumpxMaterialDto[] = [],
    bones: JumpxStaticSceneResult['bones'] = [],
    materialIdRemap: Map<number, number> = new Map(),
): GeosetAnimation[] => {
    const materialByMappedIndex = new Map<number, JumpxMaterialDto>()
    for (const material of materials) {
        const mappedIndex = materialIdRemap.get(material.materialIndex) ?? material.materialIndex
        materialByMappedIndex.set(mappedIndex, material)
    }
    return (geosets ?? []).map((geoset, geosetId) => {
        const material = materialByMappedIndex.get(Number(geoset.MaterialID))
        const geometry = geosetSourceGeometries[geosetId]
        const useColor = (geometry?.geometryType ?? XGEO_NORMAL_MESH) !== XGEO_NORMAL_MESH
        const compactedColorKeys = compactColorKeys((material ? materialColorKeys(material) : []).map((key) => ({
            frame: normalizedSampleFrame(key),
            value: toWar3GeosetAnimColor([
                Math.max(0, Math.min(1, Number(key.value[0]))),
                Math.max(0, Math.min(1, Number(key.value[1]))),
                Math.max(0, Math.min(1, Number(key.value[2]))),
            ]),
        })))
        const color = compactedColorKeys.length > 1
            ? {
                LineType: MATERIAL_LINEAR_LINE_TYPE,
                InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
                GlobalSeqId: null,
                Keys: compactedColorKeys.map((key) => ({ Frame: key.frame, Vector: new Float32Array(key.value) })),
            }
            : new Float32Array(compactedColorKeys[0]?.value ?? [1, 1, 1])

        return {
            GeosetId: geosetId,
            Alpha: buildGeosetAlpha(geometry, bones),
            Flags: useColor ? 2 : 0,
            UseColor: useColor,
            DropShadow: false,
            Color: color,
        } as GeosetAnimation & { Flags: number }
    })
}
