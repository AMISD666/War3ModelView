import { syncAnimationMetadata as syncAnimationMetadataProjection } from './RendererAnimationSync'
import {
    syncGeosetBuffers as syncGeosetBuffersProjection,
    syncGeosetMaterialBindings as syncGeosetMaterialBindingProjection,
} from './RendererGeosetSync'
import {
    syncDocumentMaterials as syncDocumentMaterialProjection,
    syncMaterialProjection as syncMaterialProjectionProjection,
} from './RendererMaterialSync'
import {
    syncNodeProjection as syncNodeProjectionProjection,
    syncNodeStructure as syncNodeStructureProjection,
} from './RendererNodeSync'
import { syncSceneMetadata as syncSceneMetadataProjection } from './RendererSceneSync'
import { syncTextureState as syncTextureStateProjection } from './RendererTextureSync'
import type {
    AnimationMetadataRendererSyncInput,
    DocumentMaterialRendererSyncInput,
    GeosetBuffersRendererSyncInput,
    GeosetMaterialBindingSyncInput,
    MaterialProjectionRendererSyncInput,
    NodeProjectionRendererSyncInput,
    NodeStructureRendererSyncInput,
    RendererSyncResult,
    SceneMetadataRendererSyncInput,
    TextureStateRendererSyncInput,
} from './RendererSyncTypes'

export class RendererSyncService {
    syncMaterialProjection(input: MaterialProjectionRendererSyncInput): RendererSyncResult {
        return syncMaterialProjectionProjection(input)
    }

    syncDocumentMaterials(input: DocumentMaterialRendererSyncInput): RendererSyncResult {
        return syncDocumentMaterialProjection(input)
    }

    syncGeosetMaterialBindings(input: GeosetMaterialBindingSyncInput): RendererSyncResult {
        return syncGeosetMaterialBindingProjection(input)
    }

    syncAnimationMetadata(input: AnimationMetadataRendererSyncInput): RendererSyncResult {
        return syncAnimationMetadataProjection(input)
    }

    syncSceneMetadata(input: SceneMetadataRendererSyncInput): RendererSyncResult {
        return syncSceneMetadataProjection(input)
    }

    syncGeosetBuffers(input: GeosetBuffersRendererSyncInput): RendererSyncResult {
        return syncGeosetBuffersProjection(input)
    }

    syncNodeProjection(input: NodeProjectionRendererSyncInput): RendererSyncResult {
        return syncNodeProjectionProjection(input)
    }

    syncNodeStructure(input: NodeStructureRendererSyncInput): RendererSyncResult {
        return syncNodeStructureProjection(input)
    }

    syncTextureState(input: TextureStateRendererSyncInput): RendererSyncResult {
        return syncTextureStateProjection(input)
    }
}

export const rendererSyncService = new RendererSyncService()
