/// <reference types="vite/client" />

export { }

declare global {
    interface Window {
        api: {
            openFile: () => Promise<string | null>
            readFile: (path: string) => Promise<Uint8Array>
        }
    }
}
