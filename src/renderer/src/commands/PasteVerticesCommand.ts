import { Command } from '../utils/CommandManager'
import { pasteVertices, VertexCopyBuffer } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelResourceManager } from 'war3-model'

/**
 * Command to paste copied vertices/polygons as a new geoset
 * Supports Undo/Redo through CommandManager
 */
export class PasteVerticesCommand implements Command {
    private renderer: any
    private buffer: VertexCopyBuffer
    private createNewGeoset: boolean
    private offset: [number, number, number]
    private newGeosetIndex: number = -1
    private pastedVertexStartIndex: number = -1
    private pastedFaceStartIndex: number = -1
    private originalGeosetSnapshot: any = null
    private targetGeosetIndex: number
    private selectionMode: 'vertex' | 'face'

    constructor(
        renderer: any,
        buffer: VertexCopyBuffer,
        createNewGeoset: boolean = true,
        offset: [number, number, number] = [10, 0, 0],
        selectionMode: 'vertex' | 'face' = 'vertex'
    ) {
        this.renderer = renderer
        this.buffer = buffer
        this.createNewGeoset = createNewGeoset
        this.offset = offset
        this.targetGeosetIndex = buffer.sourceGeosetIndex
        this.selectionMode = selectionMode
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
        const newVertices: number[] = []
        for (let i = 0; i < this.buffer.vertices.length; i += 3) {
            newVertices.push(
                this.buffer.vertices[i] + this.offset[0],
                this.buffer.vertices[i + 1] + this.offset[1],
                this.buffer.vertices[i + 2] + this.offset[2]
            )
        }

        // Create geoset for renderer (TypedArrays)
        // Calculate TotalGroupsCount (sum of all group lengths)
        const totalGroupsCount = this.buffer.groups?.reduce((sum, g) => sum + g.length, 0) || 1

        const rendererGeoset = {
            Vertices: new Float32Array(newVertices),
            Normals: new Float32Array(this.buffer.normals),
            VertexGroup: new Uint8Array(this.buffer.vertexGroups),
            Faces: new Uint16Array(this.buffer.faces),
            TVertices: this.buffer.tVertices.map(tv => new Float32Array(tv)),
            MaterialID: sourceGeoset.MaterialID || 0,
            SelectionGroup: sourceGeoset.SelectionGroup || 0,
            Unselectable: sourceGeoset.Unselectable || false,
            Groups: this.buffer.groups || [[0]],
            TotalGroupsCount: totalGroupsCount,
            Anims: [], // Required for MDX export - empty array for new geosets
            MinimumExtent: sourceGeoset.MinimumExtent || new Float32Array([0, 0, 0]),
            MaximumExtent: sourceGeoset.MaximumExtent || new Float32Array([0, 0, 0]),
            BoundsRadius: sourceGeoset.BoundsRadius || 0
        }

        // Add to renderer model
        this.renderer.model.Geosets.push(rendererGeoset)
        this.newGeosetIndex = this.renderer.model.Geosets.length - 1

        // Create GPU buffers for the new geoset
        ModelResourceManager.getInstance().addGeosetBuffers(this.renderer.model, this.newGeosetIndex)

        // NOTE: We intentionally do NOT add to modelStore here to avoid sync conflicts.
        // The renderer.model.Geosets is the source of truth for geometry operations.
        // Export functions will use renderer.model directly.

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
        this.pastedFaceStartIndex = result.newFaceStartIndex


        // Sync to store
        useModelStore.getState().updateGeoset(this.targetGeosetIndex, {
            Vertices: Array.from(geoset.Vertices),
            Normals: Array.from(geoset.Normals),
            VertexGroup: Array.from(geoset.VertexGroup),
            Faces: Array.from(geoset.Faces),
            TVertices: geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
        })
        useModelStore.getState().triggerRendererReload()

        // Select new elements
        this.selectNewVertices()
    }

    private selectNewVertices(): void {
        const newSelections = []
        const geosetIndex = this.createNewGeoset ? this.newGeosetIndex : this.targetGeosetIndex

        if (this.selectionMode === 'vertex') {
            const newVertexCount = this.buffer.vertices.length / 3
            const startIndex = this.createNewGeoset ? 0 : this.pastedVertexStartIndex
            for (let i = 0; i < newVertexCount; i++) {
                newSelections.push({ geosetIndex, index: startIndex + i })
            }
            useSelectionStore.getState().selectVertices(newSelections)
        } else {
            // Face Mode
            const newFaceCount = this.buffer.faces.length / 3
            const startIndex = this.createNewGeoset ? 0 : this.pastedFaceStartIndex
            for (let i = 0; i < newFaceCount; i++) {
                newSelections.push({ geosetIndex, index: startIndex + i })
            }
            useSelectionStore.getState().selectFaces(newSelections)

            // Also update vertex selection to match the faces (standard behavior in face mode?)
            // Usually face mode implies vertex selection too, OR we just select faces.
            // Let's just select faces as requested.
        }
    }

    undo(): void {
        if (this.createNewGeoset && this.newGeosetIndex >= 0) {
            // Remove the new geoset from renderer
            this.renderer.model.Geosets.splice(this.newGeosetIndex, 1)

            // NOTE: We did NOT add to store in execute(), so don't remove from store here.
            // Also, do NOT call renderer.reload() as it would reload from store and cause issues.

            // Clear GPU buffers for the removed geoset would be ideal, but WebGL handles this okay
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
