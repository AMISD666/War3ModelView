import type { JumpxBoneDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import { NodeType, type ModelNode } from '../../types/node'

const DONT_INHERIT_ALL = 1 | 2 | 4

export type JumpxNodeMapping = {
    bones: ModelNode[]
    helpers: ModelNode[]
    nodes: ModelNode[]
    pivotPoints: [number, number, number][]
    defaultObjectId: number
    objectIdByBoneId: Map<number, number>
    meshObjectIdByBoneId: Map<number, number>
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
            meshObjectIdByBoneId: new Map(),
        }
    }

    const objectIdByBoneId = new Map<number, number>()
    bones.forEach((bone, index) => {
        objectIdByBoneId.set(bone.boneIndex, index)
    })
    const meshObjectIdByBoneId = new Map<number, number>()
    bones.forEach((bone, index) => {
        meshObjectIdByBoneId.set(bone.boneIndex, bones.length + index)
    })

    const war3Bones: ModelNode[] = bones.map((bone) => {
        const objectId = objectIdByBoneId.get(bone.boneIndex) ?? 0
        return {
            type: NodeType.BONE,
            Name: uniqueBoneName(bone, objectId),
            ObjectId: objectId,
            Parent: -1,
            PivotPoint: [0, 0, 0],
            Flags: DONT_INHERIT_ALL,
            DontInherit: { Translation: true, Rotation: true, Scaling: true },
            GeosetId: null,
            GeosetAnimId: null,
        }
    })

    const meshBones: ModelNode[] = bones.map((bone) => {
        const objectId = meshObjectIdByBoneId.get(bone.boneIndex) ?? bones.length
        return {
            type: NodeType.BONE,
            Name: `${uniqueBoneName(bone, objectId)}_Mesh`,
            ObjectId: objectId,
            Parent: -1,
            PivotPoint: [0, 0, 0],
            Flags: DONT_INHERIT_ALL,
            DontInherit: { Translation: true, Rotation: true, Scaling: true },
            GeosetId: null,
            GeosetAnimId: null,
        }
    })

    const helpers: ModelNode[] = []
    const nodes = [...war3Bones, ...meshBones]
    const pivotPoints: [number, number, number][] = []
    for (const node of nodes) {
        pivotPoints[node.ObjectId] = node.PivotPoint ?? [0, 0, 0]
    }

    return {
        bones: [...war3Bones, ...meshBones],
        helpers,
        nodes,
        pivotPoints,
        defaultObjectId: war3Bones[0]?.ObjectId ?? 0,
        objectIdByBoneId,
        meshObjectIdByBoneId,
    }
}
