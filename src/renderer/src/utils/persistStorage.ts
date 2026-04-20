import { createJSONStorage, StateStorage } from 'zustand/middleware'
import { desktopGateway } from '../infrastructure/desktop'

let storageRootPromise: Promise<string> | null = null

const getStorageRoot = async (): Promise<string> => {
    if (!storageRootPromise) {
        storageRootPromise = desktopGateway.invoke<string>('get_app_storage_root_cmd')
    }
    return storageRootPromise
}

const sanitizeKey = (key: string): string =>
    key.replace(/[^a-zA-Z0-9._-]/g, '_')

const getSettingsDir = async (): Promise<string> => {
    const root = await getStorageRoot()
    const dir = `${root}\\settings`
    await desktopGateway.createDir(dir, { recursive: true })
    return dir
}

const createFileStorage = (): StateStorage => ({
    getItem: async (name: string): Promise<string | null> => {
        try {
            const dir = await getSettingsDir()
            const path = `${dir}\\${sanitizeKey(name)}.json`
            return await desktopGateway.readTextFile(path)
        } catch {
            return null
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        const dir = await getSettingsDir()
        const path = `${dir}\\${sanitizeKey(name)}.json`
        await desktopGateway.writeTextFile(path, value)
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            const dir = await getSettingsDir()
            const path = `${dir}\\${sanitizeKey(name)}.json`
            await desktopGateway.removePath(path)
        } catch {
            // Ignore missing file
        }
    },
})

export const appDirStorage = createJSONStorage(createFileStorage)
