import type { FbxNodeDto, FbxStaticSceneResult } from '../../types/fbxImport'
import { NodeType } from '../../types/node'
import type { ModelNode } from '../../types/node'

export type ImportedNodeMapping = {
    bones: ModelNode[]
    helpers: ModelNode[]
    nodes: ModelNode[]
    pivotPoints: [number, number, number][]
    defaultObjectId: number
    objectIdByTypedId: Map<number, number>
    targetRestNodes?: FbxNodeDto[]
    targetObjectIdByTypedId?: Map<number, number>
}

const tuple3 = (value: [number, number, number] | undefined): [number, number, number] => [
    Number.isFinite(value?.[0]) ? Number(value?.[0]) : 0,
    Number.isFinite(value?.[1]) ? Number(value?.[1]) : 0,
    Number.isFinite(value?.[2]) ? Number(value?.[2]) : 0,
]

const isMeaningfulHelperOffset = (value: [number, number, number] | undefined): boolean =>
    Math.abs(value?.[0] ?? 0) > 1e-5
    || Math.abs(value?.[1] ?? 0) > 1e-5
    || Math.abs(value?.[2] ?? 0) > 1e-5

const uniqueNodeName = (name: string, objectId: number): string => {
    const trimmed = name.trim()
    return trimmed.length > 0 ? trimmed : `FBX_Node_${objectId}`
}

const createStaticRootHelper = () => ({
    type: NodeType.HELPER,
    Name: 'Imported_Root',
    ObjectId: 0,
    Parent: -1,
    PivotPoint: [0, 0, 0] as [number, number, number],
    Flags: 0,
})

const shouldImportHelperNode = (
    node: FbxNodeDto,
    meshNodeIds: Set<number>,
    fallbackBoneNodeIds: Set<number>,
): boolean =>
    !node.isBone
    && !fallbackBoneNodeIds.has(node.typedId)
    && node.parentTypedId !== undefined
    && (
        meshNodeIds.has(node.typedId)
        || isMeaningfulHelperOffset(node.restTranslation)
        || isMeaningfulHelperOffset(node.worldTranslation)
        || isMeaningfulHelperOffset(node.localTranslation)
    )

const findMappedParentId = (
    node: FbxNodeDto,
    nodesByTypedId: Map<number, FbxNodeDto>,
    objectIdByTypedId: Map<number, number>,
): number => {
    let parentTypedId = node.parentTypedId
    while (parentTypedId !== undefined) {
        const mappedParent = objectIdByTypedId.get(parentTypedId)
        if (mappedParent !== undefined) {
            return mappedParent
        }
        parentTypedId = nodesByTypedId.get(parentTypedId)?.parentTypedId
    }
    return -1
}

const collectNodeIdsUsedAsClassicBones = (
    scene: FbxStaticSceneResult,
): { boneNodeIds: Set<number>; meshNodeIds: Set<number>; fallbackBoneNodeIds: Set<number> } => {
    const boneNodeIds = new Set<number>()
    const meshNodeIds = new Set<number>()
    const fallbackBoneNodeIds = new Set<number>()

    for (const bone of scene.bones ?? []) {
        if (bone.nodeTypedId !== undefined) {
            boneNodeIds.add(bone.nodeTypedId)
        }
    }
    for (const mesh of scene.meshes ?? []) {
        if (mesh.nodeTypedId !== undefined) {
            meshNodeIds.add(mesh.nodeTypedId)
        }
        const stride = Math.max(0, Math.floor(mesh.skinWeightStride || 0))
        if (stride <= 0) {
            if (mesh.nodeTypedId !== undefined) {
                fallbackBoneNodeIds.add(mesh.nodeTypedId)
                boneNodeIds.add(mesh.nodeTypedId)
            }
            continue
        }

        let hasUsableSkinWeight = false
        const vertexCount = Math.min(mesh.skinWeightCounts.length, Math.floor(mesh.skinBoneNodeTypedIds.length / stride))
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
            const count = Math.min(stride, Math.max(0, Math.floor(mesh.skinWeightCounts[vertexIndex] ?? 0)))
            for (let weightIndex = 0; weightIndex < count; weightIndex += 1) {
                const sourceIndex = vertexIndex * stride + weightIndex
                const typedId = mesh.skinBoneNodeTypedIds[sourceIndex]
                const weight = mesh.skinWeights[sourceIndex]
                if (Number.isFinite(typedId) && typedId >= 0 && typedId !== 0xFFFFFFFF && Number.isFinite(weight) && weight > 0) {
                    boneNodeIds.add(typedId)
                    hasUsableSkinWeight = true
                }
            }
        }

        if (!hasUsableSkinWeight && mesh.nodeTypedId !== undefined) {
            fallbackBoneNodeIds.add(mesh.nodeTypedId)
            boneNodeIds.add(mesh.nodeTypedId)
        }
    }

    return { boneNodeIds, meshNodeIds, fallbackBoneNodeIds }
}

export const buildImportedNodeMapping = (scene: FbxStaticSceneResult): ImportedNodeMapping => {
    const fbxNodes = scene.nodes ?? []
    const nodesByTypedId = new Map(fbxNodes.map((node) => [node.typedId, node]))
    const { boneNodeIds, meshNodeIds, fallbackBoneNodeIds } = collectNodeIdsUsedAsClassicBones(scene)

    const boneSources = fbxNodes.filter((node) => node.isBone || boneNodeIds.has(node.typedId))
    const helperSources = fbxNodes.filter((node) => shouldImportHelperNode(node, meshNodeIds, fallbackBoneNodeIds))
    const objectIdByTypedId = new Map<number, number>()
    let nextObjectId = 0
    for (const node of [...boneSources, ...helperSources]) {
        objectIdByTypedId.set(node.typedId, nextObjectId)
        nextObjectId += 1
    }

    const bones: ModelNode[] = boneSources.map((node) => {
        const objectId = objectIdByTypedId.get(node.typedId) ?? 0
        return {
            type: NodeType.BONE,
            Name: uniqueNodeName(node.name, objectId),
            ObjectId: objectId,
            Parent: findMappedParentId(node, nodesByTypedId, objectIdByTypedId),
            PivotPoint: tuple3(node.worldTranslation ?? node.restTranslation),
            Flags: 0,
            GeosetId: null,
            GeosetAnimId: null,
        } as ModelNode
    })
    const helpers: ModelNode[] = helperSources.map((node) => {
        const objectId = objectIdByTypedId.get(node.typedId) ?? 0
        return {
            type: NodeType.HELPER,
            Name: uniqueNodeName(node.name, objectId),
            ObjectId: objectId,
            Parent: findMappedParentId(node, nodesByTypedId, objectIdByTypedId),
            PivotPoint: tuple3(node.worldTranslation ?? node.restTranslation),
            Flags: 0,
        } as ModelNode
    })

    if (bones.length === 0 && helpers.length === 0) {
        const root = createStaticRootHelper() as ModelNode
        return {
            bones: [],
            helpers: [root],
            nodes: [root],
            pivotPoints: [[0, 0, 0]],
            defaultObjectId: 0,
            objectIdByTypedId: new Map(),
        }
    }

    const nodes = [...bones, ...helpers].sort((a, b) => a.ObjectId - b.ObjectId)
    const pivotPoints: [number, number, number][] = []
    for (const node of nodes) {
        pivotPoints[node.ObjectId] = node.PivotPoint ?? [0, 0, 0]
    }
    return {
        bones,
        helpers,
        nodes,
        pivotPoints,
        defaultObjectId: bones[0]?.ObjectId ?? helpers[0]?.ObjectId ?? 0,
        objectIdByTypedId,
    }
}
