import { Command } from '../utils/CommandManager'
import { pasteVertices, VertexCopyBuffer } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'

/**
 * Command to paste copied vertices/polygons as a new geoset
 * Supports Undo/Redo through CommandManager
 */
export class PasteVerticesCommand implements Command {
    private renderer: any
    private buffer: VertexCopyBuffer
    private createNewGeoset: boolean
    private newGeosetIndex: number = -1
    private pastedVertexStartIndex: number = -1
    private originalGeosetSnapshot: any = null
    private targetGeosetIndex: number

    constructor(
        renderer: any,
        buffer: VertexCopyBuffer,
        createNewGeoset: boolean = true
    ) {
        this.renderer = renderer
        this.buffer = buffer
        this.createNewGeoset = createNewGeoset
        this.targetGeosetIndex = buffer.sourceGeosetIndex
    }

    execute(): void {
        if (this.createNewGeoset) {
            this.executeAsNewGeoset()
        } else {
            this.executeToExisting()
        }
    }

    private executeAsNewGeoset(): void {
        const sourceGeoset = this.renderer.model.Geosets[this.buffer.sourceGeosetIndex]
        if (!sourceGeoset) return

        // Create new geoset from buffer with offset
        const offsetX = 10
        const newVertices: number[] = []
        for (let i = 0; i < this.buffer.vertices.length; i += 3) {
            newVertices.push(
                this.buffer.vertices[i] + offsetX,
                this.buffer.vertices[i + 1],
                this.buffer.vertices[i + 2]
            )
        }

        // Create geoset for renderer (TypedArrays)
        const rendererGeoset = {
            Vertices: new Float32Array(newVertices),
            Normals: new Float32Array(this.buffer.normals),
            VertexGroup: new Uint8Array(this.buffer.vertexGroups),
            Faces: new Uint16Array(this.buffer.faces),
            TVertices: this.buffer.tVertices.map(tv => new Float32Array(tv)),
            MaterialID: sourceGeoset.MaterialID || 0,
            SelectionGroup: sourceGeoset.SelectionGroup || 0,
            Unselectable: sourceGeoset.Unselectable || false,
            Groups: this.buffer.groups,
            MinimumExtent: sourceGeoset.MinimumExtent || [0, 0, 0],
            MaximumExtent: sourceGeoset.MaximumExtent || [0, 0, 0],
            BoundsRadius: sourceGeoset.BoundsRadius || 0
        }

        // Debug: Validate buffer data
        console.log('[PasteVerticesCommand] Buffer data:', {
            verticesLength: this.buffer.vertices.length,
            vertexCount: this.buffer.vertices.length / 3,
            facesLength: this.buffer.faces.length,
            faceCount: this.buffer.faces.length / 3,
            normalsLength: this.buffer.normals.length,
            tVerticesLayers: this.buffer.tVertices.length,
            groupsCount: this.buffer.groups?.length,
            sourceGeosetIndex: this.buffer.sourceGeosetIndex
        })

        // Debug: Validate rendererGeoset data
        console.log('[PasteVerticesCommand] rendererGeoset data:', {
            VerticesType: rendererGeoset.Vertices.constructor.name,
            VerticesLength: rendererGeoset.Vertices.length,
            FacesType: rendererGeoset.Faces.constructor.name,
            FacesLength: rendererGeoset.Faces.length,
            FacesFirst3: Array.from(rendererGeoset.Faces.slice(0, 3))
        })

        // Add to renderer model
        this.renderer.model.Geosets.push(rendererGeoset)
        this.newGeosetIndex = this.renderer.model.Geosets.length - 1

        console.log('[PasteVerticesCommand] Created new geoset at index', this.newGeosetIndex,
            'Total geosets:', this.renderer.model.Geosets.length)

        // Create geoset for store (plain arrays)
        const storeGeoset = {
            Vertices: newVertices,
            Normals: this.buffer.normals,
            VertexGroup: this.buffer.vertexGroups,
            Faces: this.buffer.faces,
            TVertices: this.buffer.tVertices,
            MaterialID: sourceGeoset.MaterialID || 0,
            SelectionGroup: sourceGeoset.SelectionGroup || 0,
            Unselectable: sourceGeoset.Unselectable || false,
            Groups: this.buffer.groups,
            MinimumExtent: sourceGeoset.MinimumExtent || [0, 0, 0],
            MaximumExtent: sourceGeoset.MaximumExtent || [0, 0, 0],
            BoundsRadius: sourceGeoset.BoundsRadius || 0
        }

        // Add to store
        const modelStore = useModelStore.getState()
        if (modelStore.modelData && modelStore.modelData.Geosets) {
            (modelStore.modelData.Geosets as any[]).push(storeGeoset)
        }

        // Force full renderer reload to rebuild GPU buffers
        // This is needed because we added to both renderer and store, 
        // so checkForStructuralChanges won't detect a difference
        if (this.renderer.reload) {
            this.renderer.reload()
            console.log('[PasteVerticesCommand] Called renderer.reload() to rebuild GPU buffers')
        }

        // Select new vertices
        this.selectNewVertices()
    }

    private executeToExisting(): void {
        const geoset = this.renderer.model.Geosets[this.targetGeosetIndex]
        if (!geoset) return

        // Save original for undo
        this.originalGeosetSnapshot = {
            Vertices: new Float32Array(geoset.Vertices),
            Normals: new Float32Array(geoset.Normals),
            VertexGroup: new Uint8Array(geoset.VertexGroup),
            Faces: new Uint16Array(geoset.Faces),
            TVertices: geoset.TVertices.map((tv: Float32Array) => new Float32Array(tv))
        }

        const result = pasteVertices(geoset, this.buffer, [10, 0, 0])
        Object.assign(geoset, result.updatedGeoset)
        this.pastedVertexStartIndex = result.newVertexStartIndex

        console.log('[PasteVerticesCommand] Pasted to existing geoset, starting at index', this.pastedVertexStartIndex)

        // Sync to store
        useModelStore.getState().updateGeoset(this.targetGeosetIndex, {
            Vertices: Array.from(geoset.Vertices),
            Normals: Array.from(geoset.Normals),
            VertexGroup: Array.from(geoset.VertexGroup),
            Faces: Array.from(geoset.Faces),
            TVertices: geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
        })
        useModelStore.getState().triggerRendererReload()

        // Select new vertices
        const newVertexCount = this.buffer.vertices.length / 3
        const newSelections = []
        for (let i = 0; i < newVertexCount; i++) {
            newSelections.push({ geosetIndex: this.targetGeosetIndex, index: this.pastedVertexStartIndex + i })
        }
        useSelectionStore.getState().selectVertices(newSelections)
    }

    private selectNewVertices(): void {
        const newVertexCount = this.buffer.vertices.length / 3
        const newSelections = []
        const geosetIndex = this.createNewGeoset ? this.newGeosetIndex : this.targetGeosetIndex
        const startIndex = this.createNewGeoset ? 0 : this.pastedVertexStartIndex

        for (let i = 0; i < newVertexCount; i++) {
            newSelections.push({ geosetIndex, index: startIndex + i })
        }
        useSelectionStore.getState().selectVertices(newSelections)
    }

    undo(): void {
        if (this.createNewGeoset && this.newGeosetIndex >= 0) {
            // Remove the new geoset
            this.renderer.model.Geosets.splice(this.newGeosetIndex, 1)

            // Also remove from store
            const modelStore = useModelStore.getState()
            if (modelStore.modelData && modelStore.modelData.Geosets) {
                modelStore.modelData.Geosets.splice(this.newGeosetIndex, 1)
            }

            // Force renderer reload
            if (this.renderer.reload) {
                this.renderer.reload()
            }
            useSelectionStore.getState().selectVertices([])
        } else if (!this.createNewGeoset && this.originalGeosetSnapshot) {
            // Restore original geoset
            const geoset = this.renderer.model.Geosets[this.targetGeosetIndex]
            if (geoset) {
                Object.assign(geoset, this.originalGeosetSnapshot)
            }

            useModelStore.getState().updateGeoset(this.targetGeosetIndex, {
                Vertices: Array.from(geoset.Vertices),
                Normals: Array.from(geoset.Normals),
                VertexGroup: Array.from(geoset.VertexGroup),
                Faces: Array.from(geoset.Faces),
                TVertices: geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
            })
            // Force renderer reload
            if (this.renderer.reload) {
                this.renderer.reload()
            }
            useSelectionStore.getState().selectVertices([])
        }
    }
}
