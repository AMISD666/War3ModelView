import { desktopGateway } from '../infrastructure/desktop'
import { isDebugConsoleEnabled } from './debugConsoleState'

let installed = false
let forwarding = false

const formatValue = (value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
    if (typeof value === 'string') return value
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

const formatArgs = (args: unknown[]): string => args.map(formatValue).join(' ')

export async function debugLog(message: string): Promise<void> {
    if (!isDebugConsoleEnabled() || forwarding) return
    forwarding = true
    try {
        await desktopGateway.invoke('debug_log', { message })
    } catch {
        // Avoid recursive console forwarding if the debug bridge itself fails.
    } finally {
        forwarding = false
    }
}

export async function logModelInfo(modelPath: string, texturePaths: string[]): Promise<void> {
    await debugLog(`[Model] ${modelPath} textures=${texturePaths.length}`)
}

export async function logError(source: string, error: unknown): Promise<void> {
    await debugLog(`[Error][${source}] ${formatValue(error)}`)
}

export function initDebugLogging(): void {
    if (installed || typeof window === 'undefined') return
    installed = true
    if (isDebugConsoleEnabled()) {
        desktopGateway.invoke('toggle_console', { show: true }).catch(() => {})
    }

    const originalError = console.error.bind(console)
    const originalWarn = console.warn.bind(console)
    console.error = (...args: unknown[]) => {
        originalError(...args)
        void debugLog(`[console.error] ${formatArgs(args)}`)
    }
    console.warn = (...args: unknown[]) => {
        originalWarn(...args)
        void debugLog(`[console.warn] ${formatArgs(args)}`)
    }

    window.addEventListener('error', (event) => {
        void logError('window.error', event.error || `${event.message} (${event.filename}:${event.lineno}:${event.colno})`)
    })
    window.addEventListener('unhandledrejection', (event) => {
        void logError('unhandledrejection', event.reason)
    })
}
