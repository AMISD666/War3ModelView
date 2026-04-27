import { markStandalonePerf } from './StandalonePerf'

export type CommandDiagnosticDetail = Record<string, unknown> & {
    source?: string
    commandName?: string
    commandType?: string
    action?: string
    commandDocumentId?: string | null
    activeDocumentId?: string | null
    documentId?: string | null
    baseDocumentRevision?: number | string
    activeDocumentRevision?: number
    previousDocumentRevision?: number
    nextDocumentRevision?: number
    reason?: string
}

export const markCommandReceived = (detail: CommandDiagnosticDetail) =>
    markStandalonePerf('command.received', detail)

export const markCommandAccepted = (detail: CommandDiagnosticDetail) =>
    markStandalonePerf('command.accepted', detail)

export const markCommandRejected = (detail: CommandDiagnosticDetail) =>
    markStandalonePerf('command.rejected', detail)

export const markDocumentRevisionChanged = (detail: CommandDiagnosticDetail) =>
    markStandalonePerf('document.revisionChanged', detail)

export const markToolCommandStaleRevision = (detail: CommandDiagnosticDetail) =>
    markStandalonePerf('tool_command_stale_revision', detail)

export const markCommandIntegrityFailed = (detail: CommandDiagnosticDetail) =>
    markStandalonePerf('command.integrityFailed', detail)
