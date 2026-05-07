import type {
    FbxImportDiagnostic,
    FbxMaterialDto,
    FbxMaterialSlotDto,
    FbxStaticMeshDto,
    FbxStaticSceneResult,
    FbxTextureDto,
} from '../../types/fbxImport'
import type { Material, MaterialLayer, ModelData, Texture } from '../../types/model'
import { getPathDir, isAbsoluteWindowsPath, normalizeWindowsPath } from '../../utils/windowsPath'
import { mapFbxMeshToGeosets } from './FbxGeosetMapper'
import { buildImportedNodeMapping, type ImportedNodeMapping } from './FbxNodeMapper'

type Extents = {
    min: [number, number, number]
    max: [number, number, number]
    radius: number
}

export type FbxStaticModelBuildResult = {
    modelData: ModelData
    nodeMapping: ImportedNodeMapping
    diagnostics: FbxImportDiagnostic[]
}

export const warning = (
    category: FbxImportDiagnostic['category'],
    message: string,
): FbxImportDiagnostic => ({
    severity: 'warning',
    category,
    message,
})

const createBaseImportedModel = (path: string, extents: Extents): ModelData => {
    const name = path.split(/[\\/]/).pop()?.replace(/\.fbx$/i, '') || 'Imported FBX'
    return {
        Version: { FormatVersion: 800 },
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

const createDefaultMaterial = (): Material => ({
    Layers: [{
        FilterMode: 'None',
        TextureID: -1,
    }],
})

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
            const war3Texture: Texture = { Image: image, ReplaceableId: 0 }
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

        if (opacity !== undefined) layer.Alpha = Math.max(0, Math.min(1, opacity))
        if (fbxMaterial.unlit) layer.Unshaded = true
        if (fbxMaterial.doubleSided) layer.TwoSided = true

        const normalTextureId = mapTextureSlot(normalSlot, textureIdByFbxIndex)
        if (normalTextureId !== undefined) layer.NormalTextureID = normalTextureId
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

export const buildFbxStaticModelData = (
    path: string,
    scene: FbxStaticSceneResult,
): FbxStaticModelBuildResult => {
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

    const maxMaterialId = modelData.Materials.length - 1
    modelData.Geosets = scene.meshes.flatMap((mesh) =>
        mapFbxMeshToGeosets(mesh, Math.min(mesh.materialIndex, maxMaterialId), nodeMapping, diagnostics))
    modelData.Model.NumGeosets = modelData.Geosets.length
    if (scene.probe.skinDeformerCount > 0) {
        diagnostics.push(warning('skeleton', 'FBX skin deformers were mapped to classic War3 matrix groups and VertexGroup data for FormatVersion 800 output.'))
    }

    return { modelData, nodeMapping, diagnostics }
}
