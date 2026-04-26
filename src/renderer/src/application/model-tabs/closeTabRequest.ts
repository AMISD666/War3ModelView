export type CloseModelTabRequestHandler = (tabId?: string) => Promise<boolean>

let activeHandler: CloseModelTabRequestHandler | null = null

export const registerCloseModelTabRequestHandler = (handler: CloseModelTabRequestHandler): (() => void) => {
    activeHandler = handler
    return () => {
        if (activeHandler === handler) {
            activeHandler = null
        }
    }
}

export const requestCloseModelTab = async (tabId?: string): Promise<boolean> => {
    if (!activeHandler) {
        return false
    }
    return activeHandler(tabId)
}
