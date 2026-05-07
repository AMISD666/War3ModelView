import { MATERIAL_TEXTURE_REF_KEYS } from '../../utils/materialTextureRelations'
import {
    ensureAnimVector,
    fixAnimVector,
    normalizeTextureIdAnimVector,
    toFloat32Array,
} from './saveDataCoercion'

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.min(max, Math.max(min, num))
}

const hasAnimVectorKeys = (value: unknown): boolean =>
    !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'Keys')

const hasAnimVectorShape = (value: unknown): boolean =>
    !!value && typeof value === 'object' && !ArrayBuffer.isView(value) && (
        hasAnimVectorKeys(value) ||
        Object.prototype.hasOwnProperty.call(value, 'LineType') ||
        Object.prototype.hasOwnProperty.call(value, 'GlobalSeqId')
    )

const staticNumberFromScalarOrAnim = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' || typeof value === 'string') {
        const num = Number(value)
        return Number.isFinite(num) ? num : fallback
    }

    if (value && typeof value === 'object' && Array.isArray((value as { Keys?: unknown[] }).Keys)) {
        const firstKey = (value as { Keys: Array<{ Vector?: ArrayLike<unknown> }> }).Keys[0]
        const firstValue = firstKey?.Vector?.[0]
        const num = Number(firstValue)
        return Number.isFinite(num) ? num : fallback
    }

    return fallback
}

const normalizeScalarAnimOrStatic = (
    value: unknown,
    fallback: number,
    globalSeqCount: number,
    options: { min?: number; max?: number } = {},
): number | object => {
    if (hasAnimVectorShape(value)) {
        if (!hasAnimVectorKeys(value)) return fallback
        const normalized = ensureAnimVector(value, 1, false, [fallback], globalSeqCount)
        return normalized?.Keys?.length ? normalized : fallback
    }

    const min = options.min ?? Number.NEGATIVE_INFINITY
    const max = options.max ?? Number.POSITIVE_INFINITY
    return clampNumber(value, fallback, min, max)
}

const normalizeFresnelColor = (value: unknown, globalSeqCount: number): Float32Array | object => {
    if (value instanceof Float32Array) {
        return value
    }
    if (hasAnimVectorShape(value)) {
        if (!hasAnimVectorKeys(value)) return new Float32Array([1, 1, 1])
        const normalized = fixAnimVector(value, 3, false, [1, 1, 1], globalSeqCount)
        return normalized?.Keys?.length ? normalized : new Float32Array([1, 1, 1])
    }
    return toFloat32Array(value, 3)
}

const normalizeTextureIdStatic = (value: unknown, textureCount: number): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return -1
    const textureId = Math.floor(parsed)
    if (textureCount <= 0 || textureId < 0 || textureId >= textureCount) return -1
    return textureId
}

const normalizeTextureIdValue = (value: unknown, textureCount: number, globalSeqCount: number): number | object => {
    if (hasAnimVectorShape(value)) {
        if (!hasAnimVectorKeys(value)) return -1
        const normalized = normalizeTextureIdAnimVector(value, textureCount, globalSeqCount)
        return normalized?.Keys?.length ? normalized : -1
    }
    return normalizeTextureIdStatic(value, textureCount)
}

export function normalizeMaterialLayerForSave(layer: any, textureCount: number, textureAnimCount: number, globalSeqCount: number): void {
    const filterModeValue = layer.FilterMode ?? layer.filterMode
    const filterModeRecord = filterModeValue && typeof filterModeValue === 'object' && 'value' in filterModeValue
        ? (filterModeValue as { value?: unknown }).value
        : filterModeValue

    if (typeof filterModeRecord === 'string') {
        const normalized = filterModeRecord.replace(/\s+/g, '').toLowerCase()
        const map: Record<string, number> = {
            none: 0,
            transparent: 1,
            blend: 2,
            additive: 3,
            addalpha: 4,
            modulate: 5,
            modulate2x: 6,
        }
        layer.FilterMode = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : map[normalized] ?? 0
    } else {
        layer.FilterMode = clampNumber(filterModeRecord, 0, 0, 6)
    }
    layer.FilterMode = Math.floor(layer.FilterMode)

    const shadingMask = 1 | 2 | 16 | 32 | 64 | 128
    const baseShading = typeof layer.Shading === 'number' ? layer.Shading : 0
    let shading = baseShading & ~shadingMask
    const applyShadingFlag = (value: unknown, bit: number) => {
        if (value === true) {
            shading |= bit
        } else if (value !== false && (baseShading & bit)) {
            shading |= bit
        }
    }
    applyShadingFlag(layer.Unshaded, 1)
    applyShadingFlag(layer.SphereEnvMap ?? layer.SphereEnvironmentMap, 2)
    applyShadingFlag(layer.TwoSided, 16)
    applyShadingFlag(layer.Unfogged, 32)
    applyShadingFlag(layer.NoDepthTest, 64)
    applyShadingFlag(layer.NoDepthSet, 128)
    layer.Shading = shading

    layer.TextureID = normalizeTextureIdValue(layer.TextureID, textureCount, globalSeqCount)

    if (layer.TVertexAnimId === undefined && layer.TextureAnimationId !== undefined) {
        layer.TVertexAnimId = layer.TextureAnimationId
    }
    if (layer.TVertexAnimId === undefined || layer.TVertexAnimId === null) {
        layer.TVertexAnimId = null
    } else {
        const parsed = Number(layer.TVertexAnimId)
        layer.TVertexAnimId = Number.isInteger(parsed) && parsed >= 0 && (textureAnimCount <= 0 || parsed < textureAnimCount)
            ? parsed
            : null
    }

    layer.CoordId = Math.max(0, Math.floor(clampNumber(layer.CoordId, 0, 0, Number.MAX_SAFE_INTEGER)))
    layer.Alpha = normalizeScalarAnimOrStatic(layer.Alpha, 1, globalSeqCount, { min: 0, max: 1 })

    if (layer.EmissiveGain !== undefined && layer.EmissiveGain !== null) {
        layer.EmissiveGain = normalizeScalarAnimOrStatic(layer.EmissiveGain, 1, globalSeqCount)
    }
    if (layer.FresnelColor !== undefined && layer.FresnelColor !== null) {
        layer.FresnelColor = normalizeFresnelColor(layer.FresnelColor, globalSeqCount)
    }
    if (layer.FresnelOpacity !== undefined && layer.FresnelOpacity !== null) {
        layer.FresnelOpacity = normalizeScalarAnimOrStatic(layer.FresnelOpacity, 0, globalSeqCount)
    }
    if (layer.FresnelTeamColor !== undefined && layer.FresnelTeamColor !== null) {
        layer.FresnelTeamColor = normalizeScalarAnimOrStatic(layer.FresnelTeamColor, 0, globalSeqCount)
    }

    for (const key of MATERIAL_TEXTURE_REF_KEYS) {
        if (key === 'TextureID' || layer[key] === undefined || layer[key] === null) continue
        layer[key] = normalizeTextureIdValue(layer[key], textureCount, globalSeqCount)
    }
}

export function normalizeMaterialForSave(material: any, textureCount: number, textureAnimCount: number, globalSeqCount: number): void {
    material.PriorityPlane = Math.floor(clampNumber(material.PriorityPlane, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))

    const renderMask = 1 | 16 | 32
    const baseRenderMode = typeof material.RenderMode === 'number' ? material.RenderMode : 0
    let renderMode = baseRenderMode & ~renderMask
    const applyRenderFlag = (value: unknown, bit: number) => {
        if (value === true) {
            renderMode |= bit
        } else if (value !== false && (baseRenderMode & bit)) {
            renderMode |= bit
        }
    }
    applyRenderFlag(material.ConstantColor, 1)
    applyRenderFlag(material.SortPrimsFarZ ?? material.SortPrimitivesFarZ, 16)
    applyRenderFlag(material.FullResolution, 32)
    material.RenderMode = renderMode

    if (!Array.isArray(material.Layers)) {
        material.Layers = []
        return
    }

    material.Layers.forEach((layer: any) => {
        normalizeMaterialLayerForSave(layer, textureCount, textureAnimCount, globalSeqCount)
    })
}

export function getStaticScalarForLayer(value: unknown, fallback: number): number {
    return staticNumberFromScalarOrAnim(value, fallback)
}
