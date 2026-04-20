import { windowGateway, type WindowGateway, type WindowUnlisten } from '../../infrastructure/window'
import { markStandalonePerf } from '../../utils/standalonePerf'

type HydrationWaiter = (hydrated: boolean) => void

export class ToolWindowHydrationTracker {
    private readonly hydrationState = new Map<string, boolean>()
    private readonly hydrationWaiters = new Map<string, HydrationWaiter[]>()
    private readonly hydrationListeners = new Map<string, WindowUnlisten>()

    constructor(private readonly gateway: WindowGateway = windowGateway) {}

    markPending(windowId: string): void {
        this.hydrationState.set(windowId, false)
    }

    ensureListener(windowId: string): void {
        if (this.hydrationListeners.has(windowId)) return

        this.gateway.listen(`rpc-applied-${windowId}`, () => {
            markStandalonePerf('child_hydrated', { windowId })
            this.resolve(windowId, true)
        }).then((unlisten) => {
            this.hydrationListeners.set(windowId, unlisten)
        }).catch(() => {
            // Hydration waiting still has a timeout fallback.
        })
    }

    wait(windowId: string, timeoutMs: number = 800): Promise<boolean> {
        if (this.hydrationState.get(windowId)) {
            return Promise.resolve(true)
        }

        return new Promise((resolve) => {
            const waiters = this.hydrationWaiters.get(windowId) || []
            let settled = false

            const waiter = (hydrated: boolean) => {
                if (settled) return
                settled = true
                clearTimeout(timeoutId)
                resolve(hydrated)
            }

            const timeoutId = window.setTimeout(() => {
                if (settled) return
                settled = true
                const pending = this.hydrationWaiters.get(windowId) || []
                this.hydrationWaiters.set(windowId, pending.filter((entry) => entry !== waiter))
                resolve(false)
            }, timeoutMs)

            waiters.push(waiter)
            this.hydrationWaiters.set(windowId, waiters)
        })
    }

    clearWindow(windowId: string): void {
        this.hydrationWaiters.delete(windowId)
        this.hydrationState.delete(windowId)
        this.removeListener(windowId)
    }

    clearAll(): void {
        const unlisteners = Array.from(this.hydrationListeners.values())
        this.hydrationListeners.clear()
        this.hydrationWaiters.clear()
        this.hydrationState.clear()

        unlisteners.forEach((unlisten) => {
            try {
                unlisten()
            } catch (error) {
                console.warn('[ToolWindowHydrationTracker] Failed to unlisten hydration handler:', error)
            }
        })
    }

    private resolve(windowId: string, hydrated: boolean): void {
        this.hydrationState.set(windowId, hydrated)
        const waiters = this.hydrationWaiters.get(windowId)
        if (!waiters || waiters.length === 0) return

        this.hydrationWaiters.delete(windowId)
        waiters.forEach((waiter) => waiter(hydrated))
    }

    private removeListener(windowId: string): void {
        const unlisten = this.hydrationListeners.get(windowId)
        if (!unlisten) return

        try {
            unlisten()
        } catch (error) {
            console.warn(`[ToolWindowHydrationTracker] removeListener(${windowId}):`, error)
        }
        this.hydrationListeners.delete(windowId)
    }
}
