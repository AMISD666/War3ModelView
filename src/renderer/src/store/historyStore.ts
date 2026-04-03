
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
    isDirty: boolean;

    // Actions
    push: (cmd: Command) => void;
    undo: () => void;
    redo: () => void;
    clear: () => void;
    markSaved: () => void;

    // Status
    canUndo: () => boolean;
    canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
    undoStack: [],
    redoStack: [],
    maxHistory: 20,
    isDirty: false,

    push: (cmd: Command) => {
        const { undoStack, maxHistory } = get();
        const newStack = [...undoStack, { ...cmd, timestamp: Date.now() }];

        // Trim if needed
        if (newStack.length > maxHistory) {
            newStack.shift();
        }

        set({
            undoStack: newStack,
            redoStack: [], // Clear redo on new action
            isDirty: true
        });    },

    undo: () => {
        const { undoStack, redoStack } = get();
        if (undoStack.length === 0) return;

        const cmd = undoStack[undoStack.length - 1];
        const newUndoStack = undoStack.slice(0, -1);
        const newRedoStack = [cmd, ...redoStack];        cmd.undo();

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
        const newUndoStack = [...undoStack, cmd];        cmd.redo();

        set({
            undoStack: newUndoStack,
            redoStack: newRedoStack
        });
    },

    clear: () => {
        set({ undoStack: [], redoStack: [], isDirty: false });
    },
    markSaved: () => {
        set({ isDirty: false });
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0
}));
