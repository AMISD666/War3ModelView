import { useModelStore } from '../../store/modelStore'
import {
    formatDocumentReferenceIssues,
    validateDocumentReferences,
} from '../model-validation'
import { markCommandIntegrityFailed } from '../diagnostics'

const MAX_REPORTED_ISSUES = 12

type IntegrityStage = 'execute' | 'undo' | 'redo'

const shouldValidateDocumentReferences = (): boolean => {
    if (typeof import.meta === 'undefined') return false
    return Boolean(import.meta.env?.DEV)
}

export const validateDocumentReferencesAfterCommand = (
    commandName: string,
    stage: IntegrityStage,
): void => {
    if (!shouldValidateDocumentReferences()) return

    const state = useModelStore.getState()
    if (!state.modelData) return

    const issues = validateDocumentReferences(state.modelData)
    if (issues.length === 0) return

    const formattedIssues = formatDocumentReferenceIssues(issues)
    const reportedIssues = formattedIssues.slice(0, MAX_REPORTED_ISSUES)

    markCommandIntegrityFailed({
        commandName,
        action: stage,
        documentId: state.documentId,
        activeDocumentRevision: state.documentRevision,
        issueCount: issues.length,
        issues: reportedIssues,
        truncatedIssueCount: Math.max(0, issues.length - reportedIssues.length),
    })

    console.warn(
        `[DocumentReferenceValidator] ${commandName} left invalid document references after ${stage}.`,
        reportedIssues,
        issues.length > reportedIssues.length
            ? `+${issues.length - reportedIssues.length} more issue(s)`
            : '',
    )
}
