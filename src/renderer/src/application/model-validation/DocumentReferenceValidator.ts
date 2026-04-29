import { MATERIAL_TEXTURE_REF_KEYS } from '../../utils/materialTextureRelations'

export type DocumentReferenceValidationIssue = {
    path: string
    message: string
}

const asArray = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : []

const asRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

const isNonNegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0

const isAnimTrack = (value: unknown): value is { Keys?: unknown[]; GlobalSeqId?: unknown } =>
    value !== null && typeof value === 'object' && Array.isArray((value as { Keys?: unknown[] }).Keys)

const getVectorFirst = (value: unknown): unknown => {
    if (ArrayBuffer.isView(value) || Array.isArray(value)) {
        return (value as ArrayLike<unknown>)[0]
    }
    return undefined
}

const getNodeArrays = (data: Record<string, unknown>): Array<{ key: string; items: Record<string, unknown>[] }> => [
    { key: 'Bones', items: asArray(data.Bones).map(asRecord) },
    { key: 'Lights', items: asArray(data.Lights).map(asRecord) },
    { key: 'Helpers', items: asArray(data.Helpers).map(asRecord) },
    { key: 'Attachments', items: asArray(data.Attachments).map(asRecord) },
    { key: 'ParticleEmitters', items: asArray(data.ParticleEmitters).map(asRecord) },
    { key: 'ParticleEmitters2', items: asArray(data.ParticleEmitters2).map(asRecord) },
    { key: 'RibbonEmitters', items: asArray(data.RibbonEmitters).map(asRecord) },
    { key: 'EventObjects', items: asArray(data.EventObjects).map(asRecord) },
    { key: 'CollisionShapes', items: asArray(data.CollisionShapes).map(asRecord) },
    { key: 'ParticleEmitterPopcorns', items: asArray(data.ParticleEmitterPopcorns).map(asRecord) },
]

const pushInvalidIndex = (
    issues: DocumentReferenceValidationIssue[],
    path: string,
    value: unknown,
    targetName: string,
    targetCount: number,
): void => {
    issues.push({
        path,
        message: `${path} references ${targetName} index ${String(value)}, but ${targetName} count is ${targetCount}`,
    })
}

const validateIndexReference = (
    issues: DocumentReferenceValidationIssue[],
    path: string,
    value: unknown,
    targetName: string,
    targetCount: number,
    options: { allowNull?: boolean; allowNegative?: boolean } = {},
): void => {
    if (value === undefined || value === null) {
        if (!options.allowNull) {
            pushInvalidIndex(issues, path, value, targetName, targetCount)
        }
        return
    }

    if (typeof value !== 'number' || !Number.isInteger(value)) {
        pushInvalidIndex(issues, path, value, targetName, targetCount)
        return
    }

    if (value < 0) {
        if (!options.allowNegative) {
            pushInvalidIndex(issues, path, value, targetName, targetCount)
        }
        return
    }

    if (value >= targetCount) {
        pushInvalidIndex(issues, path, value, targetName, targetCount)
    }
}

const validateTextureReferenceValue = (
    issues: DocumentReferenceValidationIssue[],
    path: string,
    value: unknown,
    textureCount: number,
): void => {
    if (value === undefined || value === null) return

    if (typeof value === 'number') {
        validateIndexReference(issues, path, value, 'Textures', textureCount, { allowNegative: true })
        return
    }

    if (!isAnimTrack(value)) return

    value.Keys?.forEach((key, keyIndex) => {
        const vectorValue = getVectorFirst(asRecord(key).Vector)
        validateIndexReference(issues, `${path}.Keys[${keyIndex}].Vector[0]`, vectorValue, 'Textures', textureCount, {
            allowNegative: true,
        })
    })
}

const validateGlobalSeqId = (
    issues: DocumentReferenceValidationIssue[],
    path: string,
    value: unknown,
    globalSequenceCount: number,
): void => {
    if (!isAnimTrack(value)) return
    const globalSeqId = value.GlobalSeqId
    if (globalSeqId === undefined || globalSeqId === null || globalSeqId === -1) return
    validateIndexReference(issues, `${path}.GlobalSeqId`, globalSeqId, 'GlobalSequences', globalSequenceCount)
}

const validateTracksInObject = (
    issues: DocumentReferenceValidationIssue[],
    path: string,
    value: unknown,
    globalSequenceCount: number,
): void => {
    if (value === null || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = `${path}.${key}`
        if (isAnimTrack(nested)) {
            validateGlobalSeqId(issues, nextPath, nested, globalSequenceCount)
            continue
        }
        if (nested !== null && typeof nested === 'object' && !ArrayBuffer.isView(nested)) {
            validateTracksInObject(issues, nextPath, nested, globalSequenceCount)
        }
    }
}

export const validateDocumentReferences = (modelData: unknown): DocumentReferenceValidationIssue[] => {
    const issues: DocumentReferenceValidationIssue[] = []
    const data = asRecord(modelData)
    if (!modelData) return issues

    const geosets = asArray(data.Geosets).map(asRecord)
    const geosetAnims = asArray(data.GeosetAnims).map(asRecord)
    const materials = asArray(data.Materials).map(asRecord)
    const textures = asArray(data.Textures).map(asRecord)
    const textureAnims = asArray(data.TextureAnims).map(asRecord)
    const globalSequences = asArray(data.GlobalSequences)

    geosetAnims.forEach((anim, index) => {
        validateIndexReference(issues, `GeosetAnims[${index}].GeosetId`, anim.GeosetId, 'Geosets', geosets.length)
    })

    geosets.forEach((geoset, index) => {
        validateIndexReference(issues, `Geosets[${index}].MaterialID`, geoset.MaterialID, 'Materials', materials.length, {
            allowNull: true,
        })
    })

    materials.forEach((material, materialIndex) => {
        asArray(material.Layers).map(asRecord).forEach((layer, layerIndex) => {
            const layerPath = `Materials[${materialIndex}].Layers[${layerIndex}]`
            for (const key of MATERIAL_TEXTURE_REF_KEYS) {
                validateTextureReferenceValue(issues, `${layerPath}.${key}`, layer[key], textures.length)
            }

            const tvertexAnimId = layer.TVertexAnimId ?? layer.TextureAnimationId ?? layer.TextureAnimId
            validateIndexReference(issues, `${layerPath}.TVertexAnimId`, tvertexAnimId, 'TextureAnims', textureAnims.length, {
                allowNull: true,
                allowNegative: true,
            })

            validateTracksInObject(issues, layerPath, layer, globalSequences.length)
        })
    })

    getNodeArrays(data).forEach(({ key, items }) => {
        items.forEach((node, index) => {
            const nodePath = `${key}[${index}]`
            if (key === 'RibbonEmitters') {
                validateIndexReference(issues, `${nodePath}.MaterialID`, node.MaterialID, 'Materials', materials.length, {
                    allowNull: true,
                })
            }
            if (key === 'Bones') {
                validateIndexReference(issues, `${nodePath}.GeosetId`, node.GeosetId, 'Geosets', geosets.length, {
                    allowNull: true,
                })
                validateIndexReference(issues, `${nodePath}.GeosetAnimId`, node.GeosetAnimId, 'GeosetAnims', geosetAnims.length, {
                    allowNull: true,
                })
            }
            if (key === 'ParticleEmitters' || key === 'ParticleEmitters2') {
                const textureId = node.TextureID ?? node.TextureId
                if (isNonNegativeInteger(textureId)) {
                    validateIndexReference(issues, `${nodePath}.TextureID`, textureId, 'Textures', textures.length)
                }
            }
            validateTracksInObject(issues, nodePath, node, globalSequences.length)
        })
    })

    textureAnims.forEach((textureAnim, index) => {
        validateTracksInObject(issues, `TextureAnims[${index}]`, textureAnim, globalSequences.length)
    })

    geosetAnims.forEach((geosetAnim, index) => {
        validateTracksInObject(issues, `GeosetAnims[${index}]`, geosetAnim, globalSequences.length)
    })

    return issues
}

export const formatDocumentReferenceIssues = (issues: DocumentReferenceValidationIssue[]): string[] =>
    issues.map((issue) => issue.message)
