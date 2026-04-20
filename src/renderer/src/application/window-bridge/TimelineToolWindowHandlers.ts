import type { ModelData } from '../../types/model'
import { NodeType } from '../../types/node'
import { useGlobalColorAdjustStore } from '../../store/globalColorAdjustStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { pruneModelKeyframes } from '../../utils/modelUtils'
import type { GlobalColorAdjustSettings } from '../../utils/globalColorAdjustCore'
import { commandBus, type CommandBus } from '../commands'

export interface SequenceManagerRpcState {
    sequences: any[]
}

export interface GlobalSequenceManagerRpcState {
    globalSequences: number[]
}

export interface GlobalColorAdjustRpcState {
    settings: GlobalColorAdjustSettings
}

const cloneModelData = (data: ModelData | null): ModelData | null =>
    data === null ? null : structuredClone(data)

const markActiveTabDirtyState = (state: { activeTabId: string | null; dirtyTabs: Record<string, boolean> }) => {
    if (!state.activeTabId) return {}
    return { dirtyTabs: { ...state.dirtyTabs, [state.activeTabId]: true } }
}

const sanitizeNodesForSnapshot = (nodes: any[]) =>
    nodes.filter((node) => node && (node.type === NodeType.CAMERA || typeof node.ObjectId === 'number'))

const getSequenceStartFrame = (sequence: any): number => {
    const interval = Array.isArray(sequence?.Interval)
        ? sequence.Interval
        : sequence?.Interval
            ? Array.from(sequence.Interval as ArrayLike<number>)
            : []
    const start = Number(interval[0] ?? 0)
    return Number.isFinite(start) ? start : 0
}

const buildTabsWithModelSnapshot = (
    state: ReturnType<typeof useModelStore.getState>,
    modelData: ModelData | null,
    sequences: any[],
    currentSequence: number,
    currentFrame: number,
) => {
    if (!state.activeTabId) {
        return state.tabs
    }

    return state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId) {
            return tab
        }

        return {
            ...tab,
            snapshot: {
                ...tab.snapshot,
                modelData,
                modelPath: state.modelPath,
                nodes: sanitizeNodesForSnapshot(state.nodes),
                sequences: [...sequences],
                currentSequence,
                currentFrame,
                hiddenGeosetIds: [...state.hiddenGeosetIds],
                lastActive: Date.now(),
            },
        }
    })
}

const syncRendererSequences = (sequences: any[], currentSequence: number): void => {
    const renderer = useRendererStore.getState().renderer
    if (!renderer?.model) {
        return
    }

    renderer.model.Sequences = sequences
    if (currentSequence >= 0 && typeof (renderer as any).setSequence === 'function') {
        ; (renderer as any).setSequence(currentSequence)
    }
}

const syncRendererGlobalSequences = (globalSequences: { Duration: number }[]): void => {
    const renderer = useRendererStore.getState().renderer
    if (renderer?.model) {
        ; (renderer.model as any).GlobalSequences = globalSequences
    }
}

const applySequenceModelPatch = (modelData: ModelData | null): void => {
    if (!modelData) {
        return
    }

    const nextSequences = modelData.Sequences || []
    let nextCurrentSequence = -1
    let nextCurrentFrame = 0

    useModelStore.setState((state) => {
        nextCurrentSequence = nextSequences.length === 0
            ? -1
            : Math.max(0, Math.min(state.currentSequence >= 0 ? state.currentSequence : 0, nextSequences.length - 1))
        nextCurrentFrame = nextCurrentSequence >= 0 ? getSequenceStartFrame(nextSequences[nextCurrentSequence]) : 0

        return {
            modelData,
            sequences: nextSequences,
            currentSequence: nextCurrentSequence,
            currentFrame: nextCurrentFrame,
            isPlaying: nextSequences.length > 0 ? state.isPlaying : false,
            tabs: buildTabsWithModelSnapshot(state, modelData, nextSequences, nextCurrentSequence, nextCurrentFrame),
            rendererReloadTrigger: state.rendererReloadTrigger + 1,
            ...markActiveTabDirtyState(state),
        }
    })

    syncRendererSequences(nextSequences, nextCurrentSequence)
}

const applyGlobalSequenceModelPatch = (modelData: ModelData | null): void => {
    if (!modelData) {
        return
    }

    useModelStore.setState((state) => ({
        modelData,
        tabs: buildTabsWithModelSnapshot(state, modelData, state.sequences, state.currentSequence, state.currentFrame),
        rendererReloadTrigger: state.rendererReloadTrigger + 1,
        ...markActiveTabDirtyState(state),
    }))

    syncRendererGlobalSequences(modelData.GlobalSequences || [])
}

const createSequenceModelData = (
    modelData: ModelData | null,
    sequences: any[],
    deletedIntervals: Array<[number, number]> = [],
    shouldPrune = false,
): ModelData | null => {
    const nextModelData = cloneModelData(modelData)
    if (!nextModelData) {
        return null
    }

    nextModelData.Sequences = structuredClone(sequences)
    if (shouldPrune) {
        deletedIntervals.forEach(([start, end]) => {
            pruneModelKeyframes(nextModelData, start, end)
        })
    }
    return nextModelData
}

const createGlobalSequenceModelData = (
    modelData: ModelData | null,
    globalSequences: number[],
): ModelData | null => {
    const nextModelData = cloneModelData(modelData)
    if (!nextModelData) {
        return null
    }

    nextModelData.GlobalSequences = globalSequences
        .map((duration) => Math.max(0, Math.floor(Number(duration) || 0)))
        .map((duration) => ({ Duration: duration }))
    return nextModelData
}

export class SequenceManagerCommandHandler {
    constructor(private readonly bus: CommandBus = commandBus) { }

    handle(command: string, payload: unknown): void {
        const state = useModelStore.getState()
        const before = cloneModelData(state.modelData)
        if (!before) {
            return
        }

        if (command === 'SAVE_SEQUENCES') {
            const after = createSequenceModelData(before, Array.isArray(payload) ? payload : [])
            if (!after) return
            this.execute('Save Sequences', before, after)
            return
        }

        if (command === 'PRUNE_KEYFRAMES') {
            const deletedIntervals = Array.isArray(payload) ? payload as Array<[number, number]> : []
            const after = createSequenceModelData(before, before.Sequences || [], deletedIntervals, true)
            if (!after) return
            this.execute('Prune Sequence Keyframes', before, after)
            return
        }

        if (command === 'APPLY_SEQUENCE_CHANGES') {
            const nextSequences = Array.isArray((payload as any)?.sequences) ? (payload as any).sequences : []
            const deletedIntervals = Array.isArray((payload as any)?.deletedIntervals) ? (payload as any).deletedIntervals : []
            const shouldPrune = (payload as any)?.pruneKeyframes !== false
            const after = createSequenceModelData(before, nextSequences, deletedIntervals, shouldPrune)
            if (!after) return
            this.execute('Apply Sequence Changes', before, after)
        }
    }

    private execute(name: string, before: ModelData, after: ModelData): void {
        const beforeSnapshot = cloneModelData(before)
        const afterSnapshot = cloneModelData(after)
        if (!beforeSnapshot || !afterSnapshot) {
            return
        }

        this.bus.execute({
            name,
            execute: () => applySequenceModelPatch(cloneModelData(afterSnapshot)),
            undo: () => applySequenceModelPatch(cloneModelData(beforeSnapshot)),
            redo: () => applySequenceModelPatch(cloneModelData(afterSnapshot)),
        })
    }
}

export class GlobalSequenceManagerCommandHandler {
    constructor(private readonly bus: CommandBus = commandBus) { }

    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_GLOBAL_SEQ_ACTION' || (payload as any)?.action !== 'SAVE') {
            return
        }

        const state = useModelStore.getState()
        const before = cloneModelData(state.modelData)
        const after = createGlobalSequenceModelData(before, Array.isArray((payload as any)?.globalSequences) ? (payload as any).globalSequences : [])
        if (!before || !after) {
            return
        }

        const beforeSnapshot = cloneModelData(before)
        const afterSnapshot = cloneModelData(after)
        if (!beforeSnapshot || !afterSnapshot) {
            return
        }

        this.bus.execute({
            name: 'Save Global Sequences',
            execute: () => applyGlobalSequenceModelPatch(cloneModelData(afterSnapshot)),
            undo: () => applyGlobalSequenceModelPatch(cloneModelData(beforeSnapshot)),
            redo: () => applyGlobalSequenceModelPatch(cloneModelData(afterSnapshot)),
        })
    }
}

export class GlobalColorAdjustCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command === 'SET_GLOBAL_COLOR_ADJUST_SETTINGS') {
            useGlobalColorAdjustStore.getState().replaceSettings(payload as Partial<GlobalColorAdjustSettings>)
            return
        }

        if (command === 'RESET_GLOBAL_COLOR_ADJUST_SETTINGS') {
            useGlobalColorAdjustStore.getState().resetSettings()
        }
    }
}

export const sequenceManagerCommandHandler = new SequenceManagerCommandHandler()
export const globalSequenceManagerCommandHandler = new GlobalSequenceManagerCommandHandler()
export const globalColorAdjustCommandHandler = new GlobalColorAdjustCommandHandler()
