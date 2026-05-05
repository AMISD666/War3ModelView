import type { FbxImportProbeResult, FbxImportSettings, FbxStaticSceneResult } from '../../types/fbxImport'

export interface FbxImportGateway {
    probeFile(path: string, settings?: FbxImportSettings): Promise<FbxImportProbeResult>
    importStaticScene(path: string, settings?: FbxImportSettings): Promise<FbxStaticSceneResult>
}
