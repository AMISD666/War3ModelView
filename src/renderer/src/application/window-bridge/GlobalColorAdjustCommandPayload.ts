import type { GlobalColorAdjustSettings } from '../../utils/globalColorAdjustCore'

export type GlobalColorAdjustCommandRevision = {
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

export type SetGlobalColorAdjustSettingsCommandPayload = GlobalColorAdjustCommandRevision & {
    settings: GlobalColorAdjustSettings
}

export type ResetGlobalColorAdjustSettingsCommandPayload = GlobalColorAdjustCommandRevision

export type SetGlobalColorTextureSaveModeCommandPayload = GlobalColorAdjustCommandRevision & {
    mode: 'overwrite' | 'save_as'
}

export type SetGlobalColorTextureSaveSuffixCommandPayload = GlobalColorAdjustCommandRevision & {
    suffix: string
}
