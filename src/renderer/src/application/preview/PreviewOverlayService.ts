import { useModelStore, type MaterialManagerPreview, type NodeEditorPreview } from '../../store/modelStore'
import { markStandalonePerf } from '../diagnostics/StandalonePerf'

export type PreviewOverlayScope = 'materialManager' | 'nodeEditor' | 'globalColorAdjust'

export interface PreviewOverlayResult {
    scope: PreviewOverlayScope
    documentId: string | null
    baseDocumentRevision: number
    previousPreviewRevision: number
    nextPreviewRevision: number
    active: boolean
}

const createPreviewResult = (
    scope: PreviewOverlayScope,
    previousPreviewRevision: number,
    active: boolean,
): PreviewOverlayResult => {
    const state = useModelStore.getState()
    const result: PreviewOverlayResult = {
        scope,
        documentId: state.documentId,
        baseDocumentRevision: state.documentRevision,
        previousPreviewRevision,
        nextPreviewRevision: state.previewRevision,
        active,
    }
    markStandalonePerf('preview.overlayChanged', {
        scope,
        documentId: result.documentId ?? '',
        baseDocumentRevision: result.baseDocumentRevision,
        previousPreviewRevision: result.previousPreviewRevision,
        nextPreviewRevision: result.nextPreviewRevision,
        active,
    })
    return result
}

export class PreviewOverlayService {
    setMaterialManagerPreview(preview: MaterialManagerPreview): PreviewOverlayResult {
        const previousPreviewRevision = useModelStore.getState().previewRevision
        useModelStore.getState().setMaterialManagerPreview(preview)
        return createPreviewResult('materialManager', previousPreviewRevision, true)
    }

    clearMaterialManagerPreview(): PreviewOverlayResult {
        const previousPreviewRevision = useModelStore.getState().previewRevision
        useModelStore.getState().clearMaterialManagerPreview()
        return createPreviewResult('materialManager', previousPreviewRevision, false)
    }

    setNodeEditorPreview(preview: NodeEditorPreview): PreviewOverlayResult {
        const previousPreviewRevision = useModelStore.getState().previewRevision
        useModelStore.getState().setNodeEditorPreview(preview)
        return createPreviewResult('nodeEditor', previousPreviewRevision, true)
    }

    clearNodeEditorPreview(): PreviewOverlayResult {
        const previousPreviewRevision = useModelStore.getState().previewRevision
        useModelStore.getState().clearNodeEditorPreview()
        return createPreviewResult('nodeEditor', previousPreviewRevision, false)
    }

    markPreviewChanged(scope: PreviewOverlayScope, reason: string): PreviewOverlayResult {
        const previousPreviewRevision = useModelStore.getState().previewRevision
        useModelStore.getState().bumpPreviewRevision(reason)
        return createPreviewResult(scope, previousPreviewRevision, true)
    }
}

export const previewOverlayService = new PreviewOverlayService()
