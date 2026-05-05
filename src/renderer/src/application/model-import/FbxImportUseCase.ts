import type { FbxImportGateway } from '../../infrastructure/fbx'
import { fbxImportGateway } from '../../infrastructure/fbx'
import type {
    FbxImportDiagnostic,
    FbxImportResult,
    FbxImportSettings,
    FbxNodeDto,
    FbxMaterialDto,
    FbxMaterialSlotDto,
    FbxStaticMeshDto,
    FbxStaticSceneResult,
    FbxTextureDto,
} from '../../types/fbxImport'
import type { Material, MaterialLayer, ModelData, Texture } from '../../types/model'
import { NodeType } from '../../types/node'
import type { ModelNode } from '../../types/node'
import { getPathDir, isAbsoluteWindowsPath, normalizeWindowsPath } from '../../utils/windowsPath'
import { applyFbxAnimationTracks } from './FbxAnimationMapper'
import { rotateImportedFbxModelZ90 } from './FbxFinalModelTransform'
import { mapFbxMeshToGeoset } from './FbxGeosetMapper'

type Extents = {
    min: [number, number, number]
    max: [number, number, number]
    radius: number
}

const createBaseImportedModel = (path: string, extents: Extents): ModelData => {
    const name = path.split(/[\\/]/).pop()?.replace(/\.fbx$/i, '') || 'Imported FBX'
    return {
        Version: {
            FormatVersion: 800,
        },
        Model: {
            Name: name,
            NumGeosets: 0,
            NumGeosetAnims: 0,
            NumHelpers: 0,
            NumBones: 0,
            NumLights: 0,
            NumAttachments: 0,
            NumParticleEmitters: 0,
            NumParticleEmitters2: 0,
            NumRibbonEmitters: 0,
            NumEventObjects: 0,
            NumCameras: 0,
            BlendTime: 150,
            MinimumExtent: extents.min,
            MaximumExtent: extents.max,
            BoundsRadius: extents.radius,
        },
        Sequences: [],
        GlobalSequences: [],
        Textures: [],
        Materials: [],
        TextureAnims: [],
        Geosets: [],
        GeosetAnims: [],
        Nodes: [],
        Bones: [],
        Helpers: [],
        Attachments: [],
        Lights: [],
        ParticleEmitters: [],
        ParticleEmitters2: [],
        RibbonEmitters: [],
        EventObjects: [],
        CollisionShapes: [],
        ParticleEmitterPopcorns: [],
        Cameras: [],
        PivotPoints: [],
    }
}

const warning = (category: FbxImportDiagnostic['category'], message: string): FbxImportDiagnostic => ({
    severity: 'warning',
    category,
    message,
})

const createDefaultMaterial = (): Material => ({
    Layers: [{
        FilterMode: 'None',
        TextureID: -1,
    }],
})

const createStaticRootHelper = () => ({
    type: NodeType.HELPER,
    Name: 'Imported_Root',
    ObjectId: 0,
    Parent: -1,
    PivotPoint: [0, 0, 0] as [number, number, number],
    Flags: 0,
})

type ImportedNodeMapping = {
    bones: ModelNode[]
    helpers: ModelNode[]
    nodes: ModelNode[]
    pivotPoints: [number, number, number][]
    defaultObjectId: number
    objectIdByTypedId: Map<number, number>
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

const shouldImportHelperNode = (node: FbxNodeDto, meshNodeIds: Set<number>): boolean =>
    !node.isBone
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

const buildImportedNodeMapping = (scene: FbxStaticSceneResult): ImportedNodeMapping => {
    const fbxNodes = scene.nodes ?? []
    const nodesByTypedId = new Map(fbxNodes.map((node) => [node.typedId, node]))
    const boneNodeIds = new Set<number>()
    const meshNodeIds = new Set<number>()
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
            continue
        }
        const vertexCount = Math.min(mesh.skinWeightCounts.length, Math.floor(mesh.skinBoneNodeTypedIds.length / stride))
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
            const count = Math.min(stride, Math.max(0, Math.floor(mesh.skinWeightCounts[vertexIndex] ?? 0)))
            for (let weightIndex = 0; weightIndex < count; weightIndex += 1) {
                const typedId = mesh.skinBoneNodeTypedIds[vertexIndex * stride + weightIndex]
                if (Number.isFinite(typedId) && typedId >= 0 && typedId !== 0xFFFFFFFF) {
                    boneNodeIds.add(typedId)
                }
            }
        }
    }

    const boneSources = fbxNodes.filter((node) => node.isBone || boneNodeIds.has(node.typedId))
    const helperSources = fbxNodes.filter((node) => !boneNodeIds.has(node.typedId) && shouldImportHelperNode(node, meshNodeIds))
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
            PivotPoint: tuple3(node.restTranslation ?? node.worldTranslation),
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
            PivotPoint: tuple3(node.restTranslation ?? node.worldTranslation),
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
        defaultObjectId: helpers[0]?.ObjectId ?? bones[0]?.ObjectId ?? 0,
        objectIdByTypedId,
    }
}

const isPortableRelativeTexturePath = (value: string): boolean => {
    const trimmed = value.trim()
    return trimmed.length > 0
        && !/^[a-zA-Z]:[\\/]/.test(trimmed)
        && !trimmed.startsWith('\\\\')
        && !trimmed.startsWith('/')
}

const toRelativePathFromDir = (sourcePath: string, sourceDir: string): string | null => {
    const normalizedSource = normalizeWindowsPath(sourcePath)
    const normalizedDir = normalizeWindowsPath(sourceDir).replace(/[\\]+$/, '')
    const lowerSource = normalizedSource.toLowerCase()
    const lowerDir = normalizedDir.toLowerCase()
    if (!lowerSource.startsWith(`${lowerDir}\\`)) {
        return null
    }
    return normalizedSource.slice(normalizedDir.length + 1)
}

const chooseTextureImagePath = (texture: FbxTextureDto, sourceModelDir: string): string => {
    if (isPortableRelativeTexturePath(texture.relativeFilename)) {
        return normalizeWindowsPath(texture.relativeFilename)
    }

    const filename = texture.filename.trim()
    if (filename.length > 0) {
        if (isAbsoluteWindowsPath(normalizeWindowsPath(filename))) {
            return toRelativePathFromDir(filename, sourceModelDir) ?? normalizeWindowsPath(filename)
        }
        return normalizeWindowsPath(filename)
    }

    const absoluteFilename = texture.absoluteFilename.trim()
    if (absoluteFilename.length > 0) {
        return toRelativePathFromDir(absoluteFilename, sourceModelDir) ?? normalizeWindowsPath(absoluteFilename)
    }
    return ''
}

const buildTextureLookup = (
    sourceModelDir: string,
    textures: FbxTextureDto[],
    diagnostics: FbxImportDiagnostic[],
): { war3Textures: Texture[]; textureIdByFbxIndex: Map<number, number> } => {
    const war3Textures: Texture[] = []
    const textureIdByFbxIndex = new Map<number, number>()
    const idByImage = new Map<string, number>()

    for (const texture of textures) {
        if (texture.kind !== 'file') {
            diagnostics.push(warning('texture', `FBX texture "${texture.name || texture.textureIndex}" is ${texture.kind}; only file textures are mapped to War3 textures.`))
            continue
        }

        const image = chooseTextureImagePath(texture, sourceModelDir)
        if (!image) {
            diagnostics.push(warning('texture', `FBX texture "${texture.name || texture.textureIndex}" has no usable path${texture.hasEmbeddedContent ? '; embedded texture extraction is not implemented yet' : ''}.`))
            continue
        }

        const key = image.replace(/\\/g, '/').toLowerCase()
        let war3Id = idByImage.get(key)
        if (war3Id === undefined) {
            const war3Texture: Texture = {
                Image: image,
                ReplaceableId: 0,
            }
            if (texture.wrapURepeat || texture.wrapVRepeat) {
                war3Texture.WrapWidth = texture.wrapURepeat
                war3Texture.WrapHeight = texture.wrapVRepeat
                war3Texture.Flags = (texture.wrapURepeat ? 1 : 0) | (texture.wrapVRepeat ? 2 : 0)
            }
            war3Id = war3Textures.length
            idByImage.set(key, war3Id)
            war3Textures.push(war3Texture)
        }
        textureIdByFbxIndex.set(texture.textureIndex, war3Id)

        if (texture.hasUvTransform) {
            diagnostics.push(warning('texture', `FBX texture "${texture.name || image}" has a UV transform; static UV transform conversion to War3 TextureAnims is not implemented yet.`))
        }
        if (texture.uvSet) {
            diagnostics.push(warning('texture', `FBX texture "${texture.name || image}" requests UV set "${texture.uvSet}"; importer currently maps the first UV set only.`))
        }
    }

    return { war3Textures, textureIdByFbxIndex }
}

const findSlot = (material: FbxMaterialDto, slots: FbxMaterialSlotDto['slot'][]): FbxMaterialSlotDto | undefined =>
    material.slots.find((slot) => slots.includes(slot.slot) && slot.textureEnabled && slot.textureIndex !== undefined)

const mapTextureSlot = (
    slot: FbxMaterialSlotDto | undefined,
    textureIdByFbxIndex: Map<number, number>,
): number | undefined => {
    if (!slot || slot.textureIndex === undefined) {
        return undefined
    }
    return textureIdByFbxIndex.get(slot.textureIndex)
}

const buildMaterials = (
    scene: FbxStaticSceneResult,
    textureIdByFbxIndex: Map<number, number>,
    diagnostics: FbxImportDiagnostic[],
): Material[] => {
    if (scene.materials.length === 0) {
        return [createDefaultMaterial()]
    }

    const materialCount = Math.max(1, ...scene.materials.map((material) => material.materialIndex + 1))
    const materials = Array.from({ length: materialCount }, () => createDefaultMaterial())

    for (const fbxMaterial of scene.materials) {
        const mainSlot = findSlot(fbxMaterial, ['baseColor', 'diffuse'])
        const normalSlot = findSlot(fbxMaterial, ['normal'])
        const emissiveSlot = findSlot(fbxMaterial, ['emission'])
        const opacitySlot = findSlot(fbxMaterial, ['opacity'])
        const mainTextureId = mapTextureSlot(mainSlot, textureIdByFbxIndex)
        const opacity = fbxMaterial.opacity ?? opacitySlot?.value[0]
        const layer: MaterialLayer = {
            FilterMode: opacity !== undefined && opacity < 0.999 ? 'Blend' : 'None',
            TextureID: mainTextureId ?? -1,
            CoordId: 0,
        }

        if (opacity !== undefined) {
            layer.Alpha = Math.max(0, Math.min(1, opacity))
        }
        if (fbxMaterial.unlit) {
            layer.Unshaded = true
        }
        if (fbxMaterial.doubleSided) {
            layer.TwoSided = true
        }

        const normalTextureId = mapTextureSlot(normalSlot, textureIdByFbxIndex)
        if (normalTextureId !== undefined) {
            layer.NormalTextureID = normalTextureId
        }
        const emissiveTextureId = mapTextureSlot(emissiveSlot, textureIdByFbxIndex)
        if (emissiveTextureId !== undefined) {
            layer.EmissiveTextureID = emissiveTextureId
            layer.EmissiveGain = 1
        }
        if (fbxMaterial.slots.some((slot) => slot.slot === 'roughness' || slot.slot === 'metalness' || slot.slot === 'ambientOcclusion')) {
            diagnostics.push(warning('material', `FBX material "${fbxMaterial.name || fbxMaterial.materialIndex}" contains PBR ORM-related maps; packing them into War3 ORMTextureID is not implemented yet.`))
        }

        materials[fbxMaterial.materialIndex] = { Layers: [layer] }
    }

    return materials
}

const computeCombinedExtents = (meshes: FbxStaticMeshDto[]): Extents => {
    if (meshes.length === 0) {
        return { min: [0, 0, 0], max: [0, 0, 0], radius: 0 }
    }

    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    let radius = 0
    for (const mesh of meshes) {
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], mesh.minimumExtent[axis])
            max[axis] = Math.max(max[axis], mesh.maximumExtent[axis])
        }
        radius = Math.max(radius, mesh.boundsRadius)
    }
    return { min, max, radius }
}

export class FbxImportUseCase {
    constructor(private readonly gateway: FbxImportGateway) {}

    async importFromPath(path: string, settings?: FbxImportSettings): Promise<FbxImportResult> {
        const scene = await this.gateway.importStaticScene(path, settings)
        const diagnostics: FbxImportDiagnostic[] = scene.probe.warnings.map((message) => warning('unsupported-feature', message))

        if (scene.meshes.length === 0) {
            diagnostics.push(warning('geometry', 'FBX scene did not produce any static mesh geosets.'))
        }
        const extents = computeCombinedExtents(scene.meshes)
        const { war3Textures, textureIdByFbxIndex } = buildTextureLookup(getPathDir(path), scene.textures, diagnostics)
        const modelData = createBaseImportedModel(path, extents)
        modelData.Textures = war3Textures
        modelData.Materials = buildMaterials(scene, textureIdByFbxIndex, diagnostics)
        const nodeMapping = buildImportedNodeMapping(scene)
        modelData.Bones = nodeMapping.bones
        modelData.Helpers = nodeMapping.helpers
        modelData.Nodes = nodeMapping.nodes
        modelData.PivotPoints = nodeMapping.pivotPoints
        modelData.Model.NumBones = modelData.Bones.length
        modelData.Model.NumHelpers = modelData.Helpers.length
        const mappedAnimationKeyCount = applyFbxAnimationTracks(scene, modelData, nodeMapping)
        if (scene.probe.animationStackCount > 0 && mappedAnimationKeyCount === 0) {
            diagnostics.push(warning('animation', 'FBX animation stacks were baked, but no baked node tracks mapped to imported War3 nodes.'))
        } else if (mappedAnimationKeyCount > 0) {
            diagnostics.push(warning('animation', 'FBX animation stacks were imported as War3 Sequences and node TRS tracks.'))
        }
        const maxMaterialId = modelData.Materials.length - 1
        modelData.Geosets = scene.meshes.map((mesh) => mapFbxMeshToGeoset(mesh, Math.min(mesh.materialIndex, maxMaterialId), nodeMapping, diagnostics))
        modelData.Model.NumGeosets = modelData.Geosets.length
        if (scene.probe.skinDeformerCount > 0) {
            diagnostics.push(warning('skeleton', 'FBX skin deformers were mapped to classic War3 matrix groups and VertexGroup data for FormatVersion 800 output.'))
        }
        rotateImportedFbxModelZ90(modelData)
        diagnostics.push(warning('geometry', 'Imported FBX model data was rotated 90 degrees around the Warcraft III Z axis.'))

        return {
            modelData,
            diagnostics,
            probe: scene.probe,
        }
    }
}

export const fbxImportUseCase = new FbxImportUseCase(fbxImportGateway)
