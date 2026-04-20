export interface UpdateFetchOptions {
    headers?: Record<string, string>
}

export interface UpdateFetchResult<TBody> {
    ok: boolean
    status: number
    body: TBody
}

export interface UpdateGateway {
    getAppVersion(): Promise<string>
    fetchJson<TBody>(url: string, options?: UpdateFetchOptions): Promise<UpdateFetchResult<TBody>>
    getTempDir(): Promise<string>
    openUrl(url: string): Promise<void>
    downloadFile(url: string, targetPath: string): Promise<void>
    launchInstaller(path: string): Promise<void>
    exit(code: number): Promise<void>
}
