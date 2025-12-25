/**
 * Context Menu Manager - Handles Windows Registry operations for right-click menu integration
 * Allows users to open .mdx and .mdl files directly from Windows Explorer
 */
import { exec } from 'child_process'
import { app } from 'electron'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Registry paths for HKEY_CURRENT_USER (no admin required)
const REGISTRY_BASE = 'HKCU\\Software\\Classes'
const MENU_NAME = 'GGwar3Edit'
const MENU_LABEL = '使用 GGwar3Edit 打开'

/**
 * Get the executable path with proper escaping for registry
 */
function getExePath(): string {
    return app.getPath('exe')
}

/**
 * Execute a registry command
 */
async function regCommand(args: string): Promise<{ success: boolean; error?: string }> {
    try {
        await execAsync(`reg ${args}`)
        return { success: true }
    } catch (error: any) {
        console.error('Registry command failed:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Register context menu for a specific file extension
 */
async function registerForExtension(ext: string): Promise<boolean> {
    const exePath = getExePath()
    const basePath = `${REGISTRY_BASE}\\${ext}\\shell\\${MENU_NAME}`

    // Create the menu entry
    const addKeyResult = await regCommand(`add "${basePath}" /ve /d "${MENU_LABEL}" /f`)
    if (!addKeyResult.success) return false

    // Add icon (use the app's icon)
    const addIconResult = await regCommand(`add "${basePath}" /v "Icon" /d "\\"${exePath}\\",0" /f`)
    if (!addIconResult.success) return false

    // Create command subkey
    const commandPath = `${basePath}\\command`
    const command = `"\\"${exePath}\\" \\"%1\\""`
    const addCommandResult = await regCommand(`add "${commandPath}" /ve /d ${command} /f`)

    return addCommandResult.success
}

/**
 * Unregister context menu for a specific file extension
 */
async function unregisterForExtension(ext: string): Promise<boolean> {
    const basePath = `${REGISTRY_BASE}\\${ext}\\shell\\${MENU_NAME}`
    const result = await regCommand(`delete "${basePath}" /f`)
    return result.success
}

/**
 * Check if context menu is registered for a specific extension
 */
async function isRegisteredForExtension(ext: string): Promise<boolean> {
    const basePath = `${REGISTRY_BASE}\\${ext}\\shell\\${MENU_NAME}`
    try {
        await execAsync(`reg query "${basePath}"`)
        return true
    } catch {
        return false
    }
}

/**
 * Register context menu for both .mdx and .mdl files
 */
export async function registerContextMenu(): Promise<{ success: boolean; error?: string }> {
    try {
        const mdxResult = await registerForExtension('.mdx')
        const mdlResult = await registerForExtension('.mdl')

        if (mdxResult && mdlResult) {
            return { success: true }
        } else {
            return { success: false, error: '部分注册表项创建失败' }
        }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}

/**
 * Unregister context menu for both .mdx and .mdl files
 */
export async function unregisterContextMenu(): Promise<{ success: boolean; error?: string }> {
    try {
        await unregisterForExtension('.mdx')
        await unregisterForExtension('.mdl')
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}

/**
 * Check if context menu is currently registered
 */
export async function isContextMenuRegistered(): Promise<boolean> {
    const mdxRegistered = await isRegisteredForExtension('.mdx')
    const mdlRegistered = await isRegisteredForExtension('.mdl')
    return mdxRegistered && mdlRegistered
}

/**
 * Get the file path from command line arguments (for opening files from context menu)
 */
export function getFilePathFromArgs(): string | null {
    // In development, args structure is different
    const args = process.argv

    // Skip electron executable and app path
    for (let i = 1; i < args.length; i++) {
        const arg = args[i]
        if (arg && (arg.endsWith('.mdx') || arg.endsWith('.mdl'))) {
            return arg
        }
    }
    return null
}
