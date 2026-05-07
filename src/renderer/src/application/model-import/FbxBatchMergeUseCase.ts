import type { FbxImportGateway } from '../../infrastructure/fbx'
import { fbxImportGateway } from '../../infrastructure/fbx'
import type { FbxImportDiagnostic, FbxImportSettings } from '../../types/fbxImport'
import type { ModelData, Sequence } from '../../types/model'
import type { ModelNode } from '../../types/node'
import { getBasename } from '../../utils/windowsPath'
import { applyFbxAnimationTracks } from './FbxAnimationMapper'
import { rotateImportedFbxModelZ90 } from './FbxFinalModelTransform'
import { buildFbxStaticModelData, warning } from './FbxModelBuilder'
import type { ImportedNodeMapping } from './FbxNodeMapper'

export interface FbxBatchMergeInput {
    paths: string[]
    startFrame: number
    intervalFrame: number
    settings?: FbxImportSettings
}

export interface FbxBatchMergeResult {
    modelData: ModelData
    diagnostics: FbxImportDiagnostic[]
    sourceCount: number
    sequenceCount: number
}

const NODE_COLLECTIONS: Array<'Bones' | 'Helpers' | 'Nodes'> = ['Bones', 'Helpers', 'Nodes']

const toFiniteInteger = (value: number, fallback: number): number =>
    Number.isFinite(value) ? Math.round(Number(value)) : fallback

const normalizePathList = (paths: string[]): string[] => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const path of paths) {
        const trimmed = path.trim()
        if (!trimmed.toLowerCase().endsWith('.fbx')) continue
        const key = trimmed.replace(/\//g, '\\').toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(trimmed)
    }
    return result
}

const collectNodeNames = (nodes: ModelNode[] | undefined): Set<string> =>
    new Set((nodes ?? []).map((node) => node.Name).filter((name): name is string => !!name))

const assertCompatibleSkeleton = (base: ModelData, next: ModelData, nextPath: string): void => {
    const baseNames = collectNodeNames(base.Nodes)
    const missing = (next.Nodes ?? [])
        .map((node) => node.Name)
        .filter((name): name is string => !!name && !baseNames.has(name))
    if (missing.length > 0) {
        throw new Error(`${getBasename(nextPath)} 骨骼不一致，未匹配节点：${missing.slice(0, 8).join(', ')}`)
    }
}

const syncNodeCollectionsFromFlatNodes = (modelData: ModelData): void => {
    const nodeByObjectId = new Map((modelData.Nodes ?? []).map((node) => [node.ObjectId, node]))
    for (const collection of NODE_COLLECTIONS) {
        if (collection === 'Nodes') continue
        const nodes = modelData[collection]
        if (!Array.isArray(nodes)) continue
        modelData[collection] = nodes.map((node) => nodeByObjectId.get(node.ObjectId) ?? node)
    }
}

const prefixSequenceName = (sequence: Sequence, path: string): Sequence => {
    const sourceName = getBasename(path).replace(/\.fbx$/i, '')
    const name = sequence.Name?.trim() || sourceName || 'FBX'
    if (name.toLowerCase().includes(sourceName.toLowerCase())) {
        return sequence
    }
    return { ...sequence, Name: sourceName ? `${sourceName} ${name}` : name }
}

const buildSceneAnimationMappingForBase = (
    baseMapping: ImportedNodeMapping,
    nextMapping: ImportedNodeMapping,
    path: string,
): ImportedNodeMapping => {
    const typedIdByObjectId = new Map(
        [...nextMapping.objectIdByTypedId].map(([typedId, objectId]) => [objectId, typedId]),
    )
    const typedIdsByName = new Map<string, number[]>()
    for (const node of nextMapping.nodes) {
        const typedId = typedIdByObjectId.get(node.ObjectId)
        if (typedId === undefined) {
            continue
        }
        const name = node.Name.trim()
        if (name) {
            typedIdsByName.set(name, [...(typedIdsByName.get(name) ?? []), typedId])
        }
    }

    const objectIdByTypedId = new Map<number, number>()
    const missing: string[] = []
    for (const baseNode of baseMapping.nodes) {
        const typedIds = typedIdsByName.get(baseNode.Name.trim())
        const typedId = typedIds?.shift()
        if (typedId === undefined) {
            missing.push(baseNode.Name)
            continue
        }
        objectIdByTypedId.set(typedId, baseNode.ObjectId)
    }
    if (missing.length > 0) {
        throw new Error(`${getBasename(path)} 缺少同骨骼节点：${missing.slice(0, 8).join(', ')}`)
    }

    return {
        ...baseMapping,
        objectIdByTypedId,
    }
}

const prefixNewSequences = (modelData: ModelData, firstNewIndex: number, path: string): void => {
    const sequences = modelData.Sequences ?? []
    for (let index = firstNewIndex; index < sequences.length; index += 1) {
        sequences[index] = prefixSequenceName(sequences[index], path)
    }
}

export class FbxBatchMergeUseCase {
    constructor(private readonly gateway: FbxImportGateway) {}

    async mergeFromPaths(input: FbxBatchMergeInput): Promise<FbxBatchMergeResult> {
        const paths = normalizePathList(input.paths)
        if (paths.length < 2) {
            throw new Error('请选择至少 2 个 FBX 文件')
        }

        const startFrame = toFiniteInteger(input.startFrame, 333)
        const intervalFrame = Math.max(1, toFiniteInteger(input.intervalFrame, 2000))
        const diagnostics: FbxImportDiagnostic[] = []
        let baseModel: ModelData | null = null
        let baseMapping: ImportedNodeMapping | null = null
        let totalMappedKeys = 0
        let nextSequenceStart = startFrame

        for (let index = 0; index < paths.length; index += 1) {
            const path = paths[index]
            const scene = await this.gateway.importStaticScene(path, input.settings)
            const { modelData, nodeMapping, diagnostics: buildDiagnostics } = buildFbxStaticModelData(path, scene)
            diagnostics.push(...buildDiagnostics)

            if (!baseModel) {
                baseModel = modelData
                baseMapping = nodeMapping
                const firstSequenceIndex = baseModel.Sequences?.length ?? 0
                totalMappedKeys += applyFbxAnimationTracks(scene, baseModel, baseMapping, {
                    startFrame: nextSequenceStart,
                    intervalFrame,
                    append: true,
                })
                prefixNewSequences(baseModel, firstSequenceIndex, path)
                nextSequenceStart += Math.max(0, (baseModel.Sequences?.length ?? 0) - firstSequenceIndex) * intervalFrame
            } else {
                if (!baseMapping) {
                    throw new Error('FBX 合并没有可用的基准骨骼')
                }
                assertCompatibleSkeleton(baseModel, modelData, path)
                const firstSequenceIndex = baseModel.Sequences?.length ?? 0
                const sceneMapping = buildSceneAnimationMappingForBase(baseMapping, nodeMapping, path)
                totalMappedKeys += applyFbxAnimationTracks(scene, baseModel, sceneMapping, {
                    startFrame: nextSequenceStart,
                    intervalFrame,
                    append: true,
                })
                prefixNewSequences(baseModel, firstSequenceIndex, path)
                nextSequenceStart += Math.max(0, (baseModel.Sequences?.length ?? 0) - firstSequenceIndex) * intervalFrame
            }
        }

        if (!baseModel || !baseMapping) {
            throw new Error('FBX 合并没有生成有效模型')
        }
        if (totalMappedKeys === 0) {
            diagnostics.push(warning('animation', 'Selected FBX files were imported, but no animation tracks mapped to the shared skeleton.'))
        }
        syncNodeCollectionsFromFlatNodes(baseModel)
        rotateImportedFbxModelZ90(baseModel)
        diagnostics.push(warning('geometry', 'Merged FBX model data was rotated 90 degrees around the Warcraft III Z axis.'))

        return {
            modelData: baseModel,
            diagnostics,
            sourceCount: paths.length,
            sequenceCount: baseModel.Sequences?.length ?? 0,
        }
    }
}

export const fbxBatchMergeUseCase = new FbxBatchMergeUseCase(fbxImportGateway)
