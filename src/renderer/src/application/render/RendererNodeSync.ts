import {
    createSyncResult,
    markRendererSyncApplied,
    markRendererSyncFailed,
    markRendererSyncStarted,
} from './RendererSyncDiagnostics'
import type {
    NodeProjectionRendererSyncInput,
    NodeStructureRendererSyncInput,
    RendererSyncError,
    RendererSyncResult,
} from './RendererSyncTypes'
import { applyNodeCollections, type RendererNode } from './RendererNodeCollections'

export const syncNodeProjection = (
    input: NodeProjectionRendererSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('nodeStructure', 'document', input)

    if (!input.renderer?.model) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    const safeNodes = Array.isArray(input.nodes)
        ? input.nodes.filter((node): node is RendererNode => !!node && typeof node === 'object' && typeof (node as Record<string, unknown>).ObjectId === 'number')
        : []

    try {
        const rendererModel = input.renderer.model as Record<string, unknown>
        applyNodeCollections(rendererModel, safeNodes)

        let invalidWrappers = 0
        const storeNodeMap = new Map<number, RendererNode>(safeNodes.map((node) => [node.ObjectId as number, node]))
        const wrappers = input.renderer.rendererData?.nodes
        wrappers?.forEach((wrapper) => {
            const wrapperNodeId = wrapper?.node?.ObjectId
            if (typeof wrapperNodeId !== 'number') {
                invalidWrappers += 1
                return
            }
            const freshNode = storeNodeMap.get(wrapperNodeId)
            if (freshNode && wrapper) {
                wrapper.node = freshNode
            }
        })

        if (invalidWrappers > 0) {
            input.renderer.modelInstance?.syncNodes?.()
        }

        const result = createSyncResult(input, 'document', 'nodeStructure', true)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'node_projection_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown node projection sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}

export const syncNodeStructure = (
    input: NodeStructureRendererSyncInput,
): RendererSyncResult => {
    markRendererSyncStarted('nodeStructure', 'document', input)

    if (!input.renderer?.model || !input.renderer.modelInstance) {
        const result = createSyncResult(input, 'document', 'none', false)
        markRendererSyncFailed(result, 'renderer_unavailable')
        return result
    }

    try {
        const nextNodes = Array.isArray(input.nodes) && input.nodes.length > 0
            ? input.nodes
            : (input.ensureNodes?.(input.renderer.model) ?? input.renderer.model.Nodes ?? [])

        const rendererModel = input.renderer.model as Record<string, unknown>
        applyNodeCollections(rendererModel, nextNodes as RendererNode[])
        input.renderer.modelInstance.syncNodes?.()
        input.renderer.modelInstance.syncMaterials?.()
        input.renderer.modelInstance.syncGlobalSequences?.()

        const result = createSyncResult(input, 'document', 'nodeStructure', true)
        markRendererSyncApplied(result)
        return result
    } catch (error) {
        const syncError: RendererSyncError = {
            code: 'node_structure_sync_failed',
            message: error instanceof Error ? error.message : 'Unknown node structure sync error',
        }
        const result = createSyncResult(input, 'document', 'fullReload', false, [syncError])
        markRendererSyncFailed(result, syncError.code)
        return result
    }
}
