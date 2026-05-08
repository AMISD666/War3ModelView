import type { PreviewProjectionMode } from '../preview'
import { getGeosetVertexCount } from '../../commands/AutoSeparateLayersSplitter'
import {
    createMaterialManagerMaterialSummaries,
    createMaterialManagerSequenceSummaries,
    createMaterialManagerTextureAnimSummaries,
    createMaterialManagerTextureSummaries,
    type MaterialManagerMaterialSummary,
    type MaterialManagerSequenceSummary,
    type MaterialManagerTextureAnimSummary,
    type MaterialManagerTextureSummary,
} from './MaterialManagerSnapshotPayload'
import {
    createTextureManagerMaterialSummaries,
    createTextureManagerTextureSummaries,
    type TextureManagerMaterialSummary,
    type TextureManagerTextureSummary,
} from './TextureManagerSnapshotPayload'

export type ToolWindowGeosetSummary = {
    index: number
    MaterialID: unknown
    SelectionGroup: unknown
    vertexCount: number
    faceCount: number
}

export type TextureManagerSnapshot = {
    textureSummaries: TextureManagerTextureSummary[]
    /** @deprecated Standalone texture manager should use textureSummaries and selected-detail commands. */
    textures: any[]
    materialSummaries: TextureManagerMaterialSummary[]
    /** @deprecated Standalone texture manager should use materialSummaries. */
    materials: any[]
    geosets: ToolWindowGeosetSummary[]
    modelPath: string | null | undefined
}

export type ToolWindowSnapshotEnvelope<TPayload> = {
    documentId: string | null
    documentRevision: number
    assetRevision: number
    previewRevision: number
    snapshotRevision: number
    snapshotProjection: PreviewProjectionMode
    windowId: string
    payload: TPayload
}

export type TextureManagerRpcState = ToolWindowSnapshotEnvelope<TextureManagerSnapshot> & {
    /** @deprecated Use snapshotRevision after envelope migration completes. */
    snapshotVersion: number
    /** @deprecated Use payload after envelope migration completes. */
    snapshot: TextureManagerSnapshot
    pickedGeosetIndex: number | null
    selectedMaterialIndex: number | null
    selectedMaterialLayerIndex: number | null
}

export type TextureManagerPatch = {
    pickedGeosetIndex: number | null
}

export type MaterialManagerSnapshot = {
    materialSummaries: MaterialManagerMaterialSummary[]
    /** @deprecated Standalone material manager still needs full selected/editing data until detail queries land. */
    materials: any[]
    textureSummaries: MaterialManagerTextureSummary[]
    /** @deprecated Standalone material manager should use textureSummaries for list/select UI. */
    textures: any[]
    geosets: ToolWindowGeosetSummary[]
    globalSequences: number[]
    sequenceSummaries: MaterialManagerSequenceSummary[]
    textureAnimSummaries: MaterialManagerTextureAnimSummary[]
    /** @deprecated Standalone material manager should use sequenceSummaries. */
    sequences: any[]
    /** @deprecated Standalone material manager should use textureAnimSummaries unless editing TextureAnims directly. */
    textureAnims: any[]
    modelPath: string | null | undefined
}

export type MaterialManagerRpcState = ToolWindowSnapshotEnvelope<MaterialManagerSnapshot> & {
    /** @deprecated Use snapshotRevision after envelope migration completes. */
    snapshotVersion: number
    /** @deprecated Use payload after envelope migration completes. */
    snapshot: MaterialManagerSnapshot
    pickedGeosetIndex: number | null
    selectedMaterialIndex: number | null
    selectedMaterialLayerIndex: number | null
}

export type MaterialManagerPatch = {
    pickedGeosetIndex?: number | null
    selectedMaterialIndex?: number | null
    selectedMaterialLayerIndex?: number | null
}

export type ToolWindowSelectionState = {
    pickedGeosetIndex: number | null | undefined
    selectedMaterialIndex: number | null | undefined
    selectedMaterialLayerIndex: number | null | undefined
}

export type ToolWindowSnapshotPerf = (event: string, payload: Record<string, unknown>) => void

type SnapshotCache<TSnapshot> = {
    snapshotVersion: number
    snapshot: TSnapshot
    sourceRefs: Record<string, unknown>
}

const EMPTY_TEXTURE_SNAPSHOT: TextureManagerSnapshot = {
    textureSummaries: [],
    textures: [],
    materialSummaries: [],
    materials: [],
    geosets: [],
    modelPath: undefined,
}

const EMPTY_MATERIAL_SNAPSHOT: MaterialManagerSnapshot = {
    materialSummaries: [],
    materials: [],
    textureSummaries: [],
    textures: [],
    geosets: [],
    globalSequences: [],
    sequenceSummaries: [],
    textureAnimSummaries: [],
    sequences: [],
    textureAnims: [],
    modelPath: undefined,
}

const GEOSET_METADATA_MERGE_KEYS = ['MaterialID', 'SelectionGroup'] as const

export const stripGeosetDataForToolWindow = (geosets: any[] | undefined | null): ToolWindowGeosetSummary[] => {
    if (!Array.isArray(geosets)) return []
    return geosets.map((geoset, index) => ({
        index,
        MaterialID: geoset?.MaterialID,
        SelectionGroup: geoset?.SelectionGroup,
        vertexCount: getGeosetVertexCount(geoset),
        faceCount: geoset?.Faces ? geoset.Faces.length / 3 : 0,
    }))
}

export const toGlobalSequenceDurations = (values: any[] | undefined | null): number[] => {
    if (!Array.isArray(values)) return []
    return values
        .map((value) => (typeof value === 'number' ? value : value?.Duration))
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

const extractGeosetMetadataPatch = (incomingGeoset: any): Record<string, unknown> => {
    const patch: Record<string, unknown> = {}
    for (const key of GEOSET_METADATA_MERGE_KEYS) {
        if (incomingGeoset && incomingGeoset[key] !== undefined) {
            patch[key] = incomingGeoset[key]
        }
    }
    return patch
}

export const mergeGeosetMetadata = (existingGeosets: any[] | undefined, incomingGeosets: any[] | undefined): any[] | undefined => {
    if (!Array.isArray(incomingGeosets)) return undefined
    if (!Array.isArray(existingGeosets) || existingGeosets.length === 0) {
        return incomingGeosets.map((geoset) => extractGeosetMetadataPatch(geoset))
    }

    const merged = existingGeosets.map((geoset) => geoset)
    incomingGeosets.forEach((incomingGeoset, fallbackIndex) => {
        const targetIndex = Number.isInteger(incomingGeoset?.index) ? incomingGeoset.index : fallbackIndex
        if (targetIndex < 0 || targetIndex >= merged.length) return
        const baseGeoset = merged[targetIndex]
        if (!baseGeoset) return
        merged[targetIndex] = {
            ...baseGeoset,
            ...extractGeosetMetadataPatch(incomingGeoset),
        }
    })
    return merged
}

export class ToolWindowSnapshotCache {
    private textureCache: SnapshotCache<TextureManagerSnapshot> = {
        snapshotVersion: 0,
        snapshot: EMPTY_TEXTURE_SNAPSHOT,
        sourceRefs: {},
    }

    private materialCache: SnapshotCache<MaterialManagerSnapshot> = {
        snapshotVersion: 0,
        snapshot: EMPTY_MATERIAL_SNAPSHOT,
        sourceRefs: {},
    }

    buildTextureManagerState(input: {
        modelData: any
        modelPath: string | null | undefined
        documentId: string | null
        documentRevision: number
        assetRevision: number
        previewRevision: number
        snapshotProjection: PreviewProjectionMode
        selection: ToolWindowSelectionState
        markPerf?: ToolWindowSnapshotPerf
    }): TextureManagerRpcState {
        const modelData = input.modelData
        const nextSourceRefs = {
            textures: modelData?.Textures ?? null,
            materials: modelData?.Materials ?? null,
            geosets: modelData?.Geosets ?? null,
            modelPath: input.modelPath,
            snapshotProjection: input.snapshotProjection,
        }

        if (this.hasSourceChanged(this.textureCache.sourceRefs, nextSourceRefs)) {
            this.textureCache.snapshotVersion += 1
            this.textureCache.sourceRefs = nextSourceRefs
            this.textureCache.snapshot = {
                textureSummaries: createTextureManagerTextureSummaries(modelData?.Textures),
                textures: [],
                materialSummaries: createTextureManagerMaterialSummaries(modelData?.Materials),
                materials: [],
                geosets: stripGeosetDataForToolWindow(modelData?.Geosets),
                modelPath: input.modelPath,
            }
            input.markPerf?.('texture_snapshot_cached', {
                snapshotVersion: this.textureCache.snapshotVersion,
                snapshotProjection: input.snapshotProjection,
                textureCount: this.textureCache.snapshot.textureSummaries.length,
                materialCount: this.textureCache.snapshot.materials.length,
                geosetCount: this.textureCache.snapshot.geosets.length,
            })
        }

        return {
            documentId: input.documentId,
            documentRevision: input.documentRevision,
            assetRevision: input.assetRevision,
            previewRevision: input.previewRevision,
            snapshotRevision: this.textureCache.snapshotVersion,
            snapshotProjection: input.snapshotProjection,
            windowId: 'textureManager',
            payload: this.textureCache.snapshot,
            snapshotVersion: this.textureCache.snapshotVersion,
            snapshot: this.textureCache.snapshot,
            pickedGeosetIndex: input.selection.pickedGeosetIndex ?? null,
            selectedMaterialIndex: input.selection.selectedMaterialIndex ?? null,
            selectedMaterialLayerIndex: input.selection.selectedMaterialLayerIndex ?? null,
        }
    }

    buildMaterialManagerState(input: {
        modelData: any
        modelPath: string | null | undefined
        documentId: string | null
        documentRevision: number
        assetRevision: number
        previewRevision: number
        snapshotProjection: PreviewProjectionMode
        selection: ToolWindowSelectionState
        markPerf?: ToolWindowSnapshotPerf
    }): MaterialManagerRpcState {
        const modelData = input.modelData
        const nextSourceRefs = {
            materials: modelData?.Materials ?? null,
            textures: modelData?.Textures ?? null,
            geosets: modelData?.Geosets ?? null,
            globalSequences: modelData?.GlobalSequences ?? null,
            sequences: modelData?.Sequences || null,
            textureAnims: modelData?.TextureAnims || null,
            modelPath: input.modelPath,
            snapshotProjection: input.snapshotProjection,
        }

        if (this.hasSourceChanged(this.materialCache.sourceRefs, nextSourceRefs)) {
            this.materialCache.snapshotVersion += 1
            this.materialCache.sourceRefs = nextSourceRefs
            this.materialCache.snapshot = {
                materialSummaries: createMaterialManagerMaterialSummaries(modelData?.Materials),
                materials: modelData?.Materials ?? [],
                textureSummaries: createMaterialManagerTextureSummaries(modelData?.Textures),
                textures: modelData?.Textures ?? [],
                geosets: stripGeosetDataForToolWindow(modelData?.Geosets),
                globalSequences: toGlobalSequenceDurations(modelData?.GlobalSequences),
                sequenceSummaries: createMaterialManagerSequenceSummaries(modelData?.Sequences),
                textureAnimSummaries: createMaterialManagerTextureAnimSummaries(modelData?.TextureAnims),
                sequences: [],
                textureAnims: [],
                modelPath: input.modelPath,
            }
            input.markPerf?.('material_snapshot_cached', {
                snapshotVersion: this.materialCache.snapshotVersion,
                snapshotProjection: input.snapshotProjection,
                materialCount: this.materialCache.snapshot.materials.length,
                materialSummaryCount: this.materialCache.snapshot.materialSummaries.length,
                textureCount: this.materialCache.snapshot.textures.length,
                textureSummaryCount: this.materialCache.snapshot.textureSummaries.length,
                sequenceSummaryCount: this.materialCache.snapshot.sequenceSummaries.length,
                textureAnimSummaryCount: this.materialCache.snapshot.textureAnimSummaries.length,
                geosetCount: this.materialCache.snapshot.geosets.length,
            })
        }

        return {
            documentId: input.documentId,
            documentRevision: input.documentRevision,
            assetRevision: input.assetRevision,
            previewRevision: input.previewRevision,
            snapshotRevision: this.materialCache.snapshotVersion,
            snapshotProjection: input.snapshotProjection,
            windowId: 'materialManager',
            payload: this.materialCache.snapshot,
            snapshotVersion: this.materialCache.snapshotVersion,
            snapshot: this.materialCache.snapshot,
            pickedGeosetIndex: input.selection.pickedGeosetIndex ?? null,
            selectedMaterialIndex: input.selection.selectedMaterialIndex ?? null,
            selectedMaterialLayerIndex: input.selection.selectedMaterialLayerIndex ?? null,
        }
    }

    private hasSourceChanged(previous: Record<string, unknown>, next: Record<string, unknown>): boolean {
        return Object.keys(next).some((key) => previous[key] !== next[key])
    }
}
