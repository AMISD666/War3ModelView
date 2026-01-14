/**
 * Debug logging utility
 * Logs to both browser console and Tauri debug console (if enabled)
 */

import { invoke } from '@tauri-apps/api/core'
import { isDebugConsoleEnabled } from './debugConsoleState'

// Flag to prevent infinite loops when overriding console.error
let isLoggingToDebug = false

/**
 * Log a message to the debug console (CMD window)
 */
export async function debugLog(message: string): Promise<void> {
    if (isLoggingToDebug) return
    if (!isDebugConsoleEnabled()) return

    try {
        isLoggingToDebug = true
        await invoke('debug_log', { message })
    } catch (e) {
        // Silently fail if debug_log not available
    } finally {
        isLoggingToDebug = false
    }
}

/**
 * Log model info to debug console
 */
export async function logModelInfo(modelPath: string, texturePaths: string[]): Promise<void> {
    await debugLog(`========== 模型加载 ==========`)
    await debugLog(`模型路径: ${modelPath}`)
    await debugLog(`贴图数量: ${texturePaths.length}`)
    for (let i = 0; i < texturePaths.length; i++) {
        await debugLog(`  贴图[${i}]: ${texturePaths[i]}`)
    }
    await debugLog(`==============================`)
}

/**
 * Log an error to debug console
 */
export async function logError(source: string, error: unknown): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await debugLog(`[ERROR] ${source}: ${errorMsg}`)
}

// Store original console.error
const originalConsoleError = console.error

/**
 * Initialize debug logging by overriding console.error
 */
export function initDebugLogging(): void {
    console.error = (...args: unknown[]) => {
        // Call original
        originalConsoleError.apply(console, args)

        // Also log to debug console
        const message = args.map(arg => {
            if (typeof arg === 'string') return arg
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`
            try {
                return JSON.stringify(arg)
            } catch {
                return String(arg)
            }
        }).join(' ')

        debugLog(`[console.error] ${message}`)
    }

    // Also catch unhandled errors
    window.addEventListener('error', (event) => {
        debugLog(`[window.error] ${event.message} at ${event.filename}:${event.lineno}`)
    })

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
        debugLog(`[unhandledrejection] ${reason}`)
    })

    debugLog('[Debug] 调试日志已初始化')
}
