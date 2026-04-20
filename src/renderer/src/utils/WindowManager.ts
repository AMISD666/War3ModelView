import type { NodeEditorKind } from '../types/nodeEditorRpc'
import { getToolWindowSize, type ToolWindowId } from '../constants/windowLayouts'
import {
    ToolWindowHydrationTracker,
    ToolWindowLifecycleService,
    ToolWindowSessionRegistry,
    WindowRpcTransport,
    type OpenToolWindowOptions,
} from '../application/window-bridge'

class WindowManager {
    private readonly sessionRegistry = new ToolWindowSessionRegistry()
    private readonly hydrationTracker = new ToolWindowHydrationTracker()
    private readonly lifecycleService = new ToolWindowLifecycleService(this.hydrationTracker)
    private readonly rpcTransport = new WindowRpcTransport((windowId) => this.lifecycleService.resolveWindow(windowId))

    async preloadToolWindow(windowId: string, title: string, width: number, height: number): Promise<void> {
        await this.lifecycleService.preloadToolWindow(windowId, title, width, height)
    }

    async openMaterialManager(): Promise<void> {
        await this.openToolWindow('materialManager', '\u6750\u8d28\u7ba1\u7406\u5668', 760, 450)
    }

    setPendingNodeEditorSession(kind: NodeEditorKind, objectId: number): void {
        this.sessionRegistry.setPendingNodeEditorSession(kind, objectId)
    }

    getPendingNodeEditorSession(): { kind: NodeEditorKind; objectId: number; sessionNonce: number } | null {
        return this.sessionRegistry.getPendingNodeEditorSession()
    }

    async openNodeEditorWindow(title: string, width: number, height: number): Promise<void> {
        await this.openToolWindow('nodeEditor', title, width, height)
    }

    async openToolWindow(
        windowId: string,
        title: string,
        width: number,
        height: number,
        options?: OpenToolWindowOptions,
    ): Promise<void> {
        await this.lifecycleService.openToolWindow(windowId, title, width, height, options)
    }

    async emitToolWindowEvent(windowId: string, eventName: string, payload: any): Promise<void> {
        await this.rpcTransport.emitToolWindowEvent(windowId, eventName, payload)
    }

    async emitToolWindowSync(windowId: string, state: any): Promise<void> {
        await this.rpcTransport.emitToolWindowSync(windowId, state)
    }

    async emitToolWindowPatch(windowId: string, patch: any): Promise<void> {
        await this.rpcTransport.emitToolWindowPatch(windowId, patch)
    }

    async hideToolWindow(windowId: string): Promise<void> {
        await this.lifecycleService.hideToolWindow(windowId)
    }

    async isToolWindowVisible(windowId: string): Promise<boolean> {
        return this.lifecycleService.isToolWindowVisible(windowId)
    }

    async openKeyframeToolWindow(windowId: string, title: string, width: number, height: number, payload: any): Promise<void> {
        await this.openToolWindow(windowId, title, width, height, {
            waitForHydration: false,
            hydrationTimeoutMs: 0,
            syncMode: 'never',
        })
        await this.rpcTransport.emitKeyframeInit(windowId, payload)
    }

    async destroyAllWindows(): Promise<void> {
        await this.lifecycleService.destroyAllWindows()
    }

    async openConfiguredToolWindow(windowId: ToolWindowId, title: string): Promise<void> {
        const { width, height } = getToolWindowSize(windowId)
        await this.openToolWindow(windowId, title, width, height)
    }

    async openConfiguredMaterialManager(): Promise<void> {
        const { width, height } = getToolWindowSize('materialManager')
        await this.openToolWindow('materialManager', '\u6750\u8d28\u7ba1\u7406\u5668', width, height)
    }

    getKeyframeWindowId(fieldName: string): string {
        return this.sessionRegistry.getKeyframeWindowId(fieldName)
    }
}

export const windowManager = new WindowManager()
