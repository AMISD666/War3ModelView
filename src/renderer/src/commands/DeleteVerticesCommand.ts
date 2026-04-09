import { Command } from '../utils/CommandManager'
import { deleteVertices, DeleteResult } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelResourceManager } from 'war3-model'

interface VertexSelection {
    geosetIndex: number
    index: number
}

const cloneTypedArray = <T extends ArrayLike<number>>(value: T | undefined | null): T | null => {
    if (!value) return null
    const Ctor = (value as any).constructor
    return new Ctor(value) as T
}

const cloneGeosetSnapshot = (geoset: any) => ({
    ...geoset,
    Vertices: cloneTypedArray(geoset?.Vertices) ?? new Float32Array(),
    Normals: cloneTypedArray(geoset?.Normals) ?? new Float32Array(),
    VertexGroup: cloneTypedArray(geoset?.VertexGroup) ?? new Uint8Array(),
    Faces: cloneTypedArray(geoset?.Faces) ?? new Uint16Array(),
    TVertices: Array.isArray(geoset?.TVertices)
        ? geoset.TVertices.map((tv: Float32Array | number[]) => cloneTypedArray(tv) ?? new Float32Array())
        : [],
    Tangents: cloneTypedArray(geoset?.Tangents),
    SkinWeights: cloneTypedArray(geoset?.SkinWeights),
    Groups: geoset?.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]],
    MinimumExtent: Array.isArray(geoset?.MinimumExtent) ? [...geoset.MinimumExtent] : geoset?.MinimumExtent,
    MaximumExtent: Array.isArray(geoset?.MaximumExtent) ? [...geoset.MaximumExtent] : geoset?.MaximumExtent,
    Anims: geoset?.Anims ? JSON.parse(JSON.stringify(geoset.Anims)) : geoset?.Anims
})

/**
 * Command to delete vertices and their faces
 * Supports Undo/Redo through CommandManager
 */
export class DeleteVerticesCommand implements Command {
    private renderer: any
    private selections: VertexSelection[]
    private geosetIndex: number
    private originalGeosetSnapshot: any = null
    private deleteResult: DeleteResult | null = null
    private removedGeoset = false

    constructor(renderer: any, selections: VertexSelection[]) {
        this.renderer = renderer
        this.selections = selections

        // All selections should be from the same geoset
        if (selections.length > 0) {
            this.geosetIndex = selections[0].geosetIndex
        } else {
            this.geosetIndex = -1
        }
    }

    execute(): void {
        if (this.selections.length < 1 || this.geosetIndex < 0) {
            console.warn('[DeleteVerticesCommand] Need at least 1 vertex selected')
            return
        }

        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (!geoset) return

        // Save original geoset snapshot for undo
        this.originalGeosetSnapshot = cloneGeosetSnapshot(geoset)

        // Get vertex indices
        const vertexIndices = this.selections.map(s => s.index)

        // Perform delete
        this.deleteResult = deleteVertices(geoset, vertexIndices)

        const shouldRemoveGeoset =
            (this.deleteResult.updatedGeoset.Vertices?.length || 0) === 0 ||
            (this.deleteResult.updatedGeoset.Faces?.length || 0) === 0

        if (shouldRemoveGeoset) {
            this.renderer.model.Geosets.splice(this.geosetIndex, 1)
            this.removedGeoset = true
        } else {
            Object.assign(geoset, this.deleteResult.updatedGeoset)
            ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.geosetIndex)
            this.removedGeoset = false
        }

        useSelectionStore.getState().selectVertices([])

        // Sync to store
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetSnapshot) return

        if (this.removedGeoset) {
            this.renderer.model.Geosets.splice(this.geosetIndex, 0, cloneGeosetSnapshot(this.originalGeosetSnapshot))
        } else {
            const geoset = this.renderer.model.Geosets[this.geosetIndex]
            if (geoset) {
                Object.assign(geoset, cloneGeosetSnapshot(this.originalGeosetSnapshot))
            }
        }

        ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.geosetIndex)

        this.syncToStore()
    }

    private syncToStore(): void {
        const nextGeosets = this.renderer.model.Geosets.map((geoset: any) => ({
            ...geoset,
            Vertices: Array.from(geoset.Vertices || []),
            Normals: Array.from(geoset.Normals || []),
            VertexGroup: Array.from(geoset.VertexGroup || []),
            Faces: Array.from(geoset.Faces || []),
            TVertices: Array.isArray(geoset.TVertices)
                ? geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
                : [],
            Groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]]
        }))

        useModelStore.getState().setGeosets(nextGeosets)
    }
}
