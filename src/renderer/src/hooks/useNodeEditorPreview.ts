import { useCallback, useEffect, useRef } from 'react'
import {
    NODE_EDITOR_COMMANDS,
    type ClearNodePreviewPayload,
    type NodeEditorCommandSender,
    type NodeEditorNodePayload,
} from '../types/nodeEditorRpc'

type HistoryLike = {
    name: string
    undoNode: any
    redoNode: any
}

interface UseNodeEditorPreviewOptions<TNode> {
    visible: boolean
    nodeId: number | null
    currentNodeObjectId?: number | null
    isStandalone?: boolean
    standaloneEmit?: NodeEditorCommandSender
    setStorePreview: (payload: { objectId: number; node: TNode }) => void
    clearStorePreview: () => void
    buildPreviewNode: () => TNode | null
}

export function useNodeEditorPreview<TNode>({
    visible,
    nodeId,
    currentNodeObjectId,
    isStandalone,
    standaloneEmit,
    setStorePreview,
    clearStorePreview,
    buildPreviewNode,
}: UseNodeEditorPreviewOptions<TNode>) {
    const allowLivePreviewRef = useRef(false)
    const previewRafRef = useRef<number | null>(null)
    const pendingPreviewRef = useRef(false)

    const pushPreviewNode = useCallback((next: TNode) => {
        if (nodeId === null) return

        if (isStandalone && standaloneEmit) {
            const payload: NodeEditorNodePayload<TNode> = { objectId: nodeId, node: next }
            standaloneEmit(NODE_EDITOR_COMMANDS.previewNodeUpdate, payload)
            return
        }

        setStorePreview({ objectId: nodeId, node: next })
    }, [isStandalone, nodeId, setStorePreview, standaloneEmit])

    const clearPreviewNode = useCallback(() => {
        if (isStandalone && standaloneEmit) {
            const payload: ClearNodePreviewPayload = { objectId: nodeId }
            standaloneEmit(NODE_EDITOR_COMMANDS.clearNodePreview, payload)
            return
        }

        clearStorePreview()
    }, [clearStorePreview, isStandalone, nodeId, standaloneEmit])

    const flushPreview = useCallback(() => {
        previewRafRef.current = null

        if (!allowLivePreviewRef.current || !pendingPreviewRef.current || nodeId === null) {
            pendingPreviewRef.current = false
            return
        }

        pendingPreviewRef.current = false
        const next = buildPreviewNode()
        if (!next) return
        pushPreviewNode(next)
    }, [buildPreviewNode, nodeId, pushPreviewNode])

    const schedulePreview = useCallback(() => {
        if (!allowLivePreviewRef.current || nodeId === null) return

        pendingPreviewRef.current = true
        if (previewRafRef.current != null) return

        previewRafRef.current = requestAnimationFrame(() => {
            flushPreview()
        })
    }, [flushPreview, nodeId])

    useEffect(() => {
        if (!visible || !currentNodeObjectId) {
            allowLivePreviewRef.current = false
            return
        }

        const timer = window.setTimeout(() => {
            allowLivePreviewRef.current = true
        }, 0)

        return () => {
            clearTimeout(timer)
            allowLivePreviewRef.current = false
        }
    }, [visible, currentNodeObjectId])

    useEffect(() => {
        if (!visible) {
            clearPreviewNode()
        }
    }, [clearPreviewNode, visible])

    useEffect(() => {
        return () => {
            if (previewRafRef.current != null) {
                cancelAnimationFrame(previewRafRef.current)
                previewRafRef.current = null
            }
            pendingPreviewRef.current = false
        }
    }, [])

    return {
        schedulePreview,
        pushPreviewNode,
        clearPreviewNode,
    }
}

export type { HistoryLike }
