import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { emit as tauriEmit, listen as tauriListen } from '@tauri-apps/api/event'
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog'
import {
    copyFile as tauriCopyFile,
    exists as tauriExists,
    mkdir as tauriMkdir,
    readDir as tauriReadDir,
    readFile as tauriReadFile,
    readTextFile as tauriReadTextFile,
    remove as tauriRemove,
    writeFile as tauriWriteFile,
    writeTextFile as tauriWriteTextFile,
} from '@tauri-apps/plugin-fs'
import type {
    DesktopDirEntry,
    DesktopEvent,
    DesktopEventUnlisten,
    DesktopGateway,
    OpenFileDialogOptions,
    SaveFileDialogOptions,
} from './DesktopGateway'

export class TauriDesktopGateway implements DesktopGateway {
    invoke<TResponse>(command: string, args?: Record<string, unknown>): Promise<TResponse> {
        return tauriInvoke<TResponse>(command, args)
    }

    openFileDialog(options?: OpenFileDialogOptions): Promise<string | string[] | null> {
        return tauriOpen(options)
    }

    saveFileDialog(options?: SaveFileDialogOptions): Promise<string | null> {
        return tauriSave(options)
    }

    readTextFile(path: string): Promise<string> {
        return tauriReadTextFile(path)
    }

    writeTextFile(path: string, contents: string): Promise<void> {
        return tauriWriteTextFile(path, contents)
    }

    readFile(path: string): Promise<Uint8Array> {
        return tauriReadFile(path)
    }

    writeFile(path: string, contents: Uint8Array): Promise<void> {
        return tauriWriteFile(path, contents)
    }

    copyFile(sourcePath: string, targetPath: string): Promise<void> {
        return tauriCopyFile(sourcePath, targetPath)
    }

    createDir(path: string, options?: { recursive?: boolean }): Promise<void> {
        return tauriMkdir(path, options)
    }

    removePath(path: string, options?: { recursive?: boolean }): Promise<void> {
        return tauriRemove(path, options)
    }

    exists(path: string): Promise<boolean> {
        return tauriExists(path)
    }

    readDir(path: string): Promise<DesktopDirEntry[]> {
        return tauriReadDir(path)
    }

    emit<TPayload>(event: string, payload?: TPayload): Promise<void> {
        return tauriEmit(event, payload)
    }

    listen<TPayload>(
        event: string,
        handler: (event: DesktopEvent<TPayload>) => void,
    ): Promise<DesktopEventUnlisten> {
        return tauriListen<TPayload>(event, (event) => handler(event))
    }
}

export const desktopGateway: DesktopGateway = new TauriDesktopGateway()
