import { markStandalonePerf } from './StandalonePerf'

export type SnapshotDiagnosticDetail = Record<string, unknown> & {
    windowId: string
    snapshotId?: number
    source?: string
    keyCount?: number
    documentId?: string | null
    documentRevision?: number
    snapshotRevision?: number
    snapshotVersion?: number
}

export const markSnapshotSent = (detail: SnapshotDiagnosticDetail) => {
    markStandalonePerf('snapshot_sent', detail)
    return markStandalonePerf('snapshot.sent', detail)
}

export const markSnapshotReceived = (detail: SnapshotDiagnosticDetail) => {
    markStandalonePerf('snapshot_received', detail)
    return markStandalonePerf('snapshot.received', detail)
}

export const markSnapshotIgnoredStale = (detail: SnapshotDiagnosticDetail) => {
    markStandalonePerf('snapshot_ignored_stale', detail)
    return markStandalonePerf('snapshot.ignoredStale', detail)
}
