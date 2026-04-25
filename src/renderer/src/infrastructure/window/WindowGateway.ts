export type WindowUnlisten = () => void

export interface WindowCloseRequestedEvent {
    isPreventDefault(): boolean
    preventDefault(): void
}

export interface ManagedWindow {
    readonly label: string
    setSize(width: number, height: number): Promise<void>
    setMinSize(width: number, height: number): Promise<void>
    setFocus(): Promise<void>
    show(): Promise<void>
    hide(): Promise<void>
    destroy(): Promise<void>
    isVisible(): Promise<boolean>
    emit<TPayload>(event: string, payload?: TPayload): Promise<void>
    once(event: string, handler: (event: unknown) => void): void
    onCloseRequested(handler: (event: WindowCloseRequestedEvent) => void | Promise<void>): Promise<WindowUnlisten>
}

export interface CreateManagedWindowOptions {
    url: string
    title: string
    width: number
    height: number
    minWidth: number
    minHeight: number
    resizable: boolean
    transparent: boolean
    decorations: boolean
    alwaysOnTop: boolean
    center: boolean
    visible: boolean
}

export interface WindowGateway {
    getCurrentWindowLabel(): string
    setCurrentWindowTitle(title: string): Promise<void>
    showCurrentWindow(): Promise<void>
    focusCurrentWindow(): Promise<void>
    hideCurrentWindow(): Promise<void>
    minimizeCurrentWindow(): Promise<void>
    destroyCurrentWindow(): Promise<void>
    setCurrentWindowAlwaysOnTop(alwaysOnTop: boolean): Promise<void>
    closeCurrentWindow(): Promise<void>
    onCurrentCloseRequested(handler: (event: WindowCloseRequestedEvent) => void | Promise<void>): Promise<WindowUnlisten>
    listen(event: string, handler: (event: unknown) => void): Promise<WindowUnlisten>
    emit<TPayload>(event: string, payload?: TPayload): Promise<void>
    getWindowByLabel(label: string): Promise<ManagedWindow | null>
    getAllWindows(): Promise<ManagedWindow[]>
    createWindow(label: string, options: CreateManagedWindowOptions): ManagedWindow
    emitJsonPayload(label: string, event: string, payloadJson: string): Promise<void>
    emitMsgpackPayload(label: string, event: string, payloadB64: string): Promise<void>
}
