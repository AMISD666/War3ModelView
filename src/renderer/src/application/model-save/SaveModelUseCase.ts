import type { DesktopGateway } from '../../infrastructure/desktop'
import { desktopGateway } from '../../infrastructure/desktop'
import type { ModelSerializationFormat, ModelSerializationGateway } from '../../infrastructure/serialization'
import { modelSerializationGateway } from '../../infrastructure/serialization'
import { applyGlobalColorAdjustmentsToModel, applyGlobalColorAdjustmentsToNodes } from '../../services/globalColorAdjustModelService'
import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import type { GlobalColorAdjustSettings } from '../../utils/globalColorAdjustCore'
import { hasActiveGlobalColorAdjustSettings } from '../../utils/globalColorAdjustCore'
import {
    formatDocumentReferenceIssues,
    repairDocumentReferences,
    validateDocumentReferences,
} from '../model-validation'
import { cleanupInvalidGeosets, validateModelData } from './ModelSavePreparationService'
import { prepareModelDataForSave } from './prepareModelDataForSave'

export interface PrepareModelForSaveInput {
    modelData: ModelData
    nodes?: ModelNode[]
    globalColorSettings?: GlobalColorAdjustSettings
}

export interface PrepareModelForSaveResult {
    preparedData: ModelData
    savedNodes?: ModelNode[]
    validationErrors: string[]
}

export interface WritePreparedModelFileInput {
    preparedData: ModelData
    targetPath: string
    format?: ModelSerializationFormat
}

export interface WritePreparedModelFileResult {
    format: ModelSerializationFormat
}

export class SaveModelUseCase {
    constructor(
        private readonly desktop: DesktopGateway,
        private readonly serialization: ModelSerializationGateway,
    ) { }

    prepareModelForSave(input: PrepareModelForSaveInput): PrepareModelForSaveResult {
        const repairedInput = repairDocumentReferences(input.modelData)
        const preparedBase = prepareModelDataForSave(repairedInput.modelData) as ModelData
        const adjustedData = input.globalColorSettings
            ? applyGlobalColorAdjustmentsToModel(preparedBase, input.globalColorSettings) ?? preparedBase
            : preparedBase
        const preparedAndRepaired = repairDocumentReferences(prepareModelDataForSave(adjustedData) as ModelData)
        let preparedData = preparedAndRepaired.modelData
        const hasGlobalColorAdjustments = !!input.globalColorSettings && hasActiveGlobalColorAdjustSettings(input.globalColorSettings)
        const savedNodes = input.nodes && input.globalColorSettings && hasGlobalColorAdjustments
            ? applyGlobalColorAdjustmentsToNodes(input.nodes, input.globalColorSettings)
            : input.nodes

        cleanupInvalidGeosets(preparedData)
        preparedData = repairDocumentReferences(preparedData).modelData

        return {
            preparedData,
            savedNodes,
            validationErrors: [
                ...validateModelData(preparedData),
                ...formatDocumentReferenceIssues(validateDocumentReferences(preparedData)),
            ],
        }
    }

    async writePreparedModelFile(input: WritePreparedModelFileInput): Promise<WritePreparedModelFileResult> {
        const format = input.format ?? inferModelSerializationFormat(input.targetPath)
        cleanupInvalidGeosets(input.preparedData)
        const repairedData = repairDocumentReferences(input.preparedData).modelData
        await this.desktop.writeFile(input.targetPath, this.serialization.serialize(repairedData, format))
        return { format }
    }
}

export const inferModelSerializationFormat = (path: string): ModelSerializationFormat =>
    path.toLowerCase().endsWith('.mdl') ? 'mdl' : 'mdx'

export const saveModelUseCase = new SaveModelUseCase(desktopGateway, modelSerializationGateway)
