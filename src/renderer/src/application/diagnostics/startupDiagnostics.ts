import { desktopGateway } from '../../infrastructure/desktop'

type StartupDetail = Record<string, unknown>

type StartupBootMark = {
    mark?: unknown
    epochMs?: unknown
    perfMs?: unknown
    readyState?: unknown
}

type StartupWindow = Window & {
    __war3StartupBootMarks?: StartupBootMark[]
    __war3StartupBootMarksFlushed?: boolean
    __war3StartupOnceMarks?: Record<string, boolean>
}

export function markStartup(mark: string, detail?: StartupDetail): void {
    void desktopGateway.invoke('startup_diagnostics_mark', {
        mark,
        detail: detail ?? {},
    }).catch(() => {
        // Startup diagnostics must never block the app startup path.
    })
}

export function markStartupNow(mark: string, detail?: StartupDetail): void {
    markStartup(mark, {
        perfMs: typeof performance !== 'undefined' ? Number(performance.now().toFixed(2)) : null,
        href: typeof window !== 'undefined' ? window.location.href : '',
        ...detail,
    })
}

export function markStartupOnce(mark: string, detail?: StartupDetail): void {
    if (typeof window === 'undefined') {
        markStartupNow(mark, detail)
        return
    }
    const startupWindow = window as StartupWindow
    if (!startupWindow.__war3StartupOnceMarks) {
        startupWindow.__war3StartupOnceMarks = {}
    }
    if (startupWindow.__war3StartupOnceMarks[mark]) return
    startupWindow.__war3StartupOnceMarks[mark] = true
    markStartupNow(mark, detail)
}

export function flushHtmlStartupBootMarks(): void {
    if (typeof window === 'undefined') return
    const startupWindow = window as StartupWindow
    if (startupWindow.__war3StartupBootMarksFlushed) return
    startupWindow.__war3StartupBootMarksFlushed = true

    const marks = Array.isArray(startupWindow.__war3StartupBootMarks)
        ? startupWindow.__war3StartupBootMarks
        : []
    marks.forEach((entry) => {
        const mark = typeof entry.mark === 'string' ? entry.mark : 'frontend.html.unknown_boot_mark'
        markStartup(mark, {
            epochMs: entry.epochMs,
            perfMs: entry.perfMs,
            readyState: entry.readyState,
        })
    })
}
