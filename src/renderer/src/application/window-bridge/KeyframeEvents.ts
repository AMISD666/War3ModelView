export const KEYFRAME_SAVE_EVENT = 'IPC_KEYFRAME_SAVE'

export interface KeyframeSavePayload {
    callerId?: string
    fieldName?: string
    data?: unknown
}
