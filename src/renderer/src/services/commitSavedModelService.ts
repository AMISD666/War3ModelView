import { useModelStore } from '../store/modelStore'
import type { ModelData } from '../types/model'
import type { ModelNode } from '../types/node'

export const commitSavedModelToStore = (
    savedModelData: ModelData,
    savedNodes: ModelNode[]
): void => {
    useModelStore.setState((state) => {
        const updatedTabs = state.activeTabId
            ? state.tabs.map((tab) => {
                if (tab.id !== state.activeTabId) {
                    return tab
                }
                return {
                    ...tab,
                    snapshot: {
                        ...tab.snapshot,
                        modelData: savedModelData,
                        modelPath: state.modelPath,
                        nodes: savedNodes,
                        sequences: [...state.sequences],
                        currentSequence: state.currentSequence,
                        currentFrame: state.currentFrame,
                        hiddenGeosetIds: [...state.hiddenGeosetIds],
                        lastActive: Date.now(),
                    },
                }
            })
            : state.tabs

        return {
            modelData: savedModelData,
            nodes: savedNodes,
            tabs: updatedTabs,
            materialManagerPreview: null,
            nodeEditorPreview: null,
            rendererReloadTrigger: state.rendererReloadTrigger + 1,
        }
    })
}
