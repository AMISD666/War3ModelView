import { emit, listen } from '@tauri-apps/api/event';
import { WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import { markStandalonePerf } from './standalonePerf';

type OpenToolWindowOptions = {
    waitForHydration?: boolean;
    hydrationTimeoutMs?: number;
    syncMode?: 'existing_only' | 'always' | 'never';
};

type ResolvedOpenToolWindowOptions = {
    waitForHydration: boolean;
    hydrationTimeoutMs: number;
    syncMode: 'existing_only' | 'always' | 'never';
};

class WindowManager {
    private activeWindows: Map<string, WebviewWindow> = new Map();
    private visibilityCache: Map<string, boolean> = new Map();
    private hydrationState: Map<string, boolean> = new Map();
    private hydrationWaiters: Map<string, Array<(hydrated: boolean) => void>> = new Map();
    private hydrationListeners: Map<string, () => void> = new Map();

    private resolveHydration(windowId: string, hydrated: boolean): void {
        this.hydrationState.set(windowId, hydrated);
        const waiters = this.hydrationWaiters.get(windowId);
        if (!waiters || waiters.length === 0) return;

        this.hydrationWaiters.delete(windowId);
        waiters.forEach((waiter) => waiter(hydrated));
    }

    private ensureHydrationListener(windowId: string): void {
        if (this.hydrationListeners.has(windowId)) return;

        listen(`rpc-applied-${windowId}`, () => {
            markStandalonePerf('child_hydrated', { windowId });
            this.resolveHydration(windowId, true);
        }).then((unlisten) => {
            this.hydrationListeners.set(windowId, unlisten);
        }).catch((error) => {
            console.error(`[WindowManager] Failed to listen for hydration on ${windowId}:`, error);
        });
    }

    private waitForHydration(windowId: string, timeoutMs: number = 800): Promise<boolean> {
        if (this.hydrationState.get(windowId)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const waiters = this.hydrationWaiters.get(windowId) || [];
            let settled = false;

            const waiter = (hydrated: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(hydrated);
            };

            const timeoutId = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                const pending = this.hydrationWaiters.get(windowId) || [];
                this.hydrationWaiters.set(windowId, pending.filter((entry) => entry !== waiter));
                resolve(false);
            }, timeoutMs);

            waiters.push(waiter);
            this.hydrationWaiters.set(windowId, waiters);
        });
    }

    private async requestImmediateSync(windowId: string): Promise<void> {
        markStandalonePerf('sync_request', { windowId, mode: 'immediate' });
        await emit(`rpc-req-${windowId}`).catch(() => { });
    }

    private isKeyframeWindow(windowId: string): boolean {
        return /^keyframeEditor_/i.test(windowId);
    }

    private getOpenOptions(windowId: string, options?: OpenToolWindowOptions): ResolvedOpenToolWindowOptions {
        const keyframeWindow = this.isKeyframeWindow(windowId);
        return {
            waitForHydration: options?.waitForHydration ?? !keyframeWindow,
            hydrationTimeoutMs: options?.hydrationTimeoutMs ?? (keyframeWindow ? 0 : 180),
            syncMode: options?.syncMode ?? (keyframeWindow ? 'never' : 'existing_only'),
        };
    }

    private async prepareWindowForShow(
        windowId: string,
        hadExistingWindow: boolean,
        options: ResolvedOpenToolWindowOptions,
        context: Record<string, unknown> = {}
    ): Promise<boolean> {
        this.hydrationState.set(windowId, false);

        const shouldRequestSync =
            options.syncMode === 'always' ||
            (options.syncMode === 'existing_only' && hadExistingWindow);

        if (shouldRequestSync) {
            await this.requestImmediateSync(windowId);
        } else {
            markStandalonePerf('sync_request_skipped', {
                windowId,
                hadExistingWindow,
                syncMode: options.syncMode,
                ...context,
            });
        }

        if (!options.waitForHydration || options.hydrationTimeoutMs <= 0) {
            markStandalonePerf('hydration_wait_skipped', {
                windowId,
                hadExistingWindow,
                timeoutMs: options.hydrationTimeoutMs,
                ...context,
            });
            return false;
        }

        const hydratedBeforeShow = await this.waitForHydration(windowId, options.hydrationTimeoutMs);
        markStandalonePerf('pre_show_hydration_wait_complete', {
            windowId,
            hadExistingWindow,
            hydratedBeforeShow,
            timeoutMs: options.hydrationTimeoutMs,
            ...context,
        });
        return hydratedBeforeShow;
    }

    private async resolveToolWindow(windowId: string): Promise<WebviewWindow | null> {
        const win = this.activeWindows.get(windowId) ?? await WebviewWindow.getByLabel(windowId);
        if (!win) {
            return null;
        }

        if (!this.activeWindows.has(windowId)) {
            this.activeWindows.set(windowId, win);
        }

        return win;
    }

    async emitToolWindowEvent(windowId: string, eventName: string, payload: any): Promise<void> {
        const win = await this.resolveToolWindow(windowId);
        if (!win) {
            markStandalonePerf('global_emit_fallback', { windowId, eventName, reason: 'window_not_found' });
            await emit(eventName, payload).catch(() => { });
            return;
        }

        try {
            await (win as any).emit(eventName, payload);
            markStandalonePerf('direct_window_emit', { windowId, eventName });
        } catch {
            markStandalonePerf('global_emit_fallback', { windowId, eventName, reason: 'direct_emit_failed' });
            await emit(eventName, payload).catch(() => { });
        }
    }

    async preloadToolWindow(windowId: string, title: string, width: number, height: number): Promise<void> {
        this.ensureHydrationListener(windowId);

        if (this.activeWindows.has(windowId)) {
            console.log(`[WindowManager] Window "${windowId}" already in memory.`);
            return;
        }

        try {
            const existingWin = await WebviewWindow.getByLabel(windowId);
            if (existingWin) {
                console.log(`[WindowManager] Recovered existing native window: ${windowId}`);
                markStandalonePerf('window_recovered', { windowId, title });
                this.activeWindows.set(windowId, existingWin);
                this.visibilityCache.set(windowId, await existingWin.isVisible().catch(() => false));
                this.hydrationState.set(windowId, false);

                await existingWin.onCloseRequested(async (event) => {
                    event.preventDefault();
                    this.visibilityCache.set(windowId, false);
                    await existingWin.hide();
                });
                return;
            }
        } catch (e) {
            console.warn(`[WindowManager] Error checking for existing window ${windowId}:`, e);
        }

        console.log(`[WindowManager] Creating new window: ${windowId} (${title})`);
        try {
            const win = new WebviewWindow(windowId, {
                url: `${window.location.origin}/?window=${windowId}`,
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
            });

            win.once('tauri://error', (e) => {
                console.error(`[WindowManager] Tauri error for window "${windowId}":`, JSON.stringify(e));
                this.activeWindows.delete(windowId);
                this.visibilityCache.delete(windowId);
            });

            await win.onCloseRequested(async (event) => {
                event.preventDefault();
                this.visibilityCache.set(windowId, false);
                await win.hide();
            });

            markStandalonePerf('window_created', { windowId, title, width, height });
            this.activeWindows.set(windowId, win);
            this.visibilityCache.set(windowId, false);
            this.hydrationState.set(windowId, false);
        } catch (err) {
            console.error(`[WindowManager] Runtime exception creating window ${windowId}:`, err);
            throw err;
        }
    }

    async openMaterialManager(): Promise<void> {
        await this.openToolWindow('materialManager', '材质管理器', 760, 450);
    }

    async openToolWindow(
        windowId: string,
        title: string,
        width: number,
        height: number,
        options?: OpenToolWindowOptions
    ): Promise<void> {
        console.log(`[WindowManager] Request to open: ${windowId}`);
        markStandalonePerf('open_requested', { windowId, title, width, height });

        let win = this.activeWindows.get(windowId);
        const hadExistingWindow = !!win;
        const resolvedOptions = this.getOpenOptions(windowId, options);

        if (!win) {
            console.log(`[WindowManager] Window ${windowId} not preloaded, preloading now...`);
            await this.preloadToolWindow(windowId, title, width, height);
            win = this.activeWindows.get(windowId);
        }

        if (win) {
            try {
                await this.prepareWindowForShow(windowId, hadExistingWindow, resolvedOptions);

                console.log(`[WindowManager] Showing window: ${windowId}`);
                await win.show();
                markStandalonePerf('window_shown', { windowId, title });
                this.visibilityCache.set(windowId, true);
                await win.setFocus();
            } catch (e) {
                console.error(`[WindowManager] Failed to show window ${windowId}:`, e);
                this.activeWindows.delete(windowId);
                this.visibilityCache.delete(windowId);
                await this.preloadToolWindow(windowId, title, width, height);
                const freshWin = this.activeWindows.get(windowId);
                if (freshWin) {
                    await this.prepareWindowForShow(windowId, false, resolvedOptions, { reopened: true });

                    await freshWin.show();
                    markStandalonePerf('window_shown', { windowId, title, reopened: true });
                    this.visibilityCache.set(windowId, true);
                    await freshWin.setFocus();
                }
            }
        } else {
            console.error(`[WindowManager] Could not resolve window instance for ${windowId} even after fallback.`);
        }
    }

    async emitToolWindowSync(windowId: string, state: any): Promise<void> {
        await this.emitToolWindowEvent(windowId, `rpc-sync-${windowId}`, state);
    }

    async emitToolWindowPatch(windowId: string, patch: any): Promise<void> {
        await this.emitToolWindowEvent(windowId, `rpc-patch-${windowId}`, patch);
    }

    async hideToolWindow(windowId: string): Promise<void> {
        const win = this.activeWindows.get(windowId);
        if (win) {
            this.visibilityCache.set(windowId, false);
            await win.hide();
        }
    }

    async isToolWindowVisible(windowId: string): Promise<boolean> {
        const win = await this.resolveToolWindow(windowId);
        if (!win) {
            this.visibilityCache.set(windowId, false);
            return false;
        }

        const visible = await win.isVisible().catch(() => false);
        this.visibilityCache.set(windowId, visible);
        return visible;
    }

    async openKeyframeToolWindow(windowId: string, title: string, width: number, height: number, payload: any): Promise<void> {
        await this.openToolWindow(windowId, title, width, height, {
            waitForHydration: false,
            hydrationTimeoutMs: 0,
            syncMode: 'never',
        });

        for (const delay of [0, 50, 150]) {
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            await emit('IPC_KEYFRAME_INIT', payload).catch(() => { });
        }
    }

    async destroyAllWindows(): Promise<void> {
        const trackedWindows = Array.from(this.activeWindows.entries());
        const hydrationListeners = Array.from(this.hydrationListeners.values());
        this.activeWindows.clear();
        this.visibilityCache.clear();
        this.hydrationState.clear();
        this.hydrationWaiters.clear();
        this.hydrationListeners.clear();

        hydrationListeners.forEach((unlisten) => {
            try {
                unlisten();
            } catch (e) {
                console.warn('[WindowManager] Failed to unlisten hydration handler:', e);
            }
        });

        const windows = new Map<string, WebviewWindow>(trackedWindows);
        try {
            const discoveredWindows = await getAllWebviewWindows();
            discoveredWindows.forEach((win) => {
                if (win.label !== 'main') {
                    windows.set(win.label, win);
                }
            });
        } catch (e) {
            console.warn('[WindowManager] Failed to enumerate webview windows during shutdown:', e);
        }

        await Promise.all(
            Array.from(windows.entries()).map(async ([windowId, win]) => {
                try {
                    await win.destroy();
                } catch (e) {
                    console.warn(`[WindowManager] Failed to destroy window ${windowId}:`, e);
                }
            })
        );
    }

    private keyframeMap: Map<string, string> = new Map();
    private nextPoolIndex = 0;
    private readonly POOL_SIZE = 8;

    getKeyframeWindowId(fieldName: string): string {
        const safeFieldName = fieldName || 'default';
        const key = safeFieldName.toLowerCase().trim();

        if (this.keyframeMap.has(key)) {
            return this.keyframeMap.get(key)!;
        }

        const windowId = `keyframeEditor_${this.nextPoolIndex}`;
        this.keyframeMap.set(key, windowId);

        this.nextPoolIndex = (this.nextPoolIndex + 1) % this.POOL_SIZE;
        console.log(`[WindowManager] Mapped field "${safeFieldName}" to pooled window "${windowId}"`);
        return windowId;
    }
}

export const windowManager = new WindowManager();
