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
import { clearTextureBatchCache } from '../cache'

export type SaveValidationContext = 'save' | 'saveAs' | 'export' | 'convert'

export interface SaveWorkflowTextureOptions extends EncodeAdjustedTexturesOptions { }

export interface SaveWorkflowProgress {
    progress: number
    detail: string
}

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
    onProgress?: (progress: SaveWorkflowProgress) => void | Promise<void>
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
        await input.onProgress?.({ progress: 8, detail: '正在整理模型数据...' })
        const preparation = this.saveModel.prepareModelForSave({
            modelData: input.modelData,
            nodes: input.nodes,
            globalColorSettings: input.globalColorSettings,
        })

        await input.onProgress?.({ progress: 24, detail: '正在校验模型数据...' })
        if (preparation.validationErrors.length > 0) {
            await input.onProgress?.({ progress: 30, detail: '等待确认模型验证结果...' })
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
                {
                    onProgress: ({ current, total, texturePath }) => input.onProgress?.({
                        progress: 35 + (total > 0 ? (current / total) * 15 : 15),
                        detail: texturePath ? `正在复制贴图 ${current}/${total}: ${texturePath}` : `正在复制贴图 ${current}/${total}`,
                    }),
                },
            )
            : EMPTY_TEXTURE_RESULT

        const textureEncodeResult = input.encodeAdjustedTextures && input.textureOptions
            ? await this.textureAssets.encodeAdjustedTexturesOnSave(
                preparation.preparedData,
                input.sourceModelPath,
                input.targetPath,
                input.textureOptions,
                {
                    onProgress: ({ current, total, texturePath }) => input.onProgress?.({
                        progress: 55 + (total > 0 ? (current / total) * 25 : 25),
                        detail: texturePath ? `正在写出调整贴图 ${current}/${total}: ${texturePath}` : `正在写出调整贴图 ${current}/${total}`,
                    }),
                },
            )
            : EMPTY_TEXTURE_RESULT

        await input.onProgress?.({ progress: 86, detail: '正在写出模型文件...' })
        await this.saveModel.writePreparedModelFile({
            preparedData: preparation.preparedData,
            targetPath: input.targetPath,
            format: input.format,
        })

        if (textureEncodeResult.encodedCount > 0) {
            await input.onProgress?.({ progress: 94, detail: '正在刷新贴图缓存...' })
            await this.clearTextureBatchCache()
        }

        await input.onProgress?.({ progress: 98, detail: '正在完成保存...' })
        return {
            preparedData: preparation.preparedData,
            savedNodes: preparation.savedNodes,
            textureEncodeResult,
            textureCopyResult,
        }
    }

    private async clearTextureBatchCache(): Promise<void> {
        try {
            await clearTextureBatchCache(this.desktop)
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
