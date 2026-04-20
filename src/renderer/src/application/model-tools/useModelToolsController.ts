import { useCallback } from 'react'
import { showMessage } from '../../store/messageStore'
import { useModelStore } from '../../store/modelStore'
import type { ModelData } from '../../types/model'

type CleanupModule = typeof import('../../services/modelCleanupService')

const MODEL_REQUIRED_MESSAGE = '没有打开任何模型，请先打开一个模型。'

const getCurrentModelContext = (): { modelData: ModelData | null; modelPath: string | null } => {
    const state = useModelStore.getState()
    return {
        modelData: state.modelData,
        modelPath: state.modelPath,
    }
}

const requireModelData = (): { modelData: ModelData; modelPath: string | null } | null => {
    const { modelData, modelPath } = getCurrentModelContext()
    if (!modelData) {
        showMessage('warning', '提示', MODEL_REQUIRED_MESSAGE)
        return null
    }
    return { modelData, modelPath }
}

const applyPatchedModelData = (nextModelData: ModelData, modelPath: string | null): void => {
    useModelStore.getState().setModelData(nextModelData, modelPath, {
        skipAutoRecalculate: true,
        skipModelRebuild: true,
    })
}

const runCleanupAction = async (
    loader: () => Promise<CleanupModule>,
    executor: (module: CleanupModule, draft: ModelData) => { removed: number; message: string },
): Promise<void> => {
    const current = requireModelData()
    if (!current) {
        return
    }

    const draft = structuredClone(current.modelData)
    const cleanupModule = await loader()
    const result = executor(cleanupModule, draft)

    if (result.removed > 0) {
        applyPatchedModelData(draft, current.modelPath)
        showMessage('success', '成功', result.message)
        return
    }

    showMessage('info', '提示', result.message)
}

export const useModelToolsController = () => {
    const recalculateNormals = useCallback(() => {
        if (!requireModelData()) return
        useModelStore.getState().recalculateNormals()
        showMessage('success', '成功', '已重新计算法线')
    }, [])

    const recalculateExtents = useCallback(() => {
        if (!requireModelData()) return
        useModelStore.getState().recalculateExtents()
        showMessage('success', '成功', '已重新计算模型顶点范围')
    }, [])

    const repairModel = useCallback(() => {
        if (!requireModelData()) return
        useModelStore.getState().repairModel()
        showMessage('success', '成功', '模型修复完成')
    }, [])

    const addDeathAnimation = useCallback(() => {
        if (!requireModelData()) return
        useModelStore.getState().addDeathAnimation()
        showMessage('success', '成功', '已添加/更新死亡动画')
    }, [])

    const removeLights = useCallback(() => {
        if (!requireModelData()) return
        useModelStore.getState().removeLights()
        showMessage('success', '成功', '已删除所有光照节点')
    }, [])

    const mergeSameMaterials = useCallback(async () => {
        await runCleanupAction(
            () => import('../../services/modelCleanupService'),
            (module, draft) => module.mergeSameMaterials(draft),
        )
    }, [])

    const cleanUnusedMaterials = useCallback(async () => {
        await runCleanupAction(
            () => import('../../services/modelCleanupService'),
            (module, draft) => module.cleanUnusedMaterials(draft),
        )
    }, [])

    const cleanUnusedTextures = useCallback(async () => {
        await runCleanupAction(
            () => import('../../services/modelCleanupService'),
            (module, draft) => module.cleanUnusedTextures(draft),
        )
    }, [])

    return {
        recalculateNormals,
        recalculateExtents,
        repairModel,
        addDeathAnimation,
        removeLights,
        mergeSameMaterials,
        cleanUnusedMaterials,
        cleanUnusedTextures,
    }
}
