import { invoke } from '@tauri-apps/api/core'
import { markStandalonePerf } from './standalonePerf'

type MpqReadAggregate = {
    count: number
    successCount: number
    failureCount: number
    totalMs: number
    maxMs: number
    totalBytes: number
    repeatedPathReads: number
}

type MpqPerfWindow = Window & {
    __mpqReadPerfState?: {
        bySource: Record<string, MpqReadAggregate>
        pathHits: Record<string, number>
    }
}

const SUMMARY_EMIT_EVERY = 20
const SLOW_READ_MS = 24

const getPerfWindow = (): MpqPerfWindow | null => {
    if (typeof window === 'undefined') return null
    return window as MpqPerfWindow
}

const normalizePerfPath = (path: string): string => {
    if (!path) return ''
    return path.replace(/\//g, '\\').replace(/\\+/g, '\\').trim()
}

const roundMs = (value: number): number => Number(value.toFixed(2))

const getPayloadBytes = (payload: unknown): number => {
    if (!payload) return 0
    if (payload instanceof Uint8Array) return payload.byteLength
    if (payload instanceof ArrayBuffer) return payload.byteLength
    if (ArrayBuffer.isView(payload)) return payload.byteLength
    if (typeof payload === 'string') return payload.length
    if (Array.isArray(payload)) return payload.length
    if (typeof payload === 'object') {
        const candidate = (payload as any).data ?? (payload as any).bytes ?? (payload as any).payload
        if (candidate !== undefined) {
            return getPayloadBytes(candidate)
        }
    }
    return 0
}

const getPerfState = () => {
    const perfWindow = getPerfWindow()
    if (!perfWindow) return null

    if (!perfWindow.__mpqReadPerfState) {
        perfWindow.__mpqReadPerfState = {
            bySource: {},
            pathHits: {},
        }
    }

    return perfWindow.__mpqReadPerfState
}

const recordMpqReadMetric = (source: string, path: string, durationMs: number, payload: unknown, success: boolean) => {
    const perfState = getPerfState()
    if (!perfState) return

    const normalizedPath = normalizePerfPath(path)
    const aggregate = perfState.bySource[source] || {
        count: 0,
        successCount: 0,
        failureCount: 0,
        totalMs: 0,
        maxMs: 0,
        totalBytes: 0,
        repeatedPathReads: 0,
    }

    const nextHitCount = (perfState.pathHits[normalizedPath] || 0) + 1
    perfState.pathHits[normalizedPath] = nextHitCount

    aggregate.count += 1
    aggregate.totalMs += durationMs
    aggregate.maxMs = Math.max(aggregate.maxMs, durationMs)
    aggregate.totalBytes += getPayloadBytes(payload)
    if (success) aggregate.successCount += 1
    else aggregate.failureCount += 1
    if (nextHitCount > 1) aggregate.repeatedPathReads += 1
    perfState.bySource[source] = aggregate

    if (durationMs >= SLOW_READ_MS) {
        markStandalonePerf('mpq_read_slow', {
            source,
            path: normalizedPath,
            durationMs: roundMs(durationMs),
            bytes: getPayloadBytes(payload),
            success,
            pathHitCount: nextHitCount,
        })
    }

    if (aggregate.count % SUMMARY_EMIT_EVERY === 0) {
        markStandalonePerf('mpq_read_stats', {
            source,
            count: aggregate.count,
            successCount: aggregate.successCount,
            failureCount: aggregate.failureCount,
            avgMs: roundMs(aggregate.totalMs / Math.max(1, aggregate.count)),
            maxMs: roundMs(aggregate.maxMs),
            avgBytes: Math.round(aggregate.totalBytes / Math.max(1, aggregate.successCount)),
            repeatedPathReads: aggregate.repeatedPathReads,
            uniquePathCount: Object.keys(perfState.pathHits).length,
        })
    }
}

export async function invokeReadMpqFile<T = Uint8Array>(path: string, source: string): Promise<T> {
    const normalizedPath = normalizePerfPath(path)
    const startedAt = performance.now()

    try {
        const payload = await invoke<T>('read_mpq_file', { path: normalizedPath })
        recordMpqReadMetric(source, normalizedPath, performance.now() - startedAt, payload, true)
        return payload
    } catch (error) {
        recordMpqReadMetric(source, normalizedPath, performance.now() - startedAt, null, false)
        throw error
    }
}
