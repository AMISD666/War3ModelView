export type MaterialManagerSequenceSummary = {
    index: number
    name: string
    interval: [number, number] | null
}

export type MaterialManagerTextureAnimSummary = {
    index: number
    trackCount: number
}

export type MaterialManagerTextureSummary = {
    index: number
    image: string
    fileName: string
    replaceableId?: number
}

export type MaterialManagerMaterialSummary = {
    index: number
    layerCount: number
    priorityPlane?: number
}

export type MaterialManagerSelectedLayerDetail = {
    index: number
    label: string
    textureId: number | null
    textureAnimId: number | null
    filterMode: unknown
    hasTextureTrack: boolean
    hasAlphaTrack: boolean
}

export type MaterialManagerSelectedMaterialDetail = MaterialManagerMaterialSummary & {
    layers: MaterialManagerSelectedLayerDetail[]
}

const toIntervalSummary = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value) || value.length < 2) {
        return null
    }
    const start = Number(value[0])
    const end = Number(value[1])
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null
    }
    return [start, end]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

const isAnimTrackRecord = (value: unknown): value is { Keys: unknown[] } =>
    isRecord(value) && Array.isArray(value.Keys)

const toNullableInteger = (value: unknown): number | null => {
    if (value === null || value === undefined) {
        return null
    }
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isInteger(parsed) ? parsed : null
}

const getLayerTextureAnimId = (layer: Record<string, unknown>): number | null => (
    toNullableInteger(layer.TVertexAnimId ?? layer.TextureAnimationId ?? layer.TextureAnimId)
)

const createSelectedLayerDetail = (layer: unknown, index: number): MaterialManagerSelectedLayerDetail => {
    const record = isRecord(layer) ? layer : {}
    return {
        index,
        label: `Layer ${index}`,
        textureId: isAnimTrackRecord(record.TextureID) ? null : toNullableInteger(record.TextureID),
        textureAnimId: getLayerTextureAnimId(record),
        filterMode: record.FilterMode,
        hasTextureTrack: isAnimTrackRecord(record.TextureID),
        hasAlphaTrack: isAnimTrackRecord(record.Alpha),
    }
}

export const createMaterialManagerSequenceSummaries = (sequences: unknown): MaterialManagerSequenceSummary[] => {
    if (!Array.isArray(sequences)) {
        return []
    }
    return sequences.map((sequence, index) => {
        const record = isRecord(sequence) ? sequence : {}
        return {
            index,
            name: typeof record.Name === 'string' ? record.Name : `Sequence ${index}`,
            interval: toIntervalSummary(record.Interval),
        }
    })
}

export const materialManagerSequenceSummariesToKeyframeSequences = (
    summaries: MaterialManagerSequenceSummary[] | undefined,
    legacySequences: unknown[] | undefined,
): Array<{ Name: string; Interval: [number, number] }> => {
    if (Array.isArray(summaries) && summaries.length > 0) {
        return summaries.map((summary) => ({
            Name: summary.name,
            Interval: summary.interval ?? [0, 0],
        }))
    }

    return Array.isArray(legacySequences)
        ? legacySequences
            .map((sequence, index) => {
                const record = isRecord(sequence) ? sequence : {}
                const interval = toIntervalSummary(record.Interval)
                if (!interval) return null
                return {
                    Name: typeof record.Name === 'string' ? record.Name : `Sequence ${index}`,
                    Interval: interval,
                }
            })
            .filter((sequence): sequence is { Name: string; Interval: [number, number] } => sequence !== null)
        : []
}

export const createMaterialManagerTextureAnimSummaries = (textureAnims: unknown): MaterialManagerTextureAnimSummary[] => {
    if (!Array.isArray(textureAnims)) {
        return []
    }
    return textureAnims.map((textureAnim, index) => ({
        index,
        trackCount: isRecord(textureAnim)
            ? ['Translation', 'Rotation', 'Scaling'].filter((field) => isRecord(textureAnim[field])).length
            : 0,
    }))
}

export const createMaterialManagerTextureSummaries = (textures: unknown): MaterialManagerTextureSummary[] => {
    if (!Array.isArray(textures)) {
        return []
    }
    return textures.map((texture, index) => {
        const record = isRecord(texture) ? texture : {}
        const image = typeof record.Image === 'string' ? record.Image : ''
        return {
            index,
            image,
            fileName: image.replace(/\\/g, '/').split('/').pop() || image || `Texture ${index}`,
            replaceableId: typeof record.ReplaceableId === 'number' ? record.ReplaceableId : undefined,
        }
    })
}

export const createMaterialManagerMaterialSummaries = (materials: unknown): MaterialManagerMaterialSummary[] => {
    if (!Array.isArray(materials)) {
        return []
    }
    return materials.map((material, index) => {
        const record = isRecord(material) ? material : {}
        return {
            index,
            layerCount: Array.isArray(record.Layers) ? record.Layers.length : 0,
            priorityPlane: typeof record.PriorityPlane === 'number' ? record.PriorityPlane : undefined,
        }
    })
}

export const getMaterialManagerMaterialListItems = (
    summaries: MaterialManagerMaterialSummary[] | undefined,
    legacyMaterials: unknown[] | undefined,
): MaterialManagerMaterialSummary[] => {
    const legacyCount = Array.isArray(legacyMaterials) ? legacyMaterials.length : 0
    if (Array.isArray(summaries) && summaries.length > 0) {
        const summaryByIndex = new Map(summaries.map((summary) => [summary.index, summary]))
        const count = Math.max(summaries.length, legacyCount)
        return Array.from({ length: count }, (_, index) => {
            const summary = summaryByIndex.get(index)
            if (summary) return summary

            const legacyRecord = isRecord(legacyMaterials?.[index]) ? legacyMaterials[index] as Record<string, unknown> : {}
            return {
                index,
                layerCount: Array.isArray(legacyRecord.Layers) ? legacyRecord.Layers.length : 0,
                priorityPlane: typeof legacyRecord.PriorityPlane === 'number' ? legacyRecord.PriorityPlane : undefined,
            }
        })
    }
    return createMaterialManagerMaterialSummaries(legacyMaterials)
}

export const getMaterialManagerSelectedMaterialDetail = (
    summaries: MaterialManagerMaterialSummary[] | undefined,
    legacyMaterials: unknown[] | undefined,
    selectedMaterialIndex: number,
): MaterialManagerSelectedMaterialDetail | null => {
    if (!Number.isInteger(selectedMaterialIndex) || selectedMaterialIndex < 0) {
        return null
    }

    const legacyMaterial = Array.isArray(legacyMaterials) ? legacyMaterials[selectedMaterialIndex] : undefined
    const legacySummary = createMaterialManagerMaterialSummaries([legacyMaterial])[0]
    const summary = Array.isArray(summaries)
        ? summaries.find((item) => item.index === selectedMaterialIndex)
        : undefined
    const baseSummary = summary ?? (legacySummary ? { ...legacySummary, index: selectedMaterialIndex } : {
        index: selectedMaterialIndex,
        layerCount: 0,
    })
    const layers = isRecord(legacyMaterial) && Array.isArray(legacyMaterial.Layers)
        ? legacyMaterial.Layers.map(createSelectedLayerDetail)
        : Array.from({ length: baseSummary.layerCount }, (_, index) => createSelectedLayerDetail(undefined, index))

    return {
        ...baseSummary,
        layerCount: layers.length || baseSummary.layerCount,
        layers,
    }
}

export const getMaterialManagerTextureOptions = (
    summaries: MaterialManagerTextureSummary[] | undefined,
    legacyTextures: unknown[] | undefined,
): Array<{ value: string; plainLabel: string; label: string }> => {
    const source = Array.isArray(summaries) && summaries.length > 0
        ? summaries
        : (Array.isArray(legacyTextures)
            ? createMaterialManagerTextureSummaries(legacyTextures)
            : [])
    return source.map((summary) => ({
        value: String(summary.index),
        plainLabel: summary.fileName || `Texture ${summary.index}`,
        label: `${summary.fileName || `Texture ${summary.index}`}  (#${summary.index})`,
    }))
}

export const materialManagerTextureAnimSummariesToPlaceholders = (
    summaries: MaterialManagerTextureAnimSummary[] | undefined,
    legacyTextureAnims: unknown[] | undefined,
): unknown[] => {
    if (Array.isArray(summaries) && summaries.length > 0) {
        return summaries.map((summary) => ({ index: summary.index, trackCount: summary.trackCount }))
    }
    return Array.isArray(legacyTextureAnims) ? legacyTextureAnims : []
}

export const getMaterialManagerTextureAnimOptionIndexes = (
    summaries: MaterialManagerTextureAnimSummary[] | undefined,
    legacyTextureAnims: unknown[] | undefined,
): number[] => {
    if (Array.isArray(summaries) && summaries.length > 0) {
        return summaries.map((summary) => summary.index)
    }
    return Array.isArray(legacyTextureAnims)
        ? legacyTextureAnims.map((_, index) => index)
        : []
}
