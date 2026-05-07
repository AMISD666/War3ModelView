import type { FbxImportGateway } from '../../infrastructure/fbx'
import { fbxImportGateway } from '../../infrastructure/fbx'
import type {
    FbxImportResult,
    FbxImportSettings,
} from '../../types/fbxImport'
import { applyFbxAnimationTracks } from './FbxAnimationMapper'
import { rotateImportedFbxModelZ90 } from './FbxFinalModelTransform'
import { buildFbxStaticModelData, warning } from './FbxModelBuilder'

export class FbxImportUseCase {
    constructor(private readonly gateway: FbxImportGateway) {}

    async importFromPath(path: string, settings?: FbxImportSettings): Promise<FbxImportResult> {
        const scene = await this.gateway.importStaticScene(path, settings)
        const { modelData, nodeMapping, diagnostics } = buildFbxStaticModelData(path, scene)
        const mappedAnimationKeyCount = applyFbxAnimationTracks(scene, modelData, nodeMapping)
        if (scene.probe.animationStackCount > 0 && mappedAnimationKeyCount === 0) {
            diagnostics.push(warning('animation', 'FBX animation stacks were baked, but no baked node tracks mapped to imported War3 nodes.'))
        } else if (mappedAnimationKeyCount > 0) {
            diagnostics.push(warning('animation', 'FBX animation stacks were imported as War3 Sequences and node TRS tracks.'))
        }
        rotateImportedFbxModelZ90(modelData)
        diagnostics.push(warning('geometry', 'Imported FBX model data was rotated 90 degrees around the Warcraft III Z axis.'))

        return {
            modelData,
            diagnostics,
            probe: scene.probe,
        }
    }
}

export const fbxImportUseCase = new FbxImportUseCase(fbxImportGateway)
