import type { DesktopGateway } from '../desktop'
import { desktopGateway } from '../desktop'
import type { FbxImportProbeResult, FbxImportSettings, FbxStaticSceneResult } from '../../types/fbxImport'
import type { FbxImportGateway } from './FbxImportGateway'

export class TauriFbxImportGateway implements FbxImportGateway {
    constructor(private readonly desktop: DesktopGateway) {}

    probeFile(path: string, settings?: FbxImportSettings): Promise<FbxImportProbeResult> {
        return this.desktop.invoke<FbxImportProbeResult>('probe_fbx_native_import', {
            path,
            options: settings
                ? {
                    maxFileSizeBytes: settings.maxFileSizeBytes,
                }
                : undefined,
        })
    }

    importStaticScene(path: string, settings?: FbxImportSettings): Promise<FbxStaticSceneResult> {
        return this.desktop.invoke<FbxStaticSceneResult>('import_fbx_static_scene', {
            path,
            options: settings
                ? {
                    maxFileSizeBytes: settings.maxFileSizeBytes,
                }
                : undefined,
        })
    }
}

export const fbxImportGateway: FbxImportGateway = new TauriFbxImportGateway(desktopGateway)
