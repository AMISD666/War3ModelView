import { markStandalonePerf } from '../diagnostics/StandalonePerf'

export type CacheDiagnosticEvent = 'hit' | 'miss' | 'staleInvalidated'

export type CacheDiagnosticDetail = Record<string, unknown> & {
    source: string
    namespace?: string
    key?: string
    count?: number
    requested?: number
    documentId?: string | null
    documentRevision?: number
    assetRevision?: number
    previewRevision?: number
}

export const markCacheDiagnostic = (
    event: CacheDiagnosticEvent,
    detail: CacheDiagnosticDetail,
) => {
    return markStandalonePerf(`cache.${event}`, detail)
}

export const markCacheHit = (detail: CacheDiagnosticDetail) => markCacheDiagnostic('hit', detail)

export const markCacheMiss = (detail: CacheDiagnosticDetail) => markCacheDiagnostic('miss', detail)

export const markCacheStaleInvalidated = (detail: CacheDiagnosticDetail) =>
    markCacheDiagnostic('staleInvalidated', detail)
