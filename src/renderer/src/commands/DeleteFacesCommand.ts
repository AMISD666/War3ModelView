import { ModelResourceManager } from 'war3-model'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { Command } from '../utils/CommandManager'
import { deleteFaces, DeleteFacesResult } from '../utils/vertexOperations'

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
        this.deleteResults = []

        const selectionsByGeoset = new Map<number, number[]>()
        this.selections.forEach((selection) => {
            if (selection.geosetIndex < 0 || selection.index < 0) return
            const faces = selectionsByGeoset.get(selection.geosetIndex) ?? []
            faces.push(selection.index)
            selectionsByGeoset.set(selection.geosetIndex, faces)
        })

        const geosetIndices = Array.from(selectionsByGeoset.keys()).sort((a, b) => b - a)
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
            } else {
                Object.assign(geoset, result.updatedGeoset)
                ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, geosetIndex)
            }
        }

        useSelectionStore.getState().selectFaces([])
        useSelectionStore.getState().selectVertices([])
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetsSnapshot) return

        this.renderer.model.Geosets = this.originalGeosetsSnapshot.map((geoset) => cloneDeep(geoset))
        this.renderer.model.Geosets.forEach((_geoset: any, index: number) => {
            ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, index)
        })
        useSelectionStore.getState().selectFaces([])
        useSelectionStore.getState().selectVertices([])
        this.syncToStore()
    }

    private syncToStore(): void {
        useModelStore.getState().setGeosets(this.renderer.model.Geosets.map(toStoreGeoset))
    }
}
