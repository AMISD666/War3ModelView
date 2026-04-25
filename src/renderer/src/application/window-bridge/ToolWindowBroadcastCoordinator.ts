import type { NodeEditorRpcState } from '../../types/nodeEditorRpc'
import { markStandalonePerf } from '../../utils/standalonePerf'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import type {
    GlobalColorAdjustRpcState,
    GlobalSequenceManagerRpcState,
    SequenceManagerRpcState,
} from './TimelineToolWindowHandlers'
import type {
    MaterialManagerPatch,
    MaterialManagerRpcState,
    TextureManagerPatch,
    TextureManagerRpcState,
} from './ToolWindowSnapshots'

type ModelStoreState = ReturnType<typeof useModelStore.getState>
type SelectionStoreState = ReturnType<typeof useSelectionStore.getState>

export type ToolWindowVisibilityId =
    | 'cameraManager'
    | 'geosetEditor'
    | 'geosetVisibilityTool'
    | 'geosetAnimManager'
    | 'textureManager'
    | 'textureAnimManager'
    | 'materialManager'
    | 'sequenceManager'
    | 'globalSequenceManager'
    | 'nodeEditor'

export interface ToolWindowVisibilityGateway {
    isToolWindowVisible(windowId: ToolWindowVisibilityId): Promise<boolean>
}

export interface ToolWindowBroadcastApi {
    broadcastCameraManager(state: unknown): void
    getCameraManagerState(): unknown
    broadcastGeosetEditor(state: unknown): void
    getGeosetManagerState(): unknown
    broadcastGeosetVisibilityTool(state: unknown): void
    getGeosetVisibilityState(): unknown
    broadcastGeosetAnimManager(state: unknown): void
    getGeosetAnimManagerState(): unknown
    broadcastTextureManager(state: TextureManagerRpcState): void
    broadcastTextureManagerPatch(patch: TextureManagerPatch): void
    getTextureManagerState(): TextureManagerRpcState
    broadcastTextureAnimManager(state: unknown): void
    getTextureAnimManagerState(): unknown
    broadcastMaterialManager(state: MaterialManagerRpcState): void
    broadcastMaterialManagerPatch(patch: MaterialManagerPatch): void
    getMaterialManagerState(): MaterialManagerRpcState
    broadcastNodeEditor(state: NodeEditorRpcState): void
    getNodeEditorState(): NodeEditorRpcState
    broadcastSequenceManager(state: SequenceManagerRpcState): void
    getSequenceManagerState(): SequenceManagerRpcState
    broadcastGlobalSeqManager(state: GlobalSequenceManagerRpcState): void
    getGlobalSeqManagerState(): GlobalSequenceManagerRpcState
    broadcastGlobalColorAdjust(state: GlobalColorAdjustRpcState): void
}

const TOOL_WINDOW_VISIBILITY_ORDER: ToolWindowVisibilityId[] = [
    'cameraManager',
    'geosetEditor',
    'geosetVisibilityTool',
    'geosetAnimManager',
    'textureManager',
    'textureAnimManager',
    'materialManager',
    'sequenceManager',
    'globalSequenceManager',
    'nodeEditor',
]

export class ToolWindowBroadcastCoordinator {
    private api: ToolWindowBroadcastApi | null = null

    private snapshotDispatchState = {
        textureManager: -1,
        materialManager: -1,
        nodeEditor: -1,
    }

    setApi(api: ToolWindowBroadcastApi): void {
        this.api = api
    }

    private waitForBroadcastSlot(): Promise<void> {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                const requestIdleCallback = (window as any).requestIdleCallback as
                    | ((callback: () => void, options?: { timeout?: number }) => number)
                    | undefined
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => resolve(), { timeout: 80 })
                    return
                }
                window.setTimeout(resolve, 0)
            })
        })
    }

    private async yieldAfterBroadcast(windowId: ToolWindowVisibilityId): Promise<void> {
        markStandalonePerf('tool_window_broadcast_yield', { windowId })
        await this.waitForBroadcastSlot()
    }

    broadcastGlobalColorAdjust(state: GlobalColorAdjustRpcState): void {
        this.api?.broadcastGlobalColorAdjust(state)
    }

    attach(
        visibilityGateway: ToolWindowVisibilityGateway,
        options: { initialLoadDelayMs?: number; initialBroadcastDelayMs?: number } = {},
    ): () => void {
        let prevModelData = useModelStore.getState().modelData
        let prevNodes = useModelStore.getState().nodes
        let prevPickedGeosetIndex = useSelectionStore.getState().pickedGeosetIndex
        let prevSelectedMaterialIndex = useSelectionStore.getState().selectedMaterialIndex
        let prevSelectedMaterialLayerIndex = useSelectionStore.getState().selectedMaterialLayerIndex

        const unsubscribeModel = useModelStore.subscribe((state) => {
            if (state.nodes !== prevNodes || state.modelData !== prevModelData) {
                const isInitialLoad = !prevModelData && state.modelData
                prevNodes = state.nodes
                prevModelData = state.modelData

                if (isInitialLoad) {
                    setTimeout(() => {
                        void this.performBroadcast(visibilityGateway)
                    }, options.initialLoadDelayMs ?? 100)
                } else {
                    void this.performBroadcast(visibilityGateway)
                }
            }
        })

        const unsubscribeSelection = useSelectionStore.subscribe((selectionState) => {
            const geosetChanged = selectionState.pickedGeosetIndex !== prevPickedGeosetIndex
            const materialChanged = selectionState.selectedMaterialIndex !== prevSelectedMaterialIndex
            const materialLayerChanged = selectionState.selectedMaterialLayerIndex !== prevSelectedMaterialLayerIndex

            if (!geosetChanged && !materialChanged && !materialLayerChanged) {
                return
            }

            prevPickedGeosetIndex = selectionState.pickedGeosetIndex
            prevSelectedMaterialIndex = selectionState.selectedMaterialIndex
            prevSelectedMaterialLayerIndex = selectionState.selectedMaterialLayerIndex
            this.broadcastSelectionChanges(selectionState, {
                geosetChanged,
                materialChanged,
                materialLayerChanged,
            })
        })

        const timer = setTimeout(() => {
            void this.performBroadcast(visibilityGateway)
        }, options.initialBroadcastDelayMs ?? 120)

        return () => {
            clearTimeout(timer)
            unsubscribeModel()
            unsubscribeSelection()
        }
    }

    private async performBroadcast(visibilityGateway: ToolWindowVisibilityGateway): Promise<void> {
        const api = this.api
        if (!api) {
            return
        }

        const visibilityResults = await Promise.all(
            TOOL_WINDOW_VISIBILITY_ORDER.map((windowId) => visibilityGateway.isToolWindowVisible(windowId)),
        )

        const visibilityMap = TOOL_WINDOW_VISIBILITY_ORDER.reduce<Record<ToolWindowVisibilityId, boolean>>((acc, key, index) => {
            acc[key] = visibilityResults[index]
            return acc
        }, {} as Record<ToolWindowVisibilityId, boolean>)

        if (!Object.values(visibilityMap).some(Boolean)) {
            return
        }

        if (visibilityMap.cameraManager) {
            api.broadcastCameraManager(api.getCameraManagerState())
            await this.yieldAfterBroadcast('cameraManager')
        }

        if (visibilityMap.geosetEditor) {
            api.broadcastGeosetEditor(api.getGeosetManagerState())
            await this.yieldAfterBroadcast('geosetEditor')
        }

        if (visibilityMap.geosetVisibilityTool) {
            api.broadcastGeosetVisibilityTool(api.getGeosetVisibilityState())
            await this.yieldAfterBroadcast('geosetVisibilityTool')
        }

        if (visibilityMap.geosetAnimManager) {
            api.broadcastGeosetAnimManager(api.getGeosetAnimManagerState())
            await this.yieldAfterBroadcast('geosetAnimManager')
        }

        if (visibilityMap.textureManager) {
            const textureManagerState = api.getTextureManagerState()
            if (this.snapshotDispatchState.textureManager !== textureManagerState.snapshotVersion) {
                this.snapshotDispatchState.textureManager = textureManagerState.snapshotVersion
                api.broadcastTextureManager(textureManagerState)
                await this.yieldAfterBroadcast('textureManager')
            } else {
                markStandalonePerf('snapshot_broadcast_skipped', {
                    windowId: 'textureManager',
                    snapshotVersion: textureManagerState.snapshotVersion,
                    reason: 'snapshot_version_unchanged',
                })
            }
        }

        if (visibilityMap.textureAnimManager) {
            api.broadcastTextureAnimManager(api.getTextureAnimManagerState())
            await this.yieldAfterBroadcast('textureAnimManager')
        }

        if (visibilityMap.materialManager) {
            const materialManagerState = api.getMaterialManagerState()
            if (this.snapshotDispatchState.materialManager !== materialManagerState.snapshotVersion) {
                this.snapshotDispatchState.materialManager = materialManagerState.snapshotVersion
                api.broadcastMaterialManager(materialManagerState)
                await this.yieldAfterBroadcast('materialManager')
            } else {
                markStandalonePerf('snapshot_broadcast_skipped', {
                    windowId: 'materialManager',
                    snapshotVersion: materialManagerState.snapshotVersion,
                    reason: 'snapshot_version_unchanged',
                })
            }
        }

        if (visibilityMap.sequenceManager) {
            api.broadcastSequenceManager(api.getSequenceManagerState())
            await this.yieldAfterBroadcast('sequenceManager')
        }

        if (visibilityMap.globalSequenceManager) {
            api.broadcastGlobalSeqManager(api.getGlobalSeqManagerState())
            await this.yieldAfterBroadcast('globalSequenceManager')
        }

        if (visibilityMap.nodeEditor) {
            const nodeEditorState = api.getNodeEditorState()
            if (this.snapshotDispatchState.nodeEditor !== nodeEditorState.snapshotVersion) {
                this.snapshotDispatchState.nodeEditor = nodeEditorState.snapshotVersion
                api.broadcastNodeEditor(nodeEditorState)
                await this.yieldAfterBroadcast('nodeEditor')
            } else {
                markStandalonePerf('snapshot_broadcast_skipped', {
                    windowId: 'nodeEditor',
                    snapshotVersion: nodeEditorState.snapshotVersion,
                    reason: 'snapshot_version_unchanged',
                })
            }
        }
    }

    private broadcastSelectionChanges(
        selectionState: SelectionStoreState,
        changeFlags: {
            geosetChanged: boolean
            materialChanged: boolean
            materialLayerChanged: boolean
        },
    ): void {
        const api = this.api
        if (!api) {
            return
        }

        if (changeFlags.geosetChanged) {
            api.broadcastGeosetEditor(api.getGeosetManagerState())
            api.broadcastTextureManagerPatch({
                pickedGeosetIndex: selectionState.pickedGeosetIndex ?? null,
            })
            api.broadcastGeosetAnimManager(api.getGeosetAnimManagerState())
        }

        const materialPatch: MaterialManagerPatch = {}
        if (changeFlags.geosetChanged) {
            materialPatch.pickedGeosetIndex = selectionState.pickedGeosetIndex ?? null
        }
        if (changeFlags.materialChanged) {
            materialPatch.selectedMaterialIndex = selectionState.selectedMaterialIndex ?? null
        }
        if (changeFlags.materialLayerChanged) {
            materialPatch.selectedMaterialLayerIndex = selectionState.selectedMaterialLayerIndex ?? null
        }

        if (Object.keys(materialPatch).length > 0) {
            api.broadcastMaterialManagerPatch(materialPatch)
        }
    }
}
