import type { ModelData } from '../../types/model'
import { NodeType } from '../../types/node'
import { useGlobalColorAdjustStore } from '../../store/globalColorAdjustStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { pruneModelKeyframes } from '../../utils/modelUtils'
import {
    getSequenceStartFrame,
    normalizeSequencesForPlayback,
} from '../../utils/sequenceUtils'
import type { GlobalColorAdjustSettings } from '../../utils/globalColorAdjustCore'
import { commandBus, type CommandBus } from '../commands'
import { markCommandReceived, markCommandRejected, markToolCommandStaleRevision } from '../diagnostics'

export interface SequenceManagerRpcState {
    documentId: string | null
    documentRevision: number
    assetRevision: number
    previewRevision: number
    snapshotRevision: number
    windowId: string
    sequences: any[]
}

export interface GlobalSequenceManagerRpcState {
    documentId: string | null
    documentRevision: number
    assetRevision: number
    previewRevision: number
    snapshotRevision: number
    windowId: string
    globalSequences: number[]
}

export interface GlobalColorAdjustRpcState {
    documentId: string | null
    documentRevision: number
    assetRevision: number
    previewRevision: number
    snapshotRevision: number
    windowId: string
    settings: GlobalColorAdjustSettings
    textureSaveMode: 'overwrite' | 'save_as'
    textureSaveSuffix: string
}

const cloneModelData = (data: ModelData | null): ModelData | null =>
    data === null ? null : structuredClone(data)

type RevisionedTimelineCommand = {
    action?: string
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

const asRevisionedTimelineCommand = (payload: unknown): RevisionedTimelineCommand | undefined =>
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as RevisionedTimelineCommand
        : undefined

const checkTimelineCommandRevision = (
    source: string,
    command: string,
    payload: unknown,
): boolean => {
    const revision = asRevisionedTimelineCommand(payload)
    const state = useModelStore.getState()
    markCommandReceived({
        source,
        commandName: command,
        action: revision?.action ?? '',
        commandDocumentId: revision?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: revision?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        stalePolicy: revision?.stalePolicy ?? '',
    })

    if (typeof revision?.baseDocumentRevision !== 'number') {
        return true
    }

    const documentMismatch =
        revision.documentId !== undefined &&
        revision.documentId !== null &&
        state.documentId !== null &&
        revision.documentId !== state.documentId
    const revisionMismatch = revision.baseDocumentRevision !== state.documentRevision

    if (!documentMismatch && !revisionMismatch) {
        return true
    }

    markToolCommandStaleRevision({
        source,
        commandName: command,
        action: revision.action ?? '',
        commandDocumentId: revision.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: revision.baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
        stalePolicy: revision.stalePolicy ?? 'warn',
    })

    if (documentMismatch || revision.stalePolicy === 'reject') {
        markCommandRejected({
            source,
            commandName: command,
            action: revision.action ?? '',
            commandDocumentId: revision.documentId ?? '',
            activeDocumentId: state.documentId ?? '',
            baseDocumentRevision: revision.baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
            reason: documentMismatch ? 'document_mismatch' : 'stale_revision',
        })
        console.warn(`[${source}] Rejected stale command`, {
            command,
            action: revision.action,
            commandDocumentId: revision.documentId,
            activeDocumentId: state.documentId,
            baseDocumentRevision: revision.baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
        })
        return false
    }

    console.warn(`[${source}] Stale command detected; applying for compatibility`, {
        command,
        action: revision.action,
        commandDocumentId: revision.documentId,
        activeDocumentId: state.documentId,
        baseDocumentRevision: revision.baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
    })
    return true
}

const markActiveTabDirtyState = (state: { activeTabId: string | null; dirtyTabs: Record<string, boolean> }) => {
    if (!state.activeTabId) return {}
    return { dirtyTabs: { ...state.dirtyTabs, [state.activeTabId]: true } }
}

const getNextDocumentRevisionPatch = (state: ReturnType<typeof useModelStore.getState>) => ({
    documentId: state.documentId ?? state.activeTabId,
    documentRevision: state.documentRevision + 1,
    assetRevision: state.assetRevision,
    previewRevision: state.previewRevision,
})

const sanitizeNodesForSnapshot = (nodes: any[]) =>
    nodes.filter((node) => node && (node.type === NodeType.CAMERA || typeof node.ObjectId === 'number'))

const buildTabsWithModelSnapshot = (
    state: ReturnType<typeof useModelStore.getState>,
    modelData: ModelData | null,
    sequences: any[],
    currentSequence: number,
    currentFrame: number,
    revisionPatch?: ReturnType<typeof getNextDocumentRevisionPatch>,
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
                ...revisionPatch,
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

const normalizeGlobalSequenceDurations = (globalSequences: any[] | undefined | null): number[] => (
    Array.isArray(globalSequences)
        ? globalSequences.map((sequence: any) => {
            const duration = typeof sequence === 'number' ? sequence : sequence?.Duration
            return Math.max(0, Math.floor(Number(duration) || 0))
        })
        : []
)

const syncRendererGlobalSequences = (globalSequences: any[] | undefined | null): void => {
    const renderer = useRendererStore.getState().renderer
    if (renderer?.model) {
        ; (renderer.model as any).GlobalSequences = normalizeGlobalSequenceDurations(globalSequences)
        if ((renderer as any).modelInstance?.syncGlobalSequences) {
            ; (renderer as any).modelInstance.syncGlobalSequences()
        }
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
        const revisionPatch = getNextDocumentRevisionPatch(state)
        nextCurrentSequence = nextSequences.length === 0
            ? -1
            : Math.max(0, Math.min(state.currentSequence >= 0 ? state.currentSequence : 0, nextSequences.length - 1))
        nextCurrentFrame = nextCurrentSequence >= 0 ? getSequenceStartFrame(nextSequences[nextCurrentSequence]) : 0

        return {
            ...revisionPatch,
            modelData,
            sequences: nextSequences,
            currentSequence: nextCurrentSequence,
            currentFrame: nextCurrentFrame,
            isPlaying: nextSequences.length > 0 ? state.isPlaying : false,
            tabs: buildTabsWithModelSnapshot(state, modelData, nextSequences, nextCurrentSequence, nextCurrentFrame, revisionPatch),
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

    useModelStore.setState((state) => {
        const revisionPatch = getNextDocumentRevisionPatch(state)
        return {
            ...revisionPatch,
            modelData,
            tabs: buildTabsWithModelSnapshot(
                state,
                modelData,
                state.sequences,
                state.currentSequence,
                state.currentFrame,
                revisionPatch,
            ),
            rendererReloadTrigger: state.rendererReloadTrigger + 1,
            ...markActiveTabDirtyState(state),
        }
    })

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

    nextModelData.Sequences = structuredClone(normalizeSequencesForPlayback(sequences))
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

    ; (nextModelData as any).GlobalSequences = normalizeGlobalSequenceDurations(globalSequences)
    return nextModelData
}

export class SequenceManagerCommandHandler {
    constructor(private readonly bus: CommandBus = commandBus) { }

    handle(command: string, payload: unknown): void {
        if (!checkTimelineCommandRevision('SequenceManagerCommandHandler', command, payload)) {
            return
        }

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
        if (!checkTimelineCommandRevision('GlobalSequenceManagerCommandHandler', command, payload)) {
            return
        }

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
            return
        }

        if (command === 'SET_GLOBAL_COLOR_TEXTURE_SAVE_MODE') {
            const mode = (payload as { mode?: unknown } | null)?.mode
            useRendererStore.getState().setTextureSaveMode(mode === 'save_as' ? 'save_as' : 'overwrite')
            return
        }

        if (command === 'SET_GLOBAL_COLOR_TEXTURE_SAVE_SUFFIX') {
            const suffix = (payload as { suffix?: unknown } | null)?.suffix
            useRendererStore.getState().setTextureSaveSuffix(typeof suffix === 'string' ? suffix : '')
        }
    }
}

export const sequenceManagerCommandHandler = new SequenceManagerCommandHandler()
export const globalSequenceManagerCommandHandler = new GlobalSequenceManagerCommandHandler()
export const globalColorAdjustCommandHandler = new GlobalColorAdjustCommandHandler()
