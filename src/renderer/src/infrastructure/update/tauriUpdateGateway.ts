import { getVersion } from '@tauri-apps/api/app'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { tempDir } from '@tauri-apps/api/path'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { exit as tauriExit } from '@tauri-apps/plugin-process'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import type { UpdateFetchOptions, UpdateFetchResult, UpdateGateway } from './UpdateGateway'

export class TauriUpdateGateway implements UpdateGateway {
    getAppVersion(): Promise<string> {
        return getVersion()
    }

    async fetchJson<TBody>(url: string, options?: UpdateFetchOptions): Promise<UpdateFetchResult<TBody>> {
        const response = await tauriFetch(url, options)
        return {
            ok: response.ok,
            status: response.status,
            body: await response.json() as TBody,
        }
    }

    getTempDir(): Promise<string> {
        return tempDir()
    }

    openUrl(url: string): Promise<void> {
        return shellOpen(url)
    }

    downloadFile(url: string, targetPath: string): Promise<void> {
        return tauriInvoke('download_file', { url, targetPath })
    }

    launchInstaller(path: string): Promise<void> {
        return tauriInvoke('launch_installer', { path })
    }

    exit(code: number): Promise<void> {
        return tauriExit(code)
    }
}

export const updateGateway: UpdateGateway = new TauriUpdateGateway()
