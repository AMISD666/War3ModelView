import { useMemo } from 'react'
import { useModelStore } from '../../store/modelStore'
import type { ModelData } from '../../types/model'
import {
    previewProjectionService,
    type MaterialPreviewProjection,
} from './PreviewProjectionService'

export function useMaterialPreviewProjectedModelData(): ModelData | null {
    const modelData = useModelStore((state) => state.modelData)
    const materialManagerPreview = useModelStore((state) => state.materialManagerPreview)

    return useMemo(
        () => previewProjectionService.getMaterialProjectedModelData(modelData, materialManagerPreview),
        [modelData, materialManagerPreview],
    )
}

export function useEffectivePreviewProjectedModelData(): ModelData | null {
    const modelData = useModelStore((state) => state.modelData)
    const materialManagerPreview = useModelStore((state) => state.materialManagerPreview)
    const nodeEditorPreview = useModelStore((state) => state.nodeEditorPreview)

    return useMemo(
        () => previewProjectionService.getEffectiveModelData({
            modelData,
            materialManagerPreview,
            nodeEditorPreview,
        }),
        [modelData, materialManagerPreview, nodeEditorPreview],
    )
}

export function getCurrentMaterialPreviewProjectedModelData(): ModelData | null {
    return getCurrentMaterialPreviewProjection().modelData
}

export function getCurrentMaterialPreviewProjection(): MaterialPreviewProjection {
    const state = useModelStore.getState()
    return previewProjectionService.getMaterialPreviewProjection(
        state.modelData,
        state.materialManagerPreview,
    )
}
