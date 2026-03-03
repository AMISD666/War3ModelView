import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { appDirStorage } from '../utils/persistStorage'
import type { AppMode } from './selectionStore'

type AnimationSubMode = 'binding' | 'keyframe'

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

export interface NodeColorSettings {
    Bone: string
    Helper: string
    Attachment: string
    ParticleEmitter: string
    ParticleEmitter2: string
    RibbonEmitter: string
    Light: string
    EventObject: string
    CollisionShape: string
    Camera: string
    ParticleEmitterPopcorn: string
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
    showVerticesByMode: Record<AppMode, boolean>
    setShowVerticesForMode: (mode: AppMode, show: boolean) => void
    // Animation sub-modes need independent vertex-visibility control:
    // binding: default ON (helps binding workflow), keyframe: default OFF (clean view).
    showVerticesInAnimationBinding: boolean
    showVerticesInAnimationKeyframe: boolean
    setShowVerticesForAnimationSubMode: (subMode: AnimationSubMode, show: boolean) => void
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
    showParticles: boolean
    setShowParticles: (show: boolean) => void
    showRibbons: boolean
    setShowRibbons: (show: boolean) => void
    enableLighting: boolean
    setEnableLighting: (enable: boolean) => void

    // Render Settings
    renderMode: 'textured' | 'wireframe'
    setRenderMode: (mode: 'textured' | 'wireframe') => void
    teamColor: number
    setTeamColor: (color: number) => void
    gizmoSize: number
    setGizmoSize: (size: number) => void
    gizmoOrientation: 'world' | 'camera'
    setGizmoOrientation: (mode: 'world' | 'camera') => void
    nodeSize: number
    setNodeSize: (size: number) => void
    snapTranslateEnabled: boolean
    setSnapTranslateEnabled: (enabled: boolean) => void
    snapTranslateStep: number
    setSnapTranslateStep: (step: number) => void
    snapRotateEnabled: boolean
    setSnapRotateEnabled: (enabled: boolean) => void
    snapRotateStep: number
    setSnapRotateStep: (step: number) => void

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
    nodeColors: NodeColorSettings
    setNodeColors: (colors: Partial<NodeColorSettings>) => void

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
    reset: () => void
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
            showVerticesByMode: {
                view: false,
                geometry: true,
                uv: true,
                animation: true,
                batch: true
            },
            setShowVerticesForMode: (mode, show) => set((state) => ({
                showVerticesByMode: { ...state.showVerticesByMode, [mode]: show }
            })),
            showVerticesInAnimationBinding: true,
            showVerticesInAnimationKeyframe: false,
            setShowVerticesForAnimationSubMode: (subMode, show) => set((state) => ({
                showVerticesInAnimationBinding:
                    subMode === 'binding' ? show : state.showVerticesInAnimationBinding,
                showVerticesInAnimationKeyframe:
                    subMode === 'keyframe' ? show : state.showVerticesInAnimationKeyframe
            })),
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
            showParticles: true,
            setShowParticles: (show) => set({ showParticles: show }),
            showRibbons: true,
            setShowRibbons: (show) => set({ showRibbons: show }),
            enableLighting: true,
            setEnableLighting: (enable) => set({ enableLighting: enable }),

            renderMode: 'textured',
            setRenderMode: (mode) => set({ renderMode: mode }),
            teamColor: 0, // Player 1 (Red)
            setTeamColor: (color) => set({ teamColor: color }),
            gizmoSize: 0.5,
            setGizmoSize: (size) => set({ gizmoSize: size }),
            gizmoOrientation: 'world',
            setGizmoOrientation: (mode) => set({ gizmoOrientation: mode }),
            nodeSize: 1.0,
            setNodeSize: (size) => set({ nodeSize: Math.max(0.2, Math.min(5.0, size)) }),
            snapTranslateEnabled: false,
            setSnapTranslateEnabled: (enabled) => set({ snapTranslateEnabled: enabled }),
            snapTranslateStep: 1,
            setSnapTranslateStep: (step) => set({ snapTranslateStep: step }),
            snapRotateEnabled: false,
            setSnapRotateEnabled: (enabled) => set({ snapRotateEnabled: enabled }),
            snapRotateStep: 5,
            setSnapRotateStep: (step) => set({ snapRotateStep: step }),

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
            nodeColors: {
                Bone: '#00ff00',
                Helper: '#3399ff',
                Attachment: '#ffff00',
                ParticleEmitter: '#ff9933',
                ParticleEmitter2: '#ff66cc',
                RibbonEmitter: '#b080ff',
                Light: '#ffff66',
                EventObject: '#9999ff',
                CollisionShape: '#66ffcc',
                Camera: '#66ccff',
                ParticleEmitterPopcorn: '#ffcc66'
            },
            setNodeColors: (colors) => set((state) => ({
                nodeColors: { ...state.nodeColors, ...colors }
            })),

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
            setKeepCameraOnLoad: (enabled) => set({ keepCameraOnLoad: enabled }),

            reset: () => {
                set({
                    renderer: null,
                    missingTextures: []
                });
            }
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
                showVerticesByMode: state.showVerticesByMode,
                showVerticesInAnimationBinding: state.showVerticesInAnimationBinding,
                showVerticesInAnimationKeyframe: state.showVerticesInAnimationKeyframe,
                showNodes: state.showNodes,
                showSkeleton: state.showSkeleton,
                showFPS: state.showFPS,
                showGeosetVisibility: state.showGeosetVisibility,
                showCollisionShapes: state.showCollisionShapes,
                showCameras: state.showCameras,
                showLights: state.showLights,
                showAttachments: state.showAttachments,
                showParticles: state.showParticles,
                showRibbons: state.showRibbons,
                enableLighting: state.enableLighting,
                renderMode: state.renderMode,
                teamColor: state.teamColor,
                gizmoSize: state.gizmoSize,
                gizmoOrientation: state.gizmoOrientation,
                nodeSize: state.nodeSize,
                snapTranslateEnabled: state.snapTranslateEnabled,
                snapTranslateStep: state.snapTranslateStep,
                snapRotateEnabled: state.snapRotateEnabled,
                snapRotateStep: state.snapRotateStep,
                backgroundColor: state.backgroundColor,
                vertexColor: state.vertexColor,
                wireframeColor: state.wireframeColor,
                selectionColor: state.selectionColor,
                hoverColor: state.hoverColor,
                nodeColors: state.nodeColors,
                autoRecalculateExtent: state.autoRecalculateExtent,
                autoRecalculateNormals: state.autoRecalculateNormals,
                keepCameraOnLoad: state.keepCameraOnLoad
            }),
        }
    )
)
