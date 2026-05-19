import type { JumpxImportSettings, JumpxProbeResult, JumpxStaticSceneResult } from '../../types/jumpxImport'

export interface JumpxImportGateway {
    probeFile(path: string, settings?: JumpxImportSettings): Promise<JumpxProbeResult>
    importStaticScene(path: string, settings?: JumpxImportSettings): Promise<JumpxStaticSceneResult>
}
