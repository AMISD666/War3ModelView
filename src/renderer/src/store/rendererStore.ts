import { create } from 'zustand'

interface RendererStore {
    renderer: any | null
    setRenderer: (renderer: any | null) => void
}

export const useRendererStore = create<RendererStore>((set) => ({
    renderer: null,
    setRenderer: (renderer) => set({ renderer })
}))
