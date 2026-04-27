import type { MaterialManagerPreview } from '../../store/modelStore'
import type { ModelData } from '../../types/model'
import type { PreviewProjectionMode } from '../preview'

export type RendererSyncPlan = 'none' | 'textureState' | 'materialsOnly' | 'geosetMaterialBindings' | 'geosetBuffers' | 'animationMetadata' | 'sceneMetadata' | 'nodeStructure' | 'fullReload'

export interface RendererSyncError {
    code: string
    message: string
}

export interface RendererSyncResult {
    applied: boolean
    documentRevision: number
    previewRevision: number
    plan: RendererSyncPlan
    projection: PreviewProjectionMode
    errors: RendererSyncError[]
}

export interface RendererSyncRevisionInput {
    documentRevision: number
    previewRevision: number
}

export interface MaterialProjectionRendererTarget {
    model?: {
        Textures?: unknown[]
        Materials?: unknown[]
        Geosets?: unknown[]
        Nodes?: unknown[]
        Lights?: unknown[]
        Bones?: unknown[]
        Helpers?: unknown[]
        Attachments?: unknown[]
        EventObjects?: unknown[]
        CollisionShapes?: unknown[]
        Cameras?: unknown[]
        RibbonEmitters?: unknown[]
        ParticleEmitters2?: unknown[]
        TextureAnims?: unknown[]
        GeosetAnims?: unknown[]
        Sequences?: unknown[]
        GlobalSequences?: unknown[]
        PivotPoints?: unknown[]
        MinimumExtent?: unknown
        MaximumExtent?: unknown
        Extents?: unknown
    } | null
    modelInstance?: {
        syncNodes?: () => void
        syncMaterials?: () => void
        syncGeosetAnims?: () => void
        syncGlobalSequences?: () => void
        ribbonsController?: {
            syncEmitters?: () => void
            resetEmitters?: () => void
        } | null
    } | null
    rendererData?: {
        nodes?: Array<{ node?: Record<string, unknown> | null } | null>
        materialLayerTextureID?: unknown[][]
        materialLayerNormalTextureID?: unknown[][]
        materialLayerOrmTextureID?: unknown[][]
        materialLayerReflectionTextureID?: unknown[][]
    } | null
    updateGeosetVertices?: (index: number, data: Float32Array) => void
    updateGeosetGroups?: (index: number) => void
    updateGeosetNormals?: (index: number, data: Float32Array) => void
    updateGeosetTexCoords?: (index: number, data: Float32Array) => void
    syncTextureWrapParametersFromModel?: () => void
}

export interface MaterialProjectionRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
    materialManagerPreview: MaterialManagerPreview | null
    prepareMaterialsForRenderer: (materials: unknown[] | undefined, texturesLength: number) => unknown[] | undefined
}

export interface DocumentMaterialRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
    prepareMaterialsForRenderer: (materials: unknown[] | undefined, texturesLength: number) => unknown[] | undefined
}

export interface GeosetMaterialBindingSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
}

export interface AnimationMetadataRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
    ensureSequences?: (rendererModel: NonNullable<MaterialProjectionRendererTarget['model']>) => unknown[] | undefined
}

export interface GeosetBuffersRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
}

export interface NodeProjectionRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    nodes: unknown[] | null | undefined
}

export interface NodeStructureRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    nodes: unknown[] | null | undefined
    ensureNodes?: (rendererModel: NonNullable<MaterialProjectionRendererTarget['model']>) => unknown[] | undefined
}

export interface TextureStateRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
    ensureTextureSamplers?: (
        renderer: MaterialProjectionRendererTarget,
        textures: unknown[],
    ) => void
}

export interface SceneMetadataRendererSyncInput extends RendererSyncRevisionInput {
    renderer: MaterialProjectionRendererTarget | null
    document: ModelData | null
    particleEmitters?: unknown[] | null
    syncParticleEmittersInPlace?: (currentEmitters: unknown[], nextEmitters: unknown[]) => void
}
