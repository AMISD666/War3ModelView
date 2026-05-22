import type { JumpxImportGateway } from '../../infrastructure/jumpx'
import { extractNodesFromModel, updateModelDataWithNodes } from '../../store/modelStore'
import type { ModelData } from '../../types/model'
import { jumpxImportGateway } from '../../infrastructure/jumpx'
import type { JumpxImportResult, JumpxImportSettings } from '../../types/jumpxImport'
import { applyJumpxAnimationTracks } from './JumpxAnimationMapper'
import { buildJumpxStaticModelData, warning } from './JumpxModelBuilder'

const normalizeJumpxModelForLiveEditing = (modelData: ModelData): ModelData => {
    const nodes = extractNodesFromModel(modelData)
    const normalized = updateModelDataWithNodes(modelData, nodes, false)
    return normalized ?? modelData
}

export class JumpxImportUseCase {
    constructor(private readonly gateway: JumpxImportGateway) {}

    async importFromPath(path: string, settings?: JumpxImportSettings): Promise<JumpxImportResult> {
        const scene = await this.gateway.importStaticScene(path, settings)
        const { modelData, nodeMapping, diagnostics } = buildJumpxStaticModelData(path, scene)
        const mappedAnimationKeyCount = applyJumpxAnimationTracks(scene, modelData, nodeMapping, {
            framesPerSecond: settings?.framesPerSecond,
        })
        if (mappedAnimationKeyCount > 0) {
            diagnostics.push(warning('animation', 'JumpX bone animation keys were imported as War3 node TRS tracks and sequence intervals.'))
        } else if (scene.bones.some((bone) => bone.positionKeys.length > 0 || bone.rotationKeys.length > 0 || bone.scaleKeys.length > 0)) {
            diagnostics.push(warning('animation', 'JumpX bone animation keys were present, but no keys mapped to imported War3 nodes.'))
        }
        const normalizedModelData = normalizeJumpxModelForLiveEditing(modelData)

        return {
            modelData: normalizedModelData,
            diagnostics,
            probe: scene.probe,
        }
    }
}

export const jumpxImportUseCase = new JumpxImportUseCase(jumpxImportGateway)
