import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import { deepClone } from '../../utils/modelMerge'
import { extractNodesFromModel, updateModelDataWithNodes } from '../../store/modelStore'

export interface RetargetAnimationReplacementResult {
    modelData: ModelData
    nodes: ModelNode[]
    sequenceCount: number
    copiedTrackCount: number
}

export type RetargetSequenceReplaceMode = 'smart' | 'manual'

const NODE_ANIMATION_FIELDS = [
    'Translation',
    'Rotation',
    'Scaling',
    'Visibility',
    'VisibilityAnim',
    'ColorAnim',
    'AlphaAnim',
    'AmbientColorAnim',
    'IntensityAnim',
    'AmbientIntensityAnim',
    'AttenuationStartAnim',
    'AttenuationEndAnim',
    'EmissionRateAnim',
    'LifeSpanAnim',
    'SpeedAnim',
    'VariationAnim',
    'LatitudeAnim',
    'LongitudeAnim',
    'WidthAnim',
    'LengthAnim',
    'GravityAnim',
    'TargetTranslation',
    'EventTrack',
] as const

const NODE_OPTIONAL_TRACK_FIELDS = [
    'Color',
    'AmbColor',
    'AmbientColor',
    'Alpha',
    'Intensity',
    'AmbIntensity',
    'AmbientIntensity',
    'AttenuationStart',
    'AttenuationEnd',
    'EmissionRate',
    'LifeSpan',
    'Speed',
    'Variation',
    'Latitude',
    'Longitude',
    'Width',
    'Length',
    'Gravity',
] as const

const GEOMETRY_ANIMATION_FIELDS = ['Alpha', 'Color'] as const
const CAMERA_ANIMATION_FIELDS = ['Translation', 'Rotation', 'TargetTranslation'] as const

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object'

const isAnimTrack = (value: unknown): boolean =>
    isObject(value) && Array.isArray((value as { Keys?: unknown }).Keys)

const cloneValue = <T,>(value: T): T => deepClone(value)

const readName = (value: unknown): string =>
    isObject(value) ? String(value.Name ?? value.name ?? '').trim().toLowerCase() : ''

const nodeKey = (node: ModelNode): string | null => {
    const name = readName(node)
    return name ? `${(node as any).type ?? ''}:${name}` : null
}

const buildNodeLookup = (nodes: ModelNode[]): Map<number | string, ModelNode> => {
    const lookup = new Map<number | string, ModelNode>()
    for (const node of nodes) {
        if (typeof node.ObjectId === 'number') {
            lookup.set(node.ObjectId, node)
        }
        const key = nodeKey(node)
        if (key && !lookup.has(key)) {
            lookup.set(key, node)
        }
    }
    return lookup
}

const copyAnimationFields = (
    source: Record<string, any> | undefined,
    target: Record<string, any>,
    fields: readonly string[],
): number => {
    if (!source || !target) return 0
    let copied = 0
    for (const field of fields) {
        if (source[field] !== undefined) {
            target[field] = cloneValue(source[field])
            copied += 1
        } else if (target[field] !== undefined) {
            delete target[field]
            copied += 1
        }
    }
    return copied
}

const copyOptionalTrackFields = (
    source: Record<string, any> | undefined,
    target: Record<string, any>,
    fields: readonly string[],
): number => {
    if (!source || !target) return 0
    let copied = 0
    for (const field of fields) {
        if (isAnimTrack(source[field])) {
            target[field] = cloneValue(source[field])
            copied += 1
        } else if (isAnimTrack(target[field])) {
            delete target[field]
            copied += 1
        }
    }
    return copied
}

const copyMatchedArrayFields = (
    sourceItems: unknown,
    targetItems: unknown,
    fields: readonly string[],
    matchKey: string = 'Name',
): number => {
    if (!Array.isArray(sourceItems) || !Array.isArray(targetItems)) return 0

    const byName = new Map<string, Record<string, any>>()
    sourceItems.forEach((item) => {
        if (!isObject(item)) return
        const key = readName(item)
        if (key && !byName.has(key)) {
            byName.set(key, item as Record<string, any>)
        }
    })

    let copied = 0
    targetItems.forEach((target, index) => {
        if (!isObject(target)) return
        const targetKey = readName(target)
        const source = (targetKey ? byName.get(targetKey) : undefined)
            ?? (isObject(sourceItems[index]) ? sourceItems[index] as Record<string, any> : undefined)
        copied += copyAnimationFields(source, target as Record<string, any>, fields)
    })

    if (matchKey === 'GeosetId') {
        const byGeosetId = new Map<number, Record<string, any>>()
        sourceItems.forEach((item) => {
            if (!isObject(item)) return
            const geosetId = Number((item as any).GeosetId)
            if (Number.isInteger(geosetId) && !byGeosetId.has(geosetId)) {
                byGeosetId.set(geosetId, item as Record<string, any>)
            }
        })
        targetItems.forEach((target) => {
            if (!isObject(target)) return
            const geosetId = Number((target as any).GeosetId)
            const source = Number.isInteger(geosetId) ? byGeosetId.get(geosetId) : undefined
            if (source) {
                copied += copyAnimationFields(source, target as Record<string, any>, fields)
            }
        })
    }

    return copied
}

const copyMaterialLayerAnimationTracks = (sourceModelData: any, targetModelData: any): number => {
    const sourceMaterials = Array.isArray(sourceModelData.Materials) ? sourceModelData.Materials : []
    const targetMaterials = Array.isArray(targetModelData.Materials) ? targetModelData.Materials : []
    let copied = 0

    targetMaterials.forEach((targetMaterial: any, materialIndex: number) => {
        const sourceMaterial = sourceMaterials[materialIndex]
        const sourceLayers = Array.isArray(sourceMaterial?.Layers) ? sourceMaterial.Layers : []
        const targetLayers = Array.isArray(targetMaterial?.Layers) ? targetMaterial.Layers : []

        targetLayers.forEach((targetLayer: any, layerIndex: number) => {
            const sourceLayer = sourceLayers[layerIndex]
            if (!sourceLayer) return

            for (const field of ['Alpha', 'EmissiveGain', 'FresnelOpacity', 'FresnelTeamColor'] as const) {
                if (isAnimTrack(sourceLayer[field])) {
                    targetLayer[field] = cloneValue(sourceLayer[field])
                    copied += 1
                } else if (isAnimTrack(targetLayer[field])) {
                    delete targetLayer[field]
                    copied += 1
                }
            }
        })
    })

    return copied
}

export const buildRetargetAnimationReplacement = (
    sourceModelData: ModelData,
    targetModelData: ModelData,
): RetargetAnimationReplacementResult => {
    const sourceAny = sourceModelData as any
    const targetAny = cloneValue(targetModelData) as any
    const sourceSequences = Array.isArray(sourceAny.Sequences) ? cloneValue(sourceAny.Sequences) : []
    let copiedTrackCount = 0

    targetAny.Sequences = sourceSequences
    if (targetAny.Model) {
        targetAny.Model.NumSequences = sourceSequences.length
    }
    if (targetAny.Info) {
        targetAny.Info.NumSequences = sourceSequences.length
    }

    if (Array.isArray(sourceAny.GlobalSequences)) {
        targetAny.GlobalSequences = cloneValue(sourceAny.GlobalSequences)
    }

    if (Array.isArray(sourceAny.TextureAnims)) {
        targetAny.TextureAnims = cloneValue(sourceAny.TextureAnims)
        copiedTrackCount += sourceAny.TextureAnims.length
    }

    const sourceNodes = extractNodesFromModel(sourceModelData)
    const targetNodes = extractNodesFromModel(targetAny)
    const sourceNodeLookup = buildNodeLookup(sourceNodes)
    const nextNodes = targetNodes.map((targetNode) => {
        const key = nodeKey(targetNode)
        const sourceNode = (key ? sourceNodeLookup.get(key) : undefined) ?? sourceNodeLookup.get(targetNode.ObjectId)
        if (!sourceNode) return targetNode
        const nextNode = { ...targetNode } as ModelNode
        copiedTrackCount += copyAnimationFields(sourceNode as any, nextNode as any, NODE_ANIMATION_FIELDS)
        copiedTrackCount += copyOptionalTrackFields(sourceNode as any, nextNode as any, NODE_OPTIONAL_TRACK_FIELDS)
        return nextNode
    })

    const withNodes = updateModelDataWithNodes(targetAny, nextNodes, false) as ModelData
    const withNodesAny = withNodes as any

    copiedTrackCount += copyMatchedArrayFields(sourceAny.GeosetAnims, withNodesAny.GeosetAnims, GEOMETRY_ANIMATION_FIELDS, 'GeosetId')
    copiedTrackCount += copyMatchedArrayFields(sourceAny.Cameras, withNodesAny.Cameras, CAMERA_ANIMATION_FIELDS)
    copiedTrackCount += copyMaterialLayerAnimationTracks(sourceAny, withNodesAny)

    return {
        modelData: withNodes,
        nodes: extractNodesFromModel(withNodes),
        sequenceCount: sourceSequences.length,
        copiedTrackCount,
    }
}

export const buildRetargetSequenceRangeReplacement = (
    sourceModelData: ModelData,
    targetModelData: ModelData,
): RetargetAnimationReplacementResult => {
    const sourceAny = sourceModelData as any
    const targetAny = cloneValue(targetModelData) as any
    const sourceSequences = Array.isArray(sourceAny.Sequences) ? cloneValue(sourceAny.Sequences) : []

    targetAny.Sequences = sourceSequences
    if (targetAny.Model) {
        targetAny.Model.NumSequences = sourceSequences.length
    }
    if (targetAny.Info) {
        targetAny.Info.NumSequences = sourceSequences.length
    }

    return {
        modelData: targetAny,
        nodes: extractNodesFromModel(targetAny),
        sequenceCount: sourceSequences.length,
        copiedTrackCount: 0,
    }
}
