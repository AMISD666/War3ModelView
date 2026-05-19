import type { JumpxBoneDto, JumpxGeometryDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import { NodeType, type ModelNode } from '../../types/node'
import { transformJumpxVec3 } from './JumpxCoordinateTransform'

export type JumpxNodeMapping = {
    bones: ModelNode[]
    helpers: ModelNode[]
    nodes: ModelNode[]
    pivotPoints: [number, number, number][]
    defaultObjectId: number
    objectIdByBoneId: Map<number, number>
    objectIdByGeometryId: Map<number, number>
}

const uniqueBoneName = (bone: JumpxBoneDto, objectId: number): string => {
    const trimmed = bone.name.trim()
    return trimmed.length > 0 ? trimmed : `JumpX_Bone_${objectId}`
}

const createStaticRootHelper = (): ModelNode => ({
    type: NodeType.HELPER,
    Name: 'Imported_Root',
    ObjectId: 0,
    Parent: -1,
    PivotPoint: [0, 0, 0],
    Flags: 0,
})

const nodePivot = (bone: JumpxBoneDto): [number, number, number] => {
    const firstPositionKey = [...bone.positionKeys]
        .filter((key) => Number.isFinite(key.frame))
        .sort((a, b) => a.frame - b.frame)[0]
    return transformJumpxVec3(firstPositionKey?.value ?? bone.worldTranslation)
}

const uniqueGeometryName = (geometry: JumpxGeometryDto, objectId: number): string => {
    const trimmed = geometry.name.trim()
    return trimmed.length > 0 ? trimmed : `JumpX_Geometry_${objectId}`
}

const createGeometryHelper = (geometry: JumpxGeometryDto, objectId: number): ModelNode => ({
    type: NodeType.HELPER,
    Name: uniqueGeometryName(geometry, objectId),
    ObjectId: objectId,
    Parent: -1,
    PivotPoint: transformJumpxVec3(geometry.objectPivot),
    Flags: 0,
})

export const buildJumpxNodeMapping = (scene: JumpxStaticSceneResult): JumpxNodeMapping => {
    const bones = [...(scene.bones ?? [])].sort((a, b) => a.boneIndex - b.boneIndex)
    if (bones.length === 0) {
        const root = createStaticRootHelper()
        return {
            bones: [],
            helpers: [root],
            nodes: [root],
            pivotPoints: [[0, 0, 0]],
            defaultObjectId: 0,
            objectIdByBoneId: new Map(),
            objectIdByGeometryId: new Map(),
        }
    }

    const objectIdByBoneId = new Map<number, number>()
    bones.forEach((bone, index) => {
        objectIdByBoneId.set(bone.boneIndex, index)
    })

    const war3Bones: ModelNode[] = bones.map((bone) => {
        const objectId = objectIdByBoneId.get(bone.boneIndex) ?? 0
        return {
            type: NodeType.BONE,
            Name: uniqueBoneName(bone, objectId),
            ObjectId: objectId,
            Parent: objectIdByBoneId.get(bone.parentId) ?? -1,
            PivotPoint: nodePivot(bone),
            Flags: 0,
            GeosetId: null,
            GeosetAnimId: null,
        }
    })

    const objectIdByGeometryId = new Map<number, number>()
    const helpers: ModelNode[] = []
    let nextObjectId = war3Bones.length
    for (const geometry of scene.geometries ?? []) {
        const objectId = nextObjectId
        nextObjectId += 1
        objectIdByGeometryId.set(geometry.geometryIndex, objectId)
        helpers.push(createGeometryHelper(geometry, objectId))
    }

    const nodes = [...war3Bones, ...helpers].sort((a, b) => a.ObjectId - b.ObjectId)
    const pivotPoints: [number, number, number][] = []
    for (const node of nodes) {
        pivotPoints[node.ObjectId] = node.PivotPoint ?? [0, 0, 0]
    }

    return {
        bones: war3Bones,
        helpers,
        nodes,
        pivotPoints,
        defaultObjectId: war3Bones[0]?.ObjectId ?? 0,
        objectIdByBoneId,
        objectIdByGeometryId,
    }
}
