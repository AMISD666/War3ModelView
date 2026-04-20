import { LogicalSize } from '@tauri-apps/api/dpi'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { emit as tauriEmit, listen as tauriListen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getAllWebviewWindows, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type {
    CreateManagedWindowOptions,
    ManagedWindow,
    WindowCloseRequestedEvent,
    WindowGateway,
    WindowUnlisten,
} from './WindowGateway'

class TauriManagedWindow implements ManagedWindow {
    constructor(private readonly window: WebviewWindow) {}

    get label(): string {
        return this.window.label
    }

    setSize(width: number, height: number): Promise<void> {
        return this.window.setSize(new LogicalSize(width, height))
    }

    setMinSize(width: number, height: number): Promise<void> {
        return this.window.setMinSize(new LogicalSize(width, height))
    }

    setFocus(): Promise<void> {
        return this.window.setFocus()
    }

    show(): Promise<void> {
        return this.window.show()
    }

    hide(): Promise<void> {
        return this.window.hide()
    }

    destroy(): Promise<void> {
        return this.window.destroy()
    }

    isVisible(): Promise<boolean> {
        return this.window.isVisible()
    }

    emit<TPayload>(event: string, payload?: TPayload): Promise<void> {
        return this.window.emit(event, payload)
    }

    once(event: string, handler: (event: unknown) => void): void {
        void this.window.once(event, handler)
    }

    onCloseRequested(handler: (event: WindowCloseRequestedEvent) => void | Promise<void>): Promise<WindowUnlisten> {
        return this.window.onCloseRequested(handler)
    }
}

const wrapWindow = (window: WebviewWindow | null): ManagedWindow | null =>
    window ? new TauriManagedWindow(window) : null

export class TauriWindowGateway implements WindowGateway {
    getCurrentWindowLabel(): string {
        return getCurrentWindow().label
    }

    setCurrentWindowTitle(title: string): Promise<void> {
        return getCurrentWindow().setTitle(title)
    }

    hideCurrentWindow(): Promise<void> {
        return getCurrentWindow().hide()
    }

    minimizeCurrentWindow(): Promise<void> {
        return getCurrentWindow().minimize()
    }

    destroyCurrentWindow(): Promise<void> {
        return getCurrentWindow().destroy()
    }

    setCurrentWindowAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
        return getCurrentWindow().setAlwaysOnTop(alwaysOnTop)
    }

    closeCurrentWindow(): Promise<void> {
        return getCurrentWindow().close()
    }

    onCurrentCloseRequested(handler: (event: WindowCloseRequestedEvent) => void | Promise<void>): Promise<WindowUnlisten> {
        return getCurrentWindow().onCloseRequested(handler)
    }

    listen(event: string, handler: (event: unknown) => void): Promise<WindowUnlisten> {
        return tauriListen(event, handler)
    }

    emit<TPayload>(event: string, payload?: TPayload): Promise<void> {
        return tauriEmit(event, payload)
    }

    async getWindowByLabel(label: string): Promise<ManagedWindow | null> {
        return wrapWindow(await WebviewWindow.getByLabel(label))
    }

    async getAllWindows(): Promise<ManagedWindow[]> {
        const windows = await getAllWebviewWindows()
        return windows.map((window) => new TauriManagedWindow(window))
    }

    createWindow(label: string, options: CreateManagedWindowOptions): ManagedWindow {
        return new TauriManagedWindow(new WebviewWindow(label, options))
    }

    emitJsonPayload(label: string, event: string, payloadJson: string): Promise<void> {
        return tauriInvoke('emit_to_webview_json_payload', { label, event, payloadJson })
    }

    emitMsgpackPayload(label: string, event: string, payloadB64: string): Promise<void> {
        return tauriInvoke('emit_to_webview_msgpack_b64', { label, event, payloadB64 })
    }
}

export const windowGateway: WindowGateway = new TauriWindowGateway()
