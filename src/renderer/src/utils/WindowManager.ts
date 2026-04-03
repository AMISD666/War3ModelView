import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { markStandalonePerf } from './standalonePerf';
import { chooseRpcEmitEncoding } from './rpcSerialization';
import { isKeyframeAnimVectorIntTrack, serializeAnimVectorForKeyframeIpc } from './animVectorIpc';
import type { NodeEditorKind } from '../types/nodeEditorRpc';
import { getToolWindowSize, TOOL_WINDOW_SIZES, type ToolWindowId } from '../constants/windowLayouts';

/** 超过此 JSON 字符长度则走 Rust invoke 投递，避免超大对象在 JS emit 路径反复序列化 */
const RPC_INVOKE_EMIT_THRESHOLD_CHARS = 48 * 1024

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
    /** 打开 nodeEditor 子窗前写入，供主窗口 getNodeEditorState 拼装快照 */
    private pendingNodeEditorSession: { kind: NodeEditorKind; objectId: number } | null = null;

    private activeWindows: Map<string, WebviewWindow> = new Map();
    private visibilityCache: Map<string, boolean> = new Map();
    private hydrationState: Map<string, boolean> = new Map();
    private hydrationWaiters: Map<string, Array<(hydrated: boolean) => void>> = new Map();
    private hydrationListeners: Map<string, () => void> = new Map();

    private resolveConfiguredToolWindowSize(windowId: string, width: number, height: number): { width: number; height: number } {
        if (windowId in TOOL_WINDOW_SIZES) {
            return getToolWindowSize(windowId as ToolWindowId)
        }

        return { width, height }
    }

    private async applyWindowBounds(win: WebviewWindow, width: number, height: number): Promise<void> {
        const size = new LogicalSize(width, height);
        await Promise.allSettled([
            win.setSize(size),
            win.setMinSize(size),
        ]);
    }

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
            // console.error(`[WindowManager] Failed to listen for hydration on ${windowId}:`, error);
        });
    }

    /** 移除 hydration 监听，避免销毁后仍占用事件 */
    private removeHydrationListener(windowId: string): void {
        const unlisten = this.hydrationListeners.get(windowId);
        if (!unlisten) return;
        try {
            unlisten();
        } catch (e) {
            console.warn(`[WindowManager] removeHydrationListener(${windowId}):`, e);
        }
        this.hydrationListeners.delete(windowId);
    }

    private clearToolWindowState(windowId: string): void {
        this.hydrationWaiters.delete(windowId);
        this.visibilityCache.delete(windowId);
        this.hydrationState.delete(windowId);
        this.activeWindows.delete(windowId);
    }

    /** 子窗口创建失败或异常后必须销毁，否则 Rust 侧仍占用 label，下次无法打开 */
    private async destroyWebviewWindow(windowId: string, win?: WebviewWindow | null): Promise<void> {
        this.removeHydrationListener(windowId);
        this.clearToolWindowState(windowId);
        try {
            if (win) {
                await win.destroy();
                return;
            }
            const existing = await WebviewWindow.getByLabel(windowId);
            if (existing) {
                await existing.destroy();
            }
        } catch (e) {
            console.warn(`[WindowManager] destroyWebviewWindow(${windowId}):`, e);
        }
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
            hydrationTimeoutMs: options?.hydrationTimeoutMs ?? (keyframeWindow ? 0 : 120),
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

    /** 仅对可能很大的 RPC 快照做一次 JSON.stringify，小 payload 仍走 Webview emit，避免无谓开销 */
    private isLikelyLargeRpcPayload(payload: unknown): boolean {
        if (payload == null || typeof payload !== 'object') return false
        const p = payload as Record<string, unknown>
        if (p.modelData != null) return true
        if (Array.isArray(p.materials) && p.materials.length > 0) return true
        if (Array.isArray(p.Materials) && p.Materials.length > 0) return true
        if (Array.isArray(p.textures) && p.textures.length > 3) return true
        if (Array.isArray(p.Textures) && p.Textures.length > 3) return true
        if (Array.isArray(p.geosets) && p.geosets.length > 0) return true
        if (Array.isArray(p.Geosets) && p.Geosets.length > 0) return true
        if (typeof p.snapshotVersion === 'number') return true
        return Object.keys(p).length > 12
    }

    async emitToolWindowEvent(windowId: string, eventName: string, payload: any): Promise<void> {
        if (this.isLikelyLargeRpcPayload(payload)) {
            try {
                const choice = chooseRpcEmitEncoding(payload)
                if (choice.mode === 'msgpack' && choice.msgpackB64) {
                    await invoke('emit_to_webview_msgpack_b64', {
                        label: windowId,
                        event: eventName,
                        payloadB64: choice.msgpackB64,
                    })
                    markStandalonePerf('invoke_emit_msgpack', {
                        windowId,
                        eventName,
                        b64Chars: choice.msgpackB64.length,
                    })
                    return
                }
                const json = choice.json ?? JSON.stringify(payload)
                if (json.length >= RPC_INVOKE_EMIT_THRESHOLD_CHARS) {
                    await invoke('emit_to_webview_json_payload', {
                        label: windowId,
                        event: eventName,
                        payloadJson: json,
                    })
                    markStandalonePerf('invoke_emit_large_payload', {
                        windowId,
                        eventName,
                        chars: json.length,
                    })
                    return
                }
            } catch (e) {
                console.warn('[WindowManager] 大负载 invoke（MessagePack/JSON）失败，回退到 Webview.emit:', e)
            }
        }

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

        if (this.activeWindows.has(windowId)) {            return;
        }

        try {
            const existingWin = await WebviewWindow.getByLabel(windowId);
            if (existingWin) {                markStandalonePerf('window_recovered', { windowId, title });
                this.activeWindows.set(windowId, existingWin);
                await this.applyWindowBounds(existingWin, width, height);
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
        }        try {
            const win = new WebviewWindow(windowId, {
                // 使用独立 HTML 入口，避免加载主应用 main.tsx / App 依赖链
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
            });

            win.once('tauri://error', (e) => {
                console.error(`[WindowManager] Tauri error for window "${windowId}":`, JSON.stringify(e));
                void this.destroyWebviewWindow(windowId, win);
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

    /** 设置待打开的节点编辑会话（随后应调用 openNodeEditorWindow） */
    setPendingNodeEditorSession(kind: NodeEditorKind, objectId: number): void {
        this.pendingNodeEditorSession = { kind, objectId };
    }

    getPendingNodeEditorSession(): { kind: NodeEditorKind; objectId: number } | null {
        return this.pendingNodeEditorSession;
    }

    /**
     * 独立 WebView 节点编辑器：单例 windowId=nodeEditor，种类由 pending 会话决定。
     */
    async openNodeEditorWindow(title: string, width: number, height: number): Promise<void> {
        await this.openToolWindow('nodeEditor', title, width, height);
    }

    async openToolWindow(
        windowId: string,
        title: string,
        width: number,
        height: number,
        options?: OpenToolWindowOptions
    ): Promise<void> {
        const resolvedSize = this.resolveConfiguredToolWindowSize(windowId, width, height)
        width = resolvedSize.width
        height = resolvedSize.height
        markStandalonePerf('open_requested', { windowId, title, width, height });

        let win = this.activeWindows.get(windowId);
        const hadExistingWindow = !!win;
        const resolvedOptions = this.getOpenOptions(windowId, options);

        if (!win) {
            await this.preloadToolWindow(windowId, title, width, height);
            win = this.activeWindows.get(windowId);
        }

        if (win) {
            try {
                await this.applyWindowBounds(win, width, height);
                await this.prepareWindowForShow(windowId, hadExistingWindow, resolvedOptions);                await win.show();
                markStandalonePerf('window_shown', { windowId, title });
                this.visibilityCache.set(windowId, true);
                await win.setFocus();
            } catch (e) {
                console.error(`[WindowManager] Failed to show window ${windowId}:`, e);
                await this.destroyWebviewWindow(windowId, win);
                await this.preloadToolWindow(windowId, title, width, height);
                const freshWin = this.activeWindows.get(windowId);
                if (freshWin) {
                    await this.applyWindowBounds(freshWin, width, height);
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
        if (this.visibilityCache.has(windowId)) {
            return this.visibilityCache.get(windowId) === true;
        }

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

        const ipcPayload =
            payload &&
            typeof payload === 'object' &&
            payload.initialData != null &&
            typeof payload.initialData === 'object' &&
            Array.isArray((payload.initialData as any).Keys)
                ? {
                    ...payload,
                    initialData: undefined,
                    initialDataJson: serializeAnimVectorForKeyframeIpc(payload.initialData, {
                        isInt: isKeyframeAnimVectorIntTrack(payload.fieldName),
                    }),
                }
                : payload;

        // 关键帧：整段走 Rust emit_to_webview_json_payload（与大型 RPC 相同），避免 JS WebviewWindow.emit
        // 在 Tauri 边界上对嵌套字段序列化时把 float（如四元数 w=1）错成 128 等异常整数
        const payloadJson = JSON.stringify(ipcPayload);
        let invokeOk = false;
        for (const delay of [0, 50, 150]) {
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            try {
                await invoke('emit_to_webview_json_payload', {
                    label: windowId,
                    event: 'IPC_KEYFRAME_INIT',
                    payloadJson,
                });
                invokeOk = true;
                break;
            } catch (e) {
                console.warn('[WindowManager] 关键帧 IPC 走 invoke 失败，将重试:', e);
            }
        }
        if (!invokeOk) {
            console.warn('[WindowManager] 关键帧 IPC invoke 多次失败，回退 emitToolWindowEvent');
            await this.emitToolWindowEvent(windowId, 'IPC_KEYFRAME_INIT', ipcPayload).catch(() => {});
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

    async openConfiguredToolWindow(windowId: import('../constants/windowLayouts').ToolWindowId, title: string): Promise<void> {
        const { width, height } = getToolWindowSize(windowId)
        await this.openToolWindow(windowId, title, width, height)
    }

    async openConfiguredMaterialManager(): Promise<void> {
        const { width, height } = getToolWindowSize('materialManager')
        await this.openToolWindow('materialManager', '鏉愯川绠＄悊鍣?', width, height)
    }

    getKeyframeWindowId(fieldName: string): string {
        const safeFieldName = fieldName || 'default';
        const key = safeFieldName.toLowerCase().trim();

        if (this.keyframeMap.has(key)) {
            return this.keyframeMap.get(key)!;
        }

        const windowId = `keyframeEditor_${this.nextPoolIndex}`;
        this.keyframeMap.set(key, windowId);

        this.nextPoolIndex = (this.nextPoolIndex + 1) % this.POOL_SIZE;        return windowId;
    }
}

export const windowManager = new WindowManager();
