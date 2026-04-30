import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { emit as tauriEmit, listen as tauriListen } from '@tauri-apps/api/event'
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog'
import type {
    DesktopDirEntry,
    DesktopEvent,
    DesktopEventUnlisten,
    DesktopGateway,
    OpenFileDialogOptions,
    SaveFileDialogOptions,
} from './DesktopGateway'

const toUint8Array = (payload: unknown): Uint8Array => {
    if (payload instanceof Uint8Array) {
        return payload
    }
    if (payload instanceof ArrayBuffer) {
        return new Uint8Array(payload)
    }
    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
    }
    if (Array.isArray(payload)) {
        return new Uint8Array(payload)
    }
    if (typeof payload === 'string') {
        const binary = atob(payload)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i)
        }
        return bytes
    }
    if (payload && typeof payload === 'object') {
        const wrapped = payload as { data?: unknown; bytes?: unknown; payload?: unknown }
        const candidate = wrapped.data ?? wrapped.bytes ?? wrapped.payload
        if (candidate !== undefined) {
            return toUint8Array(candidate)
        }
        const numericKeys = Object.keys(payload)
            .filter((key) => /^\d+$/.test(key))
            .sort((a, b) => Number(a) - Number(b))
        if (numericKeys.length > 0) {
            const bytes = new Uint8Array(numericKeys.length)
            for (let i = 0; i < numericKeys.length; i += 1) {
                bytes[i] = Number((payload as Record<string, unknown>)[numericKeys[i]]) & 0xff
            }
            return bytes
        }
    }
    throw new Error(`Unexpected binary response: ${Object.prototype.toString.call(payload)}`)
}

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
        return tauriInvoke<string>('secure_read_text_file', { path })
    }

    writeTextFile(path: string, contents: string): Promise<void> {
        return tauriInvoke<void>('secure_write_text_file', { path, contents })
    }

    async readFile(path: string): Promise<Uint8Array> {
        const payload = await tauriInvoke<unknown>('secure_read_file', { path })
        return toUint8Array(payload)
    }

    writeFile(path: string, contents: Uint8Array): Promise<void> {
        return tauriInvoke<void>('secure_write_file', { path, contents: Array.from(contents) })
    }

    copyFile(sourcePath: string, targetPath: string): Promise<void> {
        return tauriInvoke<void>('secure_copy_file', { sourcePath, targetPath })
    }

    createDir(path: string, options?: { recursive?: boolean }): Promise<void> {
        return tauriInvoke<void>('secure_create_dir', { path, recursive: options?.recursive })
    }

    removePath(path: string, options?: { recursive?: boolean }): Promise<void> {
        return tauriInvoke<void>('secure_remove_path', { path, recursive: options?.recursive })
    }

    exists(path: string): Promise<boolean> {
        return tauriInvoke<boolean>('secure_exists', { path })
    }

    getFileSize(path: string): Promise<number> {
        return tauriInvoke<number>('secure_file_size', { path })
    }

    readDir(path: string): Promise<DesktopDirEntry[]> {
        return tauriInvoke<DesktopDirEntry[]>('secure_read_dir', { path })
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
