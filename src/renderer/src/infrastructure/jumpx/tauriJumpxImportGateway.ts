import type { DesktopGateway } from '../desktop'
import { desktopGateway } from '../desktop'
import type { JumpxImportSettings, JumpxProbeResult, JumpxStaticSceneResult } from '../../types/jumpxImport'
import type { JumpxImportGateway } from './JumpxImportGateway'

const toNativeOptions = (settings: JumpxImportSettings | undefined) => settings
    ? {
        maxFileSizeBytes: settings.maxFileSizeBytes,
        framesPerSecond: settings.framesPerSecond,
    }
    : undefined

export class TauriJumpxImportGateway implements JumpxImportGateway {
    constructor(private readonly desktop: DesktopGateway) {}

    probeFile(path: string, settings?: JumpxImportSettings): Promise<JumpxProbeResult> {
        return this.desktop.invoke<JumpxProbeResult>('probe_jumpx_import', {
            path,
            options: toNativeOptions(settings),
        })
    }

    importStaticScene(path: string, settings?: JumpxImportSettings): Promise<JumpxStaticSceneResult> {
        return this.desktop.invoke<JumpxStaticSceneResult>('import_jumpx_static_scene', {
            path,
            options: toNativeOptions(settings),
        })
    }
}

export const jumpxImportGateway: JumpxImportGateway = new TauriJumpxImportGateway(desktopGateway)
