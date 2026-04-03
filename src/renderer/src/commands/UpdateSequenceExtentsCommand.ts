import { Command } from '../utils/CommandManager'

export interface SequenceExtentsChange {
    sequenceIndex: number
    oldMinimumExtent: [number, number, number]
    oldMaximumExtent: [number, number, number]
    newMinimumExtent: [number, number, number]
    newMaximumExtent: [number, number, number]
}

export class UpdateSequenceExtentsCommand implements Command {
    name = 'Update Sequence Extents'

    constructor(
        private changes: SequenceExtentsChange[],
        private onSync?: (changes: SequenceExtentsChange[]) => void
    ) { }

    execute() {
        this.applyChanges(true)
    }

    undo() {
        this.applyChanges(false)
    }

    private applyChanges(useNew: boolean) {
        const effectiveChanges = this.changes.map((change) => ({
            ...change,
            newMinimumExtent: useNew ? change.newMinimumExtent : change.oldMinimumExtent,
            newMaximumExtent: useNew ? change.newMaximumExtent : change.oldMaximumExtent
        }))

        if (this.onSync) {
            this.onSync(effectiveChanges)
        }
    }
}
