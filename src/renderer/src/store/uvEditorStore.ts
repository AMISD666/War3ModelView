import { create } from 'zustand'

export interface UvViewerSelectionSync {
    revision: number
    geosetIndices: number[]
}

interface UvEditorStoreState {
    showViewerSelectionHighlight: boolean
    viewerSelectionSync: UvViewerSelectionSync | null
    setShowViewerSelectionHighlight: (show: boolean) => void
    toggleShowViewerSelectionHighlight: () => void
    queueViewerSelectionSync: (geosetIndices: number[]) => void
}

export const useUvEditorStore = create<UvEditorStoreState>((set) => ({
    showViewerSelectionHighlight: true,
    viewerSelectionSync: null,
    setShowViewerSelectionHighlight: (show) => {
        set({ showViewerSelectionHighlight: show })
    },
    toggleShowViewerSelectionHighlight: () => {
        set((state) => ({ showViewerSelectionHighlight: !state.showViewerSelectionHighlight }))
    },
    queueViewerSelectionSync: (geosetIndices) => {
        const cleaned = Array.from(
            new Set(geosetIndices.filter((value) => Number.isInteger(value) && value >= 0))
        )

        set((state) => ({
            viewerSelectionSync: {
                revision: (state.viewerSelectionSync?.revision ?? 0) + 1,
                geosetIndices: cleaned
            }
        }))
    }
}))
