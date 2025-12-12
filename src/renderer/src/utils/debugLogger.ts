/**
 * Utility for logging to both browser console and production CMD window
 */
import { invoke } from '@tauri-apps/api/core'

/**
 * Log a message to both the browser console and the Tauri CMD window (in production)
 */
export async function debugLog(message: string, color?: 'green' | 'red'): Promise<void> {
    // Always log to browser console
    if (color === 'green') {
        console.log(`%c${message}`, 'color: #4ade80')
    } else if (color === 'red') {
        console.log(`%c${message}`, 'color: #f87171')
    } else {
        console.log(message)
    }

    // Also send to Tauri CMD window (works in production builds)
    let cmdMessage = message
    if (color === 'green') {
        cmdMessage = `\x1b[32m${message}\x1b[0m`
    } else if (color === 'red') {
        cmdMessage = `\x1b[31m${message}\x1b[0m`
    }

    try {
        await invoke('debug_log', { message: cmdMessage })
    } catch (e) {
        // Ignore errors (e.g., if CMD window is not open)
    }
}

/**
 * Log model loading information to CMD window
 */
export async function logModelInfo(
    modelPath: string,
    model: any,
    parseTime: number
): Promise<void> {
    const modelName = modelPath.split(/[\\/]/).pop() || modelPath

    const lines = [
        '========================================',
        `📦 模型加载: ${modelName}`,
        `   路径: ${modelPath}`,
        `   解析耗时: ${parseTime.toFixed(1)}ms`,
        '----------------------------------------',
    ]

    for (const line of lines) {
        await debugLog(line)
    }
}

/**
 * Log texture loading information to CMD window
 */
export async function logTextureInfo(
    textures: { path: string; loaded: boolean; time?: number }[]
): Promise<void> {
    if (textures.length === 0) {
        await debugLog('   贴图: 无')
        return
    }

    await debugLog(`   贴图列表 (${textures.length}):`)

    for (const tex of textures) {
        const status = tex.loaded ? '✓' : '✗'
        const timeStr = tex.time !== undefined ? ` (${tex.time.toFixed(1)}ms)` : ''
        const color = tex.loaded ? 'green' : 'red'
        await debugLog(`     ${status} ${tex.path}${timeStr}`, color)
    }
}

/**
 * Log texture loading completion
 */
export async function logTextureLoadComplete(
    totalTextures: number,
    loadedCount: number,
    totalTime: number
): Promise<void> {
    await debugLog('----------------------------------------')
    await debugLog(`   贴图加载完成: ${loadedCount}/${totalTextures} (${totalTime.toFixed(1)}ms)`)
    await debugLog('========================================')
}
