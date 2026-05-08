import { useModelStore } from '../../store/modelStore'
import { markCommandReceived as markCommandReceivedDiagnostic, markCommandRejected, markToolCommandStaleRevision } from '../diagnostics'

export type RevisionedToolCommand = {
    action?: string
    payload?: unknown
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

export const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export const cloneToolWindowData = <T>(value: T): T => structuredClone(value)

export const markCommandReceived = (
    source: string,
    commandName: string,
    command: RevisionedToolCommand | undefined,
): void => {
    const state = useModelStore.getState()
    markCommandReceivedDiagnostic({
        source,
        commandName,
        action: command?.action ?? '',
        commandDocumentId: command?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: command?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        stalePolicy: command?.stalePolicy ?? '',
    })
}

export const rejectToolWindowCommand = (
    source: string,
    command: RevisionedToolCommand | undefined,
    reason: string,
): void => {
    const state = useModelStore.getState()
    markCommandRejected({
        source,
        action: command?.action ?? '',
        commandDocumentId: command?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: command?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        reason,
    })
}

export const checkCommandRevision = (
    source: string,
    command: RevisionedToolCommand | undefined,
): boolean => {
    const baseDocumentRevision = command?.baseDocumentRevision
    if (typeof baseDocumentRevision !== 'number') {
        return true
    }

    const state = useModelStore.getState()
    const commandDocumentId = command?.documentId
    const documentMismatch =
        commandDocumentId !== undefined &&
        commandDocumentId !== null &&
        state.documentId !== null &&
        commandDocumentId !== state.documentId
    const revisionMismatch = baseDocumentRevision !== state.documentRevision

    if (!documentMismatch && !revisionMismatch) {
        return true
    }

    markToolCommandStaleRevision({
        source,
        action: command?.action ?? '',
        commandDocumentId: command?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
        stalePolicy: command?.stalePolicy ?? 'warn',
    })

    if (documentMismatch || command?.stalePolicy === 'reject') {
        rejectToolWindowCommand(
            source,
            command,
            documentMismatch ? 'document_mismatch' : 'stale_revision',
        )
        console.warn(`[${source}] Rejected stale command`, {
            action: command?.action,
            commandDocumentId: command?.documentId,
            activeDocumentId: state.documentId,
            baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
        })
        return false
    }

    console.warn(`[${source}] Stale command detected; applying for compatibility`, {
        action: command?.action,
        commandDocumentId: command?.documentId,
        activeDocumentId: state.documentId,
        baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
    })
    return true
}
