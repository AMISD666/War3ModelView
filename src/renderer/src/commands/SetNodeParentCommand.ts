import { Command } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'

const normalizeParentId = (parentId: number | undefined | null): number => {
    return typeof parentId === 'number' && Number.isFinite(parentId) ? parentId : -1
}

export class SetNodeParentCommand implements Command {
    private oldParentId: number = -1
    private applied = false

    constructor(
        private renderer: any,
        private nodeId: number,
        private newParentId: number | undefined | null
    ) { }

    execute() {
        const nodeWrapper = this.renderer?.rendererData?.nodes?.find((n: any) => n.node.ObjectId === this.nodeId)
        const storeNode = useModelStore.getState().nodes.find((n: any) => n.ObjectId === this.nodeId)
        const nextParentId = normalizeParentId(this.newParentId)

        if (nodeWrapper && nodeWrapper.node) {
            this.oldParentId = normalizeParentId(nodeWrapper.node.Parent ?? storeNode?.Parent)
        } else if (storeNode) {
            this.oldParentId = normalizeParentId(storeNode.Parent)
        } else {
            this.applied = false
            return
        }

        if (this.oldParentId === nextParentId) {
            this.applied = false
            return
        }

        if (nodeWrapper?.node) {
            nodeWrapper.node.Parent = nextParentId
            if (this.renderer.updateHierarchy) {
                this.renderer.updateHierarchy()
            }
        }
        useModelStore.getState().updateNodeSilent(this.nodeId, { Parent: nextParentId })
        this.applied = true
    }

    undo() {
        const nodeWrapper = this.renderer?.rendererData?.nodes?.find((n: any) => n.node.ObjectId === this.nodeId)
        if (nodeWrapper && nodeWrapper.node) {
            nodeWrapper.node.Parent = this.oldParentId
            if (this.renderer.updateHierarchy) {
                this.renderer.updateHierarchy()
            }
        }
        useModelStore.getState().updateNodeSilent(this.nodeId, { Parent: this.oldParentId })
    }

    hasChanges() {
        return this.applied && this.oldParentId !== normalizeParentId(this.newParentId)
    }
}
