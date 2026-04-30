import { desktopGateway, type DesktopGateway } from '../../infrastructure/desktop'
import { modelSerializationGateway } from '../../infrastructure/serialization'
import { modelDocumentCommandHandler } from '../commands'
import { extractNodesFromModel, updateModelDataWithNodes, useModelStore } from '../../store/modelStore'
import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import { deepClone } from '../../utils/modelMerge'
import {
    buildRetargetAnimationReplacement,
    buildRetargetSequenceRangeReplacement,
    type RetargetSequenceReplaceMode,
} from './retargetAnimationReplacement'
import {
    appendShiftedNodeAnimationFields,
    buildRetargetSingleSequenceReplacement,
} from './retargetSingleSequenceReplacement'

export interface RetargetModelSnapshot {
    path: string | null
    modelData: ModelData
    nodes: ModelNode[]
}

export interface RetargetCopyResult {
    copiedFields: string[]
}

export interface RetargetReplaceSequencesResult {
    sequenceCount: number
    copiedTrackCount: number
}

export interface RetargetSingleSequenceResult extends RetargetReplaceSequencesResult {
    newSequenceName: string
    sourceInterval: [number, number]
    targetInterval: [number, number]
}

export interface RetargetSequenceCopyRange {
    sourceInterval: [number, number]
    targetInterval: [number, number]
}

const NODE_ANIMATION_FIELDS = [
    'Translation',
    'Rotation',
    'Scaling',
    'Visibility',
    'VisibilityAnim',
    'ColorAnim',
    'AlphaAnim',
    'AmbientColorAnim',
    'IntensityAnim',
    'AmbientIntensityAnim',
    'AttenuationStartAnim',
    'AttenuationEndAnim',
    'EmissionRateAnim',
    'LifeSpanAnim',
    'SpeedAnim',
    'VariationAnim',
    'LatitudeAnim',
    'LongitudeAnim',
    'WidthAnim',
    'LengthAnim',
    'GravityAnim',
    'TargetTranslation',
    'EventTrack',
] as const

const cloneValue = <T,>(value: T): T => deepClone(value)

const normalizePivotPoint = (value: unknown): [number, number, number] | undefined => {
    if (!value) return undefined
    const source = (Array.isArray(value) || ArrayBuffer.isView(value)) ? value as ArrayLike<number> : null
    if (!source || source.length < 3) return undefined
    const x = Number(source[0])
    const y = Number(source[1])
    const z = Number(source[2])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined
    return [x, y, z]
}

const getNodePivotPoint = (modelData: ModelData, node: ModelNode): [number, number, number] | undefined => {
    const direct = normalizePivotPoint((node as any).PivotPoint)
    if (direct) return direct
    const table = (modelData as any).PivotPoints
    if (!Array.isArray(table) || typeof node.ObjectId !== 'number') return undefined
    return normalizePivotPoint(table[node.ObjectId])
}

const buildSnapshot = (modelData: ModelData): { modelData: ModelData; nodes: ModelNode[] } => ({
    modelData: cloneValue(modelData),
    nodes: extractNodesFromModel(modelData),
})

export class RetargetAnimationService {
    constructor(private readonly desktop: DesktopGateway = desktopGateway) {}

    async openSourceFromDialog(): Promise<RetargetModelSnapshot | null> {
        return this.openModelFromDialog('打开 A 区源动作模型')
    }

    async openTargetFromDialog(): Promise<RetargetModelSnapshot | null> {
        const snapshot = await this.openModelFromDialog('打开 B 区目标模型')
        if (!snapshot) return null
        this.commitTargetSnapshot(snapshot)
        return snapshot
    }

    async openTargetPath(path: string): Promise<RetargetModelSnapshot> {
        const snapshot = await this.openSourcePath(path)
        this.commitTargetSnapshot(snapshot)
        return snapshot
    }

    async openSourcePath(path: string): Promise<RetargetModelSnapshot> {
        const bytes = await this.desktop.readFile(path)
        const buffer = new Uint8Array(bytes).buffer as ArrayBuffer
        const parsed = modelSerializationGateway.parse(buffer, path) as ModelData
        return {
            path,
            modelData: parsed,
            nodes: extractNodesFromModel(parsed),
        }
    }

    commitTargetSnapshot(snapshot: RetargetModelSnapshot): void {
        const store = useModelStore.getState()
        if (snapshot.path) {
            store.addTab(snapshot.path)
        }
        store.setModelData(snapshot.modelData, snapshot.path, {
            skipAutoRecalculate: true,
        })
    }

    copyNodeData(input: {
        sourceModelData: ModelData
        sourceNode: ModelNode
        targetModelData: ModelData
        targetNode: ModelNode
        sequenceRange?: RetargetSequenceCopyRange | null
    }): RetargetCopyResult {
        const before = buildSnapshot(input.targetModelData)
        const nextNodes = before.nodes.map((node) => {
            if (node.ObjectId !== input.targetNode.ObjectId) return node

            if (input.sequenceRange) {
                const nextNode = { ...node } as ModelNode
                appendShiftedNodeAnimationFields(
                    input.sourceNode as any,
                    nextNode as any,
                    input.sequenceRange.sourceInterval,
                    input.sequenceRange.targetInterval,
                )
                return nextNode
            }

            const copiedFields: Record<string, unknown> = {}
            for (const field of NODE_ANIMATION_FIELDS) {
                if ((input.sourceNode as any)[field] !== undefined) {
                    copiedFields[field] = cloneValue((input.sourceNode as any)[field])
                } else if ((node as any)[field] !== undefined) {
                    copiedFields[field] = undefined
                }
            }

            const pivotPoint = getNodePivotPoint(input.sourceModelData, input.sourceNode)
            return {
                ...node,
                ...copiedFields,
                ...(pivotPoint ? { PivotPoint: pivotPoint } : {}),
            } as ModelNode
        })
        const afterModelData = this.updateModelDataWithRetargetNodes(input.targetModelData, nextNodes)
        const after = buildSnapshot(afterModelData)

        modelDocumentCommandHandler.replaceDocumentSnapshot({
            name: input.sequenceRange ? '套动作: 单动作复制节点数据' : '套动作: 复制节点数据',
            before,
            after,
            applyOptions: { rendererReload: false },
        })

        const copiedFields: string[] = NODE_ANIMATION_FIELDS.filter((field) => (input.sourceNode as any)[field] !== undefined)
        if (getNodePivotPoint(input.sourceModelData, input.sourceNode)) {
            copiedFields.push('PivotPoint')
        }
        return { copiedFields }
    }

    replaceTargetSequences(input: {
        sourceModelData: ModelData
        targetModelData: ModelData
        mode?: RetargetSequenceReplaceMode
    }): RetargetReplaceSequencesResult {
        const before = buildSnapshot(input.targetModelData)
        const replacement = input.mode === 'manual'
            ? buildRetargetSequenceRangeReplacement(input.sourceModelData, input.targetModelData)
            : buildRetargetAnimationReplacement(input.sourceModelData, input.targetModelData)
        const afterModelData = replacement.modelData
        const after = {
            modelData: afterModelData,
            nodes: replacement.nodes,
            sequences: cloneValue((afterModelData as any).Sequences ?? []),
        }

        modelDocumentCommandHandler.replaceDocumentSnapshot({
            name: '套动作: 替换动作序列',
            before,
            after,
            applyOptions: { rendererReload: true },
        })

        return {
            sequenceCount: replacement.sequenceCount,
            copiedTrackCount: replacement.copiedTrackCount,
        }
    }

    replaceTargetSingleSequence(input: {
        sourceModelData: ModelData
        targetModelData: ModelData
        sourceSequenceIndex: number
        sourceModelName: string
        mode?: RetargetSequenceReplaceMode
    }): RetargetSingleSequenceResult {
        const before = buildSnapshot(input.targetModelData)
        const replacement = buildRetargetSingleSequenceReplacement(
            input.sourceModelData,
            input.targetModelData,
            input.sourceSequenceIndex,
            input.sourceModelName,
            input.mode,
        )
        const afterModelData = replacement.modelData
        const after = {
            modelData: afterModelData,
            nodes: replacement.nodes,
            sequences: cloneValue((afterModelData as any).Sequences ?? []),
        }

        modelDocumentCommandHandler.replaceDocumentSnapshot({
            name: '套动作: 单动作替换',
            before,
            after,
            applyOptions: { rendererReload: true },
        })

        return {
            sequenceCount: replacement.sequenceCount,
            copiedTrackCount: replacement.copiedTrackCount,
            newSequenceName: replacement.newSequenceName,
            sourceInterval: replacement.sourceInterval,
            targetInterval: replacement.targetInterval,
        }
    }

    private updateModelDataWithRetargetNodes(modelData: ModelData, nodes: ModelNode[]): ModelData {
        return updateModelDataWithNodes(modelData, nodes, false) as ModelData
    }

    private async openModelFromDialog(title: string): Promise<RetargetModelSnapshot | null> {
        const selected = await this.desktop.openFileDialog({
            title,
            multiple: false,
            filters: [{ name: 'Warcraft III Models', extensions: ['mdx', 'mdl'] }],
        })
        if (!selected || typeof selected !== 'string') {
            return null
        }
        return this.openSourcePath(selected)
    }
}

export const retargetAnimationService = new RetargetAnimationService()
