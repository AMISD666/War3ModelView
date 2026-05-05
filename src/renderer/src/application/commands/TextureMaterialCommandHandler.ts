import { useModelStore, type MaterialManagerPreview } from '../../store/modelStore'
import { markCommandAccepted, markDocumentRevisionChanged } from '../diagnostics'
import { previewOverlayService } from '../preview'
import { commandBus, type CommandBus } from './CommandBus'
import {
    findSingleRemovedTextureIndex,
    remapMaterialsAfterTextureRemoval,
    remapParticleEmittersAfterTextureRemoval,
} from '../../utils/materialTextureRelations'

export type TextureMaterialDocumentDomain = 'textures' | 'materials' | 'geosets' | 'preview'
export type TextureMaterialRendererPlan = 'texturePixels' | 'materialsOnly' | 'geosetBuffers' | 'fullReload'

export interface TextureMaterialCommandResult {
    accepted: boolean
    commandType: string
    documentId: string | null
    previousDocumentRevision: number
    nextDocumentRevision: number
    previousPreviewRevision: number
    nextPreviewRevision: number
    affectedDomains: TextureMaterialDocumentDomain[]
    rendererPlan: TextureMaterialRendererPlan
}

export interface SetTextureCollectionInput {
    textures: unknown[]
}

export interface SetMaterialCollectionInput {
    materials: unknown[]
}

export interface SetTextureMaterialCollectionsInput {
    textures?: unknown[]
    materials?: unknown[]
    geosets?: unknown[]
    ribbonEmitters?: unknown[]
    particleEmitters?: unknown[]
    particleEmitters2?: unknown[]
}

export interface SetMaterialManagerPreviewInput {
    preview: MaterialManagerPreview
}

export interface CommitMaterialManagerPreviewInput {
    textures?: unknown[]
    materials?: unknown[]
    geosets?: unknown[]
    ribbonEmitters?: unknown[]
}

export class TextureMaterialCommandHandler {
    constructor(private readonly bus: CommandBus = commandBus) {}

    private executeCommand(
        commandType: string,
        affectedDomains: TextureMaterialDocumentDomain[],
        rendererPlan: TextureMaterialRendererPlan,
        execute: () => void,
        options: { documentMutation?: boolean } = {},
    ): TextureMaterialCommandResult {
        const before = useModelStore.getState()
        this.bus.execute({
            name: commandType,
            execute,
            undo: () => {},
        }, {
            recordHistory: false,
            validateDocumentReferences: options.documentMutation ?? true,
        })
        const after = useModelStore.getState()
        const result: TextureMaterialCommandResult = {
            accepted: true,
            commandType,
            documentId: after.documentId,
            previousDocumentRevision: before.documentRevision,
            nextDocumentRevision: after.documentRevision,
            previousPreviewRevision: before.previewRevision,
            nextPreviewRevision: after.previewRevision,
            affectedDomains,
            rendererPlan,
        }
        markCommandAccepted({
            commandType,
            documentId: result.documentId ?? '',
            previousDocumentRevision: result.previousDocumentRevision,
            nextDocumentRevision: result.nextDocumentRevision,
            previousPreviewRevision: result.previousPreviewRevision,
            nextPreviewRevision: result.nextPreviewRevision,
            affectedDomains: affectedDomains.join(','),
            rendererPlan,
        })
        if (result.previousDocumentRevision !== result.nextDocumentRevision) {
            markDocumentRevisionChanged({
                commandType,
                documentId: result.documentId ?? '',
                previousDocumentRevision: result.previousDocumentRevision,
                nextDocumentRevision: result.nextDocumentRevision,
                affectedDomains: affectedDomains.join(','),
            })
        }
        return result
    }

    setTextureCollection(input: SetTextureCollectionInput): TextureMaterialCommandResult {
        const previousModelData = useModelStore.getState().modelData
        const removedIndex = findSingleRemovedTextureIndex(previousModelData?.Textures, input.textures)
        if (previousModelData && removedIndex !== null) {
            return this.setTextureMaterialCollections({
                textures: input.textures,
                materials: remapMaterialsAfterTextureRemoval(
                    previousModelData.Materials ?? [],
                    removedIndex,
                    input.textures.length,
                ),
                particleEmitters: remapParticleEmittersAfterTextureRemoval(
                    previousModelData.ParticleEmitters,
                    removedIndex,
                    input.textures.length,
                ),
                particleEmitters2: remapParticleEmittersAfterTextureRemoval(
                    previousModelData.ParticleEmitters2,
                    removedIndex,
                    input.textures.length,
                ),
            })
        }

        return this.executeCommand('Texture: Set Collection', ['textures'], 'texturePixels', () => {
            useModelStore.getState().setTextures(input.textures)
        })
    }

    setMaterialCollection(input: SetMaterialCollectionInput): TextureMaterialCommandResult {
        return this.executeCommand('Material: Set Collection', ['materials'], 'materialsOnly', () => {
            useModelStore.getState().setMaterials(input.materials)
        })
    }

    setTextureMaterialCollections(input: SetTextureMaterialCollectionsInput): TextureMaterialCommandResult {
        const affectedDomains: TextureMaterialDocumentDomain[] = []
        if (input.textures !== undefined) affectedDomains.push('textures')
        if (input.materials !== undefined) affectedDomains.push('materials')
        if (input.geosets !== undefined) affectedDomains.push('geosets')
        if (input.ribbonEmitters !== undefined) affectedDomains.push('geosets')
        if (input.particleEmitters !== undefined || input.particleEmitters2 !== undefined) affectedDomains.push('textures')
        return this.executeCommand(
            'Texture/Material: Set Collections',
            affectedDomains,
            input.geosets !== undefined || input.ribbonEmitters !== undefined || input.particleEmitters !== undefined || input.particleEmitters2 !== undefined ? 'fullReload' : 'fullReload',
            () => useModelStore.getState().setVisualDataPatch({
                Textures: input.textures,
                Materials: input.materials,
                Geosets: input.geosets,
                RibbonEmitters: input.ribbonEmitters,
                ParticleEmitters: input.particleEmitters,
                ParticleEmitters2: input.particleEmitters2,
            }),
        )
    }

    setMaterialManagerPreview(input: SetMaterialManagerPreviewInput): TextureMaterialCommandResult {
        return this.executeCommand('Material: Set Preview', ['preview', 'materials', 'textures', 'geosets'], 'materialsOnly', () => {
            previewOverlayService.setMaterialManagerPreview(input.preview)
        }, { documentMutation: false })
    }

    clearMaterialManagerPreview(): TextureMaterialCommandResult {
        return this.executeCommand('Material: Clear Preview', ['preview'], 'materialsOnly', () => {
            previewOverlayService.clearMaterialManagerPreview()
        }, { documentMutation: false })
    }

    commitMaterialManagerPreview(input: CommitMaterialManagerPreviewInput): TextureMaterialCommandResult {
        const affectedDomains: TextureMaterialDocumentDomain[] = ['preview']
        if (input.textures !== undefined) affectedDomains.push('textures')
        if (input.materials !== undefined) affectedDomains.push('materials')
        if (input.geosets !== undefined) affectedDomains.push('geosets')
        if (input.ribbonEmitters !== undefined) affectedDomains.push('geosets')

        return this.executeCommand(
            'Material: Commit Preview',
            affectedDomains,
            input.geosets !== undefined || input.ribbonEmitters !== undefined ? 'geosetBuffers' : 'fullReload',
            () => {
                useModelStore.getState().setVisualDataPatch({
                    Textures: input.textures,
                    Materials: input.materials,
                    Geosets: input.geosets,
                    RibbonEmitters: input.ribbonEmitters,
                })
            },
        )
    }
}

export const textureMaterialCommandHandler = new TextureMaterialCommandHandler()
