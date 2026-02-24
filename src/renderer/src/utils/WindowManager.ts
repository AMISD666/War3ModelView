import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

class WindowManager {
    private activeWindows: Map<string, WebviewWindow> = new Map();

    /**
     * Opens a new standard isolated window for a specific tool or component.
     * Checks if it's already open, if so it just focuses it.
     */
    /**
     * Preloads a window silently in the background so opening it later is instantaneous (0ms delay).
     * This avoids the heavy Webview process creation overhead on-demand.
     */
    async preloadToolWindow(windowId: string, title: string, width: number, height: number): Promise<void> {
        if (this.activeWindows.has(windowId)) {
            console.log(`[WindowManager] Window "${windowId}" already in memory.`);
            return;
        }

        try {
            // In Tauri v2, we check if the native window already exists (survived HMR/Reload)
            const existingWin = await WebviewWindow.getByLabel(windowId);
            if (existingWin) {
                console.log(`[WindowManager] Recovered existing native window: ${windowId}`);
                this.activeWindows.set(windowId, existingWin);

                // Re-bind the close-to-hide behavior
                await existingWin.onCloseRequested(async (event) => {
                    event.preventDefault();
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
                url: `/?window=${windowId}`,
                title: title,
                width: width,
                height: height,
                minWidth: width,
                minHeight: height,
                resizable: false,
                transparent: false,
                decorations: false,
                alwaysOnTop: true,
                center: true,
                visible: false // Crucial: spawn invisibly
            });

            win.once('tauri://error', (e) => {
                console.error(`[WindowManager] Tauri error for window "${windowId}":`, JSON.stringify(e));
                this.activeWindows.delete(windowId);
            });

            // The trick: Instead of letting the OS destroy the window when the user clicks 'Close',
            // we intercept the shutdown sequence, cancel it, and just visually hide the window.
            await win.onCloseRequested(async (event) => {
                event.preventDefault(); // Stop destruction
                await win.hide();       // Just mask it
            });

            this.activeWindows.set(windowId, win);
        } catch (err) {
            console.error(`[WindowManager] Runtime exception creating window ${windowId}:`, err);
            throw err;
        }
    }

    /**
     * Instantly shows a preloaded window. If it hasn't been created yet, it falls back to creating it.
     */
    async openToolWindow(windowId: string, title: string, width: number, height: number): Promise<void> {
        console.log(`[WindowManager] Request to open: ${windowId}`);

        let win = this.activeWindows.get(windowId);

        if (!win) {
            console.log(`[WindowManager] Window ${windowId} not preloaded, preloading now...`);
            await this.preloadToolWindow(windowId, title, width, height);
            win = this.activeWindows.get(windowId);
        }

        if (win) {
            try {
                console.log(`[WindowManager] Showing window: ${windowId}`);
                await win.show();
                await win.setFocus();
            } catch (e) {
                console.error(`[WindowManager] Failed to show window ${windowId}:`, e);
                this.activeWindows.delete(windowId);
                // Last ditch effort: recreation
                await this.preloadToolWindow(windowId, title, width, height);
                const freshWin = this.activeWindows.get(windowId);
                if (freshWin) {
                    await freshWin.show();
                    await freshWin.setFocus();
                }
            }
        } else {
            console.error(`[WindowManager] Could not resolve window instance for ${windowId} even after fallback.`);
        }
    }

    /**
     * Hides a specific tool window. It enters hibernation in RAM for later use.
     */
    async hideToolWindow(windowId: string): Promise<void> {
        const win = this.activeWindows.get(windowId);
        if (win) {
            await win.hide();
        }
    }

    /**
     * Window Pooling Logic for Keyframe Editor
     * Maps a field name to a stable window instance ID from the pool.
     */
    private keyframeMap: Map<string, string> = new Map();
    private nextPoolIndex = 0;
    private readonly POOL_SIZE = 8;

    getKeyframeWindowId(fieldName: string): string {
        // Safety guard: if fieldName is missing, default to a generic key
        const safeFieldName = fieldName || 'default';

        // Normalize field name to stay consistent (case-insensitive)
        const key = safeFieldName.toLowerCase().trim();

        if (this.keyframeMap.has(key)) {
            return this.keyframeMap.get(key)!;
        }

        // Assign to a new window in the pool round-robin style
        const windowId = `keyframeEditor_${this.nextPoolIndex}`;
        this.keyframeMap.set(key, windowId);

        this.nextPoolIndex = (this.nextPoolIndex + 1) % this.POOL_SIZE;
        console.log(`[WindowManager] Mapped field "${safeFieldName}" to pooled window "${windowId}"`);
        return windowId;
    }
}

export const windowManager = new WindowManager();
