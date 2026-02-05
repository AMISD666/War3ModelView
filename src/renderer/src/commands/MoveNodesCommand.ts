import { Command } from '../utils/CommandManager'

export interface NodeChange {
    nodeId: number
    oldPivot: [number, number, number]
    newPivot: [number, number, number]
}

export class MoveNodesCommand implements Command {
    constructor(
        private renderer: any,
        private changes: NodeChange[],
        private onSync?: (changes: NodeChange[]) => void
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
            if (!nodeWrapper || !nodeWrapper.node) continue

            const pivot = useNew ? change.newPivot : change.oldPivot
            let targetPivot = nodeWrapper.node.PivotPoint

            const pivots = this.renderer.model?.PivotPoints
            if (!targetPivot && pivots) {
                targetPivot = pivots[change.nodeId]
            }
            if (!targetPivot && pivots) {
                targetPivot = new Float32Array([0, 0, 0])
                pivots[change.nodeId] = targetPivot
            }
            if (targetPivot && !nodeWrapper.node.PivotPoint) {
                nodeWrapper.node.PivotPoint = targetPivot
            }
            if (!targetPivot) continue

            targetPivot[0] = pivot[0]
            targetPivot[1] = pivot[1]
            targetPivot[2] = pivot[2]
        }

        if (this.onSync) {
            this.onSync(this.changes.map(c => ({
                ...c,
                newPivot: useNew ? c.newPivot : c.oldPivot // If undoing, we sync the 'old' pivot as the new state
            })))
        }
    }
}
