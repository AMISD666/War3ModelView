import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
// @ts-ignore
import { decodeBLP, getBLPImageData, parseMDX, parseMDL, ModelRenderer } from 'war3-model'
import { SimpleOrbitCamera } from '../utils/SimpleOrbitCamera'
import { loadAllTextures } from './viewer/textureLoader'
import { validateAllParticleEmitters } from './viewer/particleValidator'
import { checkForStructuralChanges } from './viewer/modelSync'
import { logModelInfo } from '../utils/debugLogger'
import { hexToRgb } from './viewer/types'
import { mat3, mat4, vec3, vec4, quat } from 'gl-matrix'
import { GridRenderer } from './GridRenderer'
import { DebugRenderer } from './DebugRenderer'
import { GizmoRenderer, GizmoAxis } from './GizmoRenderer'
import { AxisIndicator } from './AxisIndicator'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { useModelStore } from '../store/modelStore'
import { useRendererStore } from '../store/rendererStore'
import { ModelInfoPanel } from './info/ModelInfoPanel'
import { ViewerToolbar } from './ViewerToolbar'
import { ConfigProvider, theme } from 'antd'
import { commandManager } from '../utils/CommandManager'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { MoveNodesCommand, NodeChange } from '../commands/MoveNodesCommand'
import { SetNodeParentCommand } from '../commands/SetNodeParentCommand'
import { VertexEditor } from './VertexEditor'
import BoneBindingPanel from './BoneBindingPanel'
import { pickClosestGeoset } from '../utils/rayTriangle'
import { recalculateAllNormals } from '../utils/geometryUtils'
import { SplitVerticesCommand } from '../commands/SplitVerticesCommand'
import { WeldVerticesCommand } from '../commands/WeldVerticesCommand'
import { DeleteVerticesCommand } from '../commands/DeleteVerticesCommand'
import { PasteVerticesCommand } from '../commands/PasteVerticesCommand'
import { copyVertices, copyFaces, VertexCopyBuffer } from '../utils/vertexOperations'
import { UpdateKeyframeCommand, KeyframeChange } from '../commands/UpdateKeyframeCommand'

// Ref interface for external access to camera methods
export interface ViewerRef {
  getCamera: () => { distance: number; theta: number; phi: number; target: [number, number, number] }
  setCamera: (params: { distance: number; theta: number; phi: number; target: [number, number, number] }) => void
}

interface ViewerProps {
  modelPath: string | null
  animationIndex: number
  teamColor: number
  showGrid: boolean
  showNodes: boolean
  showSkeleton: boolean
  showCollisionShapes: boolean
  showCameras: boolean
  showLights: boolean
  showWireframe: boolean
  isPlaying: boolean
  onTogglePlay: () => void
  onToggleWireframe: () => void
  onModelLoaded: (model: any) => void
  backgroundColor: string
  showFPS: boolean
  playbackSpeed: number
  viewPreset?: { type: string, time: number } | null
  modelData?: any
}

const Viewer = forwardRef<ViewerRef, ViewerProps>(({
  modelPath,
  animationIndex,
  teamColor,
  showGrid,
  showNodes,
  showSkeleton,
  showCollisionShapes,
  showCameras,
  showLights,
  showWireframe,
  isPlaying,
  onTogglePlay,
  onToggleWireframe,
  onModelLoaded,
  backgroundColor,
  showFPS,
  playbackSpeed,
  viewPreset,
  modelData
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderer, setRenderer] = useState<ModelRenderer | null>(null)
  const [fps, setFps] = useState<number>(0)
  const gridRenderer = useRef(new GridRenderer())
  const debugRenderer = useRef(new DebugRenderer())
  const gizmoRenderer = useRef(new GizmoRenderer())
  const axisIndicator = useRef(new AxisIndicator())
  const rendererRef = useRef<ModelRenderer | null>(null)
  const cameraRef = useRef<SimpleOrbitCamera | null>(null)

  const appMainMode = useSelectionStore((state) => state.mainMode)
  const animationSubMode = useSelectionStore((state) => state.animationSubMode)
  const animationFrameId = useRef<number | null>(null)
  const lastFpsTime = useRef<number>(performance.now())
  const lastFrameTime = useRef<number>(performance.now())
  const frameCount = useRef<number>(0)
  const renderRef = useRef<((time: number) => void) | null>(null)
  const { showModelInfo } = useUIStore()

  // Refs for props to be accessible in render loop
  const showGridRef = useRef(showGrid)
  const showNodesRef = useRef(showNodes)
  const showSkeletonRef = useRef(showSkeleton)
  const showCollisionShapesRef = useRef(showCollisionShapes)
  const showCamerasRef = useRef(showCameras)
  const showLightsRef = useRef(showLights)
  const showWireframeRef = useRef(showWireframe)
  const isPlayingRef = useRef(isPlaying)
  const playbackSpeedRef = useRef(playbackSpeed)
  const backgroundColorRef = useRef(backgroundColor)

  // Cache for bound vertex highlighting (to avoid per-frame recalculation)
  const boundVerticesCache = useRef<{ boneId: number, vertices: number[] } | null>(null)

  // Progress bar state
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(100)
  const lastProgressUpdate = useRef(0)
  const ignoreNextModelDataUpdate = useRef(false)
  const lastFrameSyncTime = useRef(0) // For throttling setFrame calls

  useEffect(() => {
    showGridRef.current = showGrid
    showNodesRef.current = showNodes
    showSkeletonRef.current = showSkeleton
    showCollisionShapesRef.current = showCollisionShapes
    showCamerasRef.current = showCameras
    showLightsRef.current = showLights
    showWireframeRef.current = showWireframe
    isPlayingRef.current = isPlaying
    playbackSpeedRef.current = playbackSpeed
    backgroundColorRef.current = backgroundColor
  }, [showGrid, showNodes, showSkeleton, showCollisionShapes, showCameras, showLights, showWireframe, isPlaying, playbackSpeed, backgroundColor])

  useEffect(() => {
    if (canvasRef.current && !cameraRef.current) {
      cameraRef.current = new SimpleOrbitCamera(canvasRef.current)
    }
  }, [])

  // Sync renderer to global store
  const { setRenderer: setGlobalRenderer } = useRendererStore()
  useEffect(() => {
    setGlobalRenderer(renderer)
  }, [renderer, setGlobalRenderer])

  // 空格键播放/暂停动画快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的按键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.code === 'Space') {
        e.preventDefault() // 防止页面滚动
        onTogglePlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onTogglePlay])


  useEffect(() => {
    rendererRef.current = renderer

    // Fit to View when renderer changes (new model loaded)
    if (renderer && renderer.model && renderer.model.Info) {
      const info = renderer.model.Info as any
      if (info.Extent) {
        const { Min, Max } = info.Extent
        const min = vec3.fromValues(Min[0], Min[1], Min[2])
        const max = vec3.fromValues(Max[0], Max[1], Max[2])

        const center = vec3.create()
        vec3.add(center, min, max)
        vec3.scale(center, center, 0.5)

        const diagonal = vec3.dist(min, max)
        const distance = Math.max(diagonal * 1.2, 300)

        console.log('[Viewer] Fit to View:', { center, distance })

        targetCamera.current.target = center
        targetCamera.current.distance = distance
        targetCamera.current.theta = Math.PI / 4
        targetCamera.current.phi = Math.PI / 3
      }
    }
  }, [renderer])

  // Camera state
  const targetCamera = useRef({
    distance: 500,
    theta: Math.PI / 4,
    phi: Math.PI / 4,
    target: vec3.fromValues(0, 0, 0),
  })

  // Track if currently viewing a model camera (for ~ toggle)
  const inCameraView = useRef(false)
  // Store previous camera state to restore after exiting camera view
  const previousCameraState = useRef<{ distance: number, theta: number, phi: number, target: Float32Array } | null>(null)

  // Helper to sync targetCamera state to SimpleOrbitCamera
  const syncCameraToOrbit = () => {
    if (cameraRef.current) {
      cameraRef.current.distance = targetCamera.current.distance
      cameraRef.current.horizontalAngle = targetCamera.current.theta + Math.PI / 2
      cameraRef.current.verticalAngle = targetCamera.current.phi
      vec3.copy(cameraRef.current.target, targetCamera.current.target)
      cameraRef.current.update()
    }
  }

  const resetCamera = () => {
    vec3.set(targetCamera.current.target, 0, 0, 0)
    targetCamera.current.distance = 500
    targetCamera.current.theta = Math.PI / 4
    targetCamera.current.phi = Math.PI / 4
    syncCameraToOrbit()
  }

  // Expose camera methods to parent via ref
  useImperativeHandle(ref, () => ({
    getCamera: () => {
      // Read from SimpleOrbitCamera (actual camera used by render loop)
      if (cameraRef.current) {
        return {
          distance: cameraRef.current.distance,
          theta: cameraRef.current.horizontalAngle - Math.PI / 2, // Convert back from horizontalAngle
          phi: cameraRef.current.verticalAngle,
          target: [
            cameraRef.current.target[0],
            cameraRef.current.target[1],
            cameraRef.current.target[2]
          ] as [number, number, number]
        }
      }
      // Fallback to targetCamera
      return {
        distance: targetCamera.current.distance,
        theta: targetCamera.current.theta,
        phi: targetCamera.current.phi,
        target: [
          targetCamera.current.target[0],
          targetCamera.current.target[1],
          targetCamera.current.target[2]
        ] as [number, number, number]
      }
    },
    setCamera: (params: { distance: number; theta: number; phi: number; target: [number, number, number] }) => {

      const clampedPhi = Math.max(0.01, Math.min(Math.PI - 0.01, params.phi))

      // Update targetCamera (backup/fallback)
      targetCamera.current.distance = params.distance
      targetCamera.current.theta = params.theta
      targetCamera.current.phi = clampedPhi
      vec3.set(targetCamera.current.target, params.target[0], params.target[1], params.target[2])

      // CRITICAL: Also update SimpleOrbitCamera which is actually used by the render loop
      if (cameraRef.current) {
        cameraRef.current.distance = params.distance
        cameraRef.current.horizontalAngle = params.theta + Math.PI / 2 // Theta to horizontalAngle offset
        cameraRef.current.verticalAngle = clampedPhi
        vec3.set(cameraRef.current.target, params.target[0], params.target[1], params.target[2])
        cameraRef.current.update()

      }
    }
  }), [])

  // Mouse interaction state
  const mouseState = useRef({
    isDragging: false,
    dragButton: -1, // 0: Left, 1: Middle, 2: Right
    lastMouseX: 0,
    lastMouseY: 0,
    startX: 0,
    startY: 0,
    isBoxSelecting: false,
    isCtrlPressed: false // Store Ctrl state on mouseDown for reliable detection during drag
  })

  const initialVertexPositions = useRef<Map<string, [number, number, number]>>(new Map())
  const initialNodePositions = useRef<Map<number, [number, number, number]>>(new Map())

  // Gizmo state
  const gizmoState = useRef<{
    activeAxis: GizmoAxis,
    isDragging: boolean,
    dragStartPos: vec3 | null,
    isShiftDuplicate: boolean // Track if shift was held to trigger duplicate
  }>({
    activeAxis: null,
    isDragging: false,
    dragStartPos: null,
    isShiftDuplicate: false
  })

  // Keyframe drag state (for Rotation/Scale injection)
  const keyframeDragData = useRef<{
    initialKeys: Map<number, any>, // NodeId -> { Rotation: [], Scaling: [] }
    initialValues: Map<number, { rotation: Float32Array, scaling: Float32Array }> // NodeId -> { rotation, scaling } (snapshot at drag start)
  } | null>(null)

  // Box selection overlay state
  const [selectionBox, setSelectionBox] = useState<{ x: number, y: number, width: number, height: number } | null>(null)

  // Context menu state for vertex operations
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null)

  const loadTeamColorTextures = async (colorIndex: number) => {
    if (!renderer) return

    const idStr = colorIndex.toString().padStart(2, '0')
    const teamColorPath = `ReplaceableTextures\\TeamColor\\TeamColor${idStr}.blp`
    const teamGlowPath = `ReplaceableTextures\\TeamGlow\\TeamGlow${idStr}.blp`

    const loadTexture = async (path: string, id: number) => {
      try {
        const mpqData = await invoke<number[]>('read_mpq_file', { path }).catch(() => null)

        if (mpqData) {
          const buffer = new Uint8Array(mpqData)
          const blp = decodeBLP(buffer.buffer)
          const imageData = getBLPImageData(blp, 0)

          const texCanvas = document.createElement('canvas')
          texCanvas.width = imageData.width
          texCanvas.height = imageData.height
          const ctx = texCanvas.getContext('2d')
          if (ctx) {
            const idata = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
            ctx.putImageData(idata, 0, 0)
            const img = await createImageBitmap(texCanvas)
            if (renderer.setReplaceableTexture) {
              renderer.setReplaceableTexture(id, img)
            }
          }
        } else {
          console.warn(`[Viewer] Failed to load replaceable texture: ${path}`)
        }
      } catch (e) {
        console.error(`[Viewer] Error loading replaceable texture ${path}:`, e)
      }
    }

    await loadTexture(teamColorPath, 1)
    await loadTexture(teamGlowPath, 2)
  }

  // Handle view presets from prop
  useEffect(() => {
    if (!viewPreset) return

    switch (viewPreset.type) {
      case 'front':
        targetCamera.current.theta = -Math.PI / 2
        targetCamera.current.phi = Math.PI / 2
        break
      case 'back':
        targetCamera.current.theta = Math.PI / 2
        targetCamera.current.phi = Math.PI / 2
        break
      case 'left':
        targetCamera.current.theta = 0
        targetCamera.current.phi = Math.PI / 2
        break
      case 'right':
        targetCamera.current.theta = Math.PI
        targetCamera.current.phi = Math.PI / 2
        break
      case 'top':
        targetCamera.current.phi = 0.01
        break
      case 'bottom':
        targetCamera.current.phi = Math.PI - 0.01
        break
      case 'focus':
        vec3.set(targetCamera.current.target, 0, 0, 0)
        targetCamera.current.distance = 500
        targetCamera.current.theta = Math.PI / 4
        targetCamera.current.phi = Math.PI / 4
        break
    }
    loadTeamColorTextures(teamColor)
  }, [renderer, animationIndex, teamColor])

  // Handle Animation and Mode Changes
  useEffect(() => {
    // Guard: Only set sequence if renderer is fully initialized
    if (renderer && renderer.rendererData) {
      if (appMainMode === 'geometry') {
        // Bind Pose: Set frame to the START of the current sequence's interval
        if (renderer.rendererData.animationInfo?.Interval) {
          renderer.rendererData.frame = renderer.rendererData.animationInfo.Interval[0]
        } else if (renderer.model?.Sequences?.[animationIndex]?.Interval) {
          renderer.rendererData.frame = renderer.model.Sequences[animationIndex].Interval[0]
        } else {
          renderer.rendererData.frame = 0
        }
      } else {
        // Restore Animation
        const currentSeqIndex = renderer.rendererData.animationInfo
          ? renderer.model?.Sequences?.findIndex((s: any) => s === renderer.rendererData.animationInfo) ?? -2
          : -2

        if (currentSeqIndex !== animationIndex && (renderer as any).setSequence) {
          ; (renderer as any).setSequence(animationIndex)
        }
      }
    }
  }, [renderer, appMainMode, animationIndex])

  // Sync Store Changes to Renderer (Hot Patching)
  useEffect(() => {
    if (rendererRef.current && rendererRef.current.model) {
      const { nodes } = useModelStore.getState()
      // Patch the model data in the renderer with the latest from store
      // This is crucial for "Lightweight Reload" and seeing changes like PivotPoint (Position) updates instantly.

      // 1. Update full Nodes list (contains structure and hierarchy info)
      rendererRef.current.model.Nodes = nodes;

      // 2. Update specific lists used by renderer (Lights, etc.)
      // Note: war3-model might cache these, so we update them explicitly.
      rendererRef.current.model.Lights = nodes.filter((n: any) => n.type === 'Light');
      // Update other types if necessary (cameras, emitters, etc.)

      // 3. Force caching/update if possible. 
      // war3-model creates 'rendererData.nodes' which wraps the raw nodes.
      // We might need to update the references in rendererData if they are stale.
      if (rendererRef.current.rendererData && rendererRef.current.rendererData.nodes) {
        // The rendererData.nodes array holds wrappers { node: rawNode, ... }
        // We need to update the 'node' reference in these wrappers or update the properties.
        rendererRef.current.rendererData.nodes.forEach((wrapper: any) => {
          const freshNode = nodes.find((n: any) => n.ObjectId === wrapper.node.ObjectId);
          if (freshNode) {
            wrapper.node = freshNode;
            // If PivotPoint changed, the matrix calculation needs to happen again.
            // The renderer loop handles matrix calc, so just updating the data should be enough for the NEXT frame.
          }
        });
      }
    }
  }, [renderer, useModelStore.getState().nodes]) // Depend on nodes changing

  useEffect(() => {
    return () => {
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [])

  useEffect(() => {
    // Only reload on modelPath change, NOT on modelData change.
    // Auto-reloading on modelData change causes texture corruption and animation freeze.
    if (modelPath) {
      // Check if this is a dropped file (has in-memory data)
      if (modelPath.startsWith('dropped:')) {
        // Load from in-memory data stored in the model store
        const storeModelData = useModelStore.getState().modelData
        if (storeModelData) {
          console.log('[Viewer] Loading from in-memory data for dropped file:', modelPath)
          loadModel(modelPath, storeModelData)
        }
      } else {
        loadModel(modelPath)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPath])

  const updateProgress = (currentFrame: number, totalDuration: number) => {
    const now = performance.now()
    if (now - lastProgressUpdate.current > 100) {
      setProgress(currentFrame)
      setDuration(totalDuration)
      lastProgressUpdate.current = now
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (renderer && renderer.rendererData && renderer.rendererData.animationInfo) {
      const newFrame = parseInt(e.target.value)
      renderer.rendererData.frame = newFrame
      setProgress(newFrame)
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    targetCamera.current.distance = Math.max(10, targetCamera.current.distance * (1 + e.deltaY * 0.001))
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { mainMode } = useSelectionStore.getState()
    // Check for Gizmo interaction first
    // In geometry mode: Alt = camera rotation (allow Gizmo)
    // In animation mode: Alt = box selection (block Gizmo)
    const shouldBlockGizmoForAlt = e.altKey && mainMode === 'animation'

    if (gizmoState.current.activeAxis && e.button === 0 && !shouldBlockGizmoForAlt) {
      // Block Gizmo in keyframe mode when autoKeyframe is disabled
      const { animationSubMode: subMode } = useSelectionStore.getState()
      const { autoKeyframe } = useModelStore.getState()
      if (mainMode === 'animation' && subMode === 'keyframe' && !autoKeyframe) {
        console.log('[Viewer] Gizmo blocked: autoKeyframe is OFF in keyframe mode')
        // Clear activeAxis to prevent any visual feedback
        gizmoState.current.activeAxis = null
        // CRITICAL: Disable camera to prevent it from handling mouse events
        if (cameraRef.current) cameraRef.current.enabled = false
        return // Don't allow Gizmo interaction, fully consume event
      }

      if (cameraRef.current) cameraRef.current.enabled = false
      gizmoState.current.isDragging = true
      gizmoState.current.isShiftDuplicate = e.shiftKey // Track if this is a shift-duplicate operation
      mouseState.current.lastMouseX = e.clientX
      mouseState.current.lastMouseY = e.clientY

      const { selectedVertexIds, selectedFaceIds, geometrySubMode, animationSubMode: subMode2 } = useSelectionStore.getState()

      // Shift+Drag = Duplicate then move
      if (e.shiftKey && (geometrySubMode === 'vertex' || geometrySubMode === 'face') && rendererRef.current) {

        let buffer: VertexCopyBuffer | null = null
        let mode: 'vertex' | 'face' = 'vertex'

        if (geometrySubMode === 'vertex' && selectedVertexIds.length > 0) {
          const geosetIndex = selectedVertexIds[0].geosetIndex
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if (geoset) {
            const vertexIndices = selectedVertexIds.map(s => s.index)
            buffer = copyVertices(geoset, vertexIndices, geosetIndex)
            mode = 'vertex'
          }
        } else if (geometrySubMode === 'face' && selectedFaceIds.length > 0) {
          const geosetIndex = selectedFaceIds[0].geosetIndex
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if (geoset) {
            const faceIndices = selectedFaceIds.map(s => s.index)
            buffer = copyFaces(geoset, faceIndices, geosetIndex)
            mode = 'face'
          }
        }

        if (buffer) {
          const cmd = new PasteVerticesCommand(rendererRef.current, buffer, true, [0, 0, 0], mode)
          commandManager.execute(cmd)

          // Note: PasteVerticesCommand automatically selects the new elements
        }
      }

      // Capture initial positions for Undo (after potential paste)
      initialVertexPositions.current.clear()
      // Re-fetch selection in case it was updated by paste
      const currentSelection = useSelectionStore.getState()

      const captureVertex = (geosetIndex: number, vertexIndex: number) => {
        if (!rendererRef.current) {
          console.warn('[Viewer] CaptureVertex: No rendererRef')
          return
        }
        const geoset = rendererRef.current.model.Geosets[geosetIndex]
        if (!geoset) return
        const vIndex = vertexIndex * 3
        const key = `${geosetIndex}-${vertexIndex}`
        if (!initialVertexPositions.current.has(key)) {
          initialVertexPositions.current.set(key, [geoset.Vertices[vIndex], geoset.Vertices[vIndex + 1], geoset.Vertices[vIndex + 2]])
        }
      }

      if ((mainMode === 'animation' && subMode2 === 'binding') || (mainMode === 'animation' && subMode2 === 'keyframe')) {
        // AUTO-PAUSE: Pause animation when starting Gizmo drag in keyframe mode
        if (subMode2 === 'keyframe') {
          useModelStore.getState().setPlaying(false)
          console.log('[Viewer] Auto-paused animation for keyframe drag')

          // Initialize keyframeDragData for stable Initial + Delta updates
          // This fixes "double transform" and "jump on release" issues
          const { nodes, currentFrame } = useModelStore.getState()
          keyframeDragData.current = {
            initialKeys: new Map(),
            initialValues: new Map()
          }

          const { selectedNodeIds } = useSelectionStore.getState()
          selectedNodeIds.forEach(nodeId => {
            // 1. Snapshot original KEYS from STORE (source of truth)
            const storeNode = nodes.find((n: any) => n.ObjectId === nodeId)
            if (storeNode) {
              // Deep copy relevant props
              keyframeDragData.current!.initialKeys.set(nodeId, {
                Translation: storeNode.Translation ? JSON.parse(JSON.stringify(storeNode.Translation)) : undefined,
                Rotation: storeNode.Rotation ? JSON.parse(JSON.stringify(storeNode.Rotation)) : undefined,
                Scaling: storeNode.Scaling ? JSON.parse(JSON.stringify(storeNode.Scaling)) : undefined
              })
            }

            // 2. Snapshot current calculated VALUES from RENDERER (visual start point)
            // These values are what the user SEES when they start dragging.
            // We will apply Delta to these values.
            if (rendererRef.current && rendererRef.current.rendererData && rendererRef.current.rendererData.nodes) {
              const nodeWrapper = rendererRef.current.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
              if (nodeWrapper) {
                // Calculate current values at this frame
                // Note: nodeWrapper.node has raw data, let's trust the renderer's calculated state if accessible,
                // or use helper to interpolate from store keys.
                // For now, let's rely on the Store keys interpolation or the Helper.
                // Actually, for "Initial + Delta" logic, we need the Value at the START of drag.
                // We can get this from the interpolated keys at currentFrame.

                // Simpler: Just resolve the value from the STORE keys at currentFrame
                // We can reuse the logic we had in MouseMove, but here.

                const initialVals: any = {}

                // Helper to interpolate value at frame (linear interpolation)
                const interpolateValue = (keys: any[], frame: number, defaultVal: number[]): number[] => {
                  if (!keys || keys.length === 0) return defaultVal

                  // Sort keys by frame (should already be sorted, but safety first)
                  const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

                  // Helper to safely convert Vector to Array (handles Float32Array)
                  // Also checks for empty arrays and returns fallback in that case
                  const toArray = (v: any, fallback: number[]): number[] => {
                    if (!v) return fallback
                    // Check if it's an array-like with length
                    if (typeof v.length === 'number' && v.length === 0) return fallback
                    const result = Array.isArray(v) ? [...v] : Array.from(v) as number[]
                    // If result is empty, return fallback
                    return result.length > 0 ? result : fallback
                  }

                  // Before first key - use first key's value
                  if (frame <= sortedKeys[0].Frame) {
                    return toArray(sortedKeys[0].Vector, defaultVal)
                  }

                  // After last key - use last key's value
                  if (frame >= sortedKeys[sortedKeys.length - 1].Frame) {
                    return toArray(sortedKeys[sortedKeys.length - 1].Vector, defaultVal)
                  }

                  // Find surrounding keys and interpolate
                  for (let i = 0; i < sortedKeys.length - 1; i++) {
                    if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
                      const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
                      const from = toArray(sortedKeys[i].Vector, defaultVal)
                      const to = toArray(sortedKeys[i + 1].Vector, defaultVal)

                      // Linear interpolation
                      return from.map((v: number, idx: number) => v + (to[idx] - v) * t)
                    }
                  }

                  return defaultVal
                }

                const initialNodeKeys = keyframeDragData.current!.initialKeys.get(nodeId)

                // IMPORTANT: Always set default values first, then override if keyframes exist
                // This prevents empty arrays from causing NaN values later
                initialVals.translation = [0, 0, 0]
                initialVals.rotation = [0, 0, 0, 1]
                initialVals.scaling = [1, 1, 1]

                if (initialNodeKeys?.Translation?.Keys?.length > 0) {
                  initialVals.translation = interpolateValue(initialNodeKeys.Translation.Keys, currentFrame, [0, 0, 0])
                }
                if (initialNodeKeys?.Rotation?.Keys?.length > 0) {
                  initialVals.rotation = interpolateValue(initialNodeKeys.Rotation.Keys, currentFrame, [0, 0, 0, 1])
                }
                if (initialNodeKeys?.Scaling?.Keys?.length > 0) {
                  initialVals.scaling = interpolateValue(initialNodeKeys.Scaling.Keys, currentFrame, [1, 1, 1])
                }

                keyframeDragData.current!.initialValues.set(nodeId, initialVals as any)

                // DEBUG: Log initial state
                console.log('[DEBUG MouseDown] NodeId:', nodeId)
                console.log('[DEBUG MouseDown] PivotPoint:', [...nodeWrapper.node.PivotPoint])
                console.log('[DEBUG MouseDown] Matrix (translation part):',
                  nodeWrapper.matrix ? [nodeWrapper.matrix[12], nodeWrapper.matrix[13], nodeWrapper.matrix[14]] : 'N/A')
                console.log('[DEBUG MouseDown] InitialVals.translation:', initialVals.translation || '[0,0,0]')
                console.log('[DEBUG MouseDown] CurrentFrame:', currentFrame)
              }
            }
          })
        }

        // Capture initial node positions for animation binding/keyframe mode
        initialNodePositions.current.clear()

        const { selectedNodeIds } = useSelectionStore.getState()
        console.log('[Viewer] Capturing node positions. Mode:', mainMode, subMode2, 'Selected:', selectedNodeIds.length)
        if (renderer && renderer.rendererData && renderer.rendererData.nodes) {
          selectedNodeIds.forEach(nodeId => {
            const nodeWrapper = renderer.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
            if (nodeWrapper && nodeWrapper.node.PivotPoint) {
              initialNodePositions.current.set(nodeId, [nodeWrapper.node.PivotPoint[0], nodeWrapper.node.PivotPoint[1], nodeWrapper.node.PivotPoint[2]])
            }
          })
          console.log('[Viewer] Captured node positions:', initialNodePositions.current.size)
        }
      } else if (geometrySubMode === 'vertex') {
        console.log('[Viewer] Capturing vertices for vertex mode. Selected count:', currentSelection.selectedVertexIds.length)
        currentSelection.selectedVertexIds.forEach(sel => captureVertex(sel.geosetIndex, sel.index))
        console.log('[Viewer] Captured vertices:', initialVertexPositions.current.size)
      } else if (geometrySubMode === 'face') {
        currentSelection.selectedFaceIds.forEach(sel => {
          if (!renderer) return
          const geoset = renderer.model.Geosets[sel.geosetIndex]
          if (geoset) {
            const fIndex = sel.index * 3
            captureVertex(sel.geosetIndex, geoset.Faces[fIndex])
            captureVertex(sel.geosetIndex, geoset.Faces[fIndex + 1])
            captureVertex(sel.geosetIndex, geoset.Faces[fIndex + 2])
          }
        })
      }
      return // Consume event
    }

    mouseState.current.isDragging = true
    mouseState.current.dragButton = e.button
    mouseState.current.lastMouseX = e.clientX
    mouseState.current.lastMouseY = e.clientY
    mouseState.current.startX = e.clientX
    mouseState.current.startY = e.clientY
    mouseState.current.isCtrlPressed = e.ctrlKey || e.metaKey // Store Ctrl state on mouseDown

    // Check for box selection start
    // const { mainMode } = useSelectionStore.getState() // Moved to top
    // const isCtrl = e.ctrlKey || e.metaKey

    // Box Selection behavior:
    // - View mode: 左键直接旋转摄像机，不进行框选
    // - Other modes: 左键框选，Alt+左键旋转摄像机
    const shouldStartBoxSelection = e.button === 0 && !e.altKey && mainMode !== 'view'

    if (shouldStartBoxSelection) {
      if (cameraRef.current) cameraRef.current.enabled = false
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        mouseState.current.isBoxSelecting = true
        mouseState.current.startX = e.clientX
        mouseState.current.startY = e.clientY
        setSelectionBox({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          width: 0,
          height: 0
        })
      }
    } else {
      mouseState.current.isBoxSelecting = false
      setSelectionBox(null)
    }

    // Prevent default behavior for middle click to avoid scroll icon
    if (e.button === 1) e.preventDefault()
  }



  const handleBoxSelection = (startX: number, startY: number, endX: number, endY: number, isShift: boolean, isCtrl: boolean) => {
    if (!rendererRef.current || !canvasRef.current) return

    const { mainMode, animationSubMode, geometrySubMode, addVertexSelection, addFaceSelection, removeVertexSelection, removeFaceSelection, selectVertices, selectFaces, selectNodes } = useSelectionStore.getState()
    console.log('[Viewer] handleBoxSelection', { mainMode, geometrySubMode, box: { startX, startY, endX, endY } })

    if (mainMode !== 'geometry' && mainMode !== 'animation') return

    // Normalize box coordinates relative to canvas
    // IMPORTANT: getBoundingClientRect returns CSS pixels, but canvas.width/height are actual pixels
    // We need to convert CSS coords to canvas pixel coords
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height

    const boxLeft = (Math.min(startX, endX) - rect.left) * scaleX
    const boxRight = (Math.max(startX, endX) - rect.left) * scaleX
    const boxTop = (Math.min(startY, endY) - rect.top) * scaleY
    const boxBottom = (Math.max(startY, endY) - rect.top) * scaleY

    // Use the same camera matrices as the render loop for accurate projection
    const pMatrix = mat4.create()
    const mvMatrix = mat4.create()

    if (cameraRef.current) {
      cameraRef.current.getMatrix(mvMatrix, pMatrix)
    } else {
      // Fallback to targetCamera if cameraRef is not available
      const { distance, theta, phi, target } = targetCamera.current
      const cameraPos = vec3.create()
      const cameraX = distance * Math.sin(phi) * Math.cos(theta)
      const cameraY = distance * Math.sin(phi) * Math.sin(theta)
      const cameraZ = distance * Math.cos(phi)
      vec3.set(cameraPos, cameraX, cameraY, cameraZ)
      vec3.add(cameraPos, cameraPos, target)

      mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)
      const cameraUp = vec3.fromValues(0, 0, 1)
      mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
    }

    const viewProj = mat4.create()
    mat4.multiply(viewProj, pMatrix, mvMatrix)

    const viewport = [0, 0, canvasRef.current.width, canvasRef.current.height] as [number, number, number, number]

    // Helper to project point
    const project = (v: vec3): vec3 | null => {
      const v4 = [v[0], v[1], v[2], 1.0]
      const clip = [0, 0, 0, 0]

      clip[0] = v4[0] * viewProj[0] + v4[1] * viewProj[4] + v4[2] * viewProj[8] + v4[3] * viewProj[12]
      clip[1] = v4[0] * viewProj[1] + v4[1] * viewProj[5] + v4[2] * viewProj[9] + v4[3] * viewProj[13]
      clip[2] = v4[0] * viewProj[2] + v4[1] * viewProj[6] + v4[2] * viewProj[10] + v4[3] * viewProj[14]
      clip[3] = v4[0] * viewProj[3] + v4[1] * viewProj[7] + v4[2] * viewProj[11] + v4[3] * viewProj[15]

      if (clip[3] === 0) return null

      const ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]]

      // Map to window coordinates
      // x: (ndc.x + 1) * 0.5 * w
      // y: (1 - ndc.y) * 0.5 * h  <-- Flip Y for screen coords
      const x = (ndc[0] + 1) * 0.5 * viewport[2]
      const y = (1 - ndc[1]) * 0.5 * viewport[3]

      // Check if behind camera
      if (clip[3] < 0) return null

      return vec3.fromValues(x, y, ndc[2])
    }

    if (geometrySubMode === 'vertex' || geometrySubMode === 'group' || (mainMode === 'animation' && animationSubMode === 'binding')) {
      const newSelection: { geosetIndex: number, index: number }[] = []
      // affectedGeosetIndices for future use: const affectedGeosetIndices = new Set<number>()

      if (!rendererRef.current) return


      // Get hidden geoset IDs to skip during selection
      const { hiddenGeosetIds, forceShowAllGeosets } = useModelStore.getState()

      for (let i = 0; i < rendererRef.current.model.Geosets.length; i++) {
        // Skip hidden geosets
        if (!forceShowAllGeosets && hiddenGeosetIds.includes(i)) continue

        const geoset = rendererRef.current.model.Geosets[i]
        const vertices = geoset.Vertices

        for (let j = 0; j < vertices.length; j += 3) {
          const v = vec3.fromValues(vertices[j], vertices[j + 1], vertices[j + 2])
          const screenPos = project(v)

          if (screenPos) {
            if (screenPos[0] >= boxLeft && screenPos[0] <= boxRight &&
              screenPos[1] >= boxTop && screenPos[1] <= boxBottom) {
              newSelection.push({ geosetIndex: i, index: j / 3 })
            }
          }
        }
      }

      // If group mode, expand affected geosets to all their vertices based on the vertices we just collected
      if (geometrySubMode === 'group') {
        const engagedGeosetIndices = new Set<number>()
        newSelection.forEach(s => engagedGeosetIndices.add(s.geosetIndex))

        console.log('[Viewer] Group Mode: Engaged geosets from box:', engagedGeosetIndices.size)

        // Clear initial vertex selection and replace with full geosets
        newSelection.length = 0

        engagedGeosetIndices.forEach(idx => {
          if (!rendererRef.current) return
          const geo = rendererRef.current.model.Geosets[idx]
          if (geo && geo.Vertices) {
            const count = geo.Vertices.length / 3
            // Add all vertices
            for (let k = 0; k < count; k++) {
              newSelection.push({ geosetIndex: idx, index: k })
            }
          }
        })
      }

      if (isShift) {
        removeVertexSelection(newSelection)
      } else if (isCtrl) {
        addVertexSelection(newSelection)
      } else {
        selectVertices(newSelection)
      }

    } else if (geometrySubMode === 'face') {
      const newSelection: { geosetIndex: number, index: number }[] = []
      if (!rendererRef.current) return

      // Get hidden geoset IDs to skip during selection
      const { hiddenGeosetIds, forceShowAllGeosets } = useModelStore.getState()

      for (let i = 0; i < rendererRef.current.model.Geosets.length; i++) {
        // Skip hidden geosets
        if (!forceShowAllGeosets && hiddenGeosetIds.includes(i)) continue

        const geoset = rendererRef.current.model.Geosets[i]
        const faces = geoset.Faces
        const vertices = geoset.Vertices

        for (let j = 0; j < faces.length; j += 3) {
          const idx0 = faces[j] * 3
          const idx1 = faces[j + 1] * 3
          const idx2 = faces[j + 2] * 3

          const v0 = vec3.fromValues(vertices[idx0], vertices[idx0 + 1], vertices[idx0 + 2])
          const v1 = vec3.fromValues(vertices[idx1], vertices[idx1 + 1], vertices[idx1 + 2])
          const v2 = vec3.fromValues(vertices[idx2], vertices[idx2 + 1], vertices[idx2 + 2])

          const s0 = project(v0)
          const s1 = project(v1)
          const s2 = project(v2)

          if (s0 && s1 && s2) {
            // Check if any vertex is inside (Partial selection - select face if any part is in box)
            const in0 = s0[0] >= boxLeft && s0[0] <= boxRight && s0[1] >= boxTop && s0[1] <= boxBottom
            const in1 = s1[0] >= boxLeft && s1[0] <= boxRight && s1[1] >= boxTop && s1[1] <= boxBottom
            const in2 = s2[0] >= boxLeft && s2[0] <= boxRight && s2[1] >= boxTop && s2[1] <= boxBottom

            if (in0 || in1 || in2) {
              newSelection.push({ geosetIndex: i, index: j / 3 })
            }
          }
        }
      }

      if (isShift) {
        removeFaceSelection(newSelection)
      } else if (isCtrl) {
        addFaceSelection(newSelection)
      } else {
        selectFaces(newSelection)
      }
    } else if (mainMode === 'animation' && animationSubMode !== 'binding') {
      // Box Select Nodes
      const newSelection: number[] = []
      if (!rendererRef.current || !rendererRef.current.rendererData || !rendererRef.current.rendererData.nodes) return

      rendererRef.current.rendererData.nodes.forEach((nodeWrapper: any) => {
        const pivot = nodeWrapper.node.PivotPoint
        const worldPos = vec3.create()
        vec3.transformMat4(worldPos, pivot, nodeWrapper.matrix)

        const screenPos = project(worldPos)
        if (screenPos) {
          if (screenPos[0] >= boxLeft && screenPos[0] <= boxRight &&
            screenPos[1] >= boxTop && screenPos[1] <= boxBottom) {
            newSelection.push(nodeWrapper.node.ObjectId)
          }
        }
      })

      if (isCtrl) {
        const current = useSelectionStore.getState().selectedNodeIds
        const combined = Array.from(new Set([...current, ...newSelection]))
        selectNodes(combined)
      } else {
        selectNodes(newSelection)
      }
    }
  }



  const handleSelectionClick = (clientX: number, clientY: number, isShift: boolean, isCtrl: boolean) => {
    if (!rendererRef.current || !canvasRef.current) return

    const { mainMode, animationSubMode, geometrySubMode, selectVertex, selectVertices, selectFace, addVertexSelection, addFaceSelection, removeVertexSelection, removeFaceSelection, clearAllSelections, selectNode, setPickedGeosetIndex } = useSelectionStore.getState()

    // === Ctrl+Click Geoset Picking (works in any mode) ===
    if (isCtrl) {
      const rect = canvasRef.current.getBoundingClientRect()
      // Convert CSS coords to canvas pixel coords
      const scaleX = canvasRef.current.width / rect.width
      const scaleY = canvasRef.current.height / rect.height
      const x = (clientX - rect.left) * scaleX
      const y = (clientY - rect.top) * scaleY

      // Calculate camera and ray
      // Calculate camera and ray
      // Use the actual camera matrices to ensure perfect sync with rendering
      const pMatrix = mat4.create()
      const mvMatrix = mat4.create()
      const cameraPos = vec3.create()

      if (cameraRef.current) {
        cameraRef.current.getMatrix(mvMatrix, pMatrix)
        vec3.copy(cameraPos, cameraRef.current.position)
      } else {
        // Fallback if cameraRef is missing (should not happen usually)
        const { distance, theta, phi, target } = targetCamera.current
        const cameraX = distance * Math.sin(phi) * Math.cos(theta)
        const cameraY = distance * Math.sin(phi) * Math.sin(theta)
        const cameraZ = distance * Math.cos(phi)
        vec3.set(cameraPos, cameraX, cameraY, cameraZ)
        vec3.add(cameraPos, cameraPos, target)

        mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)
        const cameraUp = vec3.fromValues(0, 0, 1)
        mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
      }

      // Unproject to get ray (using canvas pixel coordinates)
      const ndcX = (x / canvasRef.current.width) * 2 - 1
      const ndcY = 1 - (y / canvasRef.current.height) * 2

      const invProj = mat4.create()
      mat4.invert(invProj, pMatrix)

      const invView = mat4.create()
      mat4.invert(invView, mvMatrix) // View matrix

      // Ray in Clip Space (4D)
      const rayClip4 = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)

      // Ray in Eye Space
      const rayEye4 = vec4.create()
      vec4.transformMat4(rayEye4, rayClip4, invProj)
      rayEye4[2] = -1.0
      rayEye4[3] = 0.0

      // Ray in World Space
      const rayWorld4 = vec4.create()
      vec4.transformMat4(rayWorld4, rayEye4, invView)

      const rayDir = vec3.fromValues(rayWorld4[0], rayWorld4[1], rayWorld4[2])
      vec3.normalize(rayDir, rayDir)

      // Use accurate ray-triangle intersection to find closest geoset
      const geosets = rendererRef.current.model.Geosets || []
      const result = pickClosestGeoset(cameraPos, rayDir, geosets)
      if (result !== null) {
        console.log('[Viewer] Ctrl+Click picked geoset:', result.geosetIndex, 'at distance:', result.distance)
        setPickedGeosetIndex(result.geosetIndex)

        // Visual feedback: temporarily highlight the picked geoset
        const { setHoveredGeosetId, setSelectedGeosetIndex } = useModelStore.getState()
        setHoveredGeosetId(result.geosetIndex)
        // Persist selection to store for sync with managers
        setSelectedGeosetIndex(result.geosetIndex)
        // Flash effect - clear after 300ms
        setTimeout(() => {
          setHoveredGeosetId(null)
        }, 300)

        return // Stop further processing
      } else {
        // Clear picked geoset if clicked on empty space
        setPickedGeosetIndex(null)
      }
    }

    // Handle Animation Mode Bone Selection
    // In Binding Mode, we want to allow selecting BOTH nodes and vertices.
    // Priority: Node > Vertex (if clicked on both)
    if (mainMode === 'animation') {
      // Simple distance check for nodes
      // Project all nodes to screen and find closest
      const rect = canvasRef.current.getBoundingClientRect()
      // Convert CSS coords to canvas pixel coords
      const scaleX = canvasRef.current.width / rect.width
      const scaleY = canvasRef.current.height / rect.height
      const x = (clientX - rect.left) * scaleX
      const y = (clientY - rect.top) * scaleY

      // Use the same camera matrices as render loop for accurate projection
      const pMatrix = mat4.create()
      const mvMatrix = mat4.create()

      if (cameraRef.current) {
        cameraRef.current.getMatrix(mvMatrix, pMatrix)
      } else {
        const { distance, theta, phi, target } = targetCamera.current
        const cameraPos = vec3.create()
        const cameraX = distance * Math.sin(phi) * Math.cos(theta)
        const cameraY = distance * Math.sin(phi) * Math.sin(theta)
        const cameraZ = distance * Math.cos(phi)
        vec3.set(cameraPos, cameraX, cameraY, cameraZ)
        vec3.add(cameraPos, cameraPos, target)

        mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)
        const cameraUp = vec3.fromValues(0, 0, 1)
        mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
      }

      const viewProj = mat4.create()
      mat4.multiply(viewProj, pMatrix, mvMatrix)
      const viewport = [0, 0, canvasRef.current.width, canvasRef.current.height] as [number, number, number, number]

      const project = (v: vec3): vec3 | null => {
        const v4 = [v[0], v[1], v[2], 1.0]
        const clip = [0, 0, 0, 0]
        clip[0] = v4[0] * viewProj[0] + v4[1] * viewProj[4] + v4[2] * viewProj[8] + v4[3] * viewProj[12]
        clip[1] = v4[0] * viewProj[1] + v4[1] * viewProj[5] + v4[2] * viewProj[9] + v4[3] * viewProj[13]
        clip[2] = v4[0] * viewProj[2] + v4[1] * viewProj[6] + v4[2] * viewProj[10] + v4[3] * viewProj[14]
        clip[3] = v4[0] * viewProj[3] + v4[1] * viewProj[7] + v4[2] * viewProj[11] + v4[3] * viewProj[15]

        if (clip[3] === 0) return null
        const ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]]
        const sx = (ndc[0] + 1) * 0.5 * viewport[2]
        const sy = (1 - ndc[1]) * 0.5 * viewport[3]
        if (clip[3] < 0) return null
        return vec3.fromValues(sx, sy, ndc[2])
      }

      let closestNodeId = -1
      let minDist = 20 // Selection threshold pixels

      if (rendererRef.current.rendererData && rendererRef.current.rendererData.nodes) {
        rendererRef.current.rendererData.nodes.forEach((nodeWrapper: any) => {
          // Check Pivot Point
          const pivot = nodeWrapper.node.PivotPoint
          if (!pivot) return // 跳过没有 PivotPoint 的节点
          // Apply current transformation
          const worldPos = vec3.create()
          vec3.transformMat4(worldPos, pivot, nodeWrapper.matrix)

          const screenPos = project(worldPos)
          if (screenPos) {
            const dx = screenPos[0] - x
            const dy = screenPos[1] - y
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < minDist) {
              minDist = d
              closestNodeId = nodeWrapper.node.ObjectId
            }
          }
        })
      }

      if (closestNodeId !== -1) {
        // Check if we are in parent picking mode
        const { isPickingParent, selectedNodeIds, setIsPickingParent } = useSelectionStore.getState()
        if (isPickingParent && selectedNodeIds.length === 1) {
          // Execute SetNodeParentCommand to change the selected node's parent to the clicked node
          const selectedNodeId = selectedNodeIds[0]
          if (closestNodeId !== selectedNodeId) { // Don't allow setting self as parent
            const cmd = new SetNodeParentCommand(rendererRef.current, selectedNodeId, closestNodeId)
            commandManager.execute(cmd)
          }
          setIsPickingParent(false) // Exit picking mode after setting parent
          return
        }
        selectNode(closestNodeId, isCtrl) // Support multi-select with Ctrl
        return // Stop here if we hit a node
      } else if (!isCtrl && animationSubMode !== 'binding') {
        // Only clear selection if NOT in binding mode (because in binding mode we might want to select a vertex next)
        selectNode(-1)
      }

      // If we are in Binding Mode and didn't hit a node, continue to vertex selection
      if (animationSubMode !== 'binding') {
        return
      }
    }

    if (mainMode !== 'geometry' && !(mainMode === 'animation' && animationSubMode === 'binding')) return

    const rect = canvasRef.current.getBoundingClientRect()
    // Convert CSS coords to canvas pixel coords
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height
    const x = (clientX - rect.left) * scaleX
    const y = (clientY - rect.top) * scaleY

    // Calculate ray from camera using same matrices as render loop
    const pMatrix = mat4.create()
    const mvMatrix = mat4.create()
    const cameraPos = vec3.create()

    if (cameraRef.current) {
      cameraRef.current.getMatrix(mvMatrix, pMatrix)
      vec3.copy(cameraPos, cameraRef.current.position)
    } else {
      const { distance, theta, phi, target } = targetCamera.current
      const cameraX = distance * Math.sin(phi) * Math.cos(theta)
      const cameraY = distance * Math.sin(phi) * Math.sin(theta)
      const cameraZ = distance * Math.cos(phi)
      vec3.set(cameraPos, cameraX, cameraY, cameraZ)
      vec3.add(cameraPos, cameraPos, target)

      mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)
      const cameraUp = vec3.fromValues(0, 0, 1)
      mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
    }

    // Unproject to get ray
    // Normalized Device Coordinates
    const ndcX = (x / canvasRef.current.width) * 2 - 1
    const ndcY = 1 - (y / canvasRef.current.height) * 2 // Flip Y

    const invProj = mat4.create()
    mat4.invert(invProj, pMatrix)

    const invView = mat4.create()
    mat4.invert(invView, mvMatrix)

    const rayClip = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
    const rayEye = vec4.create()
    vec4.transformMat4(rayEye, rayClip, invProj)
    rayEye[2] = -1.0
    rayEye[3] = 0.0

    const rayWorld = vec4.create()
    vec4.transformMat4(rayWorld, rayEye, invView)
    const rayDir = vec3.fromValues(rayWorld[0], rayWorld[1], rayWorld[2])
    vec3.normalize(rayDir, rayDir)

    // In Binding Mode OR Group Mode, treat as vertex selection for raycasting
    const effectiveSubMode = ((mainMode === 'animation' && animationSubMode === 'binding') || geometrySubMode === 'group') ? 'vertex' : geometrySubMode

    // DISABLED: Single-click vertex/face selection in geometry mode
    // Only box selection is allowed for vertices/faces
    // But we still allow clicking to clear selection
    if (mainMode === 'geometry') {
      // In geometry mode, single-click only clears selection (if not shift/ctrl)
      // EXCEPTION: Group Mode supports single click selection
      if (!isShift && !isCtrl && geometrySubMode !== 'group') {
        clearAllSelections()
      }
      if (geometrySubMode !== 'group') return
    }

    // Animation binding mode still supports single-click
    const result = rendererRef.current.raycast(cameraPos, rayDir, effectiveSubMode)

    if (result) {
      if (effectiveSubMode === 'vertex') {
        const sel = result as { geosetIndex: number, index: number }

        if (geometrySubMode === 'group') {
          // Group Selection: Select ALL vertices in this geoset
          const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
          if (geoset) {
            const allVertices: { geosetIndex: number, index: number }[] = []
            const count = geoset.Vertices.length / 3
            for (let i = 0; i < count; i++) {
              allVertices.push({ geosetIndex: sel.geosetIndex, index: i })
            }

            if (isShift) {
              removeVertexSelection(allVertices)
            } else if (isCtrl) {
              addVertexSelection(allVertices)
            } else {
              selectVertices(allVertices)
            }
          }
        } else {
          // Normal Vertex Selection (Actually disabled by block above, but keeping for reference/animation mode)
          if (isShift) {
            removeVertexSelection([sel])
          } else if (isCtrl) {
            addVertexSelection([sel])
          } else {
            selectVertex(sel, false)
          }
        }
      } else if (geometrySubMode === 'face') {
        const sel = result as { geosetIndex: number, index: number }
        if (isShift) {
          removeFaceSelection([sel])
        } else if (isCtrl) {
          addFaceSelection([sel])
        } else {
          selectFace(sel, false)
        }
      }
    } else if (!isShift && !isCtrl) {
      clearAllSelections()
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if input is focused, UNLESS it's a checkbox/radio/button which shouldn't block shortcuts like Undo
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
        const type = (document.activeElement as HTMLInputElement).type
        const allowedTypes = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image']
        if (!allowedTypes.includes(type)) {
          return
        }
      }

      switch (e.key.toLowerCase()) {
        case 'f': // Toggle wireframe/textured render mode
          onToggleWireframe()
          break
        case '0': // Camera Reset / Focus
          vec3.set(targetCamera.current.target, 0, 0, 0)
          targetCamera.current.distance = 500
          targetCamera.current.theta = Math.PI / 4
          targetCamera.current.phi = Math.PI / 4
          syncCameraToOrbit()
          break
        case '1': // Front
          targetCamera.current.theta = -Math.PI / 2
          targetCamera.current.phi = Math.PI / 2
          syncCameraToOrbit()
          break
        case '2': // Back
          targetCamera.current.theta = Math.PI / 2
          targetCamera.current.phi = Math.PI / 2
          syncCameraToOrbit()
          break
        case '3': // Left
          targetCamera.current.theta = 0
          targetCamera.current.phi = Math.PI / 2
          syncCameraToOrbit()
          break
        case '4': // Right
          targetCamera.current.theta = Math.PI
          targetCamera.current.phi = Math.PI / 2
          syncCameraToOrbit()
          break
        case '5': // Top
          targetCamera.current.phi = 0.01
          syncCameraToOrbit()
          break
        case '6': // Bottom
          targetCamera.current.phi = Math.PI - 0.01
          syncCameraToOrbit()
          break
        case '`': // View selected camera (~ key) - Toggle mode
          {
            if (inCameraView.current) {
              // Exit camera view: restore previous state if available, or reset to model center
              if (previousCameraState.current) {
                targetCamera.current.distance = previousCameraState.current.distance
                targetCamera.current.theta = previousCameraState.current.theta
                targetCamera.current.phi = previousCameraState.current.phi
                vec3.set(targetCamera.current.target, previousCameraState.current.target[0], previousCameraState.current.target[1], previousCameraState.current.target[2])
                previousCameraState.current = null
              } else {
                vec3.set(targetCamera.current.target, 0, 0, 0)
              }
              syncCameraToOrbit()
              inCameraView.current = false
            } else {
              // Enter camera view
              // First, save current state
              previousCameraState.current = {
                distance: targetCamera.current.distance,
                theta: targetCamera.current.theta,
                phi: targetCamera.current.phi,
                target: vec3.clone(targetCamera.current.target) as Float32Array
              }

              const selector = document.getElementById('camera-selector') as HTMLSelectElement;
              if (selector && selector.value !== '-1') {
                const { nodes: storeNodes } = useModelStore.getState();
                const cameraList = storeNodes.filter((n: any) => n.type === 'Camera');
                const idx = parseInt(selector.value);
                if (idx >= 0 && idx < cameraList.length) {
                  const cam = cameraList[idx];
                  const isArrayLike = (v: any) => Array.isArray(v) || v instanceof Float32Array || ArrayBuffer.isView(v);
                  const toArray = (v: any) => v instanceof Float32Array ? Array.from(v) : v;
                  const getPos = (prop: any, directProp?: any) => {
                    if (directProp && isArrayLike(directProp)) return toArray(directProp);
                    if (isArrayLike(prop)) return toArray(prop);
                    if (prop && prop.Keys && prop.Keys.length > 0) {
                      const v = prop.Keys[0].Vector;
                      return v ? toArray(v) : [0, 0, 0];
                    }
                    return [0, 0, 0];
                  };
                  if (cam) {
                    // Cast to any to access properties that might be missing in strict type defs
                    const camAny = cam as any;
                    const pos = getPos(camAny.Translation, camAny.Position);
                    const target = getPos(camAny.TargetTranslation, camAny.TargetPosition);

                    const dx = pos[0] - target[0];
                    const dy = pos[1] - target[1];
                    const dz = pos[2] - target[2];
                    let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (distance < 0.1) distance = 100;

                    let phi = Math.acos(dz / distance);
                    if (isNaN(phi)) phi = Math.PI / 4;
                    phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));

                    let theta = Math.atan2(dy, dx);
                    if (isNaN(theta)) theta = 0;

                    targetCamera.current.distance = distance;
                    targetCamera.current.theta = theta;
                    targetCamera.current.phi = phi;
                    vec3.set(targetCamera.current.target, target[0], target[1], target[2]);
                    syncCameraToOrbit()
                    inCameraView.current = true
                  }
                }
              }
            }
            break
          }
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            if (e.shiftKey) {
              commandManager.redo()
            } else {
              commandManager.undo()
            }
          }
          break
        case 'y':
          if (e.ctrlKey || e.metaKey) {
            commandManager.redo()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggleWireframe])

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current

    const resizeObserver = new ResizeObserver(() => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (width > 0 && height > 0) {
        canvas.width = width
        canvas.height = height

        // Update WebGL viewport
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
        if (gl) {
          gl.viewport(0, 0, width, height)
        }

        if (renderRef.current) {
          renderRef.current(performance.now())
        }
      }
    })
    resizeObserver.observe(canvas)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const loadModel = async (path: string, inMemoryData?: any) => {
    // Cleanup old renderer and animation frames
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }

    // Reset lastFrameTime to prevent large delta on first frame after model reload
    // This fixes animation jumping past interval bounds when reloading models
    lastFrameTime.current = performance.now()

    // Destroy old renderer to prevent memory leaks and clear the scene
    if (renderer) {
      console.log('[Viewer] Destroying old renderer')
      try {
        renderer.destroy()
      } catch (e) {
        console.warn('[Viewer] Error destroying renderer:', e)
      }
      setRenderer(null)
    }

    // Clear the canvas to remove any visual artifacts from the old model
    const canvas = canvasRef.current
    if (canvas) {
      const clearGl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (clearGl) {
        // Use alpha 0 to avoid black background bleeding through transparent textures
        clearGl.clearColor(0, 0, 0, 0)
        clearGl.clear(clearGl.COLOR_BUFFER_BIT | clearGl.DEPTH_BUFFER_BIT)
      }
    }

    try {
      console.time('[Viewer] FullModelLoad')
      if (!canvas) {
        console.error('[Viewer] Canvas reference is null')
        return
      }

      // Create WebGL context with alpha channel enabled
      const contextAttributes: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      }

      let gl: WebGL2RenderingContext | WebGLRenderingContext | null = canvas.getContext('webgl2', contextAttributes) as WebGL2RenderingContext | null
      if (!gl) {
        gl = canvas.getContext('webgl', contextAttributes) as WebGLRenderingContext | null
      }
      if (!gl) {
        console.error('[Viewer] WebGL not supported')
        return
      }

      gl.clearColor(0.2, 0.2, 0.2, 0)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      // Set initial viewport
      gl.viewport(0, 0, canvas.width, canvas.height)

      gridRenderer.current.init(gl)
      debugRenderer.current.init(gl)

      let model: any

      console.time('[Viewer] MDX Parse')
      const parseStart = performance.now()
      if (inMemoryData) {
        console.log('[Viewer] Loading model from in-memory data')
        model = inMemoryData
      } else {
        const buffer = await readFile(path)
        if (path.toLowerCase().endsWith('.mdl')) {
          const text = new TextDecoder().decode(buffer)
          model = parseMDL(text)
        } else {
          model = parseMDX(buffer.buffer)
        }
      }
      console.timeEnd('[Viewer] MDX Parse')
      console.log(`[Viewer] Model Parsing took ${(performance.now() - parseStart).toFixed(1)}ms`)

      // Log to production CMD window
      logModelInfo(path, model, performance.now() - parseStart)
      console.log('[Viewer] Parsed model:', {
        Sequences: model.Sequences?.length || 0,
        ParticleEmitters2: model.ParticleEmitters2?.length || 0,
        Nodes: model.Nodes?.length || 0,
        Bones: model.Bones?.length || 0,
        GlobalSequences: model.GlobalSequences?.length || 0,
      })
      if (model.Sequences && model.Sequences.length > 0) {
        // Log ALL sequences with their intervals to trace corruption
        model.Sequences.forEach((seq: any, index: number) => {
          const intervalType = seq.Interval instanceof Uint32Array ? 'Uint32Array' : Array.isArray(seq.Interval) ? 'Array' : typeof seq.Interval;
          console.log(`[Viewer] Sequence ${index} "${seq.Name}" Interval (${intervalType}): [${seq.Interval[0]}, ${seq.Interval[1]}]`);
        });
      }
      if (model.ParticleEmitters2 && model.ParticleEmitters2.length > 0) {
        console.log('[Viewer] First ParticleEmitter2:', model.ParticleEmitters2[0])
      }

      ignoreNextModelDataUpdate.current = true
      onModelLoaded(model)

      // CRITICAL FIX: Validate and fix ParticleEmitters2 before creating renderer
      // This prevents production-only rendering issues caused by invalid/missing properties
      validateAllParticleEmitters(model)

      const rendererStart = performance.now()
      const newRenderer = new ModelRenderer(model)
      newRenderer.initGL(gl)
      // NOTE: setRenderer(newRenderer) is called AFTER texture loading to avoid race condition
      newRenderer.update(0)
      resetCamera()
      console.log(`[Viewer] Renderer Init took ${(performance.now() - rendererStart).toFixed(1)}ms`)

      // Load textures using concurrent loader
      await loadAllTextures(model, newRenderer, path)

      loadTeamColorTextures(teamColor)

      // Set renderer AFTER textures are loaded to avoid race condition
      console.log('[Viewer] loadModel: All textures loaded, setting renderer')
      setRenderer(newRenderer)
      console.timeEnd('[Viewer] FullModelLoad')
    } catch (error) {
      console.error('[Viewer] Error loading model:', error)
    }
  }

  const reloadRendererWithData = async (model: any, path: string) => {
    console.log('[Viewer] ========== FULL RELOAD START ==========')
    console.log('[Viewer] reloadRendererWithData called with path:', path)
    console.log('[Viewer] Model data summary:', {
      Geosets: model.Geosets?.length || 0,
      Textures: model.Textures?.length || 0,
      Materials: model.Materials?.length || 0,
      ParticleEmitters2: model.ParticleEmitters2?.length || 0,
      Nodes: model.Nodes?.length || 0,
      Sequences: model.Sequences?.length || 0
    })
    console.time('[Viewer] ReloadModel')
    // CRITICAL: Capture old renderer's Geoset geometry BEFORE destroying
    // The TypedArrays (Vertices, Faces, Normals) are lost in store's spread operations
    // NOTE: This logic is currently disabled, see commented block below
    // let oldGeosets: any[] | null = null
    // if (renderer && renderer.model && renderer.model.Geosets) {
    //   oldGeosets = renderer.model.Geosets
    // }

    // Cleanup old renderer
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }

    if (renderer) {
      try {
        // Safety check for destroy method
        if (typeof renderer.destroy === 'function') {
          renderer.destroy()
        }
      } catch (e) {
        console.warn('[Viewer] Error destroying renderer:', e)
      }
      setRenderer(null)
    }

    try {
      const canvas = canvasRef.current
      if (!canvas) {
        console.error('[Viewer] Canvas reference is null')
        return
      }

      let gl: WebGL2RenderingContext | WebGLRenderingContext | null = canvas.getContext('webgl2') as WebGL2RenderingContext | null
      if (!gl) {
        gl = canvas.getContext('webgl') as WebGLRenderingContext | null
      }
      if (!gl) {
        console.error('[Viewer] WebGL not supported')
        return
      }

      // Copy Geoset geometry data from captured old Geosets
      // The modelData from store loses TypedArrays (Vertices, Faces, Normals) during spread operations
      // BUT: Only do this when geoset count is the same! If count changed (merge/delete),
      // the new geosets already have the correct geometry from the merge operation.
      // CRITICAL UPDATE: Commented out geometry copying. 
      // While this was intended to preserve TypedArrays, it causes severe issues when geometry is modified
      // (e.g. UV Editor splitting vertices -> vertex count changes).
      // Overwriting with oldGeosets reverts these changes or causes data mismatch (Index out of bounds).
      // The performance cost of re-parsing Arrays to TypedArrays is negligible compared to correctness.
      /*
      if (oldGeosets && model.Geosets && oldGeosets.length === model.Geosets.length) {
        console.log('[Viewer] Copying geometry from old geosets (same count)');
        for (let i = 0; i < model.Geosets.length; i++) {
          const oldGeoset = oldGeosets[i]
          const newGeoset = model.Geosets[i]
  
          // Always copy geometry data from old geoset, overwriting anything in new geoset
          if (oldGeoset.Vertices) {
            newGeoset.Vertices = oldGeoset.Vertices
          }
          if (oldGeoset.Faces) {
            newGeoset.Faces = oldGeoset.Faces
          }
          if (oldGeoset.Normals) {
            newGeoset.Normals = oldGeoset.Normals
          }
          if (oldGeoset.TVertices) {
            newGeoset.TVertices = oldGeoset.TVertices
          }
          if (oldGeoset.Groups) {
            newGeoset.Groups = oldGeoset.Groups
          }
          if (oldGeoset.SkinWeights) {
            newGeoset.SkinWeights = oldGeoset.SkinWeights
          }
          if (oldGeoset.Tangents) {
            newGeoset.Tangents = oldGeoset.Tangents
          }
          if (oldGeoset.VertexGroup) {
            newGeoset.VertexGroup = oldGeoset.VertexGroup
          }
        }
      } else if (oldGeosets && model.Geosets) {
        console.log('[Viewer] Geoset count changed (old:', oldGeosets.length, 'new:', model.Geosets.length, '), using merged geometry directly');
      }
      */

      // CRITICAL FIX: Validate and fix ParticleEmitters2 before creating renderer
      // Same validation as in loadModel - prevents production-only rendering issues
      console.log('[Viewer] Step 1: Validating particles...')
      validateAllParticleEmitters(model)
      console.log('[Viewer] Step 1: Particle validation complete')

      console.log('[Viewer] Step 2: Creating ModelRenderer...')
      const rendererStart = performance.now()
      const newRenderer = new ModelRenderer(model)
      console.log('[Viewer] Step 2: ModelRenderer created')

      console.log('[Viewer] Step 3: Initializing WebGL...')
      newRenderer.initGL(gl)
      console.log('[Viewer] Step 3: WebGL initialized')

      // NOTE: setRenderer(newRenderer) is called AFTER texture loading to avoid race condition
      console.log('[Viewer] Step 4: First update(0)...')
      newRenderer.update(0)
      console.log('[Viewer] Step 4: First update complete')

      console.log('[Viewer] Step 5: Resetting camera...')
      resetCamera()
      console.log(`[Viewer] reloadRendererWithData: Renderer Init took ${(performance.now() - rendererStart).toFixed(1)}ms`)

      // Load textures using concurrent loader
      console.log('[Viewer] Step 6: Loading textures...')
      await loadAllTextures(model, newRenderer, path)
      console.log('[Viewer] Step 6: Textures loaded')

      console.log('[Viewer] Step 7: Loading team color textures...')
      loadTeamColorTextures(teamColor)
      console.log('[Viewer] Step 7: Team colors loaded')

      // Set renderer AFTER textures are loaded to avoid race condition where
      // render loop starts before textures are available in GPU
      console.log('[Viewer] Step 8: Setting renderer state...')

      // CRITICAL: Force set the correct animation sequence on the NEW renderer
      // before setting it as state. This ensures animation is restored correctly
      // after a full reload (e.g. after creating a particle).
      const currentAnimIndex = useModelStore.getState().currentSequence
      console.log('[Viewer] Step 8a: Setting animation sequence on new renderer to:', currentAnimIndex)
      if (typeof (newRenderer as any).setSequence === 'function' && currentAnimIndex >= 0) {
        (newRenderer as any).setSequence(currentAnimIndex)
      }

      setRenderer(newRenderer)
      console.log('[Viewer] ========== FULL RELOAD COMPLETE ==========')
      console.timeEnd('[Viewer] ReloadModel')
    } catch (error) {
      console.error('[Viewer] ========== FULL RELOAD CRASHED ==========')
      console.error('[Viewer] Error reloading renderer with data:', error)
      console.error('[Viewer] Stack:', (error as Error).stack)
    }
  }

  // Watch for renderer reload trigger from store (e.g., when particles are updated)
  const rendererReloadTrigger = useModelStore((state) => state.rendererReloadTrigger)
  const lastReloadTrigger = useRef(0) // Start at 0 to match initial store value
  useEffect(() => {
    // Skip only initial mount (when trigger is still 0)
    // After that, any change should trigger sync
    const isInitialMount = rendererReloadTrigger === 0
    const hasChanged = rendererReloadTrigger !== lastReloadTrigger.current

    if (!isInitialMount && hasChanged) {
      console.log('[Viewer] Model data sync triggered, trigger:', rendererReloadTrigger)

      // Sync model data to renderer without recreating the entire renderer
      // This is the LIGHTWEIGHT SYNC approach - only updates internal data arrays
      if (renderer && modelData) {
        // Check for structural changes that require full reload
        const { needsReload, reason } = checkForStructuralChanges(modelData, renderer.model)

        if (needsReload) {
          console.log('[Viewer] Structural change detected:', reason, '. Triggering full reload.')
          reloadRendererWithData(modelData, modelPath || '')
          lastReloadTrigger.current = rendererReloadTrigger
          return
        }
        // === NODES ===
        // Sync Nodes array for correct node transforms - MUST do this BEFORE ParticleEmitters2
        if (modelData.Nodes) {
          renderer.model.Nodes = modelData.Nodes
          // Reinitialize rendererData.nodes so new nodes are accessible
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncNodes === 'function') {
            (renderer as any).modelInstance.syncNodes()
          }
        }

        // === PARTICLES ===
        // Sync ParticleEmitters2 array - always sync to handle deletions
        // Default to empty array if undefined to properly handle particle node deletion
        // CRITICAL: Validate particles BEFORE syncing to prevent crashes from invalid new particles
        if (modelData.ParticleEmitters2 && modelData.ParticleEmitters2.length > 0) {
          validateAllParticleEmitters({
            ParticleEmitters2: modelData.ParticleEmitters2,
            Textures: modelData.Textures
          })
        }
        renderer.model.ParticleEmitters2 = modelData.ParticleEmitters2 || []
        console.log('[Viewer] Synced ParticleEmitters2:', renderer.model.ParticleEmitters2.length, 'emitters')

        // === RIBBON EMITTERS ===
        if (modelData.RibbonEmitters) {
          renderer.model.RibbonEmitters = modelData.RibbonEmitters
        }

        // === LIGHTS ===
        if (modelData.Lights) {
          renderer.model.Lights = modelData.Lights
        }

        // === BONES ===
        if (modelData.Bones) {
          renderer.model.Bones = modelData.Bones
        }

        // === HELPERS ===
        if (modelData.Helpers) {
          renderer.model.Helpers = modelData.Helpers
        }

        // === ATTACHMENTS ===
        if (modelData.Attachments) {
          renderer.model.Attachments = modelData.Attachments
        }

        // === EVENT OBJECTS ===
        if (modelData.EventObjects) {
          renderer.model.EventObjects = modelData.EventObjects
        }

        // === COLLISION SHAPES ===
        if (modelData.CollisionShapes) {
          renderer.model.CollisionShapes = modelData.CollisionShapes
        }

        // === CAMERAS ===
        if (modelData.Cameras) {
          renderer.model.Cameras = modelData.Cameras
        }

        // === MATERIALS & TEXTURES ===
        if (modelData.Materials) {
          console.log('[Viewer] Syncing materials. Count:', modelData.Materials.length)
          if (modelData.Materials.length > 0) {
            console.log('[Viewer] Last Material:', JSON.stringify(modelData.Materials[modelData.Materials.length - 1]));
          }
          renderer.model.Materials = modelData.Materials
          // Lightweight sync: rebuild materialLayerTextureID cache
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncMaterials === 'function') {
            (renderer as any).modelInstance.syncMaterials()
          }
        }
        if (modelData.Textures) {
          renderer.model.Textures = modelData.Textures
        }
        if (modelData.TextureAnims) {
          renderer.model.TextureAnims = modelData.TextureAnims
          console.log('[Viewer] Synced TextureAnims:', modelData.TextureAnims.length, 'anims')
          // Debug: log GlobalSeqId for each anim's Translation
          modelData.TextureAnims.forEach((anim: any, i: number) => {
            if (anim.Translation) {
              console.log(`[Viewer] TextureAnim[${i}].Translation GlobalSeqId:`, anim.Translation.GlobalSeqId, 'Keys:', anim.Translation.Keys?.length)
            }
          })
        }

        // === GEOSETS ===
        // NOTE: Do NOT replace renderer.model.Geosets with modelData.Geosets!
        // Commands (PasteVertices, Split, Delete) directly modify renderer.model.Geosets
        // and create GPU buffers. Overwriting here would break buffer references.
        // Only sync UV texture coordinate buffers for existing geosets.
        if (modelData.Geosets && renderer.model.Geosets) {
          const minLen = Math.min(modelData.Geosets.length, renderer.model.Geosets.length)
          for (let i = 0; i < minLen; i++) {
            const geoset = modelData.Geosets[i]
            if (geoset?.TVertices?.[0]) {
              const uvData = geoset.TVertices[0]
              // Convert to Float32Array if needed
              const float32Data = uvData instanceof Float32Array
                ? uvData
                : new Float32Array(uvData)
                // updateGeosetTexCoords is an optional method that may or may not exist
                ; (renderer as any).updateGeosetTexCoords?.(i, float32Data)
            }
          }
        }

        // === GEOSET ANIMATIONS ===
        if (modelData.GeosetAnims) {
          renderer.model.GeosetAnims = modelData.GeosetAnims
        }

        // === SEQUENCES ===
        if (modelData.Sequences) {
          renderer.model.Sequences = modelData.Sequences
        }

        // === GLOBAL SEQUENCES ===
        // CRITICAL: Must call syncGlobalSequences() to extend globalSequencesFrames array
        // for new GlobalSequences, otherwise TextureAnimations using them won't animate
        if (modelData.GlobalSequences) {
          renderer.model.GlobalSequences = modelData.GlobalSequences
          // Sync the globalSequencesFrames array for new entries
          if ((renderer as any).modelInstance?.syncGlobalSequences) {
            (renderer as any).modelInstance.syncGlobalSequences()
            console.log('[Viewer] Called syncGlobalSequences() for', modelData.GlobalSequences.length, 'GlobalSequences')
          }
        }

        // === PIVOT POINTS ===
        if (modelData.PivotPoints) {
          renderer.model.PivotPoints = modelData.PivotPoints
        }

        console.log('[Viewer] Lightweight sync complete')
      }
    }
    lastReloadTrigger.current = rendererReloadTrigger
  }, [rendererReloadTrigger, modelData, renderer])

  // Handle Animation and Mode Changes
  useEffect(() => {
    if (renderer && canvasRef.current) {
      const contextAttributes: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true
      }
      const gl = canvasRef.current.getContext('webgl2', contextAttributes) || canvasRef.current.getContext('webgl', contextAttributes)
      if (!gl) return undefined

      // Clear the canvas before initializing (use alpha 0 for transparency)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      // Reinitialize helper renderers with the current GL context
      gridRenderer.current.init(gl)
      debugRenderer.current.init(gl)
      gizmoRenderer.current.init(gl)

      // Reset time tracking to prevent huge delta on first frame after reload
      lastFrameTime.current = performance.now()

      const render = (time: DOMHighResTimeStamp) => {
        try {

          if (!gl || !canvasRef.current || !renderer) {
            animationFrameId.current = requestAnimationFrame(render)
            return
          }

          const canvas = canvasRef.current
          // CRITICAL: Use rendererRef.current instead of closure-captured 'renderer'
          // to always get the LATEST renderer, even if component re-renders with new renderer
          const mdlRenderer = rendererRef.current
          if (!mdlRenderer) {
            animationFrameId.current = requestAnimationFrame(render)
            return
          }
          const delta = time - lastFrameTime.current
          lastFrameTime.current = time

          const cameraPos = vec3.create()
          const cameraUp = vec3.fromValues(0, 0, 1)
          const cameraQuat = quat.create()
          quat.identity(cameraQuat)
          const pMatrix = mat4.create()
          const mvMatrix = mat4.create()

          const [r, g, b] = hexToRgb(backgroundColorRef.current)
          gl.clearColor(r, g, b, 1.0)
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

          gl.enable(gl.DEPTH_TEST)
          gl.depthFunc(gl.LEQUAL)
          gl.enable(gl.BLEND)
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

          // Use SimpleOrbitCamera for matrices
          if (cameraRef.current) {
            cameraRef.current.getMatrix(mvMatrix, pMatrix)

            // Copy camera position
            vec3.copy(cameraPos, cameraRef.current.position)

            // Calculate camera quaternion by inverting the modelview matrix
            // This matches how it's done in war3-model renderInstances for particle billboarding
            // Reference: modelRenderer.ts lines 1047-1050
            const cameraWorldMatrix = mat4.create()
            mat4.invert(cameraWorldMatrix, mvMatrix)
            mat4.getRotation(cameraQuat, cameraWorldMatrix)
          } else {
            // Fallback logic
            const dist = targetCamera.current.distance
            const theta = targetCamera.current.theta
            const phi = targetCamera.current.phi
            const target = targetCamera.current.target

            const x = dist * Math.sin(phi) * Math.cos(theta)
            const y = dist * Math.sin(phi) * Math.sin(theta)
            const z = dist * Math.cos(phi)
            vec3.set(cameraPos, x, y, z)
            vec3.add(cameraPos, cameraPos, target)
            mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)

            mat4.perspective(pMatrix, Math.PI / 4, canvas.width / canvas.height, 1, 100000)
          }

          const { geometrySubMode, transformMode, selectedVertexIds, selectedFaceIds, animationSubMode: currentAnimationSubMode, mainMode: currentMainMode } = useSelectionStore.getState()
          const isBindPoseMode = currentMainMode === 'geometry' || (currentMainMode === 'animation' && (currentAnimationSubMode === 'binding' || animationIndex === -1))

          // Debug logs commented out to reduce console noise
          // if (time - lastFpsTime.current > 1000) {
          //   console.log('[Viewer] Render loop state:', { isPlaying: isPlayingRef.current, isBindPoseMode, appMainMode, animationSubMode })
          // }



          // CRITICAL FIX: Set camera for particle billboarding BEFORE update()
          // Particles calculate their billboard vertices during update(), but war3-model's 
          // renderInstances() normally calculates cameraQuat AFTER update() (at render time).
          // This means particles would use stale/uninitialized cameraQuat values.
          // By calling setCamera() here, we ensure particles have the correct quaternion.
          if (typeof mdlRenderer.setCamera === 'function') {
            mdlRenderer.setCamera(cameraPos, cameraQuat)
          }

          if (isPlayingRef.current && !isBindPoseMode) {
            // Only log once per second to reduce noise
            if (time - lastFpsTime.current > 1000) {
              // Logging removed
            }
            mdlRenderer.update(delta * playbackSpeedRef.current)

            // Sync frame to store for Timeline (Animation Mode only)
            // PERFORMANCE: Throttle to 200ms to avoid excessive React re-renders
            if (currentMainMode === 'animation' && mdlRenderer.rendererData) {
              const FRAME_SYNC_INTERVAL = 200 // ms
              if (time - lastFrameSyncTime.current >= FRAME_SYNC_INTERVAL) {
                useModelStore.getState().setFrame(mdlRenderer.rendererData.frame)
                lastFrameSyncTime.current = time
              }
            }
          } else {
            // Animation not updating (paused or bind pose mode)
          }

          // === Collision Shape Rendering ===
          if (showCollisionShapesRef.current && mdlRenderer.rendererData && mdlRenderer.rendererData.nodes) {
            // Filter nodes that look like collision shapes (have Shape property)
            const collisionNodes = mdlRenderer.rendererData.nodes.filter((n: any) => n.node.hasOwnProperty('Shape') || n.node.type === 'CollisionShape');

            if (collisionNodes.length > 0) {
              const viewMatrix = mvMatrix;
              const projectionMatrix = pMatrix;
              const nodeMVMatrix = mat4.create();

              collisionNodes.forEach((nodeWrapper: any) => {
                const node = nodeWrapper.node;
                // worldMatrix may be undefined, try 'matrix' property or use identity
                let worldMatrix = nodeWrapper.worldMatrix || nodeWrapper.matrix;
                if (!worldMatrix) {
                  // Use identity matrix if no world matrix available
                  worldMatrix = mat4.create();
                }

                if (!viewMatrix) return;
                mat4.multiply(nodeMVMatrix, viewMatrix, worldMatrix);

                let isSphere = false;
                if (node.Shape === 2 || node.ShapeType === 'Sphere') {
                  isSphere = true;
                } else if (node.Shape === 0 || node.ShapeType === 'Box') {
                  isSphere = false;
                } else if (node.BoundsRadius && node.BoundsRadius > 0) {
                  isSphere = true;
                }

                if (isSphere) {
                  let center;
                  if (node.Vertices) {
                    if (node.Vertices instanceof Float32Array || (node.Vertices.length === 3 && typeof node.Vertices[0] === 'number')) {
                      center = node.Vertices;
                    } else if (node.Vertices.length > 0) {
                      center = node.Vertices[0];
                    }
                  }
                  if (!center) center = node.Vertex1 || [0, 0, 0];
                  const radius = node.BoundsRadius || 0;

                  if (center && (mdlRenderer as any).gl) {
                    debugRenderer.current.renderWireframeSphere(
                      (mdlRenderer as any).gl,
                      nodeMVMatrix,
                      projectionMatrix,
                      radius,
                      center,
                      16,
                      [1, 0.5, 0, 1]
                    );
                  }
                } else {
                  let v1, v2;
                  if (node.Vertices) {
                    if (node.Vertices instanceof Float32Array || (typeof node.Vertices[0] === 'number' && node.Vertices.length >= 6)) {
                      v1 = node.Vertices.subarray ? node.Vertices.subarray(0, 3) : node.Vertices.slice(0, 3);
                      v2 = node.Vertices.subarray ? node.Vertices.subarray(3, 6) : node.Vertices.slice(3, 6);
                    } else if (node.Vertices.length >= 2) {
                      v1 = node.Vertices[0];
                      v2 = node.Vertices[1];
                    }
                  }
                  if (!v1) v1 = node.Vertex1;
                  if (!v2) v2 = node.Vertex2;

                  if (v1 && v2 && (mdlRenderer as any).gl) {
                    debugRenderer.current.renderWireframeBox(
                      (mdlRenderer as any).gl,
                      nodeMVMatrix,
                      projectionMatrix,
                      v1,
                      v2,
                      [1, 0.5, 0, 1]
                    );
                  }
                }
              });
            }
          }

          // === Camera Frustum Rendering ===
          if (showCamerasRef.current && (mdlRenderer as any).gl) {
            const gl = (mdlRenderer as any).gl;
            const { nodes: storeNodes } = useModelStore.getState();
            const cameraNodes = storeNodes.filter((n: any) => n.type === 'Camera');

            // Get selected camera index from dropdown
            const selector = document.getElementById('camera-selector') as HTMLSelectElement;
            const selectedIdx = selector ? parseInt(selector.value) : -1;

            // Debug log every 300 frames
            if (frameCount.current % 300 === 0) {
              console.log('[Camera Render] showCameras:', showCamerasRef.current, 'cameraNodes:', cameraNodes.length, 'selectedIdx:', selectedIdx);
            }

            if (cameraNodes.length > 0 && selectedIdx >= 0 && selectedIdx < cameraNodes.length) {
              // Only render the selected camera's frustum
              const cam = cameraNodes[selectedIdx];
              const isArrayLike = (v: any) => Array.isArray(v) || v instanceof Float32Array || ArrayBuffer.isView(v);
              const toArray = (v: any) => v instanceof Float32Array ? Array.from(v) : v;
              const getPos = (prop: any, directProp?: any) => {
                if (directProp && isArrayLike(directProp)) return toArray(directProp);
                if (isArrayLike(prop)) return toArray(prop);
                if (prop && prop.Keys && prop.Keys.length > 0) {
                  const v = prop.Keys[0].Vector;
                  return v ? toArray(v) : [0, 0, 0];
                }
                return [0, 0, 0];
              };

              // Cast to any to access properties that might be missing in strict type defs
              const camAny = cam as any;
              const pos = getPos(camAny.Translation, camAny.Position);
              const target = getPos(camAny.TargetTranslation, camAny.TargetPosition);
              const fov = camAny.FieldOfView || 0.7853;
              const nearClip = camAny.NearClip || 16;
              const farClip = camAny.FarClip || 1000;

              debugRenderer.current.renderWireframeFrustum(
                gl,
                mvMatrix,
                pMatrix,
                pos,
                target,
                fov,
                nearClip,
                farClip,
                [0, 0.8, 1, 1]
              );
            }
          }

          if (mdlRenderer.rendererData && mdlRenderer.rendererData.animationInfo) {
            const info = mdlRenderer.rendererData.animationInfo
            const current = mdlRenderer.rendererData.frame
            updateProgress(current, info.Interval[1])
          }

          if (mdlRenderer.rendererData) {
            mdlRenderer.setCamera(cameraPos, cameraQuat)

            if (isBindPoseMode) {
              if (mdlRenderer.rendererData.nodes) {
                mdlRenderer.rendererData.nodes.forEach((node: any) => {
                  if (node && node.matrix) {
                    mat4.identity(node.matrix)
                  }
                })
              }
              if (mdlRenderer.rendererData.rootNode) {
                mat4.identity(mdlRenderer.rendererData.rootNode.matrix)
              }
            }

            // === Geoset Visibility Control ===
            // Get visibility state from store
            const { hiddenGeosetIds, forceShowAllGeosets, hoveredGeosetId } = useModelStore.getState()

            // Store original geoset alphas to restore later
            const originalGeosetAlphas: Map<number, number> = new Map()

            // Apply visibility: hide geosets that are in hiddenGeosetIds (when forceShowAllGeosets is OFF)
            // When forceShowAllGeosets is ON, all geosets are visible regardless of hiddenGeosetIds
            if (!forceShowAllGeosets && mdlRenderer.rendererData.geosetAlpha) {
              const numGeosets = mdlRenderer.model.Geosets?.length || 0
              for (let i = 0; i < numGeosets; i++) {
                originalGeosetAlphas.set(i, mdlRenderer.rendererData.geosetAlpha[i] ?? 1)
                // If geoset is in hiddenGeosetIds, it's unchecked = hidden
                if (hiddenGeosetIds.includes(i)) {
                  mdlRenderer.rendererData.geosetAlpha[i] = 0
                }
              }
            }

            mdlRenderer.render(mvMatrix, pMatrix, { wireframe: showWireframeRef.current || (currentMainMode === 'geometry' && (geometrySubMode === 'face' || geometrySubMode === 'group')) })

            // Restore original geoset alphas
            if (originalGeosetAlphas.size > 0 && mdlRenderer.rendererData.geosetAlpha) {
              originalGeosetAlphas.forEach((alpha, index) => {
                mdlRenderer.rendererData.geosetAlpha[index] = alpha
              })
            }

            // === Hover Highlight ===
            // If a geoset is hovered, render a highlight overlay
            if (hoveredGeosetId !== null && mdlRenderer.model.Geosets && mdlRenderer.model.Geosets[hoveredGeosetId]) {
              const isWireframeMode = showWireframeRef.current || (currentMainMode === 'geometry' && (geometrySubMode === 'face' || geometrySubMode === 'group'))

              if (isWireframeMode && debugRenderer.current) {
                // In wireframe mode, draw red wireframe for hovered geoset using debugRenderer
                const geoset = mdlRenderer.model.Geosets[hoveredGeosetId]
                if (geoset && geoset.Faces && geoset.Vertices) {
                  const linePositions: number[] = []
                  const faces = geoset.Faces
                  const verts = geoset.Vertices
                  for (let i = 0; i < faces.length; i += 3) {
                    const i1 = faces[i] * 3, i2 = faces[i + 1] * 3, i3 = faces[i + 2] * 3
                    linePositions.push(verts[i1], verts[i1 + 1], verts[i1 + 2], verts[i2], verts[i2 + 1], verts[i2 + 2])
                    linePositions.push(verts[i2], verts[i2 + 1], verts[i2 + 2], verts[i3], verts[i3 + 1], verts[i3 + 2])
                    linePositions.push(verts[i3], verts[i3 + 1], verts[i3 + 2], verts[i1], verts[i1 + 1], verts[i1 + 2])
                  }
                  gl.disable(gl.DEPTH_TEST)
                  debugRenderer.current.renderLines(gl as WebGLRenderingContext, mvMatrix, pMatrix, linePositions, [1, 0, 0, 1])
                  gl.enable(gl.DEPTH_TEST)
                }
              } else {
                // Non-wireframe mode: use original renderGeosetHighlight
                // Save current GL state
                const prevBlend = gl.isEnabled(gl.BLEND)
                const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK)
                const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST)
                const prevCullFace = gl.isEnabled(gl.CULL_FACE)

                // Render with red highlight color and high opacity
                gl.disable(gl.BLEND)
                gl.depthMask(false)
                gl.disable(gl.DEPTH_TEST)
                gl.disable(gl.CULL_FACE)

                if (typeof (mdlRenderer as any).renderGeosetHighlight === 'function') {
                  (mdlRenderer as any).renderGeosetHighlight(hoveredGeosetId, [1, 0, 0], 1.0, mvMatrix, pMatrix)
                }

                // Restore GL state
                if (prevCullFace) gl.enable(gl.CULL_FACE)
                if (prevDepthTest) gl.enable(gl.DEPTH_TEST)
                gl.depthMask(prevDepthMask)
                if (!prevBlend) gl.disable(gl.BLEND)
              }
            }

            // 关键帧模式和绑定模式都显示节点
            if ((showNodesRef.current || currentMainMode === 'animation') && mdlRenderer.rendererData.nodes && currentMainMode !== 'geometry') {
              const { selectedNodeIds } = useSelectionStore.getState()
              let parentOfSelected: number | null = null
              let childrenOfSelected: number[] = []

              if (selectedNodeIds.length === 1) {
                const selectedId = selectedNodeIds[0]
                const selectedNode = mdlRenderer.rendererData.nodes.find((n: any) => n.node.ObjectId === selectedId)
                if (selectedNode) {
                  if (typeof selectedNode.node.Parent === 'number') {
                    parentOfSelected = selectedNode.node.Parent
                  }
                  childrenOfSelected = mdlRenderer.rendererData.nodes
                    .filter((n: any) => n.node.Parent === selectedId)
                    .map((n: any) => n.node.ObjectId)

                  // Recursively collect all descendants (children's children, etc.)
                  const collectDescendants = (parentIds: number[]): number[] => {
                    const children = mdlRenderer.rendererData.nodes
                      .filter((n: any) => parentIds.includes(n.node.Parent))
                      .map((n: any) => n.node.ObjectId)
                    if (children.length === 0) return []
                    return [...children, ...collectDescendants(children)]
                  }
                  childrenOfSelected = [...childrenOfSelected, ...collectDescendants(childrenOfSelected)]

                  // render bound vertices highlight (with caching to avoid per-frame recalculation)
                  if (currentMainMode === 'animation' && currentAnimationSubMode === 'binding' && debugRenderer.current) {
                    // Check if we need to recalculate (only when bone selection changes)
                    let boundVertices: number[]
                    if (boundVerticesCache.current && boundVerticesCache.current.boneId === selectedId) {
                      // Use cached data
                      boundVertices = boundVerticesCache.current.vertices
                    } else {
                      // Recalculate and cache
                      boundVertices = []
                      const geosets = mdlRenderer.model.Geosets || []

                      geosets.forEach((geoset: any) => {
                        if (!geoset.VertexGroup || !geoset.Groups) return

                        // Pre-calculate which groups contain our selected bone
                        const containingGroupIndices = new Set<number>()
                        geoset.Groups.forEach((group: number[], groupIdx: number) => {
                          if (group.includes(selectedId)) {
                            containingGroupIndices.add(groupIdx)
                          }
                        })

                        if (containingGroupIndices.size > 0) {
                          const vertices = geoset.Vertices
                          const vertexGroup = geoset.VertexGroup
                          const count = vertices.length / 3

                          for (let i = 0; i < count; i++) {
                            const groupIndex = vertexGroup[i]
                            if (containingGroupIndices.has(groupIndex)) {
                              boundVertices.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2])
                            }
                          }
                        }
                      })

                      // Cache for future frames
                      boundVerticesCache.current = { boneId: selectedId, vertices: boundVertices }
                    }

                    if (boundVertices.length > 0) {
                      gl.disable(gl.DEPTH_TEST) // Make them visible through model
                      debugRenderer.current.renderBoneVertices(
                        gl as WebGLRenderingContext,
                        mvMatrix,
                        pMatrix,
                        boundVertices
                      )
                      gl.enable(gl.DEPTH_TEST)
                    }
                  }
                }
              }

              debugRenderer.current.renderNodes(
                gl as WebGLRenderingContext,
                mvMatrix,
                pMatrix,
                mdlRenderer.rendererData.nodes as any,
                selectedNodeIds,
                parentOfSelected,
                childrenOfSelected
              )
            }

            if (showSkeletonRef.current && mdlRenderer.rendererData.nodes && currentMainMode === 'animation') {
              gl.disable(gl.DEPTH_TEST)
              mdlRenderer.renderSkeleton(mvMatrix, pMatrix, null)
              gl.enable(gl.DEPTH_TEST)
            }

            // === Light Object Rendering ===
            if (showLightsRef.current && mdlRenderer.rendererData.nodes) {
              const { nodes } = useModelStore.getState()
              const lightNodes = nodes.filter((n: any) => n.type === 'Light')

              if (lightNodes.length > 0) {
                const viewMatrix = mvMatrix
                const projectionMatrix = pMatrix
                const nodeMVMatrix = mat4.create()

                lightNodes.forEach((light: any) => {
                  const nodeWrapper = mdlRenderer.rendererData.nodes.find((n: any) => n.node.ObjectId === light.ObjectId)
                  if (!nodeWrapper) return

                  let worldMatrix = nodeWrapper.worldMatrix || nodeWrapper.matrix
                  if (!worldMatrix) worldMatrix = mat4.create()

                  mat4.multiply(nodeMVMatrix, viewMatrix, worldMatrix)

                  // Extract Light Properties
                  let type = light.LightType || 0
                  // Handle string types just in case
                  if (typeof type === 'string') {
                    if (type === 'Directional') type = 1
                    else if (type === 'Ambient') type = 2
                    else type = 0
                  }
                  // Get current attenuation values if animated, otherwise use static
                  // For simplicity in Debug view, we can use the static or first keyframe values if not easily accessible via renderer
                  // Or check if rendererData has light values updating?
                  // War3-model might not expose live light values easily unless we dig into KeyframeController.
                  // Let's use static/default values for now for structure visualization.

                  let attStart = 0
                  let attEnd = 0
                  let color = [1, 1, 0, 1] // Yellow default

                  // Helper to get scalar value (static or first key)
                  const getVal = (prop: any) => {
                    if (typeof prop === 'number') return prop
                    if (prop && prop.Keys && prop.Keys.length > 0) return prop.Keys[0].Vector[0]
                    return 0
                  }
                  // Helper to get vector value
                  const getVec = (prop: any) => {
                    if (prop instanceof Float32Array || Array.isArray(prop)) return [prop[0], prop[1], prop[2]]
                    if (prop && prop.Keys && prop.Keys.length > 0) return [prop.Keys[0].Vector[0], prop.Keys[0].Vector[1], prop.Keys[0].Vector[2]]
                    return [1, 1, 1]
                  }

                  attStart = getVal(light.AttenuationStart)
                  attEnd = getVal(light.AttenuationEnd)
                  const c = getVec(light.Color)
                  // If Color is [r,g,b], map to 0-1 range if > 1? usually 0-1 in MDL?
                  // MDL colors are usually 0-1 range.
                  color = [c[0], c[1], c[2], 1.0]

                  debugRenderer.current.renderLight(
                    gl as WebGLRenderingContext,
                    nodeMVMatrix,
                    projectionMatrix,
                    type,
                    attStart,
                    attEnd,
                    color
                  )
                })
              }
            }

          }

          if ((currentMainMode === 'geometry' && geometrySubMode === 'vertex') ||
            (currentMainMode === 'animation' && currentAnimationSubMode === 'binding')) {
            // Get geoset visibility state from modelStore
            const { hiddenGeosetIds, forceShowAllGeosets, hoveredGeosetId } = useModelStore.getState()

            // Render all visible geoset vertices
            for (let geosetIndex = 0; geosetIndex < mdlRenderer.model.Geosets.length; geosetIndex++) {
              const geoset = mdlRenderer.model.Geosets[geosetIndex]
              if (!geoset.Vertices) continue

              // Skip hidden geosets (based on hiddenGeosetIds from modelStore)
              if (hiddenGeosetIds.includes(geosetIndex) && !forceShowAllGeosets) continue

              // Use different color for hovered geoset vertices
              if (hoveredGeosetId === geosetIndex) {
                // Hovered geoset: yellow highlight
                debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, geoset.Vertices, [1, 0.8, 0, 1], 6.0)
              } else {
                // Normal geoset: blue
                debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, geoset.Vertices, [0, 0, 1, 0.5], 4.0)
              }
            }

            if (selectedVertexIds.length > 0) {
              const selectedPositions: number[] = []

              if (geometrySubMode === 'group') {
                // Group Mode: Render Red Wireframe (Lines) instead of Points
                // Group selected vertices by geoset to identify engaged geosets
                const engagedGeosets = new Set<number>()
                selectedVertexIds.forEach(v => engagedGeosets.add(v.geosetIndex))

                const linePositions: number[] = []
                engagedGeosets.forEach(geosetIndex => {
                  const geoset = mdlRenderer.model.Geosets[geosetIndex]
                  if (geoset && geoset.Faces && geoset.Vertices) {
                    // Render ALL faces of this geoset as lines
                    const faces = geoset.Faces
                    const verts = geoset.Vertices
                    for (let i = 0; i < faces.length; i += 3) {
                      const i1 = faces[i] * 3, i2 = faces[i + 1] * 3, i3 = faces[i + 2] * 3
                      // Edge 1
                      linePositions.push(verts[i1], verts[i1 + 1], verts[i1 + 2], verts[i2], verts[i2 + 1], verts[i2 + 2])
                      // Edge 2
                      linePositions.push(verts[i2], verts[i2 + 1], verts[i2 + 2], verts[i3], verts[i3 + 1], verts[i3 + 2])
                      // Edge 3
                      linePositions.push(verts[i3], verts[i3 + 1], verts[i3 + 2], verts[i1], verts[i1 + 1], verts[i1 + 2])
                    }
                  }
                })
                // Render lines with Red color, slightly OFFSET if possible to avoid z-fighting?
                // Or just disable depth test for selection?
                gl.disable(gl.DEPTH_TEST)
                debugRenderer.current.renderLines(gl as WebGLRenderingContext, mvMatrix, pMatrix, linePositions, [1, 0, 0, 1])
                gl.enable(gl.DEPTH_TEST)

              } else {
                // Vertex Mode: Render Points
                for (const sel of selectedVertexIds) {
                  const geoset = mdlRenderer.model.Geosets[sel.geosetIndex]
                  if (geoset) {
                    const vIndex = sel.index * 3
                    selectedPositions.push(
                      geoset.Vertices[vIndex],
                      geoset.Vertices[vIndex + 1],
                      geoset.Vertices[vIndex + 2]
                    )
                  }
                }
                gl.disable(gl.DEPTH_TEST)
                debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, selectedPositions, [1, 0, 0, 1], 6.0)
                gl.enable(gl.DEPTH_TEST)
              }
            }
          }

          if (currentMainMode === 'geometry' && geometrySubMode === 'face') {
            if (selectedFaceIds.length > 0) {
              const selectedPositions: number[] = []
              for (const sel of selectedFaceIds) {
                const geoset = mdlRenderer.model.Geosets[sel.geosetIndex]
                if (geoset) {
                  const fIndex = sel.index * 3
                  const i1 = geoset.Faces[fIndex] * 3
                  const i2 = geoset.Faces[fIndex + 1] * 3
                  const i3 = geoset.Faces[fIndex + 2] * 3

                  selectedPositions.push(
                    geoset.Vertices[i1], geoset.Vertices[i1 + 1], geoset.Vertices[i1 + 2],
                    geoset.Vertices[i2], geoset.Vertices[i2 + 1], geoset.Vertices[i2 + 2],
                    geoset.Vertices[i3], geoset.Vertices[i3 + 1], geoset.Vertices[i3 + 2]
                  )
                }
              }
              gl.disable(gl.DEPTH_TEST)
              debugRenderer.current.renderTriangles(gl as WebGLRenderingContext, mvMatrix, pMatrix, selectedPositions, [1, 0, 0, 0.7])

              const linePositions: number[] = []
              for (let i = 0; i < selectedPositions.length; i += 9) {
                linePositions.push(selectedPositions[i], selectedPositions[i + 1], selectedPositions[i + 2])
                linePositions.push(selectedPositions[i + 3], selectedPositions[i + 4], selectedPositions[i + 5])
                linePositions.push(selectedPositions[i + 3], selectedPositions[i + 4], selectedPositions[i + 5])
                linePositions.push(selectedPositions[i + 6], selectedPositions[i + 7], selectedPositions[i + 8])
                linePositions.push(selectedPositions[i + 6], selectedPositions[i + 7], selectedPositions[i + 8])
                linePositions.push(selectedPositions[i], selectedPositions[i + 1], selectedPositions[i + 2])
              }
              debugRenderer.current.renderLines(gl as WebGLRenderingContext, mvMatrix, pMatrix, linePositions, [1, 0, 0, 1])
              gl.enable(gl.DEPTH_TEST)
            }
          }

          if (transformMode) {
            const center = vec3.create()
            let count = 0
            let showGizmo = false

            if (currentMainMode === 'geometry') {
              if (geometrySubMode === 'vertex' && selectedVertexIds.length > 0) {
                for (const sel of selectedVertexIds) {
                  const geoset = mdlRenderer.model.Geosets[sel.geosetIndex]
                  if (geoset) {
                    const vIndex = sel.index * 3
                    center[0] += geoset.Vertices[vIndex]
                    center[1] += geoset.Vertices[vIndex + 1]
                    center[2] += geoset.Vertices[vIndex + 2]
                    count++
                  }
                }
                showGizmo = true
              } else if (geometrySubMode === 'face' && selectedFaceIds.length > 0) {
                for (const sel of selectedFaceIds) {
                  const geoset = mdlRenderer.model.Geosets[sel.geosetIndex]
                  if (geoset) {
                    const fIndex = sel.index * 3
                    const i1 = geoset.Faces[fIndex] * 3, i2 = geoset.Faces[fIndex + 1] * 3, i3 = geoset.Faces[fIndex + 2] * 3
                    center[0] += geoset.Vertices[i1] + geoset.Vertices[i2] + geoset.Vertices[i3]
                    center[1] += geoset.Vertices[i1 + 1] + geoset.Vertices[i2 + 1] + geoset.Vertices[i3 + 1]
                    center[2] += geoset.Vertices[i1 + 2] + geoset.Vertices[i2 + 2] + geoset.Vertices[i3 + 2]
                    count += 3
                  }
                }
                showGizmo = true
              }
            }
            // 动画模式（binding 和 keyframe）显示 Gizmo
            else if (currentMainMode === 'animation') {
              const { selectedNodeIds } = useSelectionStore.getState()
              if (selectedNodeIds && selectedNodeIds.length > 0) {
                for (const nodeId of selectedNodeIds) {
                  const nodeWrapper = mdlRenderer.rendererData.nodes[nodeId]
                  if (nodeWrapper && nodeWrapper.matrix) {
                    // 使用矩阵变换 PivotPoint 获取正确的世界坐标
                    const matrix = nodeWrapper.matrix
                    let pivot = [0, 0, 0]
                    if (nodeWrapper.node && nodeWrapper.node.PivotPoint) {
                      pivot = nodeWrapper.node.PivotPoint
                    } else if (mdlRenderer.model.PivotPoints && mdlRenderer.model.PivotPoints[nodeId]) {
                      pivot = mdlRenderer.model.PivotPoints[nodeId]
                    }
                    const x = matrix[0] * pivot[0] + matrix[4] * pivot[1] + matrix[8] * pivot[2] + matrix[12]
                    const y = matrix[1] * pivot[0] + matrix[5] * pivot[1] + matrix[9] * pivot[2] + matrix[13]
                    const z = matrix[2] * pivot[0] + matrix[6] * pivot[1] + matrix[10] * pivot[2] + matrix[14]
                    center[0] += x
                    center[1] += y
                    center[2] += z
                    count++
                    // 更新全局骨骼位置供 BoneParameterPanel 使用
                    (window as any)._selectedBoneWorldPos = [x, y, z]
                  }
                }
                showGizmo = true
              }
            }

            if (showGizmo && count > 0) {
              vec3.scale(center, center, 1.0 / count)

              // Fixed Gizmo Scale (no adaptive scaling)
              const gizmoScale = 1.0

              gizmoRenderer.current.render(gl as WebGLRenderingContext, mvMatrix, pMatrix, center, transformMode as any, gizmoState.current.activeAxis, gizmoScale)
            }
          }

          if (showGridRef.current) {
            gridRenderer.current.render(gl as WebGLRenderingContext, mvMatrix, pMatrix)
          }

          // Always render the axis indicator in bottom-left corner
          axisIndicator.current.render(gl as WebGLRenderingContext, mvMatrix, canvas.width, canvas.height)

          frameCount.current++
          if (time - lastFpsTime.current >= 1000) {
            setFps(Math.round(frameCount.current * 1000 / (time - lastFpsTime.current)))
            frameCount.current = 0
            lastFpsTime.current = time
          }
          // NOTE: requestAnimationFrame is called AFTER the catch block, not here!
        } catch (e: any) {
          console.error('[Viewer] Render Loop Crash:', e)
          if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current)
            animationFrameId.current = null
          }
          return // Do NOT schedule next frame on error
        }
        animationFrameId.current = requestAnimationFrame(render)
      }

      renderRef.current = render
      animationFrameId.current = requestAnimationFrame(render)

      return () => {
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current)
          animationFrameId.current = null
        }
      }
    }
    return undefined
  }, [renderer, appMainMode, animationSubMode, animationIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return

      const key = e.key.toLowerCase()
      if (key === 'w') useSelectionStore.getState().setTransformMode('translate')
      if (key === 'e') useSelectionStore.getState().setTransformMode('rotate')
      if (key === 'r') useSelectionStore.getState().setTransformMode('scale')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    // Guard: Only set sequence if renderer is fully initialized with valid rendererData
    // NOTE: Don't require animationInfo to be set - it gets set BY setSequence!
    // Requiring it creates chicken-and-egg problem where animation never starts.
    if (renderer && renderer.rendererData && typeof (renderer as any).setSequence === 'function') {
      console.log('[Viewer] Setting sequence to:', animationIndex, 'rendererData exists:', !!renderer.rendererData, 'animationInfo:', renderer.rendererData?.animationInfo?.Name)
        ; (renderer as any).setSequence(animationIndex)
    }
  }, [renderer, animationIndex])

  useEffect(() => {
    if (appMainMode === 'geometry' && renderer) {
      if (renderer.rendererData) {
        renderer.rendererData.frame = 0
      }
    }
  }, [appMainMode, renderer])

  const handleMouseMove = (e: any) => {
    // 1. Gizmo Dragging
    if (gizmoState.current.isDragging && gizmoState.current.activeAxis && rendererRef.current) {
      const deltaX = e.clientX - mouseState.current.lastMouseX
      const deltaY = e.clientY - mouseState.current.lastMouseY
      mouseState.current.lastMouseX = e.clientX
      mouseState.current.lastMouseY = e.clientY

      const { transformMode, mainMode, animationSubMode: subMode } = useSelectionStore.getState()
      const axis = gizmoState.current.activeAxis

      if (mainMode !== 'geometry' && !(mainMode === 'animation' && (subMode === 'binding' || subMode === 'keyframe'))) {
        return
      }

      const { theta, phi, distance } = targetCamera.current
      const forward = vec3.fromValues(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
      const up = vec3.fromValues(0, 0, 1)
      const right = vec3.create()
      vec3.cross(right, forward, up)
      vec3.normalize(right, right)
      const camUp = vec3.create()
      vec3.cross(camUp, right, forward)
      vec3.normalize(camUp, camUp)

      // Simplified movement speed - more consistent with mouse movement
      const moveScale = distance * 0.002

      const worldMoveDelta = vec3.create()
      vec3.scaleAndAdd(worldMoveDelta, worldMoveDelta, right, deltaX * moveScale)
      vec3.scaleAndAdd(worldMoveDelta, worldMoveDelta, camUp, -deltaY * moveScale)

      if (transformMode === 'translate' && mainMode === 'geometry') {
        const moveVec = vec3.create()

        if (axis === 'x') moveVec[0] = -worldMoveDelta[0]
        else if (axis === 'y') moveVec[1] = -worldMoveDelta[1]
        else if (axis === 'z') moveVec[2] = worldMoveDelta[2]
        else if (axis === 'xy') { moveVec[0] = -worldMoveDelta[0]; moveVec[1] = -worldMoveDelta[1]; }
        else if (axis === 'xz') { moveVec[0] = -worldMoveDelta[0]; moveVec[2] = worldMoveDelta[2]; }
        else if (axis === 'yz') { moveVec[1] = -worldMoveDelta[1]; moveVec[2] = worldMoveDelta[2]; }

        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()
        const affectedGeosets = new Set<number>()

        const updateVertex = (geosetIndex: number, vertexIndex: number, updateFn: (v: Float32Array, idx: number) => void) => {
          if (!rendererRef.current) return
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if (!geoset) return
          updateFn(geoset.Vertices, vertexIndex * 3)
          affectedGeosets.add(geosetIndex)
        }

        const applyToSelection = (updateFn: (v: Float32Array, idx: number) => void) => {
          if (geometrySubMode === 'vertex') {
            selectedVertexIds.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
          } else if (geometrySubMode === 'face') {
            selectedFaceIds.forEach(sel => {
              if (!rendererRef.current) return
              const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
              if (geoset) {
                const fIndex = sel.index * 3
                updateVertex(sel.geosetIndex, geoset.Faces[fIndex], updateFn)
                updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 1], updateFn)
                updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 2], updateFn)
              }
            })
          }
        }

        applyToSelection((v, i) => {
          v[i] += moveVec[0]
          v[i + 1] += moveVec[1]
          v[i + 2] += moveVec[2]
        })

        affectedGeosets.forEach(geosetIndex => {
          if (!rendererRef.current) return
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if ((rendererRef.current as any).updateGeosetVertices) {
            (rendererRef.current as any).updateGeosetVertices(geosetIndex, geoset.Vertices)
          }
        })

      } else if (transformMode === 'translate' && mainMode === 'animation' && (subMode === 'binding' || subMode === 'keyframe')) {
        const { selectedNodeIds } = useSelectionStore.getState()
        const { autoKeyframe, currentFrame, nodes, updateNode } = useModelStore.getState()
        const moveVec = vec3.create()

        // Use worldMoveDelta with same direction as vertex movement
        if (axis === 'x') moveVec[0] = -worldMoveDelta[0]
        else if (axis === 'y') moveVec[1] = -worldMoveDelta[1]
        else if (axis === 'z') moveVec[2] = worldMoveDelta[2]
        else if (axis === 'xy') { moveVec[0] = -worldMoveDelta[0]; moveVec[1] = -worldMoveDelta[1]; }
        else if (axis === 'xz') { moveVec[0] = -worldMoveDelta[0]; moveVec[2] = worldMoveDelta[2]; }
        else if (axis === 'yz') { moveVec[1] = -worldMoveDelta[1]; moveVec[2] = worldMoveDelta[2]; }

        if (selectedNodeIds.length > 0 && rendererRef.current && rendererRef.current.rendererData.nodes) {
          selectedNodeIds.forEach(nodeId => {
            const nodeWrapper = rendererRef.current!.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
            if (nodeWrapper && nodeWrapper.node.PivotPoint) {
              let localMoveVec = vec3.fromValues(moveVec[0], moveVec[1], moveVec[2])

              // For keyframe mode: Transform world-space delta to bone's local space
              // This is necessary because Translation keyframes are applied BEFORE rotation
              // If we don't transform, the movement direction will be wrong for rotated bones
              if (subMode === 'keyframe' && nodeWrapper.matrix) {
                // Extract rotation from the bone's matrix (upper 3x3)
                // nodeWrapper.matrix contains the accumulated transform (parent * local)
                const m = nodeWrapper.matrix as mat4
                const rotMat3 = mat3.fromValues(
                  m[0], m[1], m[2],
                  m[4], m[5], m[6],
                  m[8], m[9], m[10]
                )
                // Invert the rotation to get local-to-world inverse (i.e., world-to-local)
                const invRotMat3 = mat3.invert(mat3.create(), rotMat3)
                if (invRotMat3) {
                  // Transform world delta to local delta
                  vec3.transformMat3(localMoveVec, localMoveVec, invRotMat3)
                }
              }

              // binding 模式：修改 PivotPoint（静态绑定位置）
              if (subMode === 'binding') {
                nodeWrapper.node.PivotPoint[0] += localMoveVec[0]
                nodeWrapper.node.PivotPoint[1] += localMoveVec[1]
                nodeWrapper.node.PivotPoint[2] += localMoveVec[2]
              }
              // keyframe 模式：累积 delta 并注入临时 Translation 关键帧用于实时预览
              else if (subMode === 'keyframe') {
                // 累积 LOCAL 偏移到全局变量 (用于 MouseUp 时提交)
                if (!(window as any)._keyframeDragDelta) {
                  (window as any)._keyframeDragDelta = {}
                }
                if (!(window as any)._keyframeDragDelta[nodeId]) {
                  (window as any)._keyframeDragDelta[nodeId] = [0, 0, 0]
                }
                (window as any)._keyframeDragDelta[nodeId][0] += localMoveVec[0];
                (window as any)._keyframeDragDelta[nodeId][1] += localMoveVec[1];
                (window as any)._keyframeDragDelta[nodeId][2] += localMoveVec[2];

                // 实时预览：注入临时 Translation 关键帧到渲染器模型
                // 使用 initialTranslation + accumulatedDelta 作为预览值
                const dragData = keyframeDragData.current
                if (dragData && rendererRef.current) {
                  const initialVals = dragData.initialValues.get(nodeId) as any
                  const delta = (window as any)._keyframeDragDelta[nodeId]

                  if (initialVals && initialVals.translation) {
                    const previewTranslation = [
                      initialVals.translation[0] + delta[0],
                      initialVals.translation[1] + delta[1],
                      initialVals.translation[2] + delta[2]
                    ]

                    // 获取渲染器中的节点并注入临时 Translation
                    const rendererNode = rendererRef.current.model?.Nodes?.find((n: any) => n.ObjectId === nodeId)
                    if (rendererNode) {
                      // 确保 Translation 属性存在
                      if (!rendererNode.Translation) {
                        rendererNode.Translation = { Keys: [], InterpolationType: 1 }
                      }
                      // 在当前帧注入临时关键帧用于预览
                      // 标记为临时的，以便 MouseUp 时可以清理
                      const frame = Math.round(currentFrame)
                      const tempKeyIndex = rendererNode.Translation.Keys.findIndex((k: any) => k._isPreviewKey)
                      if (tempKeyIndex >= 0) {
                        rendererNode.Translation.Keys[tempKeyIndex].Vector = previewTranslation
                        rendererNode.Translation.Keys[tempKeyIndex].Frame = frame
                      } else {
                        rendererNode.Translation.Keys.push({
                          Frame: frame,
                          Vector: previewTranslation,
                          _isPreviewKey: true  // 标记为预览关键帧
                        })
                        rendererNode.Translation.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                      }
                    }
                  }
                }

                // DEBUG: Log during drag (throttled)
                if (!((window as any)._debugMoveCounter)) (window as any)._debugMoveCounter = 0
                  ; (window as any)._debugMoveCounter++
                if ((window as any)._debugMoveCounter % 10 === 0) {
                  console.log('[DEBUG MouseMove] NodeId:', nodeId,
                    'WorldDelta:', [moveVec[0].toFixed(2), moveVec[1].toFixed(2), moveVec[2].toFixed(2)],
                    'LocalDelta:', [localMoveVec[0].toFixed(2), localMoveVec[1].toFixed(2), localMoveVec[2].toFixed(2)])
                }
              }
            }
          })

          // Force renderer update for both binding and keyframe modes
          if (subMode === 'binding' || subMode === 'keyframe') {
            rendererRef.current!.update(0)
          }
        }
      } else if ((transformMode === 'rotate' || transformMode === 'scale') && mainMode === 'geometry') {
        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()

        const center = vec3.create()
        let count = 0
        const accumulateCenter = (geosetIndex: number, vertexIndex: number) => {
          if (!rendererRef.current) return
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if (!geoset) return
          const vIndex = vertexIndex * 3
          center[0] += geoset.Vertices[vIndex]
          center[1] += geoset.Vertices[vIndex + 1]
          center[2] += geoset.Vertices[vIndex + 2]
          count++
        }

        if (geometrySubMode === 'vertex') {
          selectedVertexIds.forEach(sel => accumulateCenter(sel.geosetIndex, sel.index))
        } else if (geometrySubMode === 'face') {
          selectedFaceIds.forEach(sel => {
            if (!rendererRef.current) return
            const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
            if (geoset) {
              const fIndex = sel.index * 3
              accumulateCenter(sel.geosetIndex, geoset.Faces[fIndex])
              accumulateCenter(sel.geosetIndex, geoset.Faces[fIndex + 1])
              accumulateCenter(sel.geosetIndex, geoset.Faces[fIndex + 2])
            }
          })
        }

        if (count > 0) {
          vec3.scale(center, center, 1.0 / count)
          const affectedGeosets = new Set<number>()

          const updateVertex = (geosetIndex: number, vertexIndex: number, updateFn: (v: Float32Array, idx: number) => void) => {
            if (!rendererRef.current) return
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if (!geoset) return
            updateFn(geoset.Vertices, vertexIndex * 3)
            affectedGeosets.add(geosetIndex)
          }

          const applyToSelection = (updateFn: (v: Float32Array, idx: number) => void) => {
            if (geometrySubMode === 'vertex') {
              selectedVertexIds.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
            } else if (geometrySubMode === 'face') {
              selectedFaceIds.forEach(sel => {
                if (!rendererRef.current) return
                const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
                if (geoset) {
                  const fIndex = sel.index * 3
                  updateVertex(sel.geosetIndex, geoset.Faces[fIndex], updateFn)
                  updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 1], updateFn)
                  updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 2], updateFn)
                }
              })
            }
          }

          if (transformMode === 'rotate') {
            let angle = 0
            const rotAxis = vec3.create()

            if (axis === 'x') {
              angle = -deltaY * 0.01 // Negated to fix rotation direction
              vec3.set(rotAxis, 1, 0, 0)
            } else if (axis === 'y') {
              angle = -deltaX * 0.01
              vec3.set(rotAxis, 0, 1, 0)
            } else if (axis === 'z') {
              angle = deltaX * 0.01
              vec3.set(rotAxis, 0, 0, 1)
            }

            if (angle !== 0) {
              const rotMat = mat4.create()
              mat4.fromRotation(rotMat, angle, rotAxis)

              applyToSelection((v, i) => {
                const p = vec3.fromValues(v[i], v[i + 1], v[i + 2])
                vec3.sub(p, p, center) // To local
                vec3.transformMat4(p, p, rotMat) // Rotate
                vec3.add(p, p, center) // To world
                v[i] = p[0]
                v[i + 1] = p[1]
                v[i + 2] = p[2]
              })
            }
          } else if (transformMode === 'scale') {
            const scaleVec = vec3.fromValues(1, 1, 1)
            const scaleFactor = 1 + (deltaX - deltaY) * 0.005

            if (axis === 'x') scaleVec[0] = scaleFactor
            else if (axis === 'y') scaleVec[1] = scaleFactor
            else if (axis === 'z') scaleVec[2] = scaleFactor
            else if (axis === 'xy') { scaleVec[0] = scaleFactor; scaleVec[1] = scaleFactor }
            else if (axis === 'xz') { scaleVec[0] = scaleFactor; scaleVec[2] = scaleFactor }
            else if (axis === 'yz') { scaleVec[1] = scaleFactor; scaleVec[2] = scaleFactor }
            else if (axis === 'center') { vec3.set(scaleVec, scaleFactor, scaleFactor, scaleFactor) }

            if (scaleVec[0] !== 1 || scaleVec[1] !== 1 || scaleVec[2] !== 1) {
              applyToSelection((v, i) => {
                const p = vec3.fromValues(v[i], v[i + 1], v[i + 2])
                vec3.sub(p, p, center) // To local
                vec3.mul(p, p, scaleVec) // Scale
                vec3.add(p, p, center) // To world
                v[i] = p[0]
                v[i + 1] = p[1]
                v[i + 2] = p[2]
              })
            }
          }

          affectedGeosets.forEach(geosetIndex => {
            if (!rendererRef.current) return
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if ((rendererRef.current as any).updateGeosetVertices) {
              (rendererRef.current as any).updateGeosetVertices(geosetIndex, geoset.Vertices)
            }
          })
        }
      }
      // === ANIMATION MODE: ROTATE & SCALE PREVIEW ===
      else if ((transformMode === 'rotate' || transformMode === 'scale') && mainMode === 'animation' && subMode === 'keyframe') {
        const { selectedNodeIds } = useSelectionStore.getState()
        const { currentFrame, nodes } = useModelStore.getState()

        // Initialize drag data if not exists
        if (!keyframeDragData.current && rendererRef.current) {
          keyframeDragData.current = {
            initialKeys: new Map(),
            initialValues: new Map()
          }

          selectedNodeIds.forEach(nodeId => {
            // 1. Snapshot original KEYS from STORE (source of truth)
            const storeNode = nodes.find((n: any) => n.ObjectId === nodeId)
            if (storeNode) {
              keyframeDragData.current!.initialKeys.set(nodeId, {
                Rotation: storeNode.Rotation ? JSON.parse(JSON.stringify(storeNode.Rotation)) : undefined,
                Scaling: storeNode.Scaling ? JSON.parse(JSON.stringify(storeNode.Scaling)) : undefined
              })
            }

            // 2. Snapshot current visual values from RENDERER (for delta calculation)
            const nodeWrapper = rendererRef.current!.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
            if (nodeWrapper) {
              // Get current interpolated value
              const currentRot = nodeWrapper.localRotation ? quat.clone(nodeWrapper.localRotation) : quat.create()
              const currentScale = nodeWrapper.localScale ? vec3.clone(nodeWrapper.localScale) : vec3.fromValues(1, 1, 1)

              keyframeDragData.current!.initialValues.set(nodeId, {
                rotation: currentRot as Float32Array,
                scaling: currentScale as Float32Array
              })
            }
          })
        }

        const center = vec3.create()
        let count = 0
        selectedNodeIds.forEach(nodeId => {
          const nodeWrapper = rendererRef.current!.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
          if (nodeWrapper) {
            const matrix = nodeWrapper.matrix
            let pivot = [0, 0, 0]
            if (nodeWrapper.node && nodeWrapper.node.PivotPoint) pivot = nodeWrapper.node.PivotPoint
            const x = matrix[0] * pivot[0] + matrix[4] * pivot[1] + matrix[8] * pivot[2] + matrix[12]
            const y = matrix[1] * pivot[0] + matrix[5] * pivot[1] + matrix[9] * pivot[2] + matrix[13]
            const z = matrix[2] * pivot[0] + matrix[6] * pivot[1] + matrix[10] * pivot[2] + matrix[14]
            center[0] += x; center[1] += y; center[2] += z;
            count++
          }
        })
        if (count > 0) vec3.scale(center, center, 1.0 / count)

        if (transformMode === 'rotate') {
          let angle = 0
          const rotAxis = vec3.create()
          if (axis === 'x') { angle = -deltaY * 0.01; vec3.set(rotAxis, 1, 0, 0) }
          else if (axis === 'y') { angle = -deltaX * 0.01; vec3.set(rotAxis, 0, 1, 0) }
          else if (axis === 'z') { angle = deltaX * 0.01; vec3.set(rotAxis, 0, 0, 1) }

          if (angle !== 0) {
            const deltaQuat = quat.create()
            quat.setAxisAngle(deltaQuat, rotAxis, angle)

            selectedNodeIds.forEach(nodeId => {
              const currentVal = keyframeDragData.current?.initialValues.get(nodeId)
              if (currentVal) {
                const newRot = quat.create()
                // Aggregate rotation: New = Current * Delta (Local approximation)
                quat.multiply(newRot, currentVal.rotation as any, deltaQuat)

                // Update current value so next frame accumulates
                quat.copy(currentVal.rotation as any, newRot)

                // INJECT into Renderer Model for PREVIEW
                const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n.ObjectId === nodeId)
                if (rendererNode) {
                  if (!rendererNode.Rotation) rendererNode.Rotation = { Keys: [], InterpolationType: 1 }
                  const keys = rendererNode.Rotation.Keys
                  const frame = Math.round(currentFrame)
                  let key = keys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
                  if (!key) {
                    key = { Frame: frame, Vector: [0, 0, 0, 1] }
                    keys.push(key)
                    keys.sort((a: any, b: any) => a.Frame - b.Frame)
                  }
                  key.Vector = [newRot[0], newRot[1], newRot[2], newRot[3]]
                }
              }
            })
          }
        } else if (transformMode === 'scale') {
          const scaleFactor = 1 + (deltaX - deltaY) * 0.005
          const scaleVec = vec3.fromValues(1, 1, 1)
          if (axis === 'x') scaleVec[0] = scaleFactor
          else if (axis === 'y') scaleVec[1] = scaleFactor
          else if (axis === 'z') scaleVec[2] = scaleFactor
          else if (axis === 'center') vec3.set(scaleVec, scaleFactor, scaleFactor, scaleFactor)
          else if (axis === 'xy') { scaleVec[0] = scaleFactor; scaleVec[1] = scaleFactor; }

          selectedNodeIds.forEach(nodeId => {
            const currentVal = keyframeDragData.current?.initialValues.get(nodeId)
            if (currentVal) {
              const newScale = vec3.create()
              // Aggregate scale: New = Current * Delta
              vec3.multiply(newScale, currentVal.scaling as any, scaleVec)

              // Update current value
              vec3.copy(currentVal.scaling as any, newScale)

              // INJECT into Renderer Model for PREVIEW
              const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n.ObjectId === nodeId)
              if (rendererNode) {
                if (!rendererNode.Scaling) rendererNode.Scaling = { Keys: [], InterpolationType: 1 }
                const keys = rendererNode.Scaling.Keys
                const frame = Math.round(currentFrame)
                let key = keys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
                if (!key) {
                  key = { Frame: frame, Vector: [1, 1, 1] }
                  keys.push(key)
                  keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                key.Vector = [newScale[0], newScale[1], newScale[2]]
              }
            }
          })
        }

        // CRITICAL: Force renderer to recalculate bone matrices with new keyframe values
        // This makes the mesh update in real-time while dragging
        rendererRef.current!.update(0)
      }
      return
    }

    if (mouseState.current.isDragging) {
      const deltaX = e.clientX - mouseState.current.lastMouseX
      const deltaY = e.clientY - mouseState.current.lastMouseY
      mouseState.current.lastMouseX = e.clientX
      mouseState.current.lastMouseY = e.clientY

      const doRotate = () => {
        targetCamera.current.theta -= deltaX * 0.01
        targetCamera.current.phi -= deltaY * 0.01
        targetCamera.current.phi = Math.max(0.01, Math.min(Math.PI - 0.01, targetCamera.current.phi))
      }

      const doPan = () => {
        const { theta, phi, distance } = targetCamera.current
        const forward = vec3.fromValues(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
        const up = vec3.fromValues(0, 0, 1)
        const right = vec3.create()
        vec3.cross(right, forward, up)
        vec3.normalize(right, right)
        const camUp = vec3.create()
        vec3.cross(camUp, right, forward)
        vec3.normalize(camUp, camUp)

        const panSpeed = distance * 0.001
        const panX = vec3.create()
        const panY = vec3.create()
        vec3.scale(panX, right, deltaX * panSpeed)
        vec3.scale(panY, camUp, deltaY * panSpeed)

        vec3.add(targetCamera.current.target, targetCamera.current.target, panX)
        vec3.add(targetCamera.current.target, targetCamera.current.target, panY)
      }

      // Camera rotation: Only when Alt is held (swapped: was plain left-click)
      if (mouseState.current.dragButton === 0 && !mouseState.current.isBoxSelecting && e.altKey) {
        // Block camera rotation if Ctrl was held on mouseDown (for geoset picking mode)
        if (!mouseState.current.isCtrlPressed) {
          doRotate()
        }
      } else if (mouseState.current.dragButton === 2 || mouseState.current.dragButton === 1) {
        doPan()
      } else if (mouseState.current.dragButton === 0 && mouseState.current.isBoxSelecting) {
        const startX = mouseState.current.startX
        const startY = mouseState.current.startY
        const currentX = e.clientX
        const currentY = e.clientY
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const x = Math.min(startX, currentX) - rect.left
          const y = Math.min(startY, currentY) - rect.top
          const width = Math.abs(currentX - startX)
          const height = Math.abs(currentY - startY)
          setSelectionBox({ x, y, width, height })
        }
      }
      return
    }

    if (!gizmoState.current.isDragging && !mouseState.current.isDragging && rendererRef.current) {
      const { transformMode, selectedVertexIds, selectedFaceIds, geometrySubMode, mainMode, animationSubMode, selectedNodeIds } = useSelectionStore.getState()

      let showGizmo = false
      const center = vec3.create()
      let count = 0

      if (mainMode === 'geometry') {
        if (geometrySubMode === 'vertex' && selectedVertexIds.length > 0) {
          for (const sel of selectedVertexIds) {
            const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
            if (geoset) {
              const vIndex = sel.index * 3
              center[0] += geoset.Vertices[vIndex]
              center[1] += geoset.Vertices[vIndex + 1]
              center[2] += geoset.Vertices[vIndex + 2]
              count++
            }
          }
          showGizmo = true
        } else if (geometrySubMode === 'face' && selectedFaceIds.length > 0) {
          for (const sel of selectedFaceIds) {
            const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
            if (geoset) {
              const fIndex = sel.index * 3
              const i1 = geoset.Faces[fIndex] * 3, i2 = geoset.Faces[fIndex + 1] * 3, i3 = geoset.Faces[fIndex + 2] * 3
              center[0] += geoset.Vertices[i1] + geoset.Vertices[i2] + geoset.Vertices[i3]
              center[1] += geoset.Vertices[i1 + 1] + geoset.Vertices[i2 + 1] + geoset.Vertices[i3 + 1]
              center[2] += geoset.Vertices[i1 + 2] + geoset.Vertices[i2 + 2] + geoset.Vertices[i3 + 2]
              count += 3
            }
          }
          showGizmo = true
        }
        // 动画模式（binding 和 keyframe）
      } else if (mainMode === 'animation' && selectedNodeIds.length > 0) {
        showGizmo = true
        for (const nodeId of selectedNodeIds) {
          const nodeWrapper = rendererRef.current.rendererData.nodes[nodeId]
          if (nodeWrapper && nodeWrapper.matrix) {
            // 使用矩阵变换 PivotPoint 获取正确的世界坐标
            const matrix = nodeWrapper.matrix
            let pivot = [0, 0, 0]
            if (nodeWrapper.node && nodeWrapper.node.PivotPoint) {
              pivot = nodeWrapper.node.PivotPoint
            } else if (rendererRef.current.model.PivotPoints && rendererRef.current.model.PivotPoints[nodeId]) {
              pivot = rendererRef.current.model.PivotPoints[nodeId]
            }
            const x = matrix[0] * pivot[0] + matrix[4] * pivot[1] + matrix[8] * pivot[2] + matrix[12]
            const y = matrix[1] * pivot[0] + matrix[5] * pivot[1] + matrix[9] * pivot[2] + matrix[13]
            const z = matrix[2] * pivot[0] + matrix[6] * pivot[1] + matrix[10] * pivot[2] + matrix[14]
            center[0] += x
            center[1] += y
            center[2] += z
            count++
          }
        }
      }

      if (showGizmo && count > 0 && transformMode) {
        // Disable Gizmo if Alt is pressed for Box Selection
        // In geometry mode: Alt = camera rotation (keep Gizmo active)
        // In animation mode: Alt = box selection (disable Gizmo)
        if (e.altKey && mainMode === 'animation') {
          gizmoState.current.activeAxis = null
          return
        }

        vec3.scale(center, center, 1.0 / count)
        // Fixed Gizmo Scale (no adaptive scaling)
        const gizmoScale = 1.0

        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect()
          // Convert CSS coords to canvas pixel coords
          const scaleX = canvasRef.current.width / rect.width
          const scaleY = canvasRef.current.height / rect.height
          const x = (e.clientX - rect.left) * scaleX
          const y = (e.clientY - rect.top) * scaleY

          // Use the same camera matrices as render loop for accurate raycasting
          const pMatrix = mat4.create()
          const mvMatrix = mat4.create()
          const cameraPos = vec3.create()

          if (cameraRef.current) {
            cameraRef.current.getMatrix(mvMatrix, pMatrix)
            vec3.copy(cameraPos, cameraRef.current.position)
          } else {
            // Fallback
            const { distance, theta, phi, target } = targetCamera.current
            const cx = distance * Math.sin(phi) * Math.cos(theta)
            const cy = distance * Math.sin(phi) * Math.sin(theta)
            const cz = distance * Math.cos(phi)
            vec3.set(cameraPos, cx, cy, cz)
            vec3.add(cameraPos, cameraPos, target)

            mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 5000)
            const cameraUp = vec3.fromValues(0, 0, 1)
            mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
          }

          // NDC using canvas pixel coordinates
          const ndcX = (x / canvasRef.current.width) * 2 - 1
          const ndcY = -((y / canvasRef.current.height) * 2 - 1)
          const rayClip = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
          const invProj = mat4.create(); mat4.invert(invProj, pMatrix)
          const rayEye = vec4.create(); vec4.transformMat4(rayEye, rayClip, invProj)
          rayEye[2] = -1.0; rayEye[3] = 0.0
          const invView = mat4.create(); mat4.invert(invView, mvMatrix)
          const rayWorld = vec4.create(); vec4.transformMat4(rayWorld, rayEye, invView)
          const rayDir = vec3.fromValues(rayWorld[0], rayWorld[1], rayWorld[2])
          vec3.normalize(rayDir, rayDir)

          const hit = gizmoRenderer.current.raycast(cameraPos, rayDir, center, transformMode as any, gizmoScale)
          gizmoState.current.activeAxis = hit
        }
      }
    }
  }

  const handleRecalculateNormals = () => {
    if (!rendererRef.current) return
    console.log('[Viewer] Recalculating normals (Smooth)...')
    recalculateAllNormals(rendererRef.current, true)
  }

  // Split vertices handler
  const handleSplitVertices = () => {
    if (!rendererRef.current) return
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore.getState()
    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex' || selectedVertexIds.length < 1) return

    console.log('[Viewer] Splitting', selectedVertexIds.length, 'vertices')
    const cmd = new SplitVerticesCommand(rendererRef.current, selectedVertexIds)
    commandManager.execute(cmd)
  }

  // Weld vertices handler
  const handleWeldVertices = () => {
    if (!rendererRef.current) return
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore.getState()
    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex' || selectedVertexIds.length < 2) return

    // Check all vertices are from the same geoset
    const geosetIndex = selectedVertexIds[0].geosetIndex
    const allSameGeoset = selectedVertexIds.every(s => s.geosetIndex === geosetIndex)
    if (!allSameGeoset) {
      console.warn('[Viewer] Cannot weld vertices from different geosets')
      return
    }

    console.log('[Viewer] Welding', selectedVertexIds.length, 'vertices')
    const cmd = new WeldVerticesCommand(rendererRef.current, selectedVertexIds)
    commandManager.execute(cmd)
  }

  const handleMouseUp = (e: any) => {
    const wasBoxSelecting = mouseState.current.isBoxSelecting
    const startX = mouseState.current.startX
    const startY = mouseState.current.startY
    const dragButton = mouseState.current.dragButton

    mouseState.current.isDragging = false
    mouseState.current.isBoxSelecting = false
    mouseState.current.dragButton = -1
    setSelectionBox(null)
    if (cameraRef.current) cameraRef.current.enabled = true

    if (gizmoState.current.isDragging) {
      gizmoState.current.isDragging = false
      gizmoState.current.activeAxis = null

      if (rendererRef.current) {
        const { mainMode, animationSubMode } = useSelectionStore.getState()

        if (mainMode === 'geometry') {
          if (initialVertexPositions.current.size > 0) {
            const changes: VertexChange[] = []

            console.log('[Viewer] Checking vertex changes. Initial positions:', initialVertexPositions.current.size)
            initialVertexPositions.current.forEach((oldPos, key) => {
              const [geosetIndexStr, vertexIndexStr] = key.split('-')
              const geosetIndex = parseInt(geosetIndexStr)
              const vertexIndex = parseInt(vertexIndexStr)

              const geoset = rendererRef.current!.model.Geosets[geosetIndex]
              if (geoset) {
                const vIndex = vertexIndex * 3
                const newPos: [number, number, number] = [geoset.Vertices[vIndex], geoset.Vertices[vIndex + 1], geoset.Vertices[vIndex + 2]]

                if (oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1] || oldPos[2] !== newPos[2]) {
                  changes.push({
                    geosetIndex,
                    vertexIndex,
                    oldPos,
                    newPos
                  })
                }
              }
            })

            console.log('[Viewer] Detected vertex changes:', changes.length)

            if (changes.length > 0) {
              const cmd = new MoveVerticesCommand(
                rendererRef.current,
                changes,
                (syncedChanges) => {
                  const affectedGeosets = new Set(syncedChanges.map(c => c.geosetIndex))
                  affectedGeosets.forEach(index => {
                    const vertices = rendererRef.current?.model.Geosets[index].Vertices
                    if (vertices) {
                      useModelStore.getState().updateGeoset(index, { Vertices: Array.from(vertices) })
                    }
                  })
                }
              )
              commandManager.execute(cmd)
              console.log('[Viewer] Vertex Move Command executed', changes.length)
            }
            initialVertexPositions.current.clear()
          }
        } else if (mainMode === 'animation' && animationSubMode === 'binding') {
          console.log('[Viewer] handleMouseUp - Animation binding mode, checking node changes. initialNodePositions size:', initialNodePositions.current.size)
          if (initialNodePositions.current.size > 0) {
            const changes: NodeChange[] = []

            initialNodePositions.current.forEach((oldPos, nodeId) => {
              const nodeWrapper = rendererRef.current!.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
              if (nodeWrapper && nodeWrapper.node.PivotPoint) {
                const newPos: [number, number, number] = [nodeWrapper.node.PivotPoint[0], nodeWrapper.node.PivotPoint[1], nodeWrapper.node.PivotPoint[2]]

                if (oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1] || oldPos[2] !== newPos[2]) {
                  changes.push({
                    nodeId,
                    oldPivot: oldPos,
                    newPivot: newPos
                  })
                }
              }
            })

            if (changes.length > 0) {
              const cmd = new MoveNodesCommand(
                rendererRef.current,
                changes,
                (syncedChanges) => {
                  const updates = syncedChanges.map(c => ({
                    objectId: c.nodeId,
                    data: { PivotPoint: c.newPivot }
                  }))
                  useModelStore.getState().updateNodes(updates)
                }
              )
              commandManager.execute(cmd)
              console.log('[Viewer] Node Move Command executed', changes.length)
            }
            initialNodePositions.current.clear()
          }
        } else if (mainMode === 'animation' && animationSubMode === 'keyframe') {
          // 1. Translation (using DragDelta)
          const dragDelta = (window as any)._keyframeDragDelta
          if (dragDelta) {
            const { autoKeyframe, currentFrame, nodes } = useModelStore.getState()
            const { selectedNodeIds } = useSelectionStore.getState()

            // FIRST: Clean up preview keyframes from renderer model
            if (rendererRef.current && rendererRef.current.model && rendererRef.current.model.Nodes) {
              selectedNodeIds.forEach(nodeId => {
                const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n.ObjectId === nodeId)
                if (rendererNode && rendererNode.Translation && rendererNode.Translation.Keys) {
                  // Remove all preview keys (marked with _isPreviewKey)
                  rendererNode.Translation.Keys = rendererNode.Translation.Keys.filter((k: any) => !k._isPreviewKey)
                }
              })
            }

            if (autoKeyframe) {
              const translationChanges: KeyframeChange[] = []
              const frame = Math.round(currentFrame)

              selectedNodeIds.forEach(nodeId => {
                const delta = dragDelta[nodeId]
                if (delta && (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0)) {
                  // Build KeyframeChange for Translation
                  // Use interpolated initial value from keyframeDragData (captured in MouseDown)
                  const storeNode = nodes.find((n: any) => n.ObjectId === nodeId)
                  if (storeNode) {
                    const oldKeys = storeNode.Translation?.Keys || []
                    const existingKey = oldKeys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)

                    // Get interpolated translation from keyframeDragData (not exact frame match!)
                    let currentTranslation = [0, 0, 0]
                    const dragData = keyframeDragData.current
                    if (dragData) {
                      const initialVals = dragData.initialValues.get(nodeId) as any
                      if (initialVals && initialVals.translation) {
                        currentTranslation = [...initialVals.translation]
                      }
                    }

                    const newTranslation = [
                      currentTranslation[0] + delta[0],
                      currentTranslation[1] + delta[1],
                      currentTranslation[2] + delta[2]
                    ]

                    // DEBUG: Log commit data
                    console.log('[DEBUG MouseUp] NodeId:', nodeId)
                    console.log('[DEBUG MouseUp] Delta (accumulated):', [...delta])
                    console.log('[DEBUG MouseUp] InitialTranslation (interpolated):', [...currentTranslation])
                    console.log('[DEBUG MouseUp] NewTranslation:', [...newTranslation])
                    console.log('[DEBUG MouseUp] Frame:', frame)

                    translationChanges.push({
                      nodeId,
                      propertyName: 'Translation',
                      frame,
                      oldValue: existingKey ? [...existingKey.Vector] : null,
                      newValue: newTranslation
                    })
                  }
                }
              })

              if (translationChanges.length > 0) {
                const cmd = new UpdateKeyframeCommand(rendererRef.current, translationChanges)
                commandManager.execute(cmd)
                console.log('[Viewer] Committed Translation Keyframe changes via command', translationChanges.length)
              }
            }
            // Clear global delta
            ; (window as any)._keyframeDragDelta = null
          }

          // NOTE: Rotation/Scale keyframe commit is handled separately by the Rotate/Scale gizmo
          // This block was incorrectly running on Translation drag, overwriting keyframes with initial values
          // The correct Rotation/Scale commit happens in the rotation/scale handleMouseMove + handleMouseUp flow

          // Clear keyframeDragData after Translation commit
          keyframeDragData.current = null
        }
      }
      return
    }

    const deltaX = Math.abs(e.clientX - startX)
    const deltaY = Math.abs(e.clientY - startY)
    const isCtrl = e.ctrlKey || e.metaKey

    if (wasBoxSelecting && deltaX > 5 && deltaY > 5) {
      handleBoxSelection(startX, startY, e.clientX, e.clientY, e.shiftKey, isCtrl)
    } else if (deltaX < 5 && deltaY < 5 && dragButton === 0) {
      handleSelectionClick(e.clientX, e.clientY, e.shiftKey, isCtrl)
    }
  }

  // Global copy buffer for vertex operations
  const vertexCopyBuffer = useRef<VertexCopyBuffer | null>(null)

  // Handle vertex delete
  const handleDeleteVertices = () => {
    if (!rendererRef.current) return
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore.getState()
    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex' || selectedVertexIds.length < 1) return

    console.log('[Viewer] Deleting', selectedVertexIds.length, 'vertices')
    const cmd = new DeleteVerticesCommand(rendererRef.current, selectedVertexIds)
    commandManager.execute(cmd)
  }

  // Handle vertex copy
  const handleCopyVertices = () => {
    console.log('[Viewer] handleCopyVertices called')
    if (!rendererRef.current) {
      console.log('[Viewer] handleCopyVertices: No renderer')
      return
    }
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore.getState()
    console.log('[Viewer] handleCopyVertices state:', { mainMode, geometrySubMode, selectedCount: selectedVertexIds.length })
    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex' || selectedVertexIds.length < 1) {
      console.log('[Viewer] handleCopyVertices: Guard failed - mainMode:', mainMode, 'geometrySubMode:', geometrySubMode, 'selectedCount:', selectedVertexIds.length)
      return
    }

    const geosetIndex = selectedVertexIds[0].geosetIndex
    const geoset = rendererRef.current.model.Geosets[geosetIndex]
    if (!geoset) {
      console.log('[Viewer] handleCopyVertices: Geoset not found at index', geosetIndex)
      return
    }

    const vertexIndices = selectedVertexIds.map(s => s.index)
    vertexCopyBuffer.current = copyVertices(geoset, vertexIndices, geosetIndex)
    console.log('[Viewer] Copied', vertexCopyBuffer.current.vertices.length / 3, 'vertices and', vertexCopyBuffer.current.faces.length / 3, 'faces')
  }

  // Handle vertex paste - always creates new geoset
  const handlePasteVertices = () => {
    if (!rendererRef.current || !vertexCopyBuffer.current) {
      console.log('[Viewer] No vertices in copy buffer')
      return
    }

    const { geometrySubMode, mainMode } = useSelectionStore.getState()
    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex') return

    // Execute paste command directly (creates new geoset)
    const cmd = new PasteVerticesCommand(rendererRef.current, vertexCopyBuffer.current, true)
    commandManager.execute(cmd)
  }
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      // Only block keyboard shortcuts when focus is on text input elements
      // Allow shortcuts when focus is on checkboxes, buttons, etc.
      const activeEl = document.activeElement as HTMLInputElement | null
      if (activeEl instanceof HTMLInputElement) {
        const textInputTypes = ['text', 'password', 'email', 'search', 'tel', 'url', 'number']
        if (textInputTypes.includes(activeEl.type)) return
      }
      if (document.activeElement instanceof HTMLTextAreaElement) return

      const { mainMode, geometrySubMode } = useSelectionStore.getState()

      if (e.ctrlKey || e.metaKey) {
        console.log('[Viewer] Keyboard: Ctrl+', e.key, 'mainMode:', mainMode, 'geometrySubMode:', geometrySubMode)

        if (e.key === 'z') {
          e.preventDefault()
          console.log('[Viewer] Executing undo')
          commandManager.undo()
        } else if (e.key === 'y') {
          e.preventDefault()
          console.log('[Viewer] Executing redo')
          commandManager.redo()
        } else if (e.key === 'c' && mainMode === 'geometry' && geometrySubMode === 'vertex') {
          e.preventDefault()
          console.log('[Viewer] Executing copy')
          handleCopyVertices()
        } else if (e.key === 'v' && mainMode === 'geometry' && geometrySubMode === 'vertex') {
          e.preventDefault()
          console.log('[Viewer] Executing paste')
          handlePasteVertices()
        }
      }

      // Delete key
      if (e.key === 'Delete' && mainMode === 'geometry' && geometrySubMode === 'vertex') {
        e.preventDefault()
        handleDeleteVertices()
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => {
          e.preventDefault()
          const { mainMode, geometrySubMode, selectedVertexIds } = useSelectionStore.getState()
          // Show context menu in vertex mode when vertices are selected AND Alt is pressed
          if (mainMode === 'geometry' && geometrySubMode === 'vertex' && selectedVertexIds.length > 0 && e.altKey) {
            setContextMenu({ x: e.clientX, y: e.clientY })
          }
        }}
        onWheel={handleWheel}
      />

      {/* Progress bar - hidden in animation mode (has its own timeline) */}
      {appMainMode !== 'animation' && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '5px',
          width: '60%',
          maxWidth: '600px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          padding: '10px',
          borderRadius: '8px',
          pointerEvents: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
            <button
              onClick={onTogglePlay}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontSize: '20px',
                width: '30px'
              }}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              min={renderer?.rendererData?.animationInfo?.Interval[0] || 0}
              max={renderer?.rendererData?.animationInfo?.Interval[1] || 100}
              value={progress}
              onChange={handleSeek}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ color: 'white', fontSize: '12px', minWidth: '80px', textAlign: 'right' }}>
              {Math.round(progress)} / {Math.round(duration)}
            </span>
          </div>
        </div>
      )}
      {showFPS && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.5)',
          color: '#0f0',
          padding: '5px 10px',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '14px',
          pointerEvents: 'none',
          zIndex: 10
        }}>
          FPS: {fps}
        </div>
      )}

      {/* Camera Selector Dropdown */}
      {(() => {
        const { nodes: storeNodes } = useModelStore.getState();
        const cameraList = storeNodes.filter((n: any) => n.type === 'Camera');
        if (cameraList.length === 0) return null;

        return (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 10
          }}>
            <select
              id="camera-selector"
              style={{
                background: 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                border: '1px solid #555',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
              onChange={(e) => {
                const idx = parseInt(e.target.value);
                if (idx >= 0 && idx < cameraList.length) {
                  const cam = cameraList[idx];
                  // Select the camera node instead of switching view
                  // usage of selectNode(id, multiSelect)
                  useSelectionStore.getState().selectNode(cam.ObjectId);
                }
              }}
              defaultValue="-1"
            >
              <option value="-1" disabled>选择相机...</option>
              {cameraList.map((cam: any, i: number) => (
                <option key={i} value={i}>{cam.Name || `Camera ${i + 1}`}</option>
              ))}
            </select>
          </div>
        );
      })()}

      {selectionBox && (
        <div
          style={{
            position: 'absolute',
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.width,
            height: selectionBox.height,
            border: '2px dashed rgba(0, 200, 255, 0.9)',
            backgroundColor: 'transparent',
            pointerEvents: 'none',
            zIndex: 1000
          }}
        />
      )}

      {showModelInfo && (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              width: 'auto',
              maxWidth: 200,
              maxHeight: 'calc(100% - 100px)',
              backgroundColor: 'rgba(30, 30, 30, 0.85)',
              border: '1px solid #007acc',
              borderRadius: '4px',
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              pointerEvents: 'auto'
            }}
          >
            <div style={{
              padding: '6px 12px',
              borderBottom: '1px solid #007acc',
              fontWeight: 'bold',
              color: '#fff',
              fontSize: '12px',
              backgroundColor: 'rgba(0, 122, 204, 0.2)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>模型信息</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <ModelInfoPanel />
            </div>
          </div>
        </ConfigProvider>
      )}

      <ViewerToolbar
        onRecalculateNormals={handleRecalculateNormals}
        onSplitVertices={handleSplitVertices}
        onWeldVertices={handleWeldVertices}
      />
      {/* Bone Binding Panel - Rendered here to access rendererRef */}
      <BoneBindingPanel />
      {appMainMode === 'geometry' && <VertexEditor renderer={renderer} onBeginUpdate={() => { ignoreNextModelDataUpdate.current = true }} />}

      {/* Context Menu for Vertex Operations */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: 'rgba(40, 40, 40, 0.95)',
            border: '1px solid #555',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 2000,
            minWidth: '120px',
            padding: '4px 0',
          }}
          onClick={() => setContextMenu(null)}
        >
          <div
            style={{
              padding: '6px 12px',
              cursor: useSelectionStore.getState().selectedVertexIds.length >= 1 ? 'pointer' : 'not-allowed',
              color: useSelectionStore.getState().selectedVertexIds.length >= 1 ? 'white' : '#666',
              fontSize: '13px',
            }}
            onMouseEnter={(e) => {
              if (useSelectionStore.getState().selectedVertexIds.length >= 1) {
                (e.target as HTMLDivElement).style.backgroundColor = '#1890ff'
              }
            }}
            onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
            onClick={() => {
              if (useSelectionStore.getState().selectedVertexIds.length >= 1) {
                handleSplitVertices()
              }
              setContextMenu(null)
            }}
          >
            分离顶点
          </div>
          <div
            style={{
              padding: '6px 12px',
              cursor: (() => {
                const { selectedVertexIds } = useSelectionStore.getState()
                return selectedVertexIds.length >= 2 && selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex) ? 'pointer' : 'not-allowed'
              })(),
              color: (() => {
                const { selectedVertexIds } = useSelectionStore.getState()
                return selectedVertexIds.length >= 2 && selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex) ? 'white' : '#666'
              })(),
              fontSize: '13px',
            }}
            onMouseEnter={(e) => {
              const { selectedVertexIds } = useSelectionStore.getState()
              if (selectedVertexIds.length >= 2 && selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex)) {
                (e.target as HTMLDivElement).style.backgroundColor = '#1890ff'
              }
            }}
            onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
            onClick={() => {
              const { selectedVertexIds } = useSelectionStore.getState()
              if (selectedVertexIds.length >= 2 && selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex)) {
                handleWeldVertices()
              }
              setContextMenu(null)
            }}
          >
            焊接顶点
          </div>
        </div>
      )}

      {/* Click outside to close context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1999,
          }}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu(null)
          }}
        />
      )}
    </div>
  )
})

export default Viewer
