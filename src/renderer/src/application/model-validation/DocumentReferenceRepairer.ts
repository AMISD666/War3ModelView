import { MATERIAL_TEXTURE_REF_KEYS } from '../../utils/materialTextureRelations'

export type DocumentReferenceRepair = {
    path: string
    message: string
}

export type DocumentReferenceRepairResult<T> = {
    modelData: T
    repairs: DocumentReferenceRepair[]
}

const asArray = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : []

const asRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

const cloneModelData = <T,>(modelData: T): T => {
    try {
        return structuredClone(modelData)
    } catch {
        return JSON.parse(JSON.stringify(modelData)) as T
    }
}

const isInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value)

const pushRepair = (repairs: DocumentReferenceRepair[], path: string, message: string): void => {
    repairs.push({ path, message })
}

const repairStaticIndex = (
    repairs: DocumentReferenceRepair[],
    owner: Record<string, unknown>,
    key: string,
    path: string,
    targetName: string,
    targetCount: number,
    fallback: number | null,
    options: { allowNull?: boolean; allowNegative?: boolean } = {},
): void => {
    const value = owner[key]
    if (value === undefined || value === null) {
        if (!options.allowNull) {
            owner[key] = fallback
            pushRepair(repairs, path, `Set missing ${targetName} reference to ${String(fallback)}`)
        }
        return
    }

    if (!isInteger(value)) {
        owner[key] = fallback
        pushRepair(repairs, path, `Replaced non-integer ${targetName} reference ${String(value)} with ${String(fallback)}`)
        return
    }

    if (value < 0) {
        if (!options.allowNegative) {
            owner[key] = fallback
            pushRepair(repairs, path, `Replaced negative ${targetName} reference ${value} with ${String(fallback)}`)
        }
        return
    }

    if (value >= targetCount) {
        owner[key] = fallback
        pushRepair(repairs, path, `Replaced out-of-range ${targetName} reference ${value} with ${String(fallback)}`)
    }
}

const repairAnimTrackFirstVectorIndex = (
    repairs: DocumentReferenceRepair[],
    track: Record<string, unknown>,
    path: string,
    targetName: string,
    targetCount: number,
    fallback: number,
): void => {
    asArray(track.Keys).forEach((rawKey, keyIndex) => {
        const key = asRecord(rawKey)
        const vector = key.Vector
        if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) return

        const current = (vector as ArrayLike<unknown>)[0]
        if (isInteger(current) && current >= 0 && current < targetCount) return
        if (isInteger(current) && current < 0) return

        ;(vector as unknown as Record<number, unknown>)[0] = fallback
        pushRepair(
            repairs,
            `${path}.Keys[${keyIndex}].Vector[0]`,
            `Replaced invalid ${targetName} animated reference ${String(current)} with ${fallback}`,
        )
    })
}

const repairTextureReference = (
    repairs: DocumentReferenceRepair[],
    owner: Record<string, unknown>,
    key: string,
    path: string,
    textureCount: number,
): void => {
    const value = owner[key]
    if (value === undefined || value === null) return
    const fallback = textureCount > 0 ? 0 : -1

    if (typeof value === 'number') {
        repairStaticIndex(repairs, owner, key, path, 'Textures', textureCount, fallback, { allowNegative: true })
        return
    }

    if (value !== null && typeof value === 'object' && Array.isArray((value as { Keys?: unknown[] }).Keys)) {
        repairAnimTrackFirstVectorIndex(repairs, value as Record<string, unknown>, path, 'Textures', textureCount, fallback)
    }
}

const repairLayerTextureAnimId = (
    repairs: DocumentReferenceRepair[],
    layer: Record<string, unknown>,
    path: string,
    textureAnimCount: number,
): void => {
    if (layer.TVertexAnimId === undefined && layer.TextureAnimationId !== undefined) {
        layer.TVertexAnimId = layer.TextureAnimationId
        delete layer.TextureAnimationId
        pushRepair(repairs, path, 'Normalized TextureAnimationId alias into TVertexAnimId')
    }
    if (layer.TVertexAnimId === undefined && layer.TextureAnimId !== undefined) {
        layer.TVertexAnimId = layer.TextureAnimId
        delete layer.TextureAnimId
        pushRepair(repairs, path, 'Normalized TextureAnimId alias into TVertexAnimId')
    }

    repairStaticIndex(repairs, layer, 'TVertexAnimId', path, 'TextureAnims', textureAnimCount, null, {
        allowNull: true,
        allowNegative: true,
    })
}

export const repairDocumentReferences = <T,>(modelData: T): DocumentReferenceRepairResult<T> => {
    if (!modelData) {
        return { modelData, repairs: [] }
    }

    const repaired = cloneModelData(modelData)
    const data = asRecord(repaired)
    const repairs: DocumentReferenceRepair[] = []

    const geosets = asArray(data.Geosets).map(asRecord)
    const materials = asArray(data.Materials).map(asRecord)
    const textures = asArray(data.Textures)
    const textureAnims = asArray(data.TextureAnims)

    if (Array.isArray(data.GeosetAnims)) {
        const usedGeosetIds = new Set<number>()
        data.GeosetAnims = data.GeosetAnims.filter((rawAnim, index) => {
            const anim = asRecord(rawAnim)
            const geosetId = anim.GeosetId
            const valid = isInteger(geosetId) && geosetId >= 0 && geosetId < geosets.length
            if (!valid) {
                pushRepair(
                    repairs,
                    `GeosetAnims[${index}].GeosetId`,
                    `Removed GeosetAnim with invalid GeosetId ${String(geosetId)}`,
                )
                return false
            }
            if (usedGeosetIds.has(geosetId)) {
                pushRepair(
                    repairs,
                    `GeosetAnims[${index}].GeosetId`,
                    `Removed duplicate GeosetAnim for GeosetId ${geosetId}`,
                )
                return false
            }
            usedGeosetIds.add(geosetId)
            return true
        })
    }

    geosets.forEach((geoset, index) => {
        repairStaticIndex(
            repairs,
            geoset,
            'MaterialID',
            `Geosets[${index}].MaterialID`,
            'Materials',
            materials.length,
            materials.length > 0 ? 0 : null,
            { allowNull: true },
        )
    })

    materials.forEach((material, materialIndex) => {
        asArray(material.Layers).map(asRecord).forEach((layer, layerIndex) => {
            const layerPath = `Materials[${materialIndex}].Layers[${layerIndex}]`
            for (const key of MATERIAL_TEXTURE_REF_KEYS) {
                repairTextureReference(repairs, layer, key, `${layerPath}.${key}`, textures.length)
            }
            repairLayerTextureAnimId(repairs, layer, `${layerPath}.TVertexAnimId`, textureAnims.length)
        })
    })

    const nodeArrays = [
        'ParticleEmitters',
        'ParticleEmitters2',
        'RibbonEmitters',
    ] as const

    nodeArrays.forEach((arrayName) => {
        asArray(data[arrayName]).map(asRecord).forEach((node, index) => {
            const nodePath = `${arrayName}[${index}]`
            if (arrayName === 'RibbonEmitters') {
                repairStaticIndex(repairs, node, 'MaterialID', `${nodePath}.MaterialID`, 'Materials', materials.length, materials.length > 0 ? 0 : null, {
                    allowNull: true,
                })
            } else {
                const textureKey = node.TextureID !== undefined ? 'TextureID' : 'TextureId'
                repairStaticIndex(repairs, node, textureKey, `${nodePath}.${textureKey}`, 'Textures', textures.length, textures.length > 0 ? 0 : -1, {
                    allowNull: true,
                    allowNegative: true,
                })
            }
        })
    })

    return { modelData: repaired, repairs }
}

export const formatDocumentReferenceRepairs = (repairs: DocumentReferenceRepair[]): string[] =>
    repairs.map((repair) => `${repair.path}: ${repair.message}`)
