export type TextureManagerMaterialSummary = {
    index: number
    firstLayerTextureId: number | null
    layerTextureIds: Array<number | null>
}

export type TextureManagerTextureSummary = {
    index: number
    image: string
    replaceableId: number
    flags: number
    adjustments?: unknown
}

export const TEXTURE_MANAGER_ADJUSTMENTS_KEY = '__wmvAdjustments'

const toTextureId = (value: unknown): number | null => {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

export const createTextureManagerTextureSummaries = (textures: unknown): TextureManagerTextureSummary[] => {
    if (!Array.isArray(textures)) return []
    return textures.map((texture, index) => {
        const record = isRecord(texture) ? texture : {}
        return {
            index,
            image: typeof record.Image === 'string'
                ? record.Image
                : (typeof record.Path === 'string' ? record.Path : ''),
            replaceableId: typeof record.ReplaceableId === 'number' ? record.ReplaceableId : Number(record.ReplaceableId ?? 0) || 0,
            flags: typeof record.Flags === 'number' ? record.Flags : Number(record.Flags ?? 0) || 0,
            adjustments: record[TEXTURE_MANAGER_ADJUSTMENTS_KEY],
        }
    })
}

export const textureManagerTextureSummariesToTextures = (
    summaries: TextureManagerTextureSummary[] | undefined,
    legacyTextures: unknown[] | undefined,
): unknown[] => {
    if (Array.isArray(summaries) && summaries.length > 0) {
        return summaries.map((summary) => {
            const texture: Record<string, unknown> = {
                Image: summary.image,
                ReplaceableId: summary.replaceableId,
                Flags: summary.flags,
            }
            if (summary.adjustments !== undefined) {
                texture[TEXTURE_MANAGER_ADJUSTMENTS_KEY] = summary.adjustments
            }
            return texture
        })
    }
    return Array.isArray(legacyTextures) ? legacyTextures : []
}

export const createTextureManagerMaterialSummaries = (materials: unknown): TextureManagerMaterialSummary[] => {
    if (!Array.isArray(materials)) return []
    return materials.map((material, index) => {
        const layers = Array.isArray((material as { Layers?: unknown }).Layers)
            ? (material as { Layers: Array<{ TextureID?: unknown }> }).Layers
            : []
        const layerTextureIds = layers.map((layer) => toTextureId(layer?.TextureID))
        return {
            index,
            firstLayerTextureId: layerTextureIds[0] ?? null,
            layerTextureIds,
        }
    })
}

export const getTextureIdForMaterial = (
    materialIndex: number,
    materialSummaries: TextureManagerMaterialSummary[] | undefined,
    legacyMaterials: unknown[] | undefined,
): number | null => {
    if (!Number.isInteger(materialIndex) || materialIndex < 0) return null
    const summary = Array.isArray(materialSummaries) ? materialSummaries[materialIndex] : undefined
    if (summary) return summary.firstLayerTextureId

    const material = Array.isArray(legacyMaterials)
        ? legacyMaterials[materialIndex] as { Layers?: Array<{ TextureID?: unknown }> } | undefined
        : undefined
    if (!material || !Array.isArray(material.Layers)) return null
    return toTextureId(material.Layers[0]?.TextureID)
}
