import { Command } from '../utils/CommandManager'
import { deleteVertices, DeleteResult } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelResourceManager } from 'war3-model'

interface VertexSelection {
    geosetIndex: number
    index: number
}

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
        this.originalGeosetSnapshot = {
            Vertices: new Float32Array(geoset.Vertices),
            Normals: new Float32Array(geoset.Normals),
            VertexGroup: new Uint8Array(geoset.VertexGroup),
            Faces: new Uint16Array(geoset.Faces),
            TVertices: geoset.TVertices.map((tv: Float32Array) => new Float32Array(tv))
        }

        // Get vertex indices
        const vertexIndices = this.selections.map(s => s.index)

        // Perform delete
        this.deleteResult = deleteVertices(geoset, vertexIndices)

        // Update geoset
        Object.assign(geoset, this.deleteResult.updatedGeoset)        // Rebuild GPU Buffers
        ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.geosetIndex)        // Clear selection
        useSelectionStore.getState().selectVertices([])

        // Sync to store
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetSnapshot) return

        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (geoset) {
            Object.assign(geoset, this.originalGeosetSnapshot)
        }

        // Rebuild GPU Buffers
        ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.geosetIndex)        // Sync to store
        this.syncToStore()
    }

    private syncToStore(): void {
        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (geoset) {
            useModelStore.getState().updateGeoset(this.geosetIndex, {
                Vertices: Array.from(geoset.Vertices),
                Normals: Array.from(geoset.Normals),
                VertexGroup: Array.from(geoset.VertexGroup),
                Faces: Array.from(geoset.Faces),
                TVertices: geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
            })
            // REMOVED triggerRendererReload - trusting command to have updated live renderer
        }
    }
}
