import { Command } from '../utils/CommandManager'
import { splitVertices, SplitResult } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelResourceManager } from 'war3-model'

interface VertexSelection {
    geosetIndex: number
    index: number
}

/**
 * Command to split vertices and their faces into a new geoset
 * Supports Undo/Redo through CommandManager
 */
export class SplitVerticesCommand implements Command {
    private renderer: any
    private selections: VertexSelection[]
    private geosetIndex: number
    private splitResult: SplitResult | null = null
    private originalGeosetSnapshot: any = null
    private newGeosetIndex: number = -1

    constructor(renderer: any, selections: VertexSelection[]) {
        this.renderer = renderer
        this.selections = selections

        // All selections should be from the same geoset for split
        if (selections.length > 0) {
            this.geosetIndex = selections[0].geosetIndex
        } else {
            this.geosetIndex = -1
        }
    }

    execute(): void {
        if (this.selections.length < 1 || this.geosetIndex < 0) {
            console.warn('[SplitVerticesCommand] Need at least 1 vertex selected')
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
            TVertices: geoset.TVertices.map((tv: Float32Array) => new Float32Array(tv)),
            MaterialID: geoset.MaterialID
        }

        // Get vertex indices
        const vertexIndices = this.selections.map(s => s.index)

        // Perform split
        this.splitResult = splitVertices(geoset, vertexIndices, geoset.MaterialID || 0)

        if (!this.splitResult.extractedFaceIndices.length) {
            console.warn('[SplitVerticesCommand] No faces to extract')
            return
        }

        // Debug: log what splitResult contains
        console.log('[SplitVerticesCommand] splitResult.newGeoset:', {
            hasVertices: !!this.splitResult.newGeoset.Vertices,
            verticesLength: this.splitResult.newGeoset.Vertices?.length,
            vertexCount: this.splitResult.newGeoset.Vertices?.length / 3,
            hasFaces: !!this.splitResult.newGeoset.Faces,
            facesLength: this.splitResult.newGeoset.Faces?.length,
            faceCount: this.splitResult.newGeoset.Faces?.length / 3,
            hasNormals: !!this.splitResult.newGeoset.Normals,
            hasTVertices: !!this.splitResult.newGeoset.TVertices,
            tVerticesLayers: this.splitResult.newGeoset.TVertices?.length
        })

        // Update original geoset with remaining geometry (faces removed)
        if (Object.keys(this.splitResult.updatedOriginalGeoset).length > 0) {
            Object.assign(geoset, this.splitResult.updatedOriginalGeoset)
            // Rebuild GPU buffers for modified original geoset
            ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.geosetIndex)
            console.log('[SplitVerticesCommand] Updated original geoset, rebuilt GPU buffers')
        }

        // Add new geoset to model
        const newGeoset = {
            ...this.splitResult.newGeoset,
            MaterialID: geoset.MaterialID || 0,
            SelectionGroup: geoset.SelectionGroup || 0,
            Unselectable: geoset.Unselectable || false,
            Groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]],
            MinimumExtent: geoset.MinimumExtent || [0, 0, 0],
            MaximumExtent: geoset.MaximumExtent || [0, 0, 0],
            BoundsRadius: geoset.BoundsRadius || 0
        }

        // Debug: log the new geoset that will be added
        console.log('[SplitVerticesCommand] Adding newGeoset to renderer:', {
            vertexCount: (newGeoset as any).Vertices?.length / 3,
            faceCount: (newGeoset as any).Faces?.length / 3,
            MaterialID: newGeoset.MaterialID,
            Groups: newGeoset.Groups?.length
        })

        this.renderer.model.Geosets.push(newGeoset)
        this.newGeosetIndex = this.renderer.model.Geosets.length - 1

        console.log('[SplitVerticesCommand] Created new geoset at index', this.newGeosetIndex,
            'Total geosets now:', this.renderer.model.Geosets.length)

        // Create GPU buffers for the new geoset
        ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.newGeosetIndex)

        // Clear selection
        useSelectionStore.getState().selectVertices([])

        // Sync to store
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetSnapshot || this.newGeosetIndex < 0) return

        // Restore original geoset
        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (geoset) {
            Object.assign(geoset, this.originalGeosetSnapshot)
        }

        // Remove the new geoset
        this.renderer.model.Geosets.splice(this.newGeosetIndex, 1)

        // Rebuild GPU buffers for the restored original geoset
        ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.geosetIndex)
        console.log('[SplitVerticesCommand] Undo: Restored old geoset and rebuilt buffers')

        // Sync to store and trigger reload
        this.syncToStore()
    }

    private syncToStore(): void {
        const modelStore = useModelStore.getState()
        const geosets = this.renderer.model.Geosets
        const currentPath = modelStore.modelPath || ''

        // Use setModelData - ensure Groups is explicitly included
        modelStore.setModelData({
            ...modelStore.modelData!,
            Geosets: geosets.map((g: any) => ({
                ...g,
                Vertices: Array.from(g.Vertices),
                Normals: Array.from(g.Normals),
                VertexGroup: Array.from(g.VertexGroup),
                Faces: Array.from(g.Faces),
                TVertices: g.TVertices.map((tv: Float32Array) => Array.from(tv)),
                Groups: g.Groups ? JSON.parse(JSON.stringify(g.Groups)) : [[0]]
            }))
        }, currentPath)

        // Force renderer reload to rebuild GPU buffers
        if (this.renderer.reload) {
            this.renderer.reload()
            console.log('[SplitVerticesCommand] Called renderer.reload() to rebuild GPU buffers')
        }
    }
}
