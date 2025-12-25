import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    readFile: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:readFile', path),

    // Context Menu APIs
    contextMenu: {
        register: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('context-menu:register'),
        unregister: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('context-menu:unregister'),
        checkStatus: (): Promise<boolean> =>
            ipcRenderer.invoke('context-menu:check-status')
    },

    // Listen for file open from command line/context menu
    onOpenFile: (callback: (filePath: string) => void) => {
        ipcRenderer.on('open-file-from-args', (_event, filePath: string) => {
            callback(filePath)
        })
    }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI
    // @ts-ignore (define in dts)
    window.api = api
}
