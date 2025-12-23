import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface GridSettings {
    show128: boolean
    show512: boolean
    show1024: boolean
    enableDepth: boolean
    enablePerspective: boolean
    gridSize: number
}

interface RendererStore {
    renderer: any | null
    setRenderer: (renderer: any | null) => void
    gridSettings: GridSettings
    setGridSettings: (settings: Partial<GridSettings>) => void
    showSettingsPanel: boolean
    setShowSettingsPanel: (show: boolean) => void
    // Display Settings
    showGrid: boolean
    setShowGrid: (show: boolean) => void
    showNodes: boolean
    setShowNodes: (show: boolean) => void
    showSkeleton: boolean
    setShowSkeleton: (show: boolean) => void
    showFPS: boolean
    setShowFPS: (show: boolean) => void
    showGeosetVisibility: boolean
    setShowGeosetVisibility: (show: boolean) => void
    showCollisionShapes: boolean
    setShowCollisionShapes: (show: boolean) => void
    showCameras: boolean
    setShowCameras: (show: boolean) => void
    showLights: boolean
    setShowLights: (show: boolean) => void

    // Render Settings
    renderMode: 'textured' | 'wireframe'
    setRenderMode: (mode: 'textured' | 'wireframe') => void
    backgroundColor: string
    setBackgroundColor: (color: string) => void
    teamColor: number
    setTeamColor: (color: number) => void

    // System State
    mpqLoaded: boolean
    setMpqLoaded: (loaded: boolean) => void
}

export const useRendererStore = create<RendererStore>()(
    persist(
        (set) => ({
            renderer: null,
            setRenderer: (renderer) => set({ renderer }),

            // Grid Settings
            gridSettings: {
                show128: true,
                show512: true,
                show1024: false,
                enableDepth: true,
                enablePerspective: true,
                gridSize: 2048
            },
            setGridSettings: (settings) => set((state) => ({
                gridSettings: { ...state.gridSettings, ...settings }
            })),

            showSettingsPanel: false,
            setShowSettingsPanel: (show) => set({ showSettingsPanel: show }),

            // Default Display Settings
            showGrid: true,
            setShowGrid: (show) => set({ showGrid: show }),
            showNodes: false,
            setShowNodes: (show) => set({ showNodes: show }),
            showSkeleton: false,
            setShowSkeleton: (show) => set({ showSkeleton: show }),
            showFPS: true,
            setShowFPS: (show) => set({ showFPS: show }),
            showGeosetVisibility: true,
            setShowGeosetVisibility: (show) => set({ showGeosetVisibility: show }),
            showCollisionShapes: false,
            setShowCollisionShapes: (show) => set({ showCollisionShapes: show }),
            showCameras: false,
            setShowCameras: (show) => set({ showCameras: show }),
            showLights: false,
            setShowLights: (show) => set({ showLights: show }),

            renderMode: 'textured',
            setRenderMode: (mode) => set({ renderMode: mode }),
            backgroundColor: '#333333',
            setBackgroundColor: (color) => set({ backgroundColor: color }),
            teamColor: 0, // Player 1 (Red)
            setTeamColor: (color) => set({ teamColor: color }),

            mpqLoaded: false,
            setMpqLoaded: (loaded) => set({ mpqLoaded: loaded })
        }),
        {
            name: 'renderer-settings-v2',
            partialize: (state) => ({
                gridSettings: state.gridSettings,
                // showSettingsPanel: state.showSettingsPanel, // Don't persist panel open state
                showGrid: state.showGrid,
                showNodes: state.showNodes,
                showSkeleton: state.showSkeleton,
                showFPS: state.showFPS,
                showGeosetVisibility: state.showGeosetVisibility,
                showCollisionShapes: state.showCollisionShapes,
                showCameras: state.showCameras,
                showLights: state.showLights,
                renderMode: state.renderMode,
                backgroundColor: state.backgroundColor,
                teamColor: state.teamColor
            }),
        }
    )
)
