import type {
    NodeEditorKind,
    NodeEditorMaterialSummary,
    NodeEditorNodeSummary,
    NodeEditorPivotPoint,
    NodeEditorResourceSummary,
    NodeEditorRpcState,
    NodeEditorSequenceSummary,
    NodeEditorTextureDetail,
    NodeEditorTextureSummary,
} from '../../types/nodeEditorRpc'
import type { ModelNode } from '../../types/node'

type NodeEditorPreviewDetail = {
    objectId: number
    node: ModelNode
}

export interface NodeEditorSessionSnapshotInput {
    kind: NodeEditorKind
    objectId: number
    sessionNonce: number
}

export interface NodeEditorLiveSnapshotInput {
    documentId: string | null
    documentRevision: number
    assetRevision: number
    previewRevision: number
    modelPath?: string | null
    modelData?: any | null
    nodes?: any[] | null
    nodeEditorPreview?: NodeEditorPreviewDetail | null
}

export interface CreateNodeEditorStateInput extends NodeEditorLiveSnapshotInput {
    session: NodeEditorSessionSnapshotInput
    snapshotRevision: number
    node: any | null
}

const toGlobalSequenceDurations = (values: unknown): number[] => {
    if (!Array.isArray(values)) {
        return []
    }
    return values
        .map((value) => typeof value === 'number' ? value : (value as { Duration?: unknown } | null)?.Duration)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
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

const toPivotPoint = (value: unknown): NodeEditorPivotPoint | null => {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
        return null
    }
    const source = Array.from(value as ArrayLike<unknown>)
    if (source.length < 3) {
        return null
    }
    const pivot: NodeEditorPivotPoint = [Number(source[0]), Number(source[1]), Number(source[2])]
    return pivot.every((entry) => Number.isFinite(entry)) ? pivot : null
}

export const createSelectedNodePivotPoint = (
    node: unknown,
    modelData: any | null | undefined,
    objectId: number,
): NodeEditorPivotPoint | null => {
    return toPivotPoint(modelData?.PivotPoints?.[objectId])
        ?? toPivotPoint((node as { PivotPoint?: unknown } | null)?.PivotPoint)
}

export const createTextureSummaries = (textures: unknown): NodeEditorTextureSummary[] => {
    if (!Array.isArray(textures)) {
        return []
    }
    return textures.map((texture: any, index) => ({
        index,
        image: typeof texture?.Image === 'string' ? texture.Image : undefined,
        replaceableId: typeof texture?.ReplaceableId === 'number' ? texture.ReplaceableId : undefined,
    }))
}

const toBooleanIfPresent = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined

const toNumberIfPresent = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const createTextureDetail = (texture: unknown, index: number): NodeEditorTextureDetail | null => {
    if (!texture || typeof texture !== 'object') {
        return null
    }
    const record = texture as Record<string, unknown>
    const image = typeof record.Image === 'string'
        ? record.Image
        : (typeof record.Path === 'string' ? record.Path : '')
    const detail: NodeEditorTextureDetail = {
        index,
        Image: image,
    }
    if (typeof record.Path === 'string') {
        detail.Path = record.Path
    }
    const replaceableId = toNumberIfPresent(record.ReplaceableId)
    if (replaceableId !== undefined) {
        detail.ReplaceableId = replaceableId
    }
    const wrapWidth = toBooleanIfPresent(record.WrapWidth)
    if (wrapWidth !== undefined) {
        detail.WrapWidth = wrapWidth
    }
    const wrapHeight = toBooleanIfPresent(record.WrapHeight)
    if (wrapHeight !== undefined) {
        detail.WrapHeight = wrapHeight
    }
    const flags = toNumberIfPresent(record.Flags)
    if (flags !== undefined) {
        detail.Flags = flags
    }
    return detail
}

export const createSelectedParticleEmitter2Texture = (
    node: unknown,
    modelData: any | null | undefined,
    kind: NodeEditorKind | '',
): NodeEditorTextureDetail | null => {
    if (kind !== 'particleEmitter2') {
        return null
    }
    const textureId = Number((node as { TextureID?: unknown } | null)?.TextureID)
    if (!Number.isInteger(textureId) || textureId < 0) {
        return null
    }
    const textures = modelData?.Textures
    if (!Array.isArray(textures) || textureId >= textures.length) {
        return null
    }
    return createTextureDetail(textures[textureId], textureId)
}

export const resolveNodeEditorSelectedDetailNode = (
    node: unknown,
    session: NodeEditorSessionSnapshotInput,
    nodeEditorPreview?: NodeEditorPreviewDetail | null,
): unknown => {
    if (session.kind === 'particleEmitter2' && nodeEditorPreview?.objectId === session.objectId && nodeEditorPreview.node) {
        return nodeEditorPreview.node
    }
    return node
}

export const createMaterialSummaries = (materials: unknown): NodeEditorMaterialSummary[] => {
    if (!Array.isArray(materials)) {
        return []
    }
    return materials.map((material: any, index) => ({
        index,
        layerCount: Array.isArray(material?.Layers) ? material.Layers.length : 0,
        priorityPlane: typeof material?.PriorityPlane === 'number' ? material.PriorityPlane : undefined,
    }))
}

export const createSequenceSummaries = (sequences: unknown): NodeEditorSequenceSummary[] => {
    if (!Array.isArray(sequences)) {
        return []
    }
    return sequences.map((sequence: any, index) => ({
        index,
        name: typeof sequence?.Name === 'string' ? sequence.Name : `Sequence ${index}`,
        interval: toIntervalSummary(sequence?.Interval),
    }))
}

export const createNodeSummaries = (nodes: unknown): NodeEditorNodeSummary[] => {
    if (!Array.isArray(nodes)) {
        return []
    }
    return nodes
        .filter((node) => node && typeof (node as any).ObjectId === 'number')
        .map((node: any) => ({
            objectId: node.ObjectId,
            name: typeof node.Name === 'string' ? node.Name : undefined,
            parent: typeof node.Parent === 'number' ? node.Parent : undefined,
            type: typeof node.type === 'number' ? node.type : undefined,
        }))
}

export const createNodeEditorResourceSummary = (
    modelData: any | null | undefined,
    nodes: any[] | null | undefined,
): NodeEditorResourceSummary => ({
    textures: createTextureSummaries(modelData?.Textures),
    materials: createMaterialSummaries(modelData?.Materials),
    sequences: createSequenceSummaries(modelData?.Sequences),
    globalSequenceDurations: toGlobalSequenceDurations(modelData?.GlobalSequences),
    nodes: createNodeSummaries(nodes),
})

export const createEmptyNodeEditorRpcState = (live: NodeEditorLiveSnapshotInput): NodeEditorRpcState => {
    const resources = createNodeEditorResourceSummary(null, [])
    return {
        documentId: live.documentId,
        documentRevision: live.documentRevision,
        assetRevision: live.assetRevision,
        previewRevision: live.previewRevision,
        snapshotRevision: 0,
        windowId: 'nodeEditor',
        snapshotVersion: 0,
        sessionNonce: 0,
        kind: '',
        objectId: -1,
        node: null,
        textures: [],
        /** @deprecated Standalone node editor should use materialSummaries/resources.materials. */
        materials: [],
        globalSequences: [],
        sequences: [],
        modelPath: '',
        renameInitialName: '',
        allNodes: [],
        pivotPoints: [],
        selectedPivotPoint: null,
        selectedParticleEmitter2Texture: null,
        resources,
        textureSummaries: resources.textures,
        materialSummaries: resources.materials,
        sequenceSummaries: resources.sequences,
        globalSequenceDurations: resources.globalSequenceDurations,
        nodeSummaries: resources.nodes,
        resourceRevision: 0,
    }
}

export const createNodeEditorRpcState = ({
    session,
    snapshotRevision,
    node,
    modelData,
    nodes,
    nodeEditorPreview,
    modelPath,
    documentId,
    documentRevision,
    assetRevision,
    previewRevision,
}: CreateNodeEditorStateInput): NodeEditorRpcState => {
    const resources = createNodeEditorResourceSummary(modelData, nodes)
    const selectedPivotPoint = createSelectedNodePivotPoint(node, modelData, session.objectId)
    const selectedDetailNode = resolveNodeEditorSelectedDetailNode(node, session, nodeEditorPreview)
    const selectedParticleEmitter2Texture = createSelectedParticleEmitter2Texture(selectedDetailNode, modelData, session.kind)
    return {
        documentId,
        documentRevision,
        assetRevision,
        previewRevision,
        snapshotRevision,
        windowId: 'nodeEditor',
        snapshotVersion: snapshotRevision,
        sessionNonce: session.sessionNonce,
        kind: session.kind,
        objectId: session.objectId,
        node,
        textures: [],
        materials: [],
        globalSequences: [],
        sequences: [],
        modelPath: modelPath ?? '',
        renameInitialName: node?.Name ?? '',
        allNodes: [],
        pivotPoints: [],
        selectedPivotPoint,
        selectedParticleEmitter2Texture,
        resources,
        textureSummaries: resources.textures,
        materialSummaries: resources.materials,
        sequenceSummaries: resources.sequences,
        globalSequenceDurations: resources.globalSequenceDurations,
        nodeSummaries: resources.nodes,
        resourceRevision: Math.max(documentRevision, assetRevision, previewRevision),
    }
}
