import { Command } from '../utils/CommandManager';
import { useModelStore } from '../store/modelStore';

export class SetGeosetVisibilityCommand implements Command {
    private previousHiddenIds: number[];
    private newHiddenIds: number[];
    private previousForceShowAll: boolean;
    private newForceShowAll: boolean;

    constructor(newHiddenIds: number[], newForceShowAll?: boolean) {
        // Capture current state as previous state
        const state = useModelStore.getState();
        this.previousHiddenIds = [...state.hiddenGeosetIds];
        this.previousForceShowAll = state.forceShowAllGeosets;

        this.newHiddenIds = newHiddenIds;
        // If newForceShowAll is not provided, keep the current state
        this.newForceShowAll = newForceShowAll !== undefined ? newForceShowAll : state.forceShowAllGeosets;
    }

    execute() {
        const state = useModelStore.getState();
        state.setHiddenGeosetIds(this.newHiddenIds);
        if (state.forceShowAllGeosets !== this.newForceShowAll) {
            state.setForceShowAllGeosets(this.newForceShowAll);
        }
    }

    undo() {
        const state = useModelStore.getState();
        state.setHiddenGeosetIds(this.previousHiddenIds);
        if (state.forceShowAllGeosets !== this.previousForceShowAll) {
            state.setForceShowAllGeosets(this.previousForceShowAll);
        }
    }
}
