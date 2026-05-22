import { addWar3GeosetBuffers, rebuildWar3GeosetBuffers } from '../infrastructure/render'
import { syncRendererGeosetBuffers } from '../application/render'
import { modelDocumentCommandHandler } from '../application/commands'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { Command } from '../utils/CommandManager'
import { deleteFaces, DeleteFacesResult } from '../utils/vertexOperations'
import {
    cloneGeosetAnims,
    remapGeosetAnimsAfterRemovingGeosets,
    syncRendererGeosetAnims
} from './geosetAnimRemap'

interface FaceSelection {
    geosetIndex: number
    index: number
}

const cloneDeep = <T>(value: T): T => {
    if (ArrayBuffer.isView(value)) {
        const Ctor = (value as any).constructor
        return new Ctor(value as any) as T
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneDeep(item)) as T
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, any>).map(([key, nestedValue]) => [key, cloneDeep(nestedValue)])
        ) as T
    }
    return value
}

const toStoreGeoset = (geoset: any) => ({
    ...geoset,
    Vertices: Array.from(geoset.Vertices || []),
    Normals: Array.from(geoset.Normals || []),
    VertexGroup: Array.from(geoset.VertexGroup || []),
    Faces: Array.from(geoset.Faces || []),
    TVertices: Array.isArray(geoset.TVertices)
        ? geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
        : [],
    Tangents: geoset.Tangents ? Array.from(geoset.Tangents) : geoset.Tangents,
    SkinWeights: geoset.SkinWeights ? Array.from(geoset.SkinWeights) : geoset.SkinWeights,
    Groups: geoset.Groups ? cloneDeep(geoset.Groups) : [[0]]
})

/**
 * Command to delete selected faces and prune vertices no remaining face uses.
 * Supports face mode and group mode selections.
 */
export class DeleteFacesCommand implements Command {
    name = 'Delete Faces'

    private originalGeosetsSnapshot: any[] | null = null
    private originalGeosetAnimsSnapshot: any[] | null = null
    private deleteResults: DeleteFacesResult[] = []

    constructor(
        private readonly renderer: any,
        private readonly selections: FaceSelection[]
    ) { }

    execute(): void {
        if (!this.renderer?.model?.Geosets || this.selections.length < 1) {
            console.warn('[DeleteFacesCommand] Need at least 1 face selected')
            return
        }

        this.originalGeosetsSnapshot = this.renderer.model.Geosets.map((geoset: any) => cloneDeep(geoset))
        this.originalGeosetAnimsSnapshot = cloneGeosetAnims(this.getCurrentGeosetAnims())
        this.deleteResults = []

        const selectionsByGeoset = new Map<number, number[]>()
        this.selections.forEach((selection) => {
            if (selection.geosetIndex < 0 || selection.index < 0) return
            const faces = selectionsByGeoset.get(selection.geosetIndex) ?? []
            faces.push(selection.index)
            selectionsByGeoset.set(selection.geosetIndex, faces)
        })

        const geosetIndices = Array.from(selectionsByGeoset.keys()).sort((a, b) => b - a)
        const removedGeosetIndices: number[] = []
        for (const geosetIndex of geosetIndices) {
            const geoset = this.renderer.model.Geosets[geosetIndex]
            if (!geoset) continue

            const result = deleteFaces(geoset, selectionsByGeoset.get(geosetIndex) ?? [])
            this.deleteResults.push(result)

            const shouldRemoveGeoset =
                (result.updatedGeoset.Vertices?.length || 0) === 0 ||
                (result.updatedGeoset.Faces?.length || 0) === 0

            if (shouldRemoveGeoset) {
                this.renderer.model.Geosets.splice(geosetIndex, 1)
                removedGeosetIndices.push(geosetIndex)
            } else {
                Object.assign(geoset, result.updatedGeoset)
                addWar3GeosetBuffers(this.renderer.model, geosetIndex)
                syncRendererGeosetBuffers(this.renderer, [geosetIndex], {
                    vertices: true,
                    normals: true,
                    texCoords: true,
                    groups: true,
                })
            }
        }

        if (removedGeosetIndices.length > 0) {
            rebuildWar3GeosetBuffers(this.renderer)

            const nextGeosetAnims = remapGeosetAnimsAfterRemovingGeosets(
                this.originalGeosetAnimsSnapshot,
                removedGeosetIndices
            )
            syncRendererGeosetAnims(this.renderer, nextGeosetAnims)
        }

        useSelectionStore.getState().selectFaces([])
        useSelectionStore.getState().selectVertices([])
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetsSnapshot) return

        this.renderer.model.Geosets = this.originalGeosetsSnapshot.map((geoset) => cloneDeep(geoset))
        rebuildWar3GeosetBuffers(this.renderer)
        this.renderer.model.Geosets.forEach((_geoset: any, index: number) => {
            syncRendererGeosetBuffers(this.renderer, [index], {
                vertices: true,
                normals: true,
                texCoords: true,
                groups: true,
            })
        })
        if (this.originalGeosetAnimsSnapshot) {
            syncRendererGeosetAnims(this.renderer, this.originalGeosetAnimsSnapshot)
        }
        useSelectionStore.getState().selectFaces([])
        useSelectionStore.getState().selectVertices([])
        this.syncToStore()
    }

    private getCurrentGeosetAnims(): any[] {
        if (Array.isArray(this.renderer?.model?.GeosetAnims)) {
            return this.renderer.model.GeosetAnims
        }
        return useModelStore.getState().modelData?.GeosetAnims ?? []
    }

    private syncToStore(): void {
        const modelState = useModelStore.getState()
        const before = modelState.modelData?.Geosets ?? []
        const after = this.renderer.model.Geosets.map(toStoreGeoset)
        modelDocumentCommandHandler.replaceGeosetList({
            name: 'Delete Faces: Sync Geosets',
            before,
            after,
            options: { recordHistory: false },
        })
        modelDocumentCommandHandler.replaceGeosetAnimationList({
            name: 'Delete Faces: Sync Geoset Animations',
            before: modelState.modelData?.GeosetAnims ?? [],
            after: cloneGeosetAnims(this.getCurrentGeosetAnims()),
            options: { recordHistory: false },
        })
    }
}
