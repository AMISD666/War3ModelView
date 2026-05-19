export const KEYFRAME_SAVE_EVENT = 'IPC_KEYFRAME_SAVE'
export const KEYFRAME_GLOBAL_SEQUENCES_CHANGED_EVENT = 'IPC_KEYFRAME_GLOBAL_SEQUENCES_CHANGED'
export const GLOBAL_SEQUENCES_CHANGED_EVENT = KEYFRAME_GLOBAL_SEQUENCES_CHANGED_EVENT

export interface KeyframeSavePayload {
    callerId?: string
    fieldName?: string
    data?: unknown
}

export interface KeyframeGlobalSequencesChangedPayload {
    documentId: string | null
    documentRevision: number
    globalSequences: number[]
}

export type GlobalSequencesChangedPayload = KeyframeGlobalSequencesChangedPayload
