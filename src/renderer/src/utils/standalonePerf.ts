import { emit } from '@tauri-apps/api/event'

export const STANDALONE_PERF_EVENT = 'standalone-perf-event'

export type StandalonePerfEntry = {
    entryId: string
    windowLabel: string
    mark: string
    epochMs: number
    perfMs: number
    detail?: Record<string, unknown>
}

type StandalonePerfWindow = Window & {
    __standalonePerfEntries?: StandalonePerfEntry[]
    __standalonePerfOnceKeys?: Record<string, boolean>
    __standalonePerfCounter?: number
}

const getPerfWindow = (): StandalonePerfWindow | null => {
    if (typeof window === 'undefined') return null
    return window as StandalonePerfWindow
}

const getWindowLabel = (): string => {
    if (typeof window === 'undefined') return 'unknown'
    const params = new URLSearchParams(window.location.search)
    return params.get('window') || 'main'
}

export const markStandalonePerf = (mark: string, detail?: Record<string, unknown>): StandalonePerfEntry | null => {
    const perfWindow = getPerfWindow()
    if (!perfWindow) return null

    const nextCounter = (perfWindow.__standalonePerfCounter || 0) + 1
    perfWindow.__standalonePerfCounter = nextCounter

    const entry: StandalonePerfEntry = {
        entryId: `${getWindowLabel()}-${Date.now()}-${nextCounter}`,
        windowLabel: getWindowLabel(),
        mark,
        epochMs: Date.now(),
        perfMs: Number(performance.now().toFixed(2)),
        detail,
    }

    try {
        performance.mark(`standalone:${entry.windowLabel}:${mark}`)
    } catch {
        // Ignore environments without Performance mark support.
    }

    if (!perfWindow.__standalonePerfEntries) {
        perfWindow.__standalonePerfEntries = []
    }
    perfWindow.__standalonePerfEntries.push(entry)
    emit(STANDALONE_PERF_EVENT, entry).catch(() => { })

    // console output intentionally disabled

    return entry
}

export const markStandalonePerfOnce = (
    onceKey: string,
    mark: string,
    detail?: Record<string, unknown>
): StandalonePerfEntry | null => {
    const perfWindow = getPerfWindow()
    if (!perfWindow) return null

    if (!perfWindow.__standalonePerfOnceKeys) {
        perfWindow.__standalonePerfOnceKeys = {}
    }

    if (perfWindow.__standalonePerfOnceKeys[onceKey]) {
        return null
    }

    perfWindow.__standalonePerfOnceKeys[onceKey] = true
    return markStandalonePerf(mark, detail)
}
