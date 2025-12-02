import { Command } from '../utils/CommandManager'

export interface VertexChange {
    geosetIndex: number
    vertexIndex: number
    oldPos: [number, number, number]
    newPos: [number, number, number]
}

export class MoveVerticesCommand implements Command {
    constructor(
        private renderer: any,
        private changes: VertexChange[]
    ) { }

    execute() {
        this.applyChanges(true)
    }

    undo() {
        this.applyChanges(false)
    }

    private applyChanges(useNew: boolean) {
        const affectedGeosets = new Set<number>()

        for (const change of this.changes) {
            const geoset = this.renderer.model.Geosets[change.geosetIndex]
            if (!geoset) continue

            const vIndex = change.vertexIndex * 3
            const pos = useNew ? change.newPos : change.oldPos

            geoset.Vertices[vIndex] = pos[0]
            geoset.Vertices[vIndex + 1] = pos[1]
            geoset.Vertices[vIndex + 2] = pos[2]

            affectedGeosets.add(change.geosetIndex)
        }

        for (const geoIndex of affectedGeosets) {
            const geoset = this.renderer.model.Geosets[geoIndex]
            if (this.renderer.updateGeosetVertices) {
                this.renderer.updateGeosetVertices(geoIndex, geoset.Vertices)
            }
        }
    }
}
