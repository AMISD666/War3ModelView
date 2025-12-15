import { Command } from '../utils/CommandManager'

export class SetNodeParentCommand implements Command {
    private oldParentId: number | undefined | null

    constructor(
        private renderer: any,
        private nodeId: number,
        private newParentId: number | undefined | null
    ) { }

    execute() {
        const nodeWrapper = this.renderer.rendererData.nodes.find((n: any) => n.node.ObjectId === this.nodeId)
        if (nodeWrapper && nodeWrapper.node) {
            this.oldParentId = nodeWrapper.node.Parent
            nodeWrapper.node.Parent = this.newParentId

            // Force hierarchy update if needed
            // The renderer usually rebuilds hierarchy or traverses it every frame
            // But if it caches children lists (like for optimize), we might need to refresh
            if (this.renderer.updateHierarchy) {
                this.renderer.updateHierarchy()
            }
        }
    }

    undo() {
        const nodeWrapper = this.renderer.rendererData.nodes.find((n: any) => n.node.ObjectId === this.nodeId)
        if (nodeWrapper && nodeWrapper.node) {
            nodeWrapper.node.Parent = this.oldParentId
            if (this.renderer.updateHierarchy) {
                this.renderer.updateHierarchy()
            }
        }
    }
}
