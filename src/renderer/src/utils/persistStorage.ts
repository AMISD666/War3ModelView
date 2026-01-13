import { createJSONStorage, StateStorage } from 'zustand/middleware'
import { invoke } from '@tauri-apps/api/core'
import { mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'

let storageRootPromise: Promise<string> | null = null

const getStorageRoot = async (): Promise<string> => {
    if (!storageRootPromise) {
        storageRootPromise = invoke<string>('get_app_storage_root_cmd')
    }
    return storageRootPromise
}

const sanitizeKey = (key: string): string =>
    key.replace(/[^a-zA-Z0-9._-]/g, '_')

const getSettingsDir = async (): Promise<string> => {
    const root = await getStorageRoot()
    const dir = `${root}\\settings`
    await mkdir(dir, { recursive: true })
    return dir
}

const createFileStorage = (): StateStorage => ({
    getItem: async (name: string): Promise<string | null> => {
        try {
            const dir = await getSettingsDir()
            const path = `${dir}\\${sanitizeKey(name)}.json`
            return await readTextFile(path)
        } catch {
            return null
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        const dir = await getSettingsDir()
        const path = `${dir}\\${sanitizeKey(name)}.json`
        await writeTextFile(path, value)
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            const dir = await getSettingsDir()
            const path = `${dir}\\${sanitizeKey(name)}.json`
            await remove(path)
        } catch {
            // Ignore missing file
        }
    },
})

export const appDirStorage = createJSONStorage(createFileStorage)
