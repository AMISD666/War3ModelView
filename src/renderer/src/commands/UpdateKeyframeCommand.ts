import { Command } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'

export interface KeyframeChange {
    nodeId: number
    propertyName: 'Rotation' | 'Scaling' | 'Translation'
    frame: number
    oldValue: number[] | null  // null = key didn't exist
    newValue: number[]
}

export class UpdateKeyframeCommand implements Command {
    constructor(
        private renderer: any,
        private changes: KeyframeChange[],
        private onSync?: () => void
    ) { }

    execute() {
        this.applyChanges(true)
    }

    undo() {
        this.applyChanges(false)
    }

    private applyChanges(useNew: boolean) {
        const { nodes, updateNodes } = useModelStore.getState()
        const updates: { objectId: number, data: any }[] = []

        for (const change of this.changes) {
            const storeNode = nodes.find((n: any) => n.ObjectId === change.nodeId)
            if (!storeNode) continue

            const value = useNew ? change.newValue : change.oldValue
            let prop = storeNode[change.propertyName]

            if (!prop) {
                prop = { Keys: [], InterpolationType: 1 }
            } else {
                prop = { ...prop, Keys: [...(prop.Keys || [])] }
            }

            // Find key at frame
            const keyIndex = prop.Keys.findIndex((k: any) => Math.abs(k.Frame - change.frame) < 0.1)

            if (value === null) {
                // Remove Key (for undo when key didn't exist before)
                if (keyIndex >= 0) {
                    prop.Keys.splice(keyIndex, 1)
                }
            } else {
                if (keyIndex >= 0) {
                    prop.Keys[keyIndex] = { ...prop.Keys[keyIndex], Vector: value }
                } else {
                    prop.Keys.push({ Frame: change.frame, Vector: value })
                    prop.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
            }

            // Check if we need to add this node to updates
            const existingUpdate = updates.find(u => u.objectId === change.nodeId)
            if (existingUpdate) {
                existingUpdate.data[change.propertyName] = prop
            } else {
                updates.push({ objectId: change.nodeId, data: { [change.propertyName]: prop } })
            }

            // Also update renderer model for immediate effect
            if (this.renderer && this.renderer.model && this.renderer.model.Nodes) {
                const rendererNode = this.renderer.model.Nodes.find((n: any) => n.ObjectId === change.nodeId)
                if (rendererNode) {
                    rendererNode[change.propertyName] = prop
                }
            }
        }

        if (updates.length > 0) {
            updateNodes(updates)
        }

        // Force renderer update
        if (this.renderer) {
            this.renderer.update(0)
        }

        if (this.onSync) {
            this.onSync()
        }
    }
}
