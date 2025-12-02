import { Command } from '../utils/CommandManager'

export interface NodeChange {
    nodeId: number
    oldPivot: [number, number, number]
    newPivot: [number, number, number]
}

export class MoveNodesCommand implements Command {
    constructor(
        private renderer: any,
        private changes: NodeChange[]
    ) { }

    execute() {
        this.applyChanges(true)
    }

    undo() {
        this.applyChanges(false)
    }

    private applyChanges(useNew: boolean) {
        if (!this.renderer || !this.renderer.rendererData || !this.renderer.rendererData.nodes) return

        for (const change of this.changes) {
            const nodeWrapper = this.renderer.rendererData.nodes.find((n: any) => n.node.ObjectId === change.nodeId)
            if (!nodeWrapper || !nodeWrapper.node.PivotPoint) continue

            const pivot = useNew ? change.newPivot : change.oldPivot

            nodeWrapper.node.PivotPoint[0] = pivot[0]
            nodeWrapper.node.PivotPoint[1] = pivot[1]
            nodeWrapper.node.PivotPoint[2] = pivot[2]
        }
    }
}
