import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import {
    extractNodesFromModel,
    type MaterialManagerPreview,
    type NodeEditorPreview,
    updateModelDataWithNodes,
} from '../../store/modelStore'

export type PreviewProjectionMode = 'document' | 'materialPreview'

export interface PreviewProjectionInput {
    modelData: ModelData | null
    materialManagerPreview?: MaterialManagerPreview | null
    nodeEditorPreview?: NodeEditorPreview | null
}

export interface MaterialPreviewProjection {
    modelData: ModelData | null
    projection: PreviewProjectionMode
}

export class PreviewProjectionService {
    getEffectiveModelData(input: PreviewProjectionInput): ModelData | null {
        const materialProjected = this.getMaterialPreviewProjection(
            input.modelData,
            input.materialManagerPreview ?? null,
        ).modelData
        return this.getNodeProjectedModelData(materialProjected, input.nodeEditorPreview ?? null)
    }

    getMaterialPreviewProjection(
        modelData: ModelData | null,
        materialManagerPreview: MaterialManagerPreview | null,
    ): MaterialPreviewProjection {
        return {
            modelData: this.getMaterialProjectedModelData(modelData, materialManagerPreview),
            projection: materialManagerPreview ? 'materialPreview' : 'document',
        }
    }

    getMaterialProjectedModelData(
        modelData: ModelData | null,
        materialManagerPreview: MaterialManagerPreview | null,
    ): ModelData | null {
        if (!modelData) return null
        if (!materialManagerPreview) return modelData

        const next: ModelData = { ...modelData }
        if (Array.isArray(materialManagerPreview.materials) && materialManagerPreview.materials.length > 0) {
            next.Materials = materialManagerPreview.materials
        }
        if (Array.isArray(materialManagerPreview.textures) && materialManagerPreview.textures.length > 0) {
            next.Textures = materialManagerPreview.textures
        }
        if (materialManagerPreview.geosets !== undefined) {
            next.Geosets = materialManagerPreview.geosets
        }
        if (materialManagerPreview.ribbonEmitters !== undefined) {
            next.RibbonEmitters = materialManagerPreview.ribbonEmitters
        }
        return next
    }

    getNodeProjectedModelData(
        modelData: ModelData | null,
        nodeEditorPreview: NodeEditorPreview | null,
    ): ModelData | null {
        if (!modelData || !nodeEditorPreview) return modelData

        const nodes = extractNodesFromModel(modelData)
        if (!Array.isArray(nodes) || nodes.length === 0) return modelData

        const hasTarget = nodes.some((node) => node.ObjectId === nodeEditorPreview.objectId)
        if (!hasTarget) return modelData

        const updatedNodes = nodes.map((node) =>
            node.ObjectId === nodeEditorPreview.objectId ? ({ ...nodeEditorPreview.node } as ModelNode) : node
        )

        return updateModelDataWithNodes(modelData, updatedNodes, false)
    }
}

export const previewProjectionService = new PreviewProjectionService()
