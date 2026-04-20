import { getToolWindowSize, TOOL_WINDOW_SIZES, type ToolWindowId } from '../../constants/windowLayouts'
import { windowGateway, type ManagedWindow, type WindowGateway } from '../../infrastructure/window'
import { markStandalonePerf } from '../../utils/standalonePerf'
import { ToolWindowHydrationTracker } from './ToolWindowHydrationTracker'

export type OpenToolWindowOptions = {
    waitForHydration?: boolean
    hydrationTimeoutMs?: number
    syncMode?: 'existing_only' | 'always' | 'never'
}

type ResolvedOpenToolWindowOptions = {
    waitForHydration: boolean
    hydrationTimeoutMs: number
    syncMode: 'existing_only' | 'always' | 'never'
}

export class ToolWindowLifecycleService {
    private readonly activeWindows = new Map<string, ManagedWindow>()
    private readonly visibilityCache = new Map<string, boolean>()

    constructor(
        private readonly hydrationTracker: ToolWindowHydrationTracker,
        private readonly gateway: WindowGateway = windowGateway,
    ) {}

    async resolveWindow(windowId: string): Promise<ManagedWindow | null> {
        const win = this.activeWindows.get(windowId) ?? await this.gateway.getWindowByLabel(windowId)
        if (!win) {
            return null
        }

        if (!this.activeWindows.has(windowId)) {
            this.activeWindows.set(windowId, win)
        }

        return win
    }

    async preloadToolWindow(windowId: string, title: string, width: number, height: number): Promise<void> {
        this.hydrationTracker.ensureListener(windowId)

        if (this.activeWindows.has(windowId)) {
            return
        }

        try {
            const existingWin = await this.gateway.getWindowByLabel(windowId)
            if (existingWin) {
                markStandalonePerf('window_recovered', { windowId, title })
                this.activeWindows.set(windowId, existingWin)
                await this.applyWindowBounds(existingWin, width, height)
                this.visibilityCache.set(windowId, await existingWin.isVisible().catch(() => false))
                this.hydrationTracker.markPending(windowId)

                await existingWin.onCloseRequested(async (event) => {
                    event.preventDefault()
                    this.visibilityCache.set(windowId, false)
                    await existingWin.hide()
                })
                return
            }
        } catch (error) {
            console.warn(`[ToolWindowLifecycleService] Error checking for existing window ${windowId}:`, error)
        }

        try {
            const win = this.gateway.createWindow(windowId, {
                url: `${window.location.origin}/standalone.html?window=${encodeURIComponent(windowId)}`,
                title,
                width,
                height,
                minWidth: width,
                minHeight: height,
                resizable: false,
                transparent: false,
                decorations: false,
                alwaysOnTop: false,
                center: true,
                visible: false,
            })

            win.once('tauri://error', (error) => {
                console.error(`[ToolWindowLifecycleService] Tauri error for window "${windowId}":`, JSON.stringify(error))
                void this.destroyWebviewWindow(windowId, win)
            })

            await win.onCloseRequested(async (event) => {
                event.preventDefault()
                this.visibilityCache.set(windowId, false)
                await win.hide()
            })

            markStandalonePerf('window_created', { windowId, title, width, height })
            this.activeWindows.set(windowId, win)
            this.visibilityCache.set(windowId, false)
            this.hydrationTracker.markPending(windowId)
        } catch (error) {
            console.error(`[ToolWindowLifecycleService] Runtime exception creating window ${windowId}:`, error)
            throw error
        }
    }

    async openToolWindow(
        windowId: string,
        title: string,
        width: number,
        height: number,
        options?: OpenToolWindowOptions,
    ): Promise<void> {
        const resolvedSize = this.resolveConfiguredToolWindowSize(windowId, width, height)
        width = resolvedSize.width
        height = resolvedSize.height
        markStandalonePerf('open_requested', { windowId, title, width, height })

        let win = this.activeWindows.get(windowId)
        const hadExistingWindow = !!win
        const resolvedOptions = this.getOpenOptions(windowId, options)

        if (!win) {
            await this.preloadToolWindow(windowId, title, width, height)
            win = this.activeWindows.get(windowId)
        }

        if (win) {
            try {
                await this.applyWindowBounds(win, width, height)
                await this.prepareWindowForShow(windowId, hadExistingWindow, resolvedOptions)
                await win.show()
                markStandalonePerf('window_shown', { windowId, title })
                this.visibilityCache.set(windowId, true)
                await win.setFocus()
            } catch (error) {
                console.error(`[ToolWindowLifecycleService] Failed to show window ${windowId}:`, error)
                await this.destroyWebviewWindow(windowId, win)
                await this.preloadToolWindow(windowId, title, width, height)
                const freshWin = this.activeWindows.get(windowId)
                if (freshWin) {
                    await this.applyWindowBounds(freshWin, width, height)
                    await this.prepareWindowForShow(windowId, false, resolvedOptions, { reopened: true })

                    await freshWin.show()
                    markStandalonePerf('window_shown', { windowId, title, reopened: true })
                    this.visibilityCache.set(windowId, true)
                    await freshWin.setFocus()
                }
            }
        } else {
            console.error(`[ToolWindowLifecycleService] Could not resolve window instance for ${windowId} even after fallback.`)
        }
    }

    async hideToolWindow(windowId: string): Promise<void> {
        const win = this.activeWindows.get(windowId)
        if (win) {
            this.visibilityCache.set(windowId, false)
            await win.hide()
        }
    }

    async isToolWindowVisible(windowId: string): Promise<boolean> {
        if (this.visibilityCache.has(windowId)) {
            return this.visibilityCache.get(windowId) === true
        }

        const win = await this.resolveWindow(windowId)
        if (!win) {
            this.visibilityCache.set(windowId, false)
            return false
        }

        const visible = await win.isVisible().catch(() => false)
        this.visibilityCache.set(windowId, visible)
        return visible
    }

    async destroyAllWindows(): Promise<void> {
        const trackedWindows = Array.from(this.activeWindows.entries())
        this.activeWindows.clear()
        this.visibilityCache.clear()
        this.hydrationTracker.clearAll()

        const windows = new Map<string, ManagedWindow>(trackedWindows)
        try {
            const discoveredWindows = await this.gateway.getAllWindows()
            discoveredWindows.forEach((win) => {
                if (win.label !== 'main') {
                    windows.set(win.label, win)
                }
            })
        } catch (error) {
            console.warn('[ToolWindowLifecycleService] Failed to enumerate webview windows during shutdown:', error)
        }

        await Promise.all(
            Array.from(windows.entries()).map(async ([windowId, win]) => {
                try {
                    await win.destroy()
                } catch (error) {
                    console.warn(`[ToolWindowLifecycleService] Failed to destroy window ${windowId}:`, error)
                }
            }),
        )
    }

    private resolveConfiguredToolWindowSize(windowId: string, width: number, height: number): { width: number; height: number } {
        if (windowId in TOOL_WINDOW_SIZES) {
            return getToolWindowSize(windowId as ToolWindowId)
        }

        return { width, height }
    }

    private async applyWindowBounds(win: ManagedWindow, width: number, height: number): Promise<void> {
        await Promise.allSettled([
            win.setSize(width, height),
            win.setMinSize(width, height),
        ])
    }

    private clearToolWindowState(windowId: string): void {
        this.hydrationTracker.clearWindow(windowId)
        this.visibilityCache.delete(windowId)
        this.activeWindows.delete(windowId)
    }

    private async destroyWebviewWindow(windowId: string, win?: ManagedWindow | null): Promise<void> {
        this.clearToolWindowState(windowId)
        try {
            if (win) {
                await win.destroy()
                return
            }
            const existing = await this.gateway.getWindowByLabel(windowId)
            if (existing) {
                await existing.destroy()
            }
        } catch (error) {
            console.warn(`[ToolWindowLifecycleService] destroyWebviewWindow(${windowId}):`, error)
        }
    }

    private async requestImmediateSync(windowId: string): Promise<void> {
        markStandalonePerf('sync_request', { windowId, mode: 'immediate' })
        await this.gateway.emit(`rpc-req-${windowId}`).catch(() => {})
    }

    private isKeyframeWindow(windowId: string): boolean {
        return /^keyframeEditor_/i.test(windowId)
    }

    private getOpenOptions(windowId: string, options?: OpenToolWindowOptions): ResolvedOpenToolWindowOptions {
        const keyframeWindow = this.isKeyframeWindow(windowId)
        return {
            waitForHydration: options?.waitForHydration ?? !keyframeWindow,
            hydrationTimeoutMs: options?.hydrationTimeoutMs ?? (keyframeWindow ? 0 : 120),
            syncMode: options?.syncMode ?? (keyframeWindow ? 'never' : 'existing_only'),
        }
    }

    private async prepareWindowForShow(
        windowId: string,
        hadExistingWindow: boolean,
        options: ResolvedOpenToolWindowOptions,
        context: Record<string, unknown> = {},
    ): Promise<boolean> {
        this.hydrationTracker.markPending(windowId)

        const shouldRequestSync =
            options.syncMode === 'always' ||
            (options.syncMode === 'existing_only' && hadExistingWindow)

        if (shouldRequestSync) {
            await this.requestImmediateSync(windowId)
        } else {
            markStandalonePerf('sync_request_skipped', {
                windowId,
                hadExistingWindow,
                syncMode: options.syncMode,
                ...context,
            })
        }

        if (!options.waitForHydration || options.hydrationTimeoutMs <= 0) {
            markStandalonePerf('hydration_wait_skipped', {
                windowId,
                hadExistingWindow,
                timeoutMs: options.hydrationTimeoutMs,
                ...context,
            })
            return false
        }

        const hydratedBeforeShow = await this.hydrationTracker.wait(windowId, options.hydrationTimeoutMs)
        markStandalonePerf('pre_show_hydration_wait_complete', {
            windowId,
            hadExistingWindow,
            hydratedBeforeShow,
            timeoutMs: options.hydrationTimeoutMs,
            ...context,
        })
        return hydratedBeforeShow
    }
}
