
import { create } from 'zustand';

export interface Command {
    name: string;
    undo: () => void;
    redo: () => void;
    timestamp?: number;
}

interface HistoryState {
    undoStack: Command[];
    redoStack: Command[];
    maxHistory: number;

    // Actions
    push: (cmd: Command) => void;
    undo: () => void;
    redo: () => void;
    clear: () => void;

    // Status
    canUndo: () => boolean;
    canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
    undoStack: [],
    redoStack: [],
    maxHistory: 50,

    push: (cmd: Command) => {
        const { undoStack, maxHistory } = get();
        const newStack = [...undoStack, { ...cmd, timestamp: Date.now() }];

        // Trim if needed
        if (newStack.length > maxHistory) {
            newStack.shift();
        }

        set({
            undoStack: newStack,
            redoStack: [] // Clear redo on new action
        });

        console.log(`[History] Pushed: ${cmd.name}`);
    },

    undo: () => {
        const { undoStack, redoStack } = get();
        if (undoStack.length === 0) return;

        const cmd = undoStack[undoStack.length - 1];
        const newUndoStack = undoStack.slice(0, -1);
        const newRedoStack = [cmd, ...redoStack];

        console.log(`[History] Undoing: ${cmd.name}`);
        cmd.undo();

        set({
            undoStack: newUndoStack,
            redoStack: newRedoStack
        });
    },

    redo: () => {
        const { undoStack, redoStack } = get();
        if (redoStack.length === 0) return;

        const cmd = redoStack[0];
        const newRedoStack = redoStack.slice(1);
        const newUndoStack = [...undoStack, cmd];

        console.log(`[History] Redoing: ${cmd.name}`);
        cmd.redo();

        set({
            undoStack: newUndoStack,
            redoStack: newRedoStack
        });
    },

    clear: () => {
        set({ undoStack: [], redoStack: [] });
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0
}));
