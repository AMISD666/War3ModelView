import type { FbxImportGateway } from '../../infrastructure/fbx'
import { fbxImportGateway } from '../../infrastructure/fbx'
import type { FbxImportDiagnostic, FbxImportSettings } from '../../types/fbxImport'
import type { FbxStaticSceneResult } from '../../types/fbxImport'
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

const buildNodePathByObjectId = (nodes: ModelNode[] | undefined): Map<number, string> => {
    const nodeByObjectId = new Map((nodes ?? []).map((node) => [node.ObjectId, node]))
    const cache = new Map<number, string>()
    const visit = (objectId: number): string => {
        const cached = cache.get(objectId)
        if (cached !== undefined) {
            return cached
        }

        const node = nodeByObjectId.get(objectId)
        if (!node) {
            return ''
        }

        const name = node.Name.trim()
        const parentPath = typeof node.Parent === 'number' && node.Parent >= 0
            ? visit(node.Parent)
            : ''
        const path = parentPath ? `${parentPath}/${name}` : name
        cache.set(objectId, path)
        return path
    }

    for (const node of nodes ?? []) {
        visit(node.ObjectId)
    }
    return cache
}

const buildTypedIdByObjectId = (mapping: ImportedNodeMapping): Map<number, number> =>
    new Map([...mapping.objectIdByTypedId].map(([typedId, objectId]) => [objectId, typedId]))

const buildTypedIdsByNodePath = (mapping: ImportedNodeMapping): Map<string, number[]> => {
    const typedIdByObjectId = buildTypedIdByObjectId(mapping)
    const pathByObjectId = buildNodePathByObjectId(mapping.nodes)
    const result = new Map<string, number[]>()
    for (const node of mapping.nodes) {
        const typedId = typedIdByObjectId.get(node.ObjectId)
        const path = pathByObjectId.get(node.ObjectId)?.trim()
        if (typedId === undefined || !path) {
            continue
        }
        result.set(path, [...(result.get(path) ?? []), typedId])
    }
    return result
}

const buildTypedIdsByNodeName = (mapping: ImportedNodeMapping): Map<string, number[]> => {
    const typedIdByObjectId = buildTypedIdByObjectId(mapping)
    const result = new Map<string, number[]>()
    for (const node of mapping.nodes) {
        const typedId = typedIdByObjectId.get(node.ObjectId)
        const name = node.Name.trim()
        if (typedId === undefined || !name) {
            continue
        }
        result.set(name, [...(result.get(name) ?? []), typedId])
    }
    return result
}

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
    baseScene: FbxStaticSceneResult,
    baseMapping: ImportedNodeMapping,
    nextMapping: ImportedNodeMapping,
    path: string,
): ImportedNodeMapping => {
    const basePathByObjectId = buildNodePathByObjectId(baseMapping.nodes)
    const typedIdsByPath = buildTypedIdsByNodePath(nextMapping)
    const typedIdsByName = buildTypedIdsByNodeName(nextMapping)

    const objectIdByTypedId = new Map<number, number>()
    const missing: string[] = []
    for (const baseNode of baseMapping.nodes) {
        const nodePath = basePathByObjectId.get(baseNode.ObjectId)?.trim() ?? ''
        const pathTypedIds = nodePath ? typedIdsByPath.get(nodePath) : undefined
        const nameTypedIds = typedIdsByName.get(baseNode.Name.trim())
        const typedId = pathTypedIds?.shift() ?? nameTypedIds?.shift()
        if (typedId === undefined) {
            missing.push(nodePath || baseNode.Name)
            continue
        }
        objectIdByTypedId.set(typedId, baseNode.ObjectId)
    }
    if (missing.length > 0) {
        throw new Error(`${getBasename(path)} 缺少同骨骼节点：${missing.slice(0, 8).join(', ')}`)
    }

    return {
        ...nextMapping,
        nodes: baseMapping.nodes,
        bones: baseMapping.bones,
        helpers: baseMapping.helpers,
        pivotPoints: baseMapping.pivotPoints,
        defaultObjectId: baseMapping.defaultObjectId,
        objectIdByTypedId,
        targetRestNodes: baseScene.nodes,
        targetObjectIdByTypedId: baseMapping.objectIdByTypedId,
    }
}

const prefixNewSequences = (modelData: ModelData, firstNewIndex: number, path: string): void => {
    const sequences = modelData.Sequences ?? []
    for (let index = firstNewIndex; index < sequences.length; index += 1) {
        sequences[index] = prefixSequenceName(sequences[index], path)
    }
}

const getNextSequenceStartAfterAppend = (
    modelData: ModelData,
    firstNewIndex: number,
    fallbackStart: number,
): number => {
    const newSequences = (modelData.Sequences ?? []).slice(firstNewIndex)
    const latestEnd = newSequences.reduce((maxEnd, sequence) => {
        const endFrame = Number(sequence.Interval?.[1])
        return Number.isFinite(endFrame) ? Math.max(maxEnd, endFrame) : maxEnd
    }, -Infinity)
    return Number.isFinite(latestEnd) ? latestEnd + 100 : fallbackStart
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
        let baseScene: FbxStaticSceneResult | null = null
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
                baseScene = scene
                const firstSequenceIndex = baseModel.Sequences?.length ?? 0
                totalMappedKeys += applyFbxAnimationTracks(scene, baseModel, baseMapping, {
                    startFrame: nextSequenceStart,
                    intervalFrame,
                    append: true,
                })
                prefixNewSequences(baseModel, firstSequenceIndex, path)
                nextSequenceStart = getNextSequenceStartAfterAppend(baseModel, firstSequenceIndex, nextSequenceStart + intervalFrame)
            } else {
                if (!baseMapping || !baseScene) {
                    throw new Error('FBX 合并没有可用的基准骨骼')
                }
                assertCompatibleSkeleton(baseModel, modelData, path)
                const firstSequenceIndex = baseModel.Sequences?.length ?? 0
                const sceneMapping = buildSceneAnimationMappingForBase(baseScene, baseMapping, nodeMapping, path)
                totalMappedKeys += applyFbxAnimationTracks(scene, baseModel, sceneMapping, {
                    startFrame: nextSequenceStart,
                    intervalFrame,
                    append: true,
                })
                prefixNewSequences(baseModel, firstSequenceIndex, path)
                nextSequenceStart = getNextSequenceStartAfterAppend(baseModel, firstSequenceIndex, nextSequenceStart + intervalFrame)
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
