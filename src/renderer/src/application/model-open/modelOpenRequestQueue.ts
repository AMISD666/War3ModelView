import type { OpenModelSource } from './OpenModelWorkflow'
import { markStartupNow } from '../diagnostics/startupDiagnostics'

export const MODEL_OPEN_FILES_REQUEST_EVENT = 'war3-open-model-files'

export interface ModelOpenFilesRequest {
    paths: string[]
    source?: OpenModelSource
    addToRecent?: boolean
    delayMs?: number
}

const getPendingQueue = (): ModelOpenFilesRequest[] => {
    const globalWindow = window as Window & { __war3PendingOpenModelFiles?: ModelOpenFilesRequest[] }
    if (!globalWindow.__war3PendingOpenModelFiles) {
        globalWindow.__war3PendingOpenModelFiles = []
    }
    return globalWindow.__war3PendingOpenModelFiles
}

export function requestOpenModelFiles(request: ModelOpenFilesRequest): void {
    const paths = Array.isArray(request.paths) ? request.paths.filter(Boolean) : []
    if (paths.length === 0) return

    const normalizedRequest = { ...request, paths }
    getPendingQueue().push(normalizedRequest)
    markStartupNow('frontend.model_open.request_queued', {
        source: normalizedRequest.source ?? '',
        pathCount: paths.length,
        queueLength: getPendingQueue().length,
        paths,
    })
    window.dispatchEvent(new CustomEvent<ModelOpenFilesRequest>(MODEL_OPEN_FILES_REQUEST_EVENT, {
        detail: normalizedRequest,
    }))
}

export function consumePendingOpenModelFileRequests(): ModelOpenFilesRequest[] {
    const queue = getPendingQueue()
    const requests = queue.splice(0, queue.length)
    markStartupNow('frontend.model_open.pending_queue_consumed', {
        requestCount: requests.length,
        pathCount: requests.reduce((count, request) => count + request.paths.length, 0),
    })
    return requests
}
