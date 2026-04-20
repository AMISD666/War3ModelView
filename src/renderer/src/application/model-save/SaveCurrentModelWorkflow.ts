import type { DesktopGateway } from '../../infrastructure/desktop'
import { desktopGateway } from '../../infrastructure/desktop'
import type { ModelSerializationFormat } from '../../infrastructure/serialization'
import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import type { GlobalColorAdjustSettings } from '../../utils/globalColorAdjustCore'
import type { SaveModelUseCase } from './SaveModelUseCase'
import { saveModelUseCase } from './SaveModelUseCase'
import type { EncodeAdjustedTexturesOptions, TextureAssetOperationResult, TextureSaveAssetService } from './TextureSaveAssetService'
import { textureSaveAssetService } from './TextureSaveAssetService'

export type SaveValidationContext = 'save' | 'saveAs' | 'export' | 'convert'

export interface SaveWorkflowTextureOptions extends EncodeAdjustedTexturesOptions { }

export interface ConfirmValidationInput {
    context: SaveValidationContext
    validationErrors: string[]
}

export interface SavePreparedModelInput {
    modelData: ModelData
    nodes?: ModelNode[]
    sourceModelPath: string | null
    targetPath: string
    globalColorSettings?: GlobalColorAdjustSettings
    textureOptions?: SaveWorkflowTextureOptions
    copyReferencedTextures?: boolean
    encodeAdjustedTextures?: boolean
    format?: ModelSerializationFormat
    validationContext: SaveValidationContext
    confirmValidation: (input: ConfirmValidationInput) => Promise<boolean>
}

export interface SavePreparedModelResult {
    preparedData: ModelData
    savedNodes?: ModelNode[]
    textureEncodeResult: TextureAssetOperationResult
    textureCopyResult: TextureAssetOperationResult
}

const EMPTY_TEXTURE_RESULT: TextureAssetOperationResult = {
    copiedCount: 0,
    encodedCount: 0,
    failed: [],
}

export class SaveCurrentModelWorkflow {
    constructor(
        private readonly saveModel: SaveModelUseCase,
        private readonly textureAssets: TextureSaveAssetService,
        private readonly desktop: DesktopGateway,
    ) { }

    async savePreparedModel(input: SavePreparedModelInput): Promise<SavePreparedModelResult | null> {
        const preparation = this.saveModel.prepareModelForSave({
            modelData: input.modelData,
            nodes: input.nodes,
            globalColorSettings: input.globalColorSettings,
        })

        if (preparation.validationErrors.length > 0) {
            const proceed = await input.confirmValidation({
                context: input.validationContext,
                validationErrors: preparation.validationErrors,
            })
            if (!proceed) {
                return null
            }
        }

        const textureCopyResult = input.copyReferencedTextures
            ? await this.textureAssets.copyReferencedTexturesToTarget(
                preparation.preparedData,
                input.sourceModelPath,
                input.targetPath,
            )
            : EMPTY_TEXTURE_RESULT

        const textureEncodeResult = input.encodeAdjustedTextures && input.textureOptions
            ? await this.textureAssets.encodeAdjustedTexturesOnSave(
                preparation.preparedData,
                input.sourceModelPath,
                input.targetPath,
                input.textureOptions,
            )
            : EMPTY_TEXTURE_RESULT

        await this.saveModel.writePreparedModelFile({
            preparedData: preparation.preparedData,
            targetPath: input.targetPath,
            format: input.format,
        })

        if (textureEncodeResult.encodedCount > 0) {
            await this.clearTextureBatchCache()
        }

        return {
            preparedData: preparation.preparedData,
            savedNodes: preparation.savedNodes,
            textureEncodeResult,
            textureCopyResult,
        }
    }

    private async clearTextureBatchCache(): Promise<void> {
        try {
            await this.desktop.invoke('clear_texture_batch_cache')
        } catch (error) {
            console.error('Failed to clear texture cache:', error)
        }
    }
}

export const saveCurrentModelWorkflow = new SaveCurrentModelWorkflow(
    saveModelUseCase,
    textureSaveAssetService,
    desktopGateway,
)
