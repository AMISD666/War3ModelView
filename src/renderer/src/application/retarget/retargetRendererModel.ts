import { deepClone } from '../../utils/modelMerge'

const REFERENCE_BLEND_MODES = new Set(['Blend', 'Transparent', 'AddAlpha', 1, 2, 4])

const sanitizeLayer = (layer: any, textureCount: number): any => {
    if (!layer || typeof layer !== 'object') return layer
    const next = { ...layer }
    const textureId = Number(next.TextureID ?? next.TextureId ?? next.textureId ?? 0)
    next.TextureID = Number.isFinite(textureId)
        ? Math.max(0, Math.min(Math.max(0, textureCount - 1), Math.trunc(textureId)))
        : 0
    if (next.FilterMode === undefined || next.FilterMode === null) {
        next.FilterMode = 'None'
    }
    if (REFERENCE_BLEND_MODES.has(next.FilterMode) && next.Alpha === undefined) {
        next.Alpha = 1
    }
    return next
}

const prepareMaterials = (model: any): any => {
    if (!Array.isArray(model?.Materials)) return model
    const textureCount = Array.isArray(model.Textures) ? model.Textures.length : 0
    return {
        ...model,
        Materials: model.Materials.map((material: any) => ({
            ...material,
            Layers: Array.isArray(material?.Layers)
                ? material.Layers.map((layer: any) => sanitizeLayer(layer, textureCount))
                : [],
        })),
    }
}

const ensureSequences = (model: any): any => {
    if (Array.isArray(model?.Sequences) && model.Sequences.length > 0) return model
    return {
        ...model,
        Sequences: [{
            Name: 'Stand',
            Interval: new Uint32Array([0, 1000]),
            NonLooping: 1,
            Rarity: 0,
            MoveSpeed: 0,
            BoundsRadius: 0,
        }],
    }
}

const ensureNodes = (model: any): { model: any; defaultNodeId: number } => {
    const nodes = Array.isArray(model?.Nodes) ? model.Nodes.filter(Boolean) : []
    if (nodes.length === 0) {
        const root = {
            Name: 'Root',
            ObjectId: 0,
            Parent: -1,
            PivotPoint: new Float32Array([0, 0, 0]),
            Flags: 0,
        }
        return { model: { ...model, Nodes: [root], PivotPoints: [root.PivotPoint] }, defaultNodeId: 0 }
    }

    const nextModel = { ...model, Nodes: nodes }
    if (!Array.isArray(nextModel.PivotPoints)) {
        let maxObjectId = -1
        for (const node of nodes) {
            if (typeof node.ObjectId === 'number') {
                maxObjectId = Math.max(maxObjectId, node.ObjectId)
            }
        }
        const pivotPoints: Float32Array[] = []
        for (const node of nodes) {
            if (typeof node.ObjectId !== 'number') continue
            const source = node.PivotPoint ?? [0, 0, 0]
            pivotPoints[node.ObjectId] = source instanceof Float32Array ? source : new Float32Array(source)
        }
        for (let index = 0; index <= maxObjectId; index += 1) {
            if (!pivotPoints[index]) {
                pivotPoints[index] = new Float32Array([0, 0, 0])
            }
        }
        nextModel.PivotPoints = pivotPoints
    }

    return { model: nextModel, defaultNodeId: nodes[0]?.ObjectId ?? 0 }
}

const ensureGeosetGroups = (model: any, defaultNodeId: number): void => {
    if (!Array.isArray(model?.Geosets)) return
    for (const geoset of model.Geosets) {
        const vertexCount = Math.floor((geoset?.Vertices?.length || 0) / 3)
        if (!Array.isArray(geoset.Groups) || geoset.Groups.length === 0) {
            geoset.Groups = [[defaultNodeId]]
        }
        if (!geoset.VertexGroup || geoset.VertexGroup.length !== vertexCount) {
            geoset.VertexGroup = new Uint16Array(vertexCount)
        }
        if (geoset.TotalGroupsCount === undefined || geoset.TotalGroupsCount === null) {
            geoset.TotalGroupsCount = geoset.Groups.length
        }

        const maxGroupIndex = geoset.Groups.length - 1
        for (let index = 0; index < geoset.VertexGroup.length; index += 1) {
            if (geoset.VertexGroup[index] > maxGroupIndex) {
                geoset.VertexGroup[index] = 0
            }
        }
        for (let index = 0; index < geoset.Groups.length; index += 1) {
            if (!Array.isArray(geoset.Groups[index]) || geoset.Groups[index].length === 0) {
                geoset.Groups[index] = [defaultNodeId]
            }
        }
    }
}

export const createRetargetRendererModel = (modelData: unknown): any => {
    const cloned = deepClone(modelData)
    const withMaterials = prepareMaterials(cloned)
    const withSequences = ensureSequences(withMaterials)
    const { model, defaultNodeId } = ensureNodes(withSequences)
    ensureGeosetGroups(model, defaultNodeId)
    return model
}
