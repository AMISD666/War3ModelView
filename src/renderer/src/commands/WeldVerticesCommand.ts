import { Command } from '../utils/CommandManager'
import { weldVertices, WeldResult } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'

interface VertexSelection {
    geosetIndex: number
    index: number
}

/**
 * Command to weld vertices - moves them to their center point
 * Does NOT modify UV or delete vertices, just changes positions
 * Supports Undo/Redo through CommandManager
 */
export class WeldVerticesCommand implements Command {
    private renderer: any
    private selections: VertexSelection[]
    private geosetIndex: number
    private oldPositions: Map<number, [number, number, number]> = new Map()
    private weldResult: WeldResult | null = null

    constructor(renderer: any, selections: VertexSelection[]) {
        this.renderer = renderer
        this.selections = selections

        // All selections must be from the same geoset
        if (selections.length > 0) {
            this.geosetIndex = selections[0].geosetIndex
            const allSameGeoset = selections.every(s => s.geosetIndex === this.geosetIndex)
            if (!allSameGeoset) {
                console.warn('[WeldVerticesCommand] All vertices must be from the same geoset')
            }
        } else {
            this.geosetIndex = -1
        }
    }

    execute(): void {
        if (this.selections.length < 2 || this.geosetIndex < 0) {
            console.warn('[WeldVerticesCommand] Need at least 2 vertices from the same geoset')
            return
        }

        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (!geoset) return

        // Save old positions for undo
        for (const sel of this.selections) {
            const idx = sel.index
            this.oldPositions.set(idx, [
                geoset.Vertices[idx * 3],
                geoset.Vertices[idx * 3 + 1],
                geoset.Vertices[idx * 3 + 2]
            ])
        }

        // Perform weld
        const vertexIndices = this.selections.map(s => s.index)
        this.weldResult = weldVertices(geoset, vertexIndices)

        // Apply to geoset (only updates Vertices)
        if (this.weldResult.updatedGeoset.Vertices) {
            geoset.Vertices = this.weldResult.updatedGeoset.Vertices
        }        // Update GPU buffer
        if (this.renderer.updateGeosetVertices) {
            this.renderer.updateGeosetVertices(this.geosetIndex, geoset.Vertices)
        }

        // Sync to store
        this.syncToStore()
    }

    undo(): void {
        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (!geoset) return

        // Restore old positions
        for (const [idx, pos] of this.oldPositions) {
            geoset.Vertices[idx * 3] = pos[0]
            geoset.Vertices[idx * 3 + 1] = pos[1]
            geoset.Vertices[idx * 3 + 2] = pos[2]
        }

        // Update GPU buffer
        if (this.renderer.updateGeosetVertices) {
            this.renderer.updateGeosetVertices(this.geosetIndex, geoset.Vertices)
        }

        // Sync to store
        this.syncToStore()
    }

    private syncToStore(): void {
        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (geoset) {
            useModelStore.getState().updateGeoset(this.geosetIndex, {
                Vertices: Array.from(geoset.Vertices)
            })
        }
    }
}
