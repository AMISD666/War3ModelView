import type { ModelData } from '../../types/model'
import type { JumpxImportDiagnostic, JumpxStaticSceneResult } from '../../types/jumpxImport'
import { getPathDir } from '../../utils/windowsPath'
import { buildJumpxGeosetAnims, buildJumpxMaterials, buildJumpxTextureAnims, getJumpxMaterialTextureFlags } from './JumpxMaterialMapper'
import { buildJumpxTextureLookup, ensureJumpxTextureSlot, jumpxTextureWrapFlags } from './JumpxTextureMapper'
import { mapJumpxGeometryToGeosets } from './JumpxGeosetMapper'
import { buildJumpxNodeMapping, type JumpxNodeMapping } from './JumpxNodeMapper'
import { mapJumpxParticlesToParticleEmitter2 } from './JumpxParticleMapper'
import { transformJumpxExtents } from './JumpxCoordinateTransform'

type Extents = {
    min: [number, number, number]
    max: [number, number, number]
    radius: number
}

export type JumpxStaticModelBuildResult = {
    modelData: ModelData
    nodeMapping: JumpxNodeMapping
    diagnostics: JumpxImportDiagnostic[]
}

export const warning = (
    category: JumpxImportDiagnostic['category'],
    message: string,
): JumpxImportDiagnostic => ({
    severity: 'warning',
    category,
    message,
})

const createBaseImportedModel = (path: string, extents: Extents): ModelData => {
    const name = path.split(/[\\/]/).pop()?.replace(/\.x$/i, '') || 'Imported JumpX'
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

const buildMaterialIdRemap = (scene: JumpxStaticSceneResult): Map<number, number> => {
    const remap = new Map<number, number>()
    for (const geometry of scene.geometries) {
        if (!remap.has(geometry.materialId)) {
            remap.set(geometry.materialId, remap.size)
        }
    }
    for (const material of scene.materials) {
        if (!remap.has(material.materialIndex)) {
            remap.set(material.materialIndex, remap.size)
        }
    }
    return remap
}

const computeCombinedExtents = (scene: JumpxStaticSceneResult): Extents => {
    if (scene.geometries.length === 0) {
        return { min: [0, 0, 0], max: [0, 0, 0], radius: 0 }
    }
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    let radius = 0
    for (const geometry of scene.geometries) {
        const scaledMin: [number, number, number] = [
            geometry.objectPivot[0] + (geometry.minimumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
            geometry.objectPivot[1] + (geometry.minimumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
            geometry.objectPivot[2] + (geometry.minimumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2],
        ]
        const scaledMax: [number, number, number] = [
            geometry.objectPivot[0] + (geometry.maximumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
            geometry.objectPivot[1] + (geometry.maximumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
            geometry.objectPivot[2] + (geometry.maximumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2],
        ]
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], scaledMin[axis])
            max[axis] = Math.max(max[axis], scaledMax[axis])
        }
        radius = Math.max(radius, geometry.boundsRadius)
    }
    const transformed = transformJumpxExtents(min, max)
    return { min: transformed.min, max: transformed.max, radius }
}

export const buildJumpxStaticModelData = (
    path: string,
    scene: JumpxStaticSceneResult,
): JumpxStaticModelBuildResult => {
    const diagnostics = scene.probe.warnings.map((message) => warning('unsupported-feature', message))
    const extents = computeCombinedExtents(scene)
    const sourceModelDir = getPathDir(path)
    const textureLookup = buildJumpxTextureLookup(sourceModelDir, scene)
    const materialIdRemap = buildMaterialIdRemap(scene)
    const { textureAnims, textureAnimIdByMaterialIndex } = buildJumpxTextureAnims(scene)
    for (const material of scene.materials) {
        const textureFlags = getJumpxMaterialTextureFlags(material, jumpxTextureWrapFlags)
        const textureId = ensureJumpxTextureSlot(sourceModelDir, scene, textureLookup.textures, textureLookup.textureIdByJumpxIndex, material.textureId, textureFlags)
        if (textureId >= 0) {
            textureLookup.textureIdByJumpxIndex.set(-1000 - material.materialIndex, textureId)
        }
    }
    const modelData = createBaseImportedModel(path, extents)
    modelData.Textures = textureLookup.textures
    modelData.TextureAnims = textureAnims
    modelData.Materials = buildJumpxMaterials(scene, textureLookup.textureIdByJumpxIndex, textureAnimIdByMaterialIndex, materialIdRemap, diagnostics)
    for (const material of scene.materials) {
        const textureId = textureLookup.textureIdByJumpxIndex.get(-1000 - material.materialIndex)
        const mappedMaterialIndex = materialIdRemap.get(material.materialIndex)
        const layer = mappedMaterialIndex !== undefined ? modelData.Materials[mappedMaterialIndex]?.Layers?.[0] : undefined
        if (layer && textureId !== undefined) layer.TextureID = textureId
    }

    const nodeMapping = buildJumpxNodeMapping(scene)
    modelData.Bones = nodeMapping.bones
    modelData.Helpers = nodeMapping.helpers
    modelData.Nodes = [...nodeMapping.nodes]
    modelData.PivotPoints = [...nodeMapping.pivotPoints]
    modelData.Model.NumBones = modelData.Bones.length
    modelData.Model.NumHelpers = modelData.Helpers.length

    const maxMaterialId = Math.max(0, modelData.Materials.length - 1)
    const geosetSourceGeometries: JumpxStaticSceneResult['geometries'] = []
    modelData.Geosets = scene.geometries.flatMap((geometry) => {
        const mappedGeosets = mapJumpxGeometryToGeosets(
            geometry,
            Math.min(Math.max(0, materialIdRemap.get(geometry.materialId) ?? geometry.materialId), maxMaterialId),
            nodeMapping,
            diagnostics,
        )
        mappedGeosets.forEach(() => geosetSourceGeometries.push(geometry))
        return mappedGeosets
    })
    modelData.Model.NumGeosets = modelData.Geosets.length
    modelData.GeosetAnims = buildJumpxGeosetAnims(modelData.Geosets, geosetSourceGeometries, scene.materials, scene.bones, materialIdRemap)
    modelData.Model.NumGeosetAnims = modelData.GeosetAnims.length

    const firstParticleObjectId = nodeMapping.nodes.length
    modelData.ParticleEmitters2 = mapJumpxParticlesToParticleEmitter2(
        scene.particles,
        firstParticleObjectId,
        nodeMapping,
        textureLookup.textureIdByJumpxIndex,
        diagnostics,
        scene.bones,
    )
    modelData.Nodes = [...modelData.Nodes, ...modelData.ParticleEmitters2]
    for (const emitter of modelData.ParticleEmitters2) {
        modelData.PivotPoints[emitter.ObjectId] = emitter.PivotPoint ?? [0, 0, 0]
    }
    modelData.Model.NumParticleEmitters2 = modelData.ParticleEmitters2.length

    if (scene.attachments.length > 0) {
        diagnostics.push(warning('unsupported-feature', 'JumpX attachments are present in the DTO but are not mapped in the first TypeScript builder pass.'))
    }
    if (scene.ribbons.length > 0) {
        diagnostics.push(warning('unsupported-feature', 'JumpX ribbons are present in the DTO but need a real ribbon fixture before first-pass mapping claims correctness.'))
    }
    return { modelData, nodeMapping, diagnostics }
}
