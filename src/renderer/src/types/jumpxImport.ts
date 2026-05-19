import type { ModelData } from './model'

export interface JumpxImportSettings {
    maxFileSizeBytes?: number
    framesPerSecond?: number
}

export interface JumpxProbeResult {
    ok: boolean
    path: string
    fileSize: number
    format: string
    version: number
    headSize: number
    dataSize: number
    headCompressedSize: number
    dataCompressedSize: number
    textureCount: number
    materialCount: number
    geometryCount: number
    boneCount: number
    boneGroupCount: number
    attachmentCount: number
    ribbonCount: number
    particleCount: number
    actionCount: number
    warnings: string[]
}

export interface JumpxStaticSceneResult {
    probe: JumpxProbeResult
    textures: JumpxTextureDto[]
    materials: JumpxMaterialDto[]
    geometries: JumpxGeometryDto[]
    bones: JumpxBoneDto[]
    boneGroups: JumpxBoneGroupDto[]
    attachments: JumpxAttachmentDto[]
    ribbons: JumpxRibbonDto[]
    particles: JumpxParticleDto[]
    actions: JumpxActionDto[]
}

export interface JumpxTextureDto {
    textureIndex: number
    name: string
    path: string
    rawFlags: number
    saveFlags: number
}

export interface JumpxMaterialDto {
    materialIndex: number
    name: string
    textureId: number
    rawFlags: number
    saveFlags: number
    sampleCount: number
    diffuseColor?: [number, number, number, number]
    emissiveColor?: [number, number, number]
    alpha?: number
    colorKeys: JumpxVec3KeyDto[]
    alphaKeys: JumpxScalarKeyDto[]
    uvSpeed?: [number, number]
}

export interface JumpxGeometryDto {
    geometryIndex: number
    name: string
    materialId: number
    vertexCount: number
    indexCount: number
    vertices: number[]
    normals: number[]
    uvs: number[]
    uv2?: number[]
    vertexColors?: number[]
    indices: number[]
    skinWeightStride: number
    skinWeightCounts: number[]
    skinBoneIds: number[]
    skinWeights: number[]
    minimumExtent: [number, number, number]
    maximumExtent: [number, number, number]
    boundsRadius: number
    objectPivot: [number, number, number]
    objectScale: [number, number, number]
    rawFlags: number
    saveFlags: number
}

export interface JumpxBoneDto {
    boneIndex: number
    name: string
    parentId: number
    worldTranslation: [number, number, number]
    localTranslation?: [number, number, number]
    inverseBindMatrix?: number[]
    bindMatrix?: number[]
    rawFlags: number
    saveFlags: number
    positionKeys: JumpxVec3KeyDto[]
    rotationKeys: JumpxQuatKeyDto[]
    scaleKeys: JumpxVec3KeyDto[]
    visibilityKeys: JumpxScalarKeyDto[]
}

export interface JumpxBoneGroupDto {
    boneGroupIndex: number
    name: string
    boneIds: number[]
    rawFlags: number
    saveFlags: number
}

export interface JumpxAttachmentDto {
    attachmentIndex: number
    name: string
    parentBoneId: number
    path: string
    pivot: [number, number, number]
    rawFlags: number
    saveFlags: number
}

export interface JumpxRibbonDto {
    ribbonIndex: number
    name: string
    parentBoneId: number
    materialId: number
    textureSlot: number
    pivot: [number, number, number]
    rawFlags: number
    saveFlags: number
}

export interface JumpxParticleDto {
    particleIndex: number
    name: string
    parentBoneId: number
    pivot: [number, number, number]
    textureId: number
    rawFlags: number
    saveFlags: number
    rawDataAddr: number
    particleFlags: number
    blendMode: number
    partFlags: number
    emissionRate: number
    speed: number
    speedVariation: number
    coneAngle: number
    gravity: number
    gravityX?: number
    gravityY?: number
    lifeRandom?: [number, number] | null
    lifeSpan: number
    width: number
    height: number
    rows: number
    columns: number
    priorityPlane: number
    startColor: [number, number, number]
    midColor: [number, number, number]
    endColor: [number, number, number]
    alpha: [number, number, number]
    particleScaling: [number, number, number]
    middleTime: number
    tailLength: number
    normal: [number, number, number]
    xAxis: [number, number, number]
    yAxis: [number, number, number]
    rotVec: [number, number, number]
    rotVel: [number, number, number]
    lifeSpanHeadUVAnim: [number, number, number]
    decayHeadUVAnim: [number, number, number]
    lifeSpanTailUVAnim: [number, number, number]
    decayTailUVAnim: [number, number, number]
    emissionRateKeys: JumpxScalarKeyDto[]
    visibilityKeys: JumpxScalarKeyDto[]
    unsupportedNotes?: string[]
}

export interface JumpxActionDto {
    actionIndex: number
    name: string
    startFrame: number
    endFrame: number
    rawFlags: number
    saveFlags: number
}

export interface JumpxVec3KeyDto {
    frame: number
    timeMs?: number
    value: [number, number, number]
    rawFlags: number
}

export interface JumpxQuatKeyDto {
    frame: number
    timeMs?: number
    value: [number, number, number, number]
    rawFlags: number
}

export interface JumpxScalarKeyDto {
    frame: number
    timeMs?: number
    value: number
    rawFlags: number
}

export type JumpxImportDiagnosticSeverity = 'info' | 'warning' | 'error'

export type JumpxImportDiagnosticCategory =
    | 'unsupported-feature'
    | 'geometry'
    | 'material'
    | 'texture'
    | 'skeleton'
    | 'animation'
    | 'particle'
    | 'war3-limit'
    | 'save-readiness'

export interface JumpxImportDiagnostic {
    severity: JumpxImportDiagnosticSeverity
    category: JumpxImportDiagnosticCategory
    message: string
}

export interface JumpxImportResult {
    modelData: ModelData
    diagnostics: JumpxImportDiagnostic[]
    probe: JumpxProbeResult
}
