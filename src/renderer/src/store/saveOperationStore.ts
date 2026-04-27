import { create } from 'zustand'

export interface SaveOperationProgress {
    progress: number
    detail: string
}

export interface SaveOperation extends SaveOperationProgress {
    id: string
    title: string
}

interface SaveOperationState {
    current: SaveOperation | null
    startSaveOperation: (input: { title: string; detail: string; progress?: number }) => string
    updateSaveOperation: (id: string, progress: Partial<SaveOperationProgress>) => void
    finishSaveOperation: (id: string) => void
}

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

export const useSaveOperationStore = create<SaveOperationState>((set) => ({
    current: null,
    startSaveOperation: ({ title, detail, progress = 0 }) => {
        const id = `save-${Date.now()}-${Math.random().toString(36).slice(2)}`
        set({
            current: {
                id,
                title,
                detail,
                progress: clampProgress(progress),
            },
        })
        return id
    },
    updateSaveOperation: (id, progress) => {
        set((state) => {
            if (!state.current || state.current.id !== id) {
                return state
            }

            return {
                current: {
                    ...state.current,
                    ...progress,
                    progress: progress.progress === undefined
                        ? state.current.progress
                        : clampProgress(progress.progress),
                },
            }
        })
    },
    finishSaveOperation: (id) => {
        set((state) => state.current?.id === id ? { current: null } : state)
    },
}))
