export type DesktopEventUnlisten = () => void

export interface DesktopEvent<TPayload> {
    event: string
    id: number
    payload: TPayload
}

export interface CreateDirOptions {
    recursive?: boolean
}

export interface RemovePathOptions {
    recursive?: boolean
}

export interface DesktopDirEntry {
    name: string
    isDirectory: boolean
    isFile: boolean
    isSymlink: boolean
}

export interface DesktopDialogFilter {
    name: string
    extensions: string[]
}

export interface OpenFileDialogOptions {
    title?: string
    multiple?: boolean
    filters?: DesktopDialogFilter[]
}

export interface SaveFileDialogOptions {
    title?: string
    defaultPath?: string
    filters?: DesktopDialogFilter[]
}

export interface DesktopGateway {
    invoke<TResponse>(command: string, args?: Record<string, unknown>): Promise<TResponse>
    openFileDialog(options?: OpenFileDialogOptions): Promise<string | string[] | null>
    saveFileDialog(options?: SaveFileDialogOptions): Promise<string | null>
    readTextFile(path: string): Promise<string>
    writeTextFile(path: string, contents: string): Promise<void>
    readFile(path: string): Promise<Uint8Array>
    writeFile(path: string, contents: Uint8Array): Promise<void>
    copyFile(sourcePath: string, targetPath: string): Promise<void>
    createDir(path: string, options?: CreateDirOptions): Promise<void>
    removePath(path: string, options?: RemovePathOptions): Promise<void>
    exists(path: string): Promise<boolean>
    readDir(path: string): Promise<DesktopDirEntry[]>
    emit<TPayload>(event: string, payload?: TPayload): Promise<void>
    listen<TPayload>(
        event: string,
        handler: (event: DesktopEvent<TPayload>) => void,
    ): Promise<DesktopEventUnlisten>
}
