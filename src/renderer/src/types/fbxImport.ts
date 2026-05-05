import type { ModelData } from './model'

export interface FbxImportSettings {
    maxFileSizeBytes?: number
}

export interface FbxImportProbeResult {
    ok: boolean
    path: string
    fileSize: number
    nodeCount: number
    meshCount: number
    materialCount: number
    textureCount: number
    skinDeformerCount: number
    boneCount: number
    animationStackCount: number
    cameraCount: number
    lightCount: number
    unitMeters: number
    framesPerSecond: number
    warnings: string[]
}

export interface FbxStaticSceneResult {
    probe: FbxImportProbeResult
    nodes: FbxNodeDto[]
    bones: FbxBoneDto[]
    textures: FbxTextureDto[]
    materials: FbxMaterialDto[]
    meshes: FbxStaticMeshDto[]
    animationStacks: FbxAnimationStackDto[]
}

export interface FbxTextureDto {
    textureIndex: number
    fileIndex?: number
    kind: string
    name: string
    filename: string
    relativeFilename: string
    absoluteFilename: string
    hasEmbeddedContent: boolean
    embeddedContentSize: number
    uvSet: string
    wrapURepeat: boolean
    wrapVRepeat: boolean
    hasUvTransform: boolean
    uvTranslation: [number, number]
    uvRotation: number
    uvScale: [number, number]
}

export type FbxMaterialSlotKind =
    | 'baseColor'
    | 'diffuse'
    | 'opacity'
    | 'normal'
    | 'emission'
    | 'roughness'
    | 'metalness'
    | 'ambientOcclusion'
    | 'reflection'
    | 'specular'
    | 'unknown'

export interface FbxMaterialSlotDto {
    slot: FbxMaterialSlotKind
    source: string
    textureIndex?: number
    fileIndex?: number
    textureEnabled: boolean
    hasValue: boolean
    valueComponents: number
    value: [number, number, number, number]
    materialProp: string
    shaderProp: string
    uvSet: string
    wrapURepeat: boolean
    wrapVRepeat: boolean
}

export interface FbxMaterialDto {
    materialIndex: number
    name: string
    shaderType: number
    shadingModelName: string
    doubleSided: boolean
    unlit: boolean
    baseColor?: [number, number, number, number]
    diffuseColor?: [number, number, number, number]
    opacity?: number
    emissiveColor?: [number, number, number]
    slots: FbxMaterialSlotDto[]
}

export interface FbxNodeDto {
    typedId: number
    parentTypedId?: number
    name: string
    isBone: boolean
    localTranslation: [number, number, number]
    localRotation: [number, number, number, number]
    localScale: [number, number, number]
    worldTranslation: [number, number, number]
    restTranslation: [number, number, number]
    restWorldMatrix: number[]
}

export interface FbxBoneDto {
    boneTypedId: number
    nodeTypedId?: number
}

export interface FbxStaticMeshDto {
    name: string
    nodeTypedId?: number
    meshMaterialSlot: number
    materialIndex: number
    skinWeightStride: number
    vertexCount: number
    indexCount: number
    vertices: number[]
    normals: number[]
    uvs: number[]
    indices: number[]
    skinWeightCounts: number[]
    skinBoneNodeTypedIds: number[]
    skinWeights: number[]
    minimumExtent: [number, number, number]
    maximumExtent: [number, number, number]
    boundsRadius: number
}

export interface FbxBakedVec3KeyDto {
    timeSeconds: number
    value: [number, number, number]
    flags: number
}

export interface FbxBakedQuatKeyDto {
    timeSeconds: number
    value: [number, number, number, number]
    flags: number
}

export interface FbxBakedNodeDto {
    nodeTypedId: number
    constantTranslation: boolean
    constantRotation: boolean
    constantScale: boolean
    translationKeys: FbxBakedVec3KeyDto[]
    rotationKeys: FbxBakedQuatKeyDto[]
    scaleKeys: FbxBakedVec3KeyDto[]
}

export interface FbxAnimationStackDto {
    stackTypedId: number
    name: string
    timeBegin: number
    timeEnd: number
    playbackTimeBegin: number
    playbackTimeEnd: number
    playbackDuration: number
    bakedNodes: FbxBakedNodeDto[]
}

export type FbxImportDiagnosticSeverity = 'info' | 'warning' | 'error'

export type FbxImportDiagnosticCategory =
    | 'unsupported-feature'
    | 'geometry'
    | 'material'
    | 'texture'
    | 'skeleton'
    | 'animation'
    | 'war3-limit'
    | 'save-readiness'

export interface FbxImportDiagnostic {
    severity: FbxImportDiagnosticSeverity
    category: FbxImportDiagnosticCategory
    message: string
}

export interface FbxImportResult {
    modelData: ModelData
    diagnostics: FbxImportDiagnostic[]
    probe: FbxImportProbeResult
}
