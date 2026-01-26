import { create } from 'zustand';

interface ModelFile {
    name: string;
    path: string;
    fullPath: string;
}

interface BatchQueueItem {
    name: string;
    fullPath: string;
}

interface BatchState {
    files: ModelFile[];
    currentPath: string | null;
    queue: BatchQueueItem[];
    modelAnimations: Record<string, string[]>;
    selectedAnimations: Record<string, string>;
    isLoading: boolean;

    setFiles: (files: ModelFile[]) => void;
    setCurrentPath: (path: string | null) => void;
    setQueue: (queue: BatchQueueItem[]) => void;
    updateQueue: (updater: (prev: BatchQueueItem[]) => BatchQueueItem[]) => void;
    setModelAnimations: (updater: (prev: Record<string, string[]>) => Record<string, string[]>) => void;
    setSelectedAnimations: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
    setLoading: (loading: boolean) => void;

    reset: () => void;
}

export const useBatchStore = create<BatchState>((set) => ({
    files: [],
    currentPath: null,
    queue: [],
    modelAnimations: {},
    selectedAnimations: {},
    isLoading: false,

    setFiles: (files) => set({ files }),
    setCurrentPath: (currentPath) => set({ currentPath }),
    setQueue: (queue) => set({ queue }),
    updateQueue: (updater) => set((state) => ({ queue: updater(state.queue) })),
    setModelAnimations: (updater) => set((state) => ({ modelAnimations: updater(state.modelAnimations) })),
    setSelectedAnimations: (updater) => set((state) => ({ selectedAnimations: updater(state.selectedAnimations) })),
    setLoading: (isLoading) => set({ isLoading }),

    reset: () => set({
        files: [],
        currentPath: null,
        queue: [],
        modelAnimations: {},
        selectedAnimations: {},
        isLoading: false
    })
}));
