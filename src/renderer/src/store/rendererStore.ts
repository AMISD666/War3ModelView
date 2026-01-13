import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { appDirStorage } from '../utils/persistStorage'

export interface GridSettings {
    show128: boolean
    show512: boolean
    show1024: boolean
    enableDepth: boolean
    enablePerspective: boolean
    gridSize: number
}

export interface VertexSettings {
    enableDepth: boolean
    size: number
}

interface RendererStore {
    renderer: any | null
    setRenderer: (renderer: any | null) => void
    gridSettings: GridSettings
    setGridSettings: (settings: Partial<GridSettings>) => void
    vertexSettings: VertexSettings
    setVertexSettings: (settings: Partial<VertexSettings>) => void
    showSettingsPanel: boolean
    setShowSettingsPanel: (show: boolean) => void
    // Display Settings
    showGridXY: boolean
    setShowGridXY: (show: boolean) => void
    showGridXZ: boolean
    setShowGridXZ: (show: boolean) => void
    showGridYZ: boolean
    setShowGridYZ: (show: boolean) => void
    showVertices: boolean
    setShowVertices: (show: boolean) => void
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
    showAttachments: boolean
    setShowAttachments: (show: boolean) => void
    enableLighting: boolean
    setEnableLighting: (enable: boolean) => void

    // Render Settings
    renderMode: 'textured' | 'wireframe'
    setRenderMode: (mode: 'textured' | 'wireframe') => void
    teamColor: number
    setTeamColor: (color: number) => void

    // Color Settings
    backgroundColor: string
    setBackgroundColor: (color: string) => void
    vertexColor: string
    setVertexColor: (color: string) => void
    wireframeColor: string
    setWireframeColor: (color: string) => void
    selectionColor: string
    setSelectionColor: (color: string) => void
    hoverColor: string
    setHoverColor: (color: string) => void

    // System State
    mpqLoaded: boolean
    setMpqLoaded: (loaded: boolean) => void

    // Missing Textures Warning
    missingTextures: string[]
    setMissingTextures: (paths: string[]) => void

    // Auto Processing Settings (on model load)
    autoRecalculateExtent: boolean
    setAutoRecalculateExtent: (enabled: boolean) => void
    autoRecalculateNormals: boolean
    setAutoRecalculateNormals: (enabled: boolean) => void
    keepCameraOnLoad: boolean
    setKeepCameraOnLoad: (enabled: boolean) => void
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
            vertexSettings: {
                enableDepth: false, // Default to penetrate (visible through model)
                size: 3
            },
            setGridSettings: (settings) => set((state) => ({
                gridSettings: { ...state.gridSettings, ...settings }
            })),

            setVertexSettings: (settings) => set((state) => ({
                vertexSettings: { ...state.vertexSettings, ...settings }
            })),

            showSettingsPanel: false,
            setShowSettingsPanel: (show) => set({ showSettingsPanel: show }),

            // Default Display Settings
            showGridXY: true,
            setShowGridXY: (show) => set({ showGridXY: show }),
            showGridXZ: false,
            setShowGridXZ: (show) => set({ showGridXZ: show }),
            showGridYZ: false,
            setShowGridYZ: (show) => set({ showGridYZ: show }),
            showVertices: true, // Default shown
            setShowVertices: (show) => set({ showVertices: show }),
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
            showAttachments: false, // Default off
            setShowAttachments: (show) => set({ showAttachments: show }),
            enableLighting: true,
            setEnableLighting: (enable) => set({ enableLighting: enable }),

            renderMode: 'textured',
            setRenderMode: (mode) => set({ renderMode: mode }),
            teamColor: 0, // Player 1 (Red)
            setTeamColor: (color) => set({ teamColor: color }),

            // Color Settings
            backgroundColor: '#333333',
            setBackgroundColor: (color) => set({ backgroundColor: color }),
            vertexColor: '#0088ff',
            setVertexColor: (color) => set({ vertexColor: color }),
            wireframeColor: '#ffffff',
            setWireframeColor: (color) => set({ wireframeColor: color }),
            selectionColor: '#ff0000',
            setSelectionColor: (color) => set({ selectionColor: color }),
            hoverColor: '#ffff00',
            setHoverColor: (color) => set({ hoverColor: color }),

            mpqLoaded: false,
            setMpqLoaded: (loaded) => set({ mpqLoaded: loaded }),

            // Missing Textures Warning
            missingTextures: [],
            setMissingTextures: (paths) => set({ missingTextures: paths }),

            // Auto Processing Settings (on model load) - defaults ON
            autoRecalculateExtent: true,
            setAutoRecalculateExtent: (enabled) => set({ autoRecalculateExtent: enabled }),
            autoRecalculateNormals: true,
            setAutoRecalculateNormals: (enabled) => set({ autoRecalculateNormals: enabled }),
            keepCameraOnLoad: false,
            setKeepCameraOnLoad: (enabled) => set({ keepCameraOnLoad: enabled })
        }),
        {
            name: 'renderer-settings-v2',
            storage: appDirStorage,
            partialize: (state) => ({
                gridSettings: state.gridSettings,
                vertexSettings: state.vertexSettings,
                // showSettingsPanel: state.showSettingsPanel, // Don't persist panel open state
                showGridXY: state.showGridXY,
                showGridXZ: state.showGridXZ,
                showGridYZ: state.showGridYZ,
                showVertices: state.showVertices,
                showNodes: state.showNodes,
                showSkeleton: state.showSkeleton,
                showFPS: state.showFPS,
                showGeosetVisibility: state.showGeosetVisibility,
                showCollisionShapes: state.showCollisionShapes,
                showCameras: state.showCameras,
                showLights: state.showLights,
                showAttachments: state.showAttachments,
                enableLighting: state.enableLighting,
                renderMode: state.renderMode,
                teamColor: state.teamColor,
                backgroundColor: state.backgroundColor,
                vertexColor: state.vertexColor,
                wireframeColor: state.wireframeColor,
                selectionColor: state.selectionColor,
                hoverColor: state.hoverColor,
                autoRecalculateExtent: state.autoRecalculateExtent,
                autoRecalculateNormals: state.autoRecalculateNormals,
                keepCameraOnLoad: state.keepCameraOnLoad
            }),
        }
    )
)
