import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useMemo, useCallback } from 'react'
import { decodeBLP, getBLPImageData, ModelRenderer } from 'war3-model'
// @ts-ignore
import ModelWorker from '../workers/model-worker.worker?worker'
import TextureAdjustWorker from '../workers/texture-adjust.worker?worker'
import { SimpleOrbitCamera } from '../utils/SimpleOrbitCamera'
import { decodeTextureData, getTextureCandidatePaths, loadAllTextures, normalizePath, prepareModelForTextureLoad } from './viewer/textureLoader'
import { createModelParseCacheKey, getCachedParsedModel, setCachedParsedModel } from './viewer/modelParseCache'
import { validateAllParticleEmitters } from './viewer/particleValidator'
import { describePe2AnimOrScalar, pe2PreviewDebugEnabled } from '../utils/pe2PreviewDebug'
import { checkForStructuralChanges, syncParticleEmitters2InPlace } from './viewer/modelSync'
import { getEnvironmentManager } from './viewer/EnvironmentManager'
import { logModelInfo } from '../utils/debugLogger'
import { hexToRgb } from './viewer/types'
import { mat3, mat4, vec3, vec4, quat } from 'gl-matrix'
import { GridRenderer } from './GridRenderer'
import { DebugRenderer } from './DebugRenderer'
import { GizmoRenderer, GizmoAxis, GIZMO_AXIS_LENGTH } from './GizmoRenderer'
import { AxisIndicator } from './AxisIndicator'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { DEFAULT_TEXTURE_ADJUSTMENTS, TextureAdjustments, applyTextureAdjustments, isDefaultTextureAdjustments, normalizeTextureAdjustments } from '../utils/textureAdjustments'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { useModelStore } from '../store/modelStore'
import { useRendererStore } from '../store/rendererStore'
import { useHistoryStore } from '../store/historyStore'
import { ModelInfoPanel } from './info/ModelInfoPanel'
import { ViewerToolbar } from './ViewerToolbar'
import { ConfigProvider, message, theme } from 'antd'
import { CameraOutlined, CopyOutlined, SyncOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { commandManager } from '../utils/CommandManager'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { MoveNodesCommand, NodeChange } from '../commands/MoveNodesCommand'
import { SetNodeParentCommand } from '../commands/SetNodeParentCommand'
import { VertexEditor } from './VertexEditor'
import { pickClosestGeoset } from '../utils/rayTriangle'
import { SplitVerticesCommand } from '../commands/SplitVerticesCommand'
import { AutoSeparateLayersCommand } from '../commands/AutoSeparateLayersCommand'
import { WeldVerticesCommand } from '../commands/WeldVerticesCommand'
import { DeleteVerticesCommand } from '../commands/DeleteVerticesCommand'
import { PasteVerticesCommand } from '../commands/PasteVerticesCommand'
import { isTextInputActive } from '../shortcuts/utils'

const toTextureUpdateUint8Array = (payload: any): Uint8ClampedArray | null => {
  if (!payload) return null
  if (payload instanceof Uint8ClampedArray) return payload
  if (payload instanceof Uint8Array) return new Uint8ClampedArray(payload.buffer, payload.byteOffset, payload.byteLength)
  if (payload instanceof ArrayBuffer) return new Uint8ClampedArray(payload)
  if (ArrayBuffer.isView(payload)) {
    return new Uint8ClampedArray(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  if (Array.isArray(payload)) return new Uint8ClampedArray(payload)
  return null
}

const getLiveTextureSourceKey = (modelPath: string, imagePath: string): string => `${modelPath || ''}::${normalizePath(imagePath || '')}`

type LiveTextureAdjustPayload = {
  modelPath: string
  imagePath: string
  adjustments: TextureAdjustments
}
import { GlobalTransformCommand } from '../commands/GlobalTransformCommand'
import { copyVertices, copyFaces, VertexCopyBuffer } from '../utils/vertexOperations'
import { UpdateKeyframeCommand, KeyframeChange } from '../commands/UpdateKeyframeCommand'
import { MissingTextureWarning } from './MissingTextureWarning'
import { GeosetSeparateDialog } from './modals/GeosetSeparateDialog'
import { LayerConfig, layerConfigToMaterialLayer } from './modals/MaterialLayerOptions'
import { NodeType } from '../types/node'
import { openNodeEditor } from '../utils/nodeEditorOpen'
import { nodeTypeToEditorKind } from '../types/nodeEditorRpc'
import { registerShortcutHandler } from '../shortcuts/manager'
import { markStandalonePerf } from '../utils/standalonePerf'
import { invokeReadMpqFile } from '../utils/mpqPerf'
import {
  markNodeManagerListScrollFromTree,
  markNodeManagerListScrollFromViewer,
} from '../utils/nodeManagerListScrollBridge'

// Singleton loop counter to prevent runaway FPS
let globalRenderLoopId = 0

// Ref interface for external access to camera methods
export interface ViewerRef {
  fitToView: () => void
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
  showAttachments?: boolean
  showWireframe: boolean
  isPlaying: boolean
  onTogglePlay: () => void
  onToggleWireframe: () => void
  onModelLoaded: (model: any) => void
  backgroundColor: string
  showFPS: boolean
  playbackSpeed: number
  viewPreset?: { type: string, time: number, reset?: boolean } | null
  onSetViewPreset?: (preset: string) => void
  modelData?: any
  onAddCameraFromView?: () => void
}

const toUint8Array = (payload: any): Uint8Array | null => {
  if (!payload) return null
  if (payload instanceof Uint8Array) return payload
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload)
  }
  if (typeof payload === 'string') {
    try {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    } catch {
      return null
    }
  }
  if (typeof payload === 'object') {
    const candidate = (payload as any).data ?? (payload as any).bytes ?? (payload as any).payload
    if (candidate !== undefined) {
      return toUint8Array(candidate)
    }
    const numericKeys = Object.keys(payload)
      .filter((k) => /^d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
    if (numericKeys.length > 0) {
      const bytes = new Uint8Array(numericKeys.length)
      for (let i = 0; i < numericKeys.length; i++) {
        bytes[i] = Number((payload as any)[numericKeys[i]]) & 0xff
      }
      return bytes
    }
  }
  return null
}

const toTightArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const TEXTURE_PREVIEW_EXTENSIONS = new Set(['blp', 'tga'])

const isTexturePreviewPath = (path: string): boolean => {
  const lower = path.toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  if (dotIndex < 0) return false
  const ext = lower.substring(dotIndex + 1)
  return TEXTURE_PREVIEW_EXTENSIONS.has(ext)
}

const getTextureDecodeWorkerCount = (): number => {
  if (typeof navigator === 'undefined') return 2
  const cores = Number(navigator.hardwareConcurrency || 4)
  if (!Number.isFinite(cores) || cores <= 2) return 2
  // 多核机器略增 Worker 数以并行解码 BLP/TGA，上限 6 避免过多线程切换
  return Math.max(2, Math.min(6, Math.floor(cores / 2)))
}

const WEBGL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false
}

type ViewerFramePerfSample = {
  totalMs: number
  clearMs: number
  cameraMs: number
  stateMs: number
  updateMs: number
  sceneMs: number
  overlayMs: number
}

type ViewerFramePerfAggregate = {
  samples: number
  totalMs: number
  maxTotalMs: number
  slowFrameCount: number
  clearMs: number
  cameraMs: number
  stateMs: number
  updateMs: number
  sceneMs: number
  overlayMs: number
  lastSlowEmitMs: number
}

const createViewerFramePerfAggregate = (): ViewerFramePerfAggregate => ({
  samples: 0,
  totalMs: 0,
  maxTotalMs: 0,
  slowFrameCount: 0,
  clearMs: 0,
  cameraMs: 0,
  stateMs: 0,
  updateMs: 0,
  sceneMs: 0,
  overlayMs: 0,
  lastSlowEmitMs: 0,
})

const roundPerfValue = (value: number): number => Number(value.toFixed(2))

const Viewer = forwardRef((props: ViewerProps, ref: React.Ref<ViewerRef>) => {
  const {
  modelPath,
  animationIndex,
  teamColor,
  showGrid,
  showNodes,
  showSkeleton,
  showCollisionShapes,
  showCameras,
  showLights,
  showAttachments,
  showWireframe,
  isPlaying,
  onTogglePlay,
  onToggleWireframe,
  onModelLoaded,
  backgroundColor,
  showFPS,
  playbackSpeed,
  viewPreset,
  modelData,
  onSetViewPreset,
  onAddCameraFromView
  } = props
  const [parseWorker] = useState(() => new ModelWorker())
  const [textureWorkers] = useState(() => {
    const count = getTextureDecodeWorkerCount()
    return Array.from({ length: count }, () => new ModelWorker())
  })
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
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
  const rendererReloadTrigger = useModelStore((state) => state.rendererReloadTrigger)
  const cachedRenderer = useModelStore((state) => state.cachedRenderer)
  const mpqLoaded = useRendererStore((state) => state.mpqLoaded)
  const nodeRenderMode = useRendererStore((state) => state.nodeRenderMode)
  const missingTextures = useRendererStore((state) => state.missingTextures)
  const glRef = useRef<WebGL2RenderingContext | WebGLRenderingContext | null>(null)
  const needsRendererUpdateRef = useRef(false)
  const animationFrameId = useRef<number | null>(null)
  const shouldRunRenderLoop = useRef<boolean>(true) // Flag to stop RAF loop on cleanup
  const lastRenderErrorReportTimeRef = useRef<number>(0)
  const framePerfRef = useRef<ViewerFramePerfAggregate>(createViewerFramePerfAggregate())
  const lastFpsTime = useRef<number>(performance.now())
  const lastFrameTime = useRef<number>(performance.now())
  const frameCount = useRef<number>(0)
  const renderRef = useRef<((time: number, scheduleNext?: boolean) => void) | null>(null)
  const pMatrixRef = useRef(mat4.create())
  const mvMatrixRef = useRef(mat4.create())
  const cameraPosRef = useRef(vec3.create())
  const cameraUpRef = useRef(vec3.fromValues(0, 0, 1))
  const cameraQuatRef = useRef(quat.create())
  const { showModelInfo } = useUIStore()
  const { isLooping, setLooping } = useModelStore()
  const [texturePreview, setTexturePreview] = useState<{
    url: string
    width: number
    height: number
    path: string
  } | null>(null)
  const backgroundTextureResolveRunningRef = useRef(false)
  const attemptedMissingTexturePathsRef = useRef<Set<string>>(new Set())

  const flushFramePerfSummary = useCallback((reason: string, force = false) => {
    const bucket = framePerfRef.current
    if (bucket.samples === 0) return
    if (!force && bucket.samples < 90) return

    markStandalonePerf('viewer_frame_profile', {
      reason,
      samples: bucket.samples,
      avgTotalMs: roundPerfValue(bucket.totalMs / bucket.samples),
      maxTotalMs: roundPerfValue(bucket.maxTotalMs),
      slowFrameCount: bucket.slowFrameCount,
      avgClearMs: roundPerfValue(bucket.clearMs / bucket.samples),
      avgCameraMs: roundPerfValue(bucket.cameraMs / bucket.samples),
      avgStateMs: roundPerfValue(bucket.stateMs / bucket.samples),
      avgUpdateMs: roundPerfValue(bucket.updateMs / bucket.samples),
      avgSceneMs: roundPerfValue(bucket.sceneMs / bucket.samples),
      avgOverlayMs: roundPerfValue(bucket.overlayMs / bucket.samples),
      isPlaying: isPlayingRef.current,
      modelPath: modelPath || '',
    })

    framePerfRef.current = createViewerFramePerfAggregate()
  }, [modelPath])

  const recordFramePerfSample = useCallback((sample: ViewerFramePerfSample, detail?: Record<string, unknown>) => {
    const bucket = framePerfRef.current
    bucket.samples += 1
    bucket.totalMs += sample.totalMs
    bucket.maxTotalMs = Math.max(bucket.maxTotalMs, sample.totalMs)
    bucket.clearMs += sample.clearMs
    bucket.cameraMs += sample.cameraMs
    bucket.stateMs += sample.stateMs
    bucket.updateMs += sample.updateMs
    bucket.sceneMs += sample.sceneMs
    bucket.overlayMs += sample.overlayMs
    if (sample.totalMs >= 16.7) {
      bucket.slowFrameCount += 1
    }

    const now = performance.now()
    if (sample.totalMs >= 33 && now - bucket.lastSlowEmitMs >= 1000) {
      bucket.lastSlowEmitMs = now
      markStandalonePerf('viewer_slow_frame', {
        totalMs: roundPerfValue(sample.totalMs),
        clearMs: roundPerfValue(sample.clearMs),
        cameraMs: roundPerfValue(sample.cameraMs),
        stateMs: roundPerfValue(sample.stateMs),
        updateMs: roundPerfValue(sample.updateMs),
        sceneMs: roundPerfValue(sample.sceneMs),
        overlayMs: roundPerfValue(sample.overlayMs),
        ...detail,
      })
    }

    if (bucket.samples >= 90) {
      flushFramePerfSummary('periodic')
    }
  }, [flushFramePerfSummary])

  useEffect(() => {
    return () => {
      parseWorker.terminate()
      textureWorkers.forEach((worker) => worker.terminate())
    }
  }, [parseWorker, textureWorkers])

  const formatCameraValue = (value: number): string => {
    if (!Number.isFinite(value)) return '0'
    const formatted = value.toFixed(2)
    return formatted.replace(/.?0+$/, '')
  }

  const getCameraVector = (prop: any, directProp?: any): number[] => {
    const isArrayLike = (v: any) => Array.isArray(v) || v instanceof Float32Array || ArrayBuffer.isView(v)
    const toArray = (v: any) => v instanceof Float32Array ? Array.from(v) : v

    if (directProp && isArrayLike(directProp)) return toArray(directProp)
    if (isArrayLike(prop)) return toArray(prop)
    if (prop && prop.Keys && prop.Keys.length > 0) {
      const v = prop.Keys[0].Vector
      return v ? toArray(v) : [0, 0, 0]
    }
    return [0, 0, 0]
  }

  const getAvailableCameras = (): any[] => {
    const { modelData, nodes } = useModelStore.getState()
    const modelCameras = Array.isArray((modelData as any)?.Cameras) ? (modelData as any).Cameras.filter((cam: any) => cam) : []
    if (modelCameras.length > 0) return modelCameras
    return Array.isArray(nodes) ? nodes.filter((n: any) => n && n.type === 'Camera') : []
  }
  const getSelectedCamera = (cameraIndex = selectedCameraIndex): any | null => {
    const cameraList = getAvailableCameras()
    if (cameraIndex < 0 || cameraIndex >= cameraList.length) return null
    return cameraList[cameraIndex] ?? null
  }
  const clearActiveModelCameraView = () => {
    inCameraView.current = false
    setActiveModelCameraView(null)
  }
  const roundVertexCoord = (value: number): number => Math.round(value * 10000) / 10000

  const getVertexPositionKey = (vertices: ArrayLike<number>, vertexIndex: number): string => {
    const base = vertexIndex * 3
    return `${roundVertexCoord(Number(vertices[base] ?? 0))},${roundVertexCoord(Number(vertices[base + 1] ?? 0))},${roundVertexCoord(Number(vertices[base + 2] ?? 0))}`
  }

  const getExpandedFaceVertexSelection = (
    selectedFaceIds: Array<{ geosetIndex: number; index: number }>
  ): Array<{ geosetIndex: number; index: number }> => {
    const result: Array<{ geosetIndex: number; index: number }> = []
    const uniqueVertexKeys = new Set<string>()
    const coincidentPositionKeysByGeoset = new Map<number, Set<string>>()

    if (!rendererRef.current || !Array.isArray(rendererRef.current.model?.Geosets)) {
      return result
    }

    const geosets = rendererRef.current.model.Geosets

    const pushVertex = (geosetIndex: number, index: number) => {
      const vertexKey = `${geosetIndex}:${index}`
      if (uniqueVertexKeys.has(vertexKey)) {
        return
      }
      uniqueVertexKeys.add(vertexKey)
      result.push({ geosetIndex, index })
    }

    selectedFaceIds.forEach((sel) => {
      const geoset = geosets[sel.geosetIndex]
      if (!geoset?.Vertices || !geoset?.Faces) {
        return
      }

      const fIndex = sel.index * 3
      const indices = [
        Number(geoset.Faces[fIndex]),
        Number(geoset.Faces[fIndex + 1]),
        Number(geoset.Faces[fIndex + 2])
      ].filter((value) => Number.isFinite(value))

      let posSet = coincidentPositionKeysByGeoset.get(sel.geosetIndex)
      if (!posSet) {
        posSet = new Set<string>()
        coincidentPositionKeysByGeoset.set(sel.geosetIndex, posSet)
      }

      indices.forEach((vertexIndex) => {
        pushVertex(sel.geosetIndex, vertexIndex)
        posSet!.add(getVertexPositionKey(geoset.Vertices, vertexIndex))
      })
    })

    coincidentPositionKeysByGeoset.forEach((positionKeys, geosetIndex) => {
      const geoset = geosets[geosetIndex]
      if (!geoset?.Vertices) {
        return
      }

      const vertexCount = Math.floor(geoset.Vertices.length / 3)
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        if (positionKeys.has(getVertexPositionKey(geoset.Vertices, vertexIndex))) {
          pushVertex(geosetIndex, vertexIndex)
        }
      }
    })

    return result
  }

  const getSplitVertexSelection = (): Array<{ geosetIndex: number; index: number }> => {
    const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()

    if (geometrySubMode === 'vertex') {
      return selectedVertexIds
    }

    if (geometrySubMode === 'face' || geometrySubMode === 'group') {
      return getExpandedFaceVertexSelection(selectedFaceIds as Array<{ geosetIndex: number; index: number }>)
    }

    return []
  }


  const getConnectedGeometryGroup = (
    geosetIndex: number,
    seedFaceIndices: number[] = [],
    seedVertexIndices: number[] = []
  ): {
    vertices: Array<{ geosetIndex: number; index: number }>,
    faces: Array<{ geosetIndex: number; index: number }>
  } => {
    if (!rendererRef.current) {
      return { vertices: [], faces: [] }
    }

    const geoset = rendererRef.current.model?.Geosets?.[geosetIndex]
    if (!geoset?.Vertices || !geoset?.Faces) {
      return { vertices: [], faces: [] }
    }

    const faceCount = Math.floor(geoset.Faces.length / 3)
    const facesByPositionKey = new Map<string, number[]>()
    const positionKeysByFace = new Array<string[]>(faceCount)
    const vertexIndicesByFace = new Array<number[]>(faceCount)

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
      const fIndex = faceIndex * 3
      const vertexIndices = [
        Number(geoset.Faces[fIndex]),
        Number(geoset.Faces[fIndex + 1]),
        Number(geoset.Faces[fIndex + 2])
      ]
      vertexIndicesByFace[faceIndex] = vertexIndices
      positionKeysByFace[faceIndex] = vertexIndices.map((vertexIndex) => getVertexPositionKey(geoset.Vertices, vertexIndex))

      positionKeysByFace[faceIndex].forEach((positionKey) => {
        const connectedFaces = facesByPositionKey.get(positionKey)
        if (connectedFaces) {
          connectedFaces.push(faceIndex)
        } else {
          facesByPositionKey.set(positionKey, [faceIndex])
        }
      })
    }

    const pendingFaces: number[] = []
    const visitedFaces = new Set<number>()
    const visitedVertices = new Set<number>()

    const enqueueFace = (faceIndex: number) => {
      if (faceIndex < 0 || faceIndex >= faceCount || visitedFaces.has(faceIndex)) {
        return
      }
      visitedFaces.add(faceIndex)
      pendingFaces.push(faceIndex)
    }

    seedFaceIndices.forEach(enqueueFace)

    seedVertexIndices.forEach((vertexIndex) => {
      const positionKey = getVertexPositionKey(geoset.Vertices, vertexIndex)
      const connectedFaces = facesByPositionKey.get(positionKey)
      if (connectedFaces && connectedFaces.length > 0) {
        connectedFaces.forEach(enqueueFace)
      } else {
        visitedVertices.add(vertexIndex)
      }
    })

    while (pendingFaces.length > 0) {
      const faceIndex = pendingFaces.pop()!
      const vertexIndices = vertexIndicesByFace[faceIndex]
      vertexIndices.forEach((vertexIndex) => visitedVertices.add(vertexIndex))
      positionKeysByFace[faceIndex].forEach((positionKey) => {
        const connectedFaces = facesByPositionKey.get(positionKey)
        if (connectedFaces) {
          connectedFaces.forEach(enqueueFace)
        }
      })
    }

    if (visitedVertices.size > 0) {
      const seedPositionKeys = new Set<string>()
      visitedVertices.forEach((vertexIndex) => {
        seedPositionKeys.add(getVertexPositionKey(geoset.Vertices, vertexIndex))
      })
      const vertexCount = Math.floor(geoset.Vertices.length / 3)
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        if (seedPositionKeys.has(getVertexPositionKey(geoset.Vertices, vertexIndex))) {
          visitedVertices.add(vertexIndex)
        }
      }
    }

    return {
      vertices: Array.from(visitedVertices).map((index) => ({ geosetIndex, index })),
      faces: Array.from(visitedFaces).map((index) => ({ geosetIndex, index }))
    }
  }

  // Sync isLooping to renderer
  useEffect(() => {
    if (renderer && renderer.rendererData) {
      renderer.rendererData.loop = isLooping
    }
  }, [renderer, isLooping])

  const copySelectedCameraParams = () => {
    const { selectedNodeIds } = useSelectionStore.getState()
    const cameraList = getAvailableCameras()

    if (cameraList.length === 0) return

    let camera = cameraList.find((cam: any) => selectedNodeIds.includes(cam.ObjectId))
    if (!camera) {
      const selector = document.getElementById('camera-selector') as HTMLSelectElement | null
      if (selector && selector.value && selector.value !== '-1') {
        const idx = parseInt(selector.value, 10)
        if (!Number.isNaN(idx) && cameraList[idx]) {
          camera = cameraList[idx]
        }
      }
    }

    if (!camera) return

    const pos = getCameraVector(camera.Translation, (camera as any).Position)
    const target = getCameraVector(camera.TargetTranslation, (camera as any).TargetPosition)
    const text = `${formatCameraValue(pos[0])},${formatCameraValue(pos[1])},${formatCameraValue(pos[2])}\n` +
      `${formatCameraValue(target[0])},${formatCameraValue(target[1])},${formatCameraValue(target[2])}`

    navigator.clipboard.writeText(text).catch(() => { })
  }

  // Mount/Unmount tracking
  useEffect(() => {
    // // // console.log('[Viewer] Component mounted');
    return () => console.log('[Viewer] Component unmounted');
  }, []);

  // Hot-swap cached renderer when it changes (tab switch)
  useEffect(() => {
    if (cachedRenderer && cachedRenderer.model) {
      const modelPathStr = (cachedRenderer as any).__modelPath || cachedRenderer.model.path || 'unknown';
      console.log('[Viewer] Hot-swapping to cached renderer:', modelPathStr)
      // Update local state
      setRenderer(cachedRenderer)
      rendererRef.current = cachedRenderer

      // Update global renderer store if needed
      useRendererStore.getState().setRenderer(cachedRenderer)

      // Sync frame from store to renderer to avoid jump
      const currentFrame = useModelStore.getState().currentFrame
      if (cachedRenderer.rendererData) {
        cachedRenderer.rendererData.frame = currentFrame
      }

      // Clear loading state since we are hot-swapping
      setLoading(false)
      setLoadingStatus('')

      // Restore camera visually
      syncCameraToOrbit()

      // Notify parent components so UI updates (nodes, animations list)
      onModelLoaded(cachedRenderer.model)

      // Ensure viewport and renderer size are correct
      if (canvasRef.current) {
        const width = canvasRef.current.width;
        const height = canvasRef.current.height;
        console.log('[Viewer] Syncing viewport and renderer resize:', width, height);

        if (glRef.current) {
          glRef.current.viewport(0, 0, width, height);
        }

        if (typeof (cachedRenderer as any).resize === 'function') {
          (cachedRenderer as any).resize(width, height);
        }
      }

      // Force-trigger a re-render in the loop to show the model immediately
      needsRendererUpdateRef.current = true
      console.log('[Viewer] Hot-swap complete, re-render triggered');

      // Reset time tracking to prevent delta spike
      lastFrameTime.current = performance.now()
    }
  }, [cachedRenderer])

  // Refs for props to be accessible in render loop
  const showGridRef = useRef(showGrid)
  const showNodesRef = useRef(showNodes)
  const nodeRenderModeRef = useRef(nodeRenderMode)
  const showSkeletonRef = useRef(showSkeleton)
  const showCollisionShapesRef = useRef(showCollisionShapes)
  const showCamerasRef = useRef(showCameras)
  const showLightsRef = useRef(showLights)
  const showAttachmentsRef = useRef(showAttachments)
  const showParticlesRef = useRef(useRendererStore.getState().showParticles ?? true)
  const showRibbonsRef = useRef(useRendererStore.getState().showRibbons ?? true)
  const showWireframeRef = useRef(showWireframe)
  const isPlayingRef = useRef(isPlaying)
  const playbackSpeedRef = useRef(playbackSpeed)
  const backgroundColorRef = useRef(backgroundColor)

  // Store-derived refs
  const getShowVerticesForCurrentContext = () => {
    const state = useRendererStore.getState() as any
    const sel = useSelectionStore.getState()
    if (sel.mainMode === 'animation') {
      return sel.animationSubMode === 'binding'
        ? (state.showVerticesInAnimationBinding ?? true)
        : (state.showVerticesInAnimationKeyframe ?? false)
    }
    return state.showVerticesByMode?.[sel.mainMode] ?? true
  }

  const showVerticesRef = useRef(getShowVerticesForCurrentContext())
  const enableLightingRef = useRef(useRendererStore.getState().enableLighting)
  const vertexSettingsRef = useRef(useRendererStore.getState().vertexSettings)

  // Cache for bound vertex highlighting (to avoid per-frame recalculation)
  const boundVerticesCache = useRef<{ boneId: number, vertices: number[] } | null>(null)

  // Progress bar state
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(100)
  const lastProgressUpdate = useRef(0)
  const ignoreNextModelDataUpdate = useRef(false)
  const lastFrameSyncTime = useRef(0) // For throttling setFrame calls
  const frameCacheRef = useRef(-1) // Cache for bone matrix optimization

  // Separate dialog state
  const [separateDialogVisible, setSeparateDialogVisible] = useState(false)
  const [separateSourceGeosetIndex, setSeparateSourceGeosetIndex] = useState(0)


  useEffect(() => {
    showGridRef.current = showGrid
    showNodesRef.current = showNodes
    nodeRenderModeRef.current = nodeRenderMode
    showSkeletonRef.current = showSkeleton
    showCollisionShapesRef.current = showCollisionShapes
    showCamerasRef.current = showCameras
    showLightsRef.current = showLights
    showAttachmentsRef.current = !!showAttachments
    showWireframeRef.current = showWireframe
    isPlayingRef.current = isPlaying
    playbackSpeedRef.current = playbackSpeed
    backgroundColorRef.current = backgroundColor

    // Sync store-only settings
    const state = useRendererStore.getState()
    showVerticesRef.current = getShowVerticesForCurrentContext()
    vertexSettingsRef.current = state.vertexSettings
  }, [showGrid, showNodes, nodeRenderMode, showSkeleton, showCollisionShapes, showCameras, showLights, showAttachments, showWireframe, isPlaying, playbackSpeed, backgroundColor,
    // Add implicit dependencies if they result in re-render, otherwise we rely on the loop checking refs.
    // Actually, we should subscribe or just use .getState() in the loop for low-frequency changes?
    // Refs are better for avoiding loop capturing stale closures.
    // But we need to update refs when store changes.
  ])

  useEffect(() => {
    if (isPlaying) return
    const mdlRenderer = rendererRef.current
    if (!mdlRenderer?.rendererData) return
    const currentFrame = Number(mdlRenderer.rendererData.frame)
    if (!Number.isFinite(currentFrame)) return

    // Ensure timeline/store frame matches actual renderer frame on pause.
    // This prevents a visible rollback when pausing multiple times in keyframe mode.
    useModelStore.getState().setFrame(currentFrame)
  }, [isPlaying])

  // Separate effect for store-driven updates (since they aren't props)
  useEffect(() => {
    const unsub = useRendererStore.subscribe((state) => {
      showVerticesRef.current = getShowVerticesForCurrentContext()
      enableLightingRef.current = state.enableLighting
      vertexSettingsRef.current = state.vertexSettings
      showParticlesRef.current = state.showParticles ?? true
      showRibbonsRef.current = state.showRibbons ?? true
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    // Update when mode/sub-mode changes even if rendererStore doesn't change.
    showVerticesRef.current = getShowVerticesForCurrentContext()
  }, [appMainMode, animationSubMode])


  useEffect(() => {
    if (canvasRef.current && !cameraRef.current) {
      cameraRef.current = new SimpleOrbitCamera(canvasRef.current)
    }
    // CRITICAL: Cleanup camera listeners on unmount to prevent listener leak
    return () => {
      if (cameraRef.current) {
        cameraRef.current.destroy()
        cameraRef.current = null
      }
    }
  }, [])

  // Sync renderer to global store
  const { setRenderer: setGlobalRenderer } = useRendererStore()
  useEffect(() => {
    setGlobalRenderer(renderer)
  }, [renderer, setGlobalRenderer])

  // Live Texture Preview from Standalone Texture Manager
  useEffect(() => {
    const sourceCache = new Map<string, { imagePath: string, imageData: ImageData }>()
    const sourceLoadCache = new Map<string, Promise<ImageData | null>>()
    const adjustWorker = new TextureAdjustWorker()
    let processing = false
    let activeSourceKey: string | null = null
    let queuedAdjust: LiveTextureAdjustPayload | null = null
    let pendingResolve: ((imageData: ImageData | null) => void) | null = null
    let pendingRequestId = 0

    const areAdjustmentsEqual = (left: TextureAdjustments, right: TextureAdjustments) =>
      left.hue === right.hue &&
      left.brightness === right.brightness &&
      left.saturation === right.saturation &&
      left.opacity === right.opacity

    const applyImageDataToRenderer = (imagePath: string, imageData: ImageData) => {
      const currentRenderer = rendererRef.current
      if (currentRenderer && typeof currentRenderer.setTextureImageData === 'function') {
        currentRenderer.setTextureImageData(imagePath, [imageData])
        const normalized = normalizePath(imagePath)
        if (normalized !== imagePath) {
          currentRenderer.setTextureImageData(normalized, [imageData])
        }
        const forwardSlash = normalized.replace(/\\/g, '/')
        if (forwardSlash !== normalized) {
          currentRenderer.setTextureImageData(forwardSlash, [imageData])
        }
      }
    }

    const readTextureSource = async (modelPathValue: string, imagePath: string): Promise<ImageData | null> => {
      const normalizedImagePath = normalizePath(imagePath)
      if (modelPathValue && !modelPathValue.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPathValue, normalizedImagePath)
        for (const candidate of candidates) {
          const buffer = await readFile(candidate).catch(() => null)
          if (buffer) {
            const imageData = decodeTextureData(buffer.buffer, imagePath)
            if (imageData) return imageData
          }
        }
      }

      try {
        const mpqData = await invokeReadMpqFile<Uint8Array>(normalizedImagePath, 'Viewer.readTextureSource')
        if (mpqData && mpqData.length > 0) {
          return decodeTextureData(mpqData.buffer as ArrayBuffer, imagePath)
        }
      } catch {
      }

      return null
    }

    const ensureSourceImageData = async (modelPathValue: string, imagePath: string): Promise<ImageData | null> => {
      const sourceKey = getLiveTextureSourceKey(modelPathValue, imagePath)
      const cached = sourceCache.get(sourceKey)
      if (cached) return cached.imageData

      const existing = sourceLoadCache.get(sourceKey)
      if (existing) return existing

      const loadPromise = readTextureSource(modelPathValue, imagePath)
        .then((imageData) => {
          if (imageData) {
            sourceCache.set(sourceKey, { imagePath, imageData })
          }
          return imageData
        })
        .finally(() => {
          sourceLoadCache.delete(sourceKey)
        })

      sourceLoadCache.set(sourceKey, loadPromise)
      return loadPromise
    }

    const runWorkerAdjust = (sourceKey: string, imageData: ImageData, adjustments: TextureAdjustments): Promise<ImageData | null> => {
      if (activeSourceKey !== sourceKey) {
        activeSourceKey = sourceKey
        const sourcePixels = new Uint8ClampedArray(imageData.data)
        adjustWorker.postMessage({
          type: 'set-source',
          key: sourceKey,
          width: imageData.width,
          height: imageData.height,
          buffer: sourcePixels.buffer,
        }, [sourcePixels.buffer])
      }

      return new Promise((resolve) => {
        pendingResolve = resolve
        const requestId = ++pendingRequestId
        adjustWorker.postMessage({
          type: 'apply',
          key: sourceKey,
          requestId,
          adjustments,
        })
      })
    }

    const processQueuedAdjust = async () => {
      if (processing) return
      processing = true

      while (queuedAdjust) {
        const current = queuedAdjust
        queuedAdjust = null

        const normalizedAdjustments = normalizeTextureAdjustments(current.adjustments)
        const sourceKey = getLiveTextureSourceKey(current.modelPath, current.imagePath)
        const sourceImageData = await ensureSourceImageData(current.modelPath, current.imagePath)
        if (!sourceImageData) {
          continue
        }

        if (isDefaultTextureAdjustments(normalizedAdjustments)) {
          applyImageDataToRenderer(current.imagePath, sourceImageData)
          continue
        }

        let adjusted = await runWorkerAdjust(sourceKey, sourceImageData, normalizedAdjustments)
        if (!adjusted) {
          adjusted = applyTextureAdjustments(sourceImageData, normalizedAdjustments)
        }

        if (queuedAdjust && areAdjustmentsEqual(normalizedAdjustments, normalizeTextureAdjustments(queuedAdjust.adjustments))) {
          continue
        }

        applyImageDataToRenderer(current.imagePath, adjusted)
      }

      processing = false
    }

    adjustWorker.onmessage = (event: MessageEvent<any>) => {
      const payload = event.data
      if (!payload || payload.type !== 'result' || !pendingResolve) {
        return
      }

      const resolve = pendingResolve
      pendingResolve = null
      resolve(new ImageData(new Uint8ClampedArray(payload.buffer), payload.width, payload.height))
    }

    adjustWorker.onerror = () => {
      if (pendingResolve) {
        const resolve = pendingResolve
        pendingResolve = null
        resolve(null)
      }
    }

    const unlistenPrepare = listen('IPC_LIVE_TEXTURE_PREPARE', (event) => {
      const payload: any = event.payload
      if (!payload?.modelPath || !payload?.imagePath) {
        return
      }
      void ensureSourceImageData(String(payload.modelPath), payload.imagePath)
    })

    const unlistenAdjust = listen('IPC_LIVE_TEXTURE_ADJUST', (event) => {
      const payload: any = event.payload
      if (!payload?.imagePath) {
        return
      }
      queuedAdjust = {
        modelPath: String(payload?.modelPath || ''),
        imagePath: payload.imagePath,
        adjustments: normalizeTextureAdjustments(payload?.adjustments || DEFAULT_TEXTURE_ADJUSTMENTS),
      }
      void processQueuedAdjust()
    })

    return () => {
      adjustWorker.terminate()
      unlistenPrepare.then(f => f())
      unlistenAdjust.then(f => f())
    }
  }, [])

  const readVec3 = (v: any): [number, number, number] | null => {
    if (!v) return null
    const a0 = Number((v as any)[0])
    const a1 = Number((v as any)[1])
    const a2 = Number((v as any)[2])
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(a2)) return null
    return [a0, a1, a2]
  }

  const getModelMinMax = (info: any): { min: [number, number, number], max: [number, number, number] } | null => {
    // war3-model historically exposed Info.Extent = { Min, Max }
    const extentMin = readVec3(info?.Extent?.Min)
    const extentMax = readVec3(info?.Extent?.Max)
    if (extentMin && extentMax) return { min: extentMin, max: extentMax }

    // Many paths use Info.MinimumExtent / Info.MaximumExtent
    const min = readVec3(info?.MinimumExtent)
    const max = readVec3(info?.MaximumExtent)
    if (min && max) return { min, max }

    // Fallback: BoundsRadius around origin.
    const r = Number(info?.BoundsRadius)
    if (Number.isFinite(r) && r > 0) {
      return { min: [-r, -r, -r], max: [r, r, r] }
    }
    return null
  }

  useEffect(() => {
    rendererRef.current = renderer

    // Fit to View when renderer changes (new model loaded)
    const keepCamera = useRendererStore.getState().keepCameraOnLoad;
    if (renderer && renderer.model && renderer.model.Info && !keepCamera) {
      // call internal impl; don't depend on external ref being present
      // (toolbar/shortcuts should work even if parent doesn't pass a ref)
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      fitToViewImpl()
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
  const previousCameraState = useRef<{
    distance: number,
    theta: number,
    phi: number,
    target: Float32Array,
    projectionMode: 'perspective' | 'orthographic',
    fov: number,
    orthoSize: number,
    nearClipPlane: number,
    farClipPlane: number
  } | null>(null)
  const lastAppliedViewPresetRef = useRef<string | null>(null)
  const [selectedCameraIndex, setSelectedCameraIndex] = useState(-1)
  const [activeModelCameraView, setActiveModelCameraView] = useState<{
    index: number,
    name: string,
    fov: number,
    nearClip: number,
    farClip: number,
    aspectRatio: number
  } | null>(null)

  // Helper to sync targetCamera state to SimpleOrbitCamera
  const syncCameraToOrbit = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.distance = targetCamera.current.distance
      cameraRef.current.horizontalAngle = targetCamera.current.theta + Math.PI / 2
      cameraRef.current.verticalAngle = targetCamera.current.phi
      vec3.copy(cameraRef.current.target, targetCamera.current.target)
      cameraRef.current.update()
    }
  }, [])

  const applySelectedCameraView = useCallback((cameraIndex = selectedCameraIndex) => {
    const camera = getSelectedCamera(cameraIndex)
    if (!camera) return false

    if (!inCameraView.current || !previousCameraState.current) {
      previousCameraState.current = {
        distance: targetCamera.current.distance,
        theta: targetCamera.current.theta,
        phi: targetCamera.current.phi,
        target: vec3.clone(targetCamera.current.target) as Float32Array,
        projectionMode: cameraRef.current?.projectionMode ?? 'perspective',
        fov: cameraRef.current?.fov ?? Math.PI / 4,
        orthoSize: cameraRef.current?.orthoSize ?? 500,
        nearClipPlane: cameraRef.current?.nearClipPlane ?? 1,
        farClipPlane: cameraRef.current?.farClipPlane ?? 100000
      }
    }

    const cam = camera as any
    const pos = getCameraVector(cam.Translation, cam.Position)
    const target = getCameraVector(cam.TargetTranslation, cam.TargetPosition)

    const dx = pos[0] - target[0]
    const dy = pos[1] - target[1]
    const dz = pos[2] - target[2]
    let distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance < 0.1) distance = 100

    let phi = Math.acos(dz / distance)
    if (Number.isNaN(phi)) phi = Math.PI / 4
    phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi))

    let theta = Math.atan2(dy, dx)
    if (Number.isNaN(theta)) theta = 0

    const fov = typeof cam.FieldOfView === 'number' && cam.FieldOfView > 0 ? cam.FieldOfView : Math.PI / 4
    const nearClip = typeof cam.NearClip === 'number' && cam.NearClip > 0 ? cam.NearClip : 16
    const farClip = typeof cam.FarClip === 'number' && cam.FarClip > nearClip ? cam.FarClip : 1000

    targetCamera.current.distance = distance
    targetCamera.current.theta = theta
    targetCamera.current.phi = phi
    vec3.set(targetCamera.current.target, target[0], target[1], target[2])

    if (cameraRef.current) {
      cameraRef.current.projectionMode = 'perspective'
      cameraRef.current.fov = fov
      cameraRef.current.nearClipPlane = nearClip
      cameraRef.current.farClipPlane = farClip
    }

    syncCameraToOrbit()
    inCameraView.current = true
    setActiveModelCameraView({
      index: cameraIndex,
      name: cam.Name || `Camera ${cameraIndex + 1}`,
      fov,
      nearClip,
      farClip,
      aspectRatio: 4 / 3
    })
    return true
  }, [selectedCameraIndex, syncCameraToOrbit])

  const applyViewPreset = useCallback((preset: string, options?: { syncExternal?: boolean }) => {
    let shouldSyncOrbit = false

    if (preset !== 'camera') {
      if (inCameraView.current && previousCameraState.current && cameraRef.current) {
        cameraRef.current.projectionMode = previousCameraState.current.projectionMode
        cameraRef.current.fov = previousCameraState.current.fov
        cameraRef.current.orthoSize = previousCameraState.current.orthoSize
        cameraRef.current.nearClipPlane = previousCameraState.current.nearClipPlane
        cameraRef.current.farClipPlane = previousCameraState.current.farClipPlane
      }
      clearActiveModelCameraView()
      previousCameraState.current = null
    }

    switch (preset) {
      case 'perspective':
        if (cameraRef.current) {
          cameraRef.current.setPerspective()
        }
        break
      case 'orthographic':
        if (cameraRef.current) {
          cameraRef.current.setOrthographic()
        }
        break
      case 'front':
        targetCamera.current.theta = 0
        targetCamera.current.phi = Math.PI / 2
        shouldSyncOrbit = true
        break
      case 'back':
        targetCamera.current.theta = Math.PI
        targetCamera.current.phi = Math.PI / 2
        shouldSyncOrbit = true
        break
      case 'left':
        targetCamera.current.theta = Math.PI / 2
        targetCamera.current.phi = Math.PI / 2
        shouldSyncOrbit = true
        break
      case 'right':
        targetCamera.current.theta = -Math.PI / 2
        targetCamera.current.phi = Math.PI / 2
        shouldSyncOrbit = true
        break
      case 'top':
        targetCamera.current.theta = 0
        targetCamera.current.phi = 0.01
        shouldSyncOrbit = true
        break
      case 'bottom':
        targetCamera.current.theta = 0
        targetCamera.current.phi = Math.PI - 0.01
        shouldSyncOrbit = true
        break
      case 'focus':
        vec3.set(targetCamera.current.target, 0, 0, 0)
        targetCamera.current.distance = 500
        targetCamera.current.theta = Math.PI / 4
        targetCamera.current.phi = Math.PI / 4
        shouldSyncOrbit = true
        break
      case 'camera':
        if (!applySelectedCameraView()) {
          return
        }
        break
      default:
        return
    }

    if (shouldSyncOrbit) {
      syncCameraToOrbit()
    }

    if (options?.syncExternal !== false) {
      onSetViewPreset?.(preset)
    }
  }, [applySelectedCameraView, onSetViewPreset, syncCameraToOrbit])

  const fitToViewImpl = React.useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer || !renderer.model || !renderer.model.Info) return

    const info = renderer.model.Info as any
    const bounds = getModelMinMax(info)
    if (!bounds) return

    const min = vec3.fromValues(bounds.min[0], bounds.min[1], bounds.min[2])
    const max = vec3.fromValues(bounds.max[0], bounds.max[1], bounds.max[2])

    const center = vec3.create()
    vec3.add(center, min, max)
    vec3.set(center, center[0] * 0.5, center[1] * 0.5, center[2] * 0.5)

    const diagonal = vec3.dist(min, max)
    const distance = Math.max(diagonal * 1.2, 300)

    // If user was viewing a model camera, "fit" should return to orbit mode.
    clearActiveModelCameraView()
    previousCameraState.current = null
    if (cameraRef.current) {
      cameraRef.current.fov = Math.PI / 4
      cameraRef.current.nearClipPlane = 1
      cameraRef.current.farClipPlane = 100000
    }

    targetCamera.current.target = center
    targetCamera.current.distance = distance
    targetCamera.current.theta = Math.PI / 4
    targetCamera.current.phi = Math.PI / 3
    syncCameraToOrbit()
  }, [])

  const handleFitToView = () => {
    fitToViewImpl()
  }

  const handleCameraViewToggle = () => {
    if (inCameraView.current) {
      if (previousCameraState.current) {
        targetCamera.current.distance = previousCameraState.current.distance
        targetCamera.current.theta = previousCameraState.current.theta
        targetCamera.current.phi = previousCameraState.current.phi
        vec3.set(
          targetCamera.current.target,
          previousCameraState.current.target[0],
          previousCameraState.current.target[1],
          previousCameraState.current.target[2]
        )

        if (cameraRef.current) {
          cameraRef.current.projectionMode = previousCameraState.current.projectionMode
          cameraRef.current.fov = previousCameraState.current.fov
          cameraRef.current.orthoSize = previousCameraState.current.orthoSize
          cameraRef.current.nearClipPlane = previousCameraState.current.nearClipPlane
          cameraRef.current.farClipPlane = previousCameraState.current.farClipPlane
        }

        previousCameraState.current = null
      } else {
        vec3.set(targetCamera.current.target, 0, 0, 0)
      }
      syncCameraToOrbit()
      clearActiveModelCameraView()
      return
    }

    applySelectedCameraView()
  }

  const resetCamera = (force = false) => {
    if (!force && useRendererStore.getState().keepCameraOnLoad) return
    clearActiveModelCameraView()
    previousCameraState.current = null
    vec3.set(targetCamera.current.target, 0, 0, 0)
    targetCamera.current.distance = 500
    targetCamera.current.theta = Math.PI / 4
    targetCamera.current.phi = Math.PI / 4
    if (cameraRef.current) {
      cameraRef.current.fov = Math.PI / 4
      cameraRef.current.nearClipPlane = 1
      cameraRef.current.farClipPlane = 100000
    }
    syncCameraToOrbit()
  }

  const getScreenStableWorldScale = (targetPixels: number, center?: vec3) => {
    const cam = cameraRef.current
    const canvas = canvasRef.current
    if (!cam || !canvas) return 1.0

    const viewportHeight = Math.max(1, canvas.height || canvas.clientHeight || 1)
    let worldUnitsPerPixel = 1.0

    if (cam.projectionMode === 'orthographic') {
      worldUnitsPerPixel = (cam.orthoSize * 2) / viewportHeight
    } else {
      const forward = vec3.create()
      vec3.subtract(forward, cam.target, cam.position)
      if (vec3.squaredLength(forward) > 1e-8) {
        vec3.normalize(forward, forward)
      } else {
        vec3.set(forward, 0, 0, -1)
      }

      const centerToUse = center ?? cam.target
      const toCenter = vec3.create()
      vec3.subtract(toCenter, centerToUse, cam.position)
      const depth = Math.max(0.1, vec3.dot(toCenter, forward))
      const viewHeight = 2 * Math.tan(cam.fov * 0.5) * depth
      worldUnitsPerPixel = viewHeight / viewportHeight
    }

    return targetPixels * worldUnitsPerPixel
  }

  const getGizmoScale = (center?: vec3) => {
    let scale = getScreenStableWorldScale(700, center) / GIZMO_AXIS_LENGTH

    // User multiplier from settings (0.1..1.0).
    const gizmoSize = useRendererStore.getState().gizmoSize || 1
    scale *= gizmoSize

    // Final clamp after user multiplier to avoid disappearing or exploding at extreme zooms.
    return Math.max(0.01, Math.min(200, scale))
  }

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    fitToView: fitToViewImpl,
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
  }), [fitToViewImpl])

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

  // Hold Q in animation mode to temporarily ignore gizmo hit-testing so nearby nodes can be picked.
  const qPressedRef = useRef(false)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented) return

      // Only suppress viewer-local shortcuts when a real text input is focused.
      if (isTextInputActive()) return

      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        const direction = ev.key === 'ArrowUp' ? -1 : 1
        const { sequences, currentSequence, setSequence } = useModelStore.getState()
        if (!Array.isArray(sequences) || sequences.length === 0) return

        let nextIndex = 0
        if (currentSequence >= 0 && currentSequence < sequences.length) {
          nextIndex = (currentSequence + direction + sequences.length) % sequences.length
        } else if (direction < 0) {
          nextIndex = sequences.length - 1
        }

        setSequence(nextIndex)
        window.dispatchEvent(new Event('timeline-fit-current-sequence'))
        ev.preventDefault()
        return
      }

      if (ev.code === 'Backquote') {
        const nextPreset = cameraRef.current?.projectionMode === 'orthographic'
          ? 'perspective'
          : 'orthographic'
        applyViewPreset(nextPreset)
        ev.preventDefault()
        ev.stopPropagation()
        return
      }

      if (ev.key === 'q' || ev.key === 'Q') {
        qPressedRef.current = true
      }
    }
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'q' || ev.key === 'Q') {
        qPressedRef.current = false
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [applyViewPreset])

  const initialVertexPositions = useRef<Map<string, [number, number, number]>>(new Map())
  const initialNodePositions = useRef<Map<number, [number, number, number]>>(new Map())

  // Gizmo state
  const gizmoState = useRef<{
    activeAxis: GizmoAxis,
    isDragging: boolean,
    dragStartPos: vec3 | null,
    dragCenter: vec3 | null,
    isShiftDuplicate: boolean // Track if shift was held to trigger duplicate
  }>({
    activeAxis: null,
    isDragging: false,
    dragStartPos: null,
    dragCenter: null,
    isShiftDuplicate: false
  })

  // Keyframe drag state (for Rotation/Scale injection)
  const keyframeDragData = useRef<{
    initialKeys: Map<number, any>, // NodeId -> { Rotation: [], Scaling: [] }
    initialValues: Map<number, { rotation: Float32Array, scaling: Float32Array }> // NodeId -> { rotation, scaling } (snapshot at drag start)
  } | null>(null)
  const keyframeTransformDirty = useRef(false)
  const previewTransformRef = useRef({
    translation: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number]
  })
  const gizmoHudRef = useRef({
    translation: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number], // degrees
    scale: [1, 1, 1] as [number, number, number]
  })
  const snapDragRef = useRef({
    translationDelta: [0, 0, 0] as [number, number, number],
    translationApplied: [0, 0, 0] as [number, number, number],
    rotationDelta: [0, 0, 0] as [number, number, number], // degrees
    rotationApplied: [0, 0, 0] as [number, number, number] // degrees
  })

  // Pre-allocated vectors for handleMouseMove to avoid GC pressure
  const mouseMoveVecs = useRef({
    forward: vec3.create(),
    up: vec3.fromValues(0, 0, 1),
    right: vec3.create(),
    camUp: vec3.create(),
    worldMoveDelta: vec3.create(),
    moveVec: vec3.create()
  })

  // Box selection overlay state
  const [selectionBox, setSelectionBox] = useState<{ x: number, y: number, width: number, height: number } | null>(null)
  const [gizmoHud, setGizmoHud] = useState<{ x: number, y: number, text: string } | null>(null)

  // Context menu state for vertex operations
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number, y: number, nodeId: number | null } | null>(null)
  const [showViewMenu, setShowViewMenu] = useState(false)
  const poseClipboardRef = useRef<{ frame: number, nodes: { nodeId: number, translation: number[], rotation: number[], scaling: number[] }[] } | null>(null)
  const formatHudNumber = (value: number, digits: number) => {
    const fixed = value.toFixed(digits)
    return fixed.replace(/.?0+$/, '')
  }
  const formatHudVec3 = (vec: [number, number, number], digits: number) => {
    return `${formatHudNumber(vec[0], digits)}, ${formatHudNumber(vec[1], digits)}, ${formatHudNumber(vec[2], digits)}`
  }
  const getCameraBasis = () => {
    const { theta, phi } = targetCamera.current
    const forward = vec3.fromValues(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
    const up = vec3.fromValues(0, 0, 1)
    const right = vec3.create()
    vec3.cross(right, forward, up)
    vec3.normalize(right, right)
    const camUp = vec3.create()
    vec3.cross(camUp, right, forward)
    vec3.normalize(camUp, camUp)
    return { right, up: camUp, forward }
  }
  const getGizmoBasis = (orientation: 'world' | 'camera') => {
    if (orientation === 'camera') {
      const cam = getCameraBasis()
      return { x: cam.right, y: cam.up, z: cam.forward }
    }
    return {
      x: vec3.fromValues(1, 0, 0),
      y: vec3.fromValues(0, 1, 0),
      z: vec3.fromValues(0, 0, 1)
    }
  }
  const quatToEulerDeg = (q: quat): [number, number, number] => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    const sinr_cosp = 2 * (w * x + y * z)
    const cosr_cosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinr_cosp, cosr_cosp)

    const sinp = 2 * (w * y - z * x)
    let pitch: number
    if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * Math.PI / 2
    else pitch = Math.asin(sinp)

    const siny_cosp = 2 * (w * z + x * y)
    const cosy_cosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(siny_cosp, cosy_cosp)

    return [roll * 180 / Math.PI, pitch * 180 / Math.PI, yaw * 180 / Math.PI]
  }
  const buildHudText = (mode: 'translate' | 'rotate' | 'scale') => {
    const hud = gizmoHudRef.current
    if (mode === 'translate') {
      return `移动 Δ: (${formatHudVec3(hud.translation, 3)})`
    }
    if (mode === 'rotate') {
      return `旋转 Δ: (${formatHudVec3(hud.rotation, 1)})°`
    }
    return `缩放 Δ: (${formatHudVec3(hud.scale, 3)})`
  }
  const updateHudPosition = (e: { clientX: number, clientY: number }, mode: 'translate' | 'rotate' | 'scale') => {
    setGizmoHud({
      x: e.clientX + 12,
      y: e.clientY + 12,
      text: buildHudText(mode)
    })
  }
  const resetGizmoHud = () => {
    gizmoHudRef.current = {
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    }
  }
  const getActiveCameraMatte = () => {
    const canvas = canvasRef.current
    if (!canvas || !activeModelCameraView || cameraRef.current?.projectionMode !== 'perspective') {
      return null
    }

    const width = canvas.clientWidth || canvas.width
    const height = canvas.clientHeight || canvas.height
    if (width <= 0 || height <= 0) return null

    const targetAspect = activeModelCameraView.aspectRatio > 0 ? activeModelCameraView.aspectRatio : 4 / 3
    // Warcraft portrait windows crop a noticeable margin compared with the raw camera render.
    const safeFrameScale = 0.72
    let frameWidth = width
    let frameHeight = frameWidth / targetAspect

    if (frameHeight > height) {
      frameHeight = height
      frameWidth = frameHeight * targetAspect
    }

    frameWidth *= safeFrameScale
    frameHeight *= safeFrameScale

    const left = Math.max(0, (width - frameWidth) * 0.5)
    const top = Math.max(0, (height - frameHeight) * 0.5)
    const fovDeg = `${(activeModelCameraView.fov * 180 / Math.PI).toFixed(1).replace(/\.0$/, '')}°`

    return {
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      rightInset: Math.max(0, width - left - frameWidth),
      bottomInset: Math.max(0, height - top - frameHeight),
      label: `${activeModelCameraView.name}`
    }
  }

  /** 必须传入当前要写入的渲染器实例；勿依赖 React state（loadModel 过程中 state 可能仍为 null 或旧引用） */
  const loadTeamColorTextures = async (targetRenderer: any, colorIndex: number) => {
    if (!targetRenderer) return

    const idStr = colorIndex.toString().padStart(2, '0')
    const teamColorPath = `ReplaceableTexturesTeamColorTeamColor${idStr}.blp`
    const teamGlowPath = `ReplaceableTexturesTeamGlowTeamGlow${idStr}.blp`

    const loadTexture = async (path: string, id: number) => {
      try {
        const mpqPayload = await invokeReadMpqFile<any>(path, 'Viewer.loadTeamColorTextures').catch(() => null)
        const mpqData = toUint8Array(mpqPayload)

        if (mpqData && mpqData.length > 0) {
          const blp = decodeBLP(toTightArrayBuffer(mpqData) as any)
          const blpMip = getBLPImageData(blp, 0)

          // CRITICAL: Use premultiplyAlpha:'none' — Canvas or default createImageBitmap destroys RGB on transparent pixels
          const idata = new ImageData(new Uint8ClampedArray(blpMip.data), blpMip.width, blpMip.height)
          const img = await createImageBitmap(idata, { premultiplyAlpha: 'none' })
          if (targetRenderer.setReplaceableTexture) {
            targetRenderer.setReplaceableTexture(id, img)
          }
        } else {
          console.warn(`[Viewer] Failed to load replaceable texture: ${path}`)
        }
      } catch (e) {
        console.error(`[Viewer] Error loading replaceable texture ${path}:`, e)
      }
    }

    // 两张替换贴图互不依赖，并行可缩短单模型加载总耗时
    await Promise.all([loadTexture(teamColorPath, 1), loadTexture(teamGlowPath, 2)])
  }

  // Render compatibility fix based on mdx-m3-viewer:
  // Layer FilterMode.Additive should use SRC_ALPHA, ONE behavior.
  // war3-model currently treats Additive as ONE, ONE, so remap Additive -> AddAlpha
  // in renderer-side material copies to avoid over-bright/white and dark fringe artifacts.
  const cloneMaterialsWithReferenceBlendCompat = (materials: any[] | undefined) => {
    if (!Array.isArray(materials)) return materials

    let hasChanges = false
    const nextMaterials = materials.map((material: any) => {
      if (!material || !Array.isArray(material.Layers)) return material

      let materialChanged = false
      const nextLayers = material.Layers.map((layer: any) => {
        if (!layer || typeof layer !== 'object') return layer

        const filterMode = typeof layer.FilterMode === 'number' ? layer.FilterMode : Number(layer.FilterMode)
        if (filterMode === 3) {
          materialChanged = true
          hasChanges = true
          return { ...layer, FilterMode: 4 }
        }
        return layer
      })

      if (!materialChanged) return material
      return { ...material, Layers: nextLayers }
    })

    return hasChanges ? nextMaterials : materials
  }

  const sanitizeMaterialsForRenderer = (materials: any[] | undefined, texturesLength: number) => {
    if (!Array.isArray(materials)) return materials

    const maxTextureId = Math.max(0, texturesLength - 1)
    let hasChanges = false

    const nextMaterials = materials.map((material: any) => {
      if (!material || !Array.isArray(material.Layers)) return material

      let materialChanged = false
      const nextLayers = material.Layers.map((layer: any) => {
        if (!layer || typeof layer !== 'object') return layer

        if (layer.TextureID && typeof layer.TextureID === 'object' && Array.isArray(layer.TextureID.Keys)) {
          return layer
        }

        const rawTextureId = typeof layer.TextureID === 'number' ? layer.TextureID : Number(layer.TextureID)
        const safeTextureId = Number.isFinite(rawTextureId)
          ? Math.min(Math.max(0, Math.floor(rawTextureId)), maxTextureId)
          : 0

        if (safeTextureId !== layer.TextureID) {
          materialChanged = true
          hasChanges = true
          return { ...layer, TextureID: safeTextureId }
        }

        return layer
      })

      if (!materialChanged) return material
      return { ...material, Layers: nextLayers }
    })

    return hasChanges ? nextMaterials : materials
  }

  const createRendererBlendCompatibleModel = (model: any) => {
    if (!model || !Array.isArray(model.Materials)) return model

    const sanitizedMaterials = sanitizeMaterialsForRenderer(model.Materials, model.Textures?.length || 0)
    const compatibleMaterials = cloneMaterialsWithReferenceBlendCompat(sanitizedMaterials)

    if (compatibleMaterials === model.Materials) return model
    return { ...model, Materials: compatibleMaterials }
  }

  const ensureWebGpuTextureSamplers = (mdlRenderer: any, textures: any[]) => {
    if (!mdlRenderer || !Array.isArray(textures)) return
    const device = mdlRenderer.device as GPUDevice | undefined
    const rendererData = mdlRenderer.rendererData as any
    if (!device || !rendererData) return

    if (!Array.isArray(rendererData.gpuSamplers)) {
      rendererData.gpuSamplers = []
    }

    for (let i = 0; i < textures.length; i++) {
      if (rendererData.gpuSamplers[i]) continue
      const texture = textures[i] || {}
      const flags = typeof texture.Flags === 'number' ? texture.Flags : 0
      const addressModeU: GPUAddressMode = (flags & 1) ? 'repeat' : 'clamp-to-edge'
      const addressModeV: GPUAddressMode = (flags & 2) ? 'repeat' : 'clamp-to-edge'

      rendererData.gpuSamplers[i] = device.createSampler({
        label: `texture sampler ${i}`,
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU,
        addressModeV
      })
    }
  }

  useEffect(() => {
    attemptedMissingTexturePathsRef.current.clear()
  }, [renderer, modelPath])

  const isResolvableTexturePath = (path: string): boolean => {
    const lower = path.toLowerCase()
    return lower.endsWith('.blp') || lower.endsWith('.tga')
  }

  useEffect(() => {
    if (!mpqLoaded || backgroundTextureResolveRunningRef.current) return
    if (!renderer) return

    const sourceModel = renderer.model || modelData
    if (!sourceModel) return

    const activePath = modelPath || (modelData as any)?.path || ''
    const pending = (missingTextures || []).filter((path) => isResolvableTexturePath(path))
    if (pending.length === 0) return

    const rendererData = (renderer as any)?.rendererData
    const loadedPaths = new Set<string>([
      ...Object.keys(rendererData?.textures || {}),
      ...Object.keys(rendererData?.gpuTextures || {})
    ])

    const unresolved = pending.filter((path) =>
      !loadedPaths.has(path) && !attemptedMissingTexturePathsRef.current.has(path)
    )

    if (unresolved.length === 0) return

    unresolved.forEach((path) => attemptedMissingTexturePathsRef.current.add(path))
    backgroundTextureResolveRunningRef.current = true

    const run = async () => {
      const resolveStart = performance.now()
      try {
        console.log(`[Viewer] Resolving ${unresolved.length} missing textures after MPQ ready`)
        const textureResults = await loadAllTextures(
          sourceModel,
          renderer,
          activePath,
          textureWorkers,
          undefined,
          {
            yieldUploads: true,
            targetPaths: unresolved,
            workerDecodeMinTextures: 10,
            workerDecodeMinBytes: 8 * 1024 * 1024
          }
        )
        const resolved = new Set(
          textureResults.filter((result) => result.loaded).map((result) => result.path)
        )
        if (resolved.size > 0) {
          resolved.forEach((path) => attemptedMissingTexturePathsRef.current.delete(path))
          const currentMissing = useRendererStore.getState().missingTextures
          const nextMissing = currentMissing.filter((path) => !resolved.has(path))
          useRendererStore.getState().setMissingTextures(nextMissing)
          await loadTeamColorTextures(renderer, teamColor)
        }
        console.log(
          `[Viewer] Missing texture resolve finished in ${(performance.now() - resolveStart).toFixed(1)}ms, resolved=${resolved.size}/${unresolved.length}`
        )
      } catch (e) {
        console.warn('[Viewer] Resolve missing textures after MPQ load failed:', e)
      } finally {
        backgroundTextureResolveRunningRef.current = false
      }
    }

    run()
  }, [mpqLoaded, renderer, modelData, modelPath, teamColor, missingTextures, textureWorkers])

  const ensureRendererSequences = (model: any) => {
    if (model?.Sequences && model.Sequences.length > 0) {
      return { model, usedFallback: false }
    }
    const fallbackSequence = {
      Name: 'Stand',
      Interval: new Uint32Array([0, 1000]),
      NonLooping: 1,
      Rarity: 0,
      MoveSpeed: 0,
      BoundsRadius: 0
    }
    return {
      model: { ...model, Sequences: [fallbackSequence] },
      usedFallback: true
    }
  }

  const ensureRenderNodes = (model: any) => {
    if (model?.Nodes && Array.isArray(model.Nodes)) {
      // Safety filter: remove any undefined or null entries that might have leaked in
      model.Nodes = model.Nodes.filter((n: any) => !!n);
    }

    if (model?.Nodes && model.Nodes.length > 0) {
      // PIVT 必须按 ObjectId 索引，不能用 Nodes 数组下标（ObjectId 未必连续或与 i 相同）
      if (!model.PivotPoints) {
        const pivotPoints: Float32Array[] = []
        let maxOid = -1
        for (const n of model.Nodes) {
          if (!n || typeof n.ObjectId !== 'number') continue
          const oid = n.ObjectId
          maxOid = Math.max(maxOid, oid)
          const p = n?.PivotPoint ?? [0, 0, 0]
          pivotPoints[oid] = p instanceof Float32Array ? p : new Float32Array(p)
        }
        for (let i = 0; i <= maxOid; i++) {
          if (!pivotPoints[i]) {
            pivotPoints[i] = new Float32Array([0, 0, 0])
          }
        }
        model.PivotPoints = pivotPoints
      }
      return { model, usedFallback: false, defaultNodeId: model.Nodes[0].ObjectId ?? 0 }
    }
    const fallbackNode = {
      Name: 'Root',
      ObjectId: 0,
      Parent: -1,
      PivotPoint: new Float32Array([0, 0, 0]),
      Flags: 0
    }
    return {
      model: { ...model, Nodes: [fallbackNode] },
      usedFallback: true,
      defaultNodeId: 0
    }
  }

  const ensureGeosetGroups = (model: any, defaultNodeId: number) => {
    if (!model?.Geosets) return
    for (const geoset of model.Geosets) {
      const vertexCount = Math.floor((geoset?.Vertices?.length || 0) / 3)
      if (!geoset.Groups || geoset.Groups.length === 0) {
        geoset.Groups = [[defaultNodeId]]
      }
      if (!geoset.VertexGroup || geoset.VertexGroup.length !== vertexCount) {
        geoset.VertexGroup = new Uint16Array(vertexCount)
      }
      if (geoset.TotalGroupsCount === undefined || geoset.TotalGroupsCount === null) {
        geoset.TotalGroupsCount = geoset.Groups.length
      }

      // Validate all VertexGroup indices point to valid Groups entries
      const maxGroupIndex = geoset.Groups.length - 1
      for (let i = 0; i < geoset.VertexGroup.length; i++) {
        if (geoset.VertexGroup[i] > maxGroupIndex) {
          geoset.VertexGroup[i] = 0 // Reset to first group
        }
      }

      // Ensure all Groups have at least one valid entry
      for (let i = 0; i < geoset.Groups.length; i++) {
        if (!geoset.Groups[i] || !Array.isArray(geoset.Groups[i]) || geoset.Groups[i].length === 0) {
          geoset.Groups[i] = [defaultNodeId]
        }
      }
    }
  }

  const hasGeometryBufferData = (value: any): boolean => {
    return !!value && typeof value.length === 'number' && value.length > 0
  }

  const cloneGeometryBuffer = (value: any) => {
    if (!value) return value
    if (ArrayBuffer.isView(value)) {
      const TypedArrayCtor = (value as any).constructor
      return typeof TypedArrayCtor === 'function' ? new TypedArrayCtor(value as any) : value
    }
    if (Array.isArray(value)) {
      return value.map((entry) => (Array.isArray(entry) ? [...entry] : entry))
    }
    return value
  }

  const sanitizeModelGeosetsForReload = (model: any, fallbackGeosets?: any[] | null) => {
    if (!model || !Array.isArray(model.Geosets)) {
      return model
    }

    const fallbackMatches =
      Array.isArray(fallbackGeosets) &&
      fallbackGeosets.length === model.Geosets.length

    let restoredCount = 0
    let skippedCount = 0
    const sanitizedGeosets = model.Geosets.flatMap((geoset: any, index: number) => {
      if (!geoset) {
        skippedCount += 1
        console.error(`[Viewer] Skipping null geoset during full reload at index ${index}`)
        return []
      }

      const hasVertices = hasGeometryBufferData(geoset.Vertices)
      const hasFaces = hasGeometryBufferData(geoset.Faces)
      if (hasVertices && hasFaces) {
        return [geoset]
      }

      const fallbackGeoset = fallbackMatches ? fallbackGeosets?.[index] : null
      const canRestoreFromFallback =
        !!fallbackGeoset &&
        hasGeometryBufferData(fallbackGeoset.Vertices) &&
        hasGeometryBufferData(fallbackGeoset.Faces)

      if (canRestoreFromFallback) {
        restoredCount += 1
        console.warn(`[Viewer] Restoring missing geometry for geoset ${index} from previous renderer snapshot`)
        return [{
          ...geoset,
          Vertices: cloneGeometryBuffer(fallbackGeoset.Vertices),
          Faces: cloneGeometryBuffer(fallbackGeoset.Faces),
          Normals: hasGeometryBufferData(geoset.Normals)
            ? geoset.Normals
            : cloneGeometryBuffer(fallbackGeoset.Normals),
          TVertices: hasGeometryBufferData(geoset.TVertices)
            ? geoset.TVertices
            : cloneGeometryBuffer(fallbackGeoset.TVertices),
          Groups: Array.isArray(geoset.Groups) && geoset.Groups.length > 0
            ? geoset.Groups
            : cloneGeometryBuffer(fallbackGeoset.Groups),
          SkinWeights: hasGeometryBufferData(geoset.SkinWeights)
            ? geoset.SkinWeights
            : cloneGeometryBuffer(fallbackGeoset.SkinWeights),
          Tangents: hasGeometryBufferData(geoset.Tangents)
            ? geoset.Tangents
            : cloneGeometryBuffer(fallbackGeoset.Tangents),
          VertexGroup: hasGeometryBufferData(geoset.VertexGroup)
            ? geoset.VertexGroup
            : cloneGeometryBuffer(fallbackGeoset.VertexGroup),
          MatrixGroups: hasGeometryBufferData(geoset.MatrixGroups)
            ? geoset.MatrixGroups
            : cloneGeometryBuffer(fallbackGeoset.MatrixGroups),
          MatrixIndices: hasGeometryBufferData(geoset.MatrixIndices)
            ? geoset.MatrixIndices
            : cloneGeometryBuffer(fallbackGeoset.MatrixIndices),
          TotalGroupsCount: geoset.TotalGroupsCount ?? fallbackGeoset.TotalGroupsCount
        }]
      }

      skippedCount += 1
      console.error(
        `[Viewer] Skipping geoset ${index} during full reload because Vertices/Faces are missing and no fallback geometry is available`
      )
      return []
    })

    if (skippedCount === 0 && restoredCount === 0) {
      return model
    }

    if (sanitizedGeosets.length === 0 && model.Geosets.length > 0) {
      throw new Error('[Viewer] Full reload aborted: all geosets are missing renderable geometry')
    }

    console.warn(`[Viewer] Geoset sanitation complete. restored=${restoredCount}, skipped=${skippedCount}`)
    return {
      ...model,
      Geosets: sanitizedGeosets
    }
  }

  // Handle view presets from prop
  useEffect(() => {
    if (!viewPreset) return
    const presetKey = `${viewPreset.type}:${viewPreset.time}:${viewPreset.reset ? 1 : 0}`
    if (lastAppliedViewPresetRef.current === presetKey) return
    lastAppliedViewPresetRef.current = presetKey
    console.log('[Viewer] View preset changed:', viewPreset.type)
    if (viewPreset.type === 'perspective' && viewPreset.reset) {
      vec3.set(targetCamera.current.target, 0, 0, 0)
      targetCamera.current.distance = 500
      targetCamera.current.theta = Math.PI / 4
      targetCamera.current.phi = Math.PI / 4
    }
    applyViewPreset(viewPreset.type, { syncExternal: false })
  }, [applyViewPreset, viewPreset]) // 仅依赖 viewPreset

  useEffect(() => {
    if (!inCameraView.current) return
    if (activeModelCameraView?.index === selectedCameraIndex) return
    if (!getSelectedCamera()) {
      clearActiveModelCameraView()
      previousCameraState.current = null
      return
    }
    applySelectedCameraView(selectedCameraIndex)
  }, [activeModelCameraView?.index, applySelectedCameraView, selectedCameraIndex])

  // Handle Animation and Mode Changes
  useEffect(() => {
    // Guard: Only set sequence if renderer is fully initialized
    if (renderer && renderer.rendererData) {
      const hasSequences = !!renderer.model?.Sequences?.length
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
        // Always enforce the sequence when seeking or switching modes to prevent desync
        // (e.g. Geometry mode manipulates frame directly, so we must reset state)
        if (hasSequences && animationIndex >= 0 && (renderer as any).setSequence) {
          ; (renderer as any).setSequence(animationIndex)
        } else {
          renderer.rendererData.frame = 0
        }
      }
    }
  }, [renderer, appMainMode, animationIndex])

  // Sync Store Changes to Renderer (Hot Patching)
  // Use proper Zustand subscription to detect nodes changes
  const storeNodes = useModelStore(state => state.nodes)
  const stableStoreNodes = useMemo(
    () => (Array.isArray(storeNodes) ? storeNodes.filter((n: any) => n && typeof n.ObjectId === 'number') : []),
    [storeNodes]
  )

  useEffect(() => {
    const cameraList = getAvailableCameras()
    if (cameraList.length === 0) {
      if (selectedCameraIndex !== -1) {
        setSelectedCameraIndex(-1)
      }
      return
    }

    if (selectedCameraIndex < 0 || selectedCameraIndex >= cameraList.length) {
      setSelectedCameraIndex(0)
    }
  }, [modelData, selectedCameraIndex, stableStoreNodes])

  useEffect(() => {
    if (rendererRef.current && rendererRef.current.model) {
      // Patch the model data in the renderer with the latest from store
      // This is crucial for "Lightweight Reload" and seeing changes like PivotPoint (Position) updates instantly.

      const safeStoreNodes = Array.isArray(storeNodes)
        ? storeNodes.filter((n: any) => n && typeof n.ObjectId === 'number')
        : [];
      const storeNodeMap = new Map<number, any>(safeStoreNodes.map((n: any) => [n.ObjectId, n]));

      // 1. Update full Nodes list (contains structure and hierarchy info)
      rendererRef.current.model.Nodes = safeStoreNodes;

      // 2. Update specific lists used by renderer (Lights, etc.)
      // Note: war3-model might cache these, so we update them explicitly.
      rendererRef.current.model.Lights = safeStoreNodes.filter((n: any) => n && n.type === 'Light');
      // Update other types if necessary (cameras, emitters, etc.)

      // 3. Force caching/update if possible. 
      // war3-model creates 'rendererData.nodes' which wraps the raw nodes.
      // We might need to update the references in rendererData if they are stale.
      if (rendererRef.current.rendererData && rendererRef.current.rendererData.nodes) {
        // The rendererData.nodes array holds wrappers { node: rawNode, ... }
        // We need to update the 'node' reference in these wrappers or update the properties.
        let invalidWrappers = 0;
        rendererRef.current.rendererData.nodes.forEach((wrapper: any) => {
          const wrapperNodeId = wrapper?.node?.ObjectId;
          if (typeof wrapperNodeId !== 'number') {
            invalidWrappers++;
            return;
          }
          const freshNode = storeNodeMap.get(wrapperNodeId);
          if (freshNode) {
            wrapper.node = freshNode;
            // If PivotPoint changed, the matrix calculation needs to happen again.
            // The renderer loop handles matrix calc, so just updating the data should be enough for the NEXT frame.
          }
        });

        // Importing/switching model can leave stale renderer wrappers briefly.
        // Rebuild wrappers once to avoid null node access crashes.
        if (invalidWrappers > 0) {
          const instance = (rendererRef.current as any).modelInstance;
          if (instance && typeof instance.syncNodes === 'function') {
            console.warn('[Viewer] Detected invalid renderer node wrappers, forcing syncNodes()', { invalidWrappers });
            instance.syncNodes();
          }
        }
      }

      // Nodes (including keyframes) changed; force a renderer.update(0) in the next RAF tick.
      // Without this, keyframe mode can momentarily fall back to bind pose until another interaction
      // (like a gizmo nudge) triggers a refresh.
      needsRendererUpdateRef.current = true
    }
  }, [renderer, storeNodes]) // Now using proper Zustand selector for stable reference

  // 与 Zustand 权威 modelData 对齐 PIVT：首帧加载后若仅热补丁 Nodes 未带 PivotPoints，粒子会误用 [0,0,0] 直到某次轻量同步
  const storePivotPoints = useModelStore((s) => s.modelData?.PivotPoints)
  useEffect(() => {
    if (!rendererRef.current?.model || !storePivotPoints) return
    rendererRef.current.model.PivotPoints = storePivotPoints as any
    needsRendererUpdateRef.current = true
  }, [renderer, storePivotPoints])

  // Handle Structural Changes (Add/Delete/Reorder Node)
  const structureUpdateTrigger = useModelStore(state => state.rendererReloadTrigger)
  useEffect(() => {
    if (rendererRef.current && (rendererRef.current as any).modelInstance && structureUpdateTrigger > 0) {
      console.log('[Viewer] Structural change detected (Trigger: ' + structureUpdateTrigger + '), rebuilding node hierarchy...')

      // Update the model's master node list
      rendererRef.current.model.Nodes = useModelStore.getState().nodes

      // Call syncNodes to rebuild rendererData.nodes and rootNode children
      // This ensures all wrappers match the new ObjectIds
      const instance = (rendererRef.current as any).modelInstance;
      instance.syncNodes()

      // Also sync other potential structural dependencies
      instance.syncMaterials()
      instance.syncGlobalSequences()

      // Rebuild invalidates cached matrices; force a refresh in the render loop.
      needsRendererUpdateRef.current = true
    }
  }, [structureUpdateTrigger, renderer])

  useEffect(() => {
    return () => {
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [])

  const lastLoadedModelPath = useRef<string | null>(null)

  useEffect(() => {
    // Only reload on modelPath change, NOT on modelData change.
    // Auto-reloading on modelData change causes texture corruption and animation freeze.
    if (modelPath) {
      const didModelPathChange = modelPath !== lastLoadedModelPath.current
      if (didModelPathChange) {
        lastLoadedModelPath.current = modelPath
      }


      if (!isTexturePreviewPath(modelPath)) {
        setTexturePreview(null)
      }
      // Check if this is a dropped file (has in-memory data)
      if (modelPath.startsWith('dropped:')) {
        // Load from in-memory data stored in the model store
        const storeModelData = useModelStore.getState().modelData
        if (storeModelData) {
          console.log('[Viewer] Loading from in-memory data for dropped file:', modelPath)
          loadModel(modelPath, storeModelData)
        }
      } else if (didModelPathChange) {
        // Switching tabs: only reload if no cached renderer is available
        // The hot-swap effect will handle restoring the cached renderer.
        if (!cachedRenderer) {
          loadModel(modelPath)
        } else {
          console.log('[Viewer] Switching tab with cached renderer, skipping full disk reload.')
        }
      } else {
        // Normal file open - only reload if no cached renderer
        if (!cachedRenderer) {
          loadModel(modelPath)
        }
      }
    } else {
      // If modelPath is null, it means no models are loaded
      if (lastLoadedModelPath.current !== null) {
        console.log('[Viewer] No model path, clearing renderer');
        lastLoadedModelPath.current = null;
        if (rendererRef.current) {
          try { rendererRef.current.destroy(); } catch (e) { }
          setRenderer(null);
        }
        // Force a clear on the canvas
        if (canvasRef.current) {
          // Clear without creating a context.
          const canvas = canvasRef.current
          const w = canvas.width
          const h = canvas.height
          canvas.width = w
          canvas.height = h
        }
      }
      setTexturePreview(null)
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
      const newFrame = parseInt(e.target.value, 10)
      renderer.rendererData.frame = newFrame
      useModelStore.getState().setFrame(newFrame)
      setProgress(newFrame)
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Note: Ctrl+Wheel is handled by a separate native non-passive listener (see useEffect below)
    if (!e.ctrlKey) {
      targetCamera.current.distance = Math.max(0.1, targetCamera.current.distance * (1 + e.deltaY * 0.001))
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { mainMode } = useSelectionStore.getState()
    // Check for Gizmo interaction first
    // In geometry mode: Alt = camera rotation (allow Gizmo)
    // In animation mode: Alt = box selection (block Gizmo)
    const shouldBlockGizmoForAlt = e.altKey && mainMode === 'animation'
    const shouldIgnoreGizmoForQ = mainMode === 'animation' && qPressedRef.current && e.button === 0
    const shouldBlockGizmo = shouldBlockGizmoForAlt || shouldIgnoreGizmoForQ

    if (shouldIgnoreGizmoForQ) {
      // Clear hover hit so Q+click won't be stolen by gizmo drag.
      gizmoState.current.activeAxis = null
    }

    if (gizmoState.current.activeAxis && e.button === 0 && !shouldBlockGizmo) {
      // Block Gizmo in keyframe mode when autoKeyframe is disabled
      const { animationSubMode: subMode, isGlobalTransformMode } = useSelectionStore.getState()
      const { autoKeyframe } = useModelStore.getState()

      // If we are in Global Transform Mode, we always allow dragging (no selection dependencies)
      if (isGlobalTransformMode) {
        // Carry on to dragging logic
      } else if (mainMode === 'animation' && subMode === 'keyframe' && !autoKeyframe) {
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
      const gizmoInfo = computeCurrentGizmoCenter()
      gizmoState.current.dragCenter = gizmoInfo.count > 0 ? vec3.clone(gizmoInfo.center) : null
      snapDragRef.current.translationDelta = [0, 0, 0]
      snapDragRef.current.translationApplied = [0, 0, 0]
      snapDragRef.current.rotationDelta = [0, 0, 0]
      snapDragRef.current.rotationApplied = [0, 0, 0]
      resetGizmoHud()
      mouseState.current.lastMouseX = e.clientX
      mouseState.current.lastMouseY = e.clientY

      const { selectedVertexIds, selectedFaceIds, geometrySubMode, animationSubMode: subMode2, transformMode } = useSelectionStore.getState()
      if (transformMode === 'translate' || transformMode === 'rotate' || transformMode === 'scale') {
        updateHudPosition(e, transformMode)
      }

      // Shift+Drag = Duplicate then move
      if (e.shiftKey && (geometrySubMode === 'vertex' || geometrySubMode === 'face' || geometrySubMode === 'group') && rendererRef.current) {

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
        } else if ((geometrySubMode === 'face' || geometrySubMode === 'group') && selectedFaceIds.length > 0) {
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
          keyframeTransformDirty.current = false
            // Reset debug log flags
            ; (window as any)._baseTransLogOnce = false
            ; (window as any)._keyframeDragDelta = {}

          const { selectedNodeIds } = useSelectionStore.getState()
          selectedNodeIds.forEach(nodeId => {
            // 1. Snapshot original KEYS from STORE (source of truth)
            const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
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
                const pivot = getOrCreateNodePivot(nodeWrapper)
                console.log('[DEBUG MouseDown] PivotPoint:', pivot ? [...pivot] : 'N/A')
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
            const pivot = nodeWrapper ? getOrCreateNodePivot(nodeWrapper) : null
            if (nodeWrapper && pivot) {
              initialNodePositions.current.set(nodeId, [pivot[0], pivot[1], pivot[2]])
            }
          })
          console.log('[Viewer] Captured node positions:', initialNodePositions.current.size)
        }
      } else if (geometrySubMode === 'vertex' || geometrySubMode === 'group') {
        console.log('[Viewer] Capturing vertices for vertex mode. Selected count:', currentSelection.selectedVertexIds.length)
        currentSelection.selectedVertexIds.forEach(sel => captureVertex(sel.geosetIndex, sel.index))
        console.log('[Viewer] Captured vertices:', initialVertexPositions.current.size)
      } else if (geometrySubMode === 'face') {
        const faceVertexKeysByGeoset = new Map<number, Set<string>>()
        currentSelection.selectedFaceIds.forEach(sel => {
          if (!renderer) return
          const geoset = renderer.model.Geosets[sel.geosetIndex]
          if (!geoset?.Vertices) return
          const fIndex = sel.index * 3
          const faceVertexIndices = [geoset.Faces[fIndex], geoset.Faces[fIndex + 1], geoset.Faces[fIndex + 2]]
          let posSet = faceVertexKeysByGeoset.get(sel.geosetIndex)
          if (!posSet) {
            posSet = new Set<string>()
            faceVertexKeysByGeoset.set(sel.geosetIndex, posSet)
          }
          faceVertexIndices.forEach((vertexIndex: number) => {
            captureVertex(sel.geosetIndex, vertexIndex)
            const vIndex = vertexIndex * 3
            const posKey = `${Math.round(Number(geoset.Vertices[vIndex]) * 10000) / 10000}|${Math.round(Number(geoset.Vertices[vIndex + 1]) * 10000) / 10000}|${Math.round(Number(geoset.Vertices[vIndex + 2]) * 10000) / 10000}`
            posSet!.add(posKey)
          })
        })
        faceVertexKeysByGeoset.forEach((posSet, geosetIndex) => {
          if (!renderer) return
          const geoset = renderer.model.Geosets[geosetIndex]
          if (!geoset?.Vertices) return
          const vertexCount = Math.floor(geoset.Vertices.length / 3)
          for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
            const vIndex = vertexIndex * 3
            const posKey = `${Math.round(Number(geoset.Vertices[vIndex]) * 10000) / 10000}|${Math.round(Number(geoset.Vertices[vIndex + 1]) * 10000) / 10000}|${Math.round(Number(geoset.Vertices[vIndex + 2]) * 10000) / 10000}`
            if (posSet.has(posKey)) {
              captureVertex(geosetIndex, vertexIndex)
            }
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
    // - View mode: 左键直接旋转镜头，不进行框选
    // - Batch mode: 同 View mode，左键旋转镜头
    // - Other modes: 左键框选，Alt+左键旋转镜头
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
    console.log('[Viewer] handleBoxSelection', { mainMode, animationSubMode, geometrySubMode, box: { startX, startY, endX, endY } })

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

    // PRIORITY: Check animation keyframe mode FIRST (bone selection)
    // Note: geometrySubMode remains 'vertex' even in animation mode, so we must check mainMode first
    if (mainMode === 'animation' && animationSubMode !== 'binding') {
      // Box Select Nodes (bones)
      console.log('[Viewer] Box Select Nodes - entering animation keyframe mode branch')
      const newSelection: number[] = []
      if (!rendererRef.current || !rendererRef.current.rendererData || !rendererRef.current.rendererData.nodes) {
        console.log('[Viewer] Box Select Nodes - no renderer data')
        return
      }

      console.log('[Viewer] Box Select Nodes - checking', rendererRef.current.rendererData.nodes.length, 'nodes')
      console.log('[Viewer] Box bounds:', { boxLeft, boxRight, boxTop, boxBottom })

      rendererRef.current.rendererData.nodes.forEach((nodeWrapper: any) => {
        const pivot = getOrCreateNodePivot(nodeWrapper)
        if (!pivot) return
        const worldPos = vec3.create()
        vec3.transformMat4(worldPos, pivot, nodeWrapper.matrix)

        const screenPos = project(worldPos)
        if (screenPos) {
          if (screenPos[0] >= boxLeft && screenPos[0] <= boxRight &&
            screenPos[1] >= boxTop && screenPos[1] <= boxBottom) {
            console.log('[Viewer] Node in box:', nodeWrapper.node.ObjectId, nodeWrapper.node.Name || 'unnamed', 'screen:', screenPos)
            newSelection.push(nodeWrapper.node.ObjectId)
          }
        }
      })

      console.log('[Viewer] Box Select Nodes - found', newSelection.length, 'nodes:', newSelection)

      if (isCtrl) {
        const current = useSelectionStore.getState().selectedNodeIds
        const combined = Array.from(new Set([...current, ...newSelection]))
        console.log('[Viewer] Ctrl+Box select - combining with existing:', current, '=> combined:', combined)
        markNodeManagerListScrollFromViewer()
        selectNodes(combined)
      } else {
        console.log('[Viewer] Box select - setting new selection:', newSelection)
        markNodeManagerListScrollFromViewer()
        selectNodes(newSelection)
      }
    } else if ((mainMode === 'geometry' && (geometrySubMode === 'vertex' || geometrySubMode === 'group')) || (mainMode === 'animation' && animationSubMode === 'binding')) {
      // Vertex selection for geometry mode OR binding mode (which also selects vertices)
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

      if (geometrySubMode === 'group') {
        const groupedVertices: { geosetIndex: number, index: number }[] = []
        const groupedFaces: { geosetIndex: number, index: number }[] = []
        const vertexKeys = new Set<string>()
        const faceKeys = new Set<string>()
        const seedsByGeoset = new Map<number, number[]>()

        newSelection.forEach((sel) => {
          const seeds = seedsByGeoset.get(sel.geosetIndex)
          if (seeds) {
            seeds.push(sel.index)
          } else {
            seedsByGeoset.set(sel.geosetIndex, [sel.index])
          }
        })

        seedsByGeoset.forEach((seedVertexIndices, geosetIndex) => {
          const groupSelection = getConnectedGeometryGroup(geosetIndex, [], seedVertexIndices)
          groupSelection.vertices.forEach((vertexSel) => {
            const key = `${vertexSel.geosetIndex}-${vertexSel.index}`
            if (!vertexKeys.has(key)) {
              vertexKeys.add(key)
              groupedVertices.push(vertexSel)
            }
          })
          groupSelection.faces.forEach((faceSel) => {
            const key = `${faceSel.geosetIndex}-${faceSel.index}`
            if (!faceKeys.has(key)) {
              faceKeys.add(key)
              groupedFaces.push(faceSel)
            }
          })
        })

        if (isShift) {
          removeVertexSelection(groupedVertices)
          removeFaceSelection(groupedFaces)
        } else if (isCtrl) {
          addVertexSelection(groupedVertices)
          addFaceSelection(groupedFaces)
        } else {
          selectVertices(groupedVertices)
          selectFaces(groupedFaces)
        }
        return
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
    }
    // Animation keyframe bone selection is now handled at the top of this function
  }



  const handleSelectionClick = (clientX: number, clientY: number, isShift: boolean, isCtrl: boolean, isAlt: boolean = false) => {
    if (!rendererRef.current || !canvasRef.current) return

    const { mainMode, animationSubMode, geometrySubMode, selectVertex, selectVertices, selectFace, selectFaces, addVertexSelection, addFaceSelection, removeVertexSelection, removeFaceSelection, clearAllSelections, selectNode, setPickedGeosetIndex } = useSelectionStore.getState()

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

      // Build skinned vertices for animation-aware picking
      const rendererNodes = rendererRef.current.rendererData?.nodes
      let skinnedVerticesMap: Map<number, Float32Array> | undefined
      if (rendererNodes) {
        // Build ObjectId → matrix lookup
        const nodeMatrixByObjectId = new Map<number, Float32Array | number[]>()
        for (const nodeWrapper of rendererNodes as any[]) {
          const objId = nodeWrapper?.node?.ObjectId
          const mtx = nodeWrapper?.matrix || nodeWrapper?.worldMatrix
          if (objId !== undefined && mtx) {
            nodeMatrixByObjectId.set(Number(objId), mtx)
          }
        }

        skinnedVerticesMap = new Map()
        for (let gi = 0; gi < geosets.length; gi++) {
          const geoset = geosets[gi]
          if (!geoset.Vertices || !geoset.VertexGroup || !geoset.Groups) continue
          const bindVerts = geoset.Vertices
          const vertCount = bindVerts.length / 3
          const skinned = new Float32Array(bindVerts.length)
          for (let vi = 0; vi < vertCount; vi++) {
            const groupIndex = geoset.VertexGroup[vi]
            const boneIds = geoset.Groups[groupIndex]
            const bx = bindVerts[vi * 3], by = bindVerts[vi * 3 + 1], bz = bindVerts[vi * 3 + 2]
            if (boneIds && boneIds.length > 0) {
              let sx = 0, sy = 0, sz = 0, validBones = 0
              for (const boneId of boneIds) {
                const mtx = nodeMatrixByObjectId.get(Number(boneId))
                if (!mtx) continue
                sx += mtx[0] * bx + mtx[4] * by + mtx[8] * bz + mtx[12]
                sy += mtx[1] * bx + mtx[5] * by + mtx[9] * bz + mtx[13]
                sz += mtx[2] * bx + mtx[6] * by + mtx[10] * bz + mtx[14]
                validBones++
              }
              if (validBones > 0) {
                const inv = 1 / validBones
                skinned[vi * 3] = sx * inv; skinned[vi * 3 + 1] = sy * inv; skinned[vi * 3 + 2] = sz * inv
              } else {
                skinned[vi * 3] = bx; skinned[vi * 3 + 1] = by; skinned[vi * 3 + 2] = bz
              }
            } else {
              skinned[vi * 3] = bx; skinned[vi * 3 + 1] = by; skinned[vi * 3 + 2] = bz
            }
          }
          skinnedVerticesMap.set(gi, skinned)
        }
      }

      const result = pickClosestGeoset(cameraPos, rayDir, geosets, skinnedVerticesMap)
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
          const pivot = getOrCreateNodePivot(nodeWrapper)
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
        markNodeManagerListScrollFromViewer()
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

    const isBindingVertexMode = mainMode === 'animation' && animationSubMode === 'binding'
    const effectiveSubMode = geometrySubMode === 'group' ? 'face' : (isBindingVertexMode ? 'vertex' : geometrySubMode)

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
      if (geometrySubMode === 'group') {
        const sel = result as { geosetIndex: number, index: number }
        const groupSelection = getConnectedGeometryGroup(sel.geosetIndex, [sel.index], [])
        if (isShift) {
          removeVertexSelection(groupSelection.vertices)
          removeFaceSelection(groupSelection.faces)
        } else if (isCtrl) {
          addVertexSelection(groupSelection.vertices)
          addFaceSelection(groupSelection.faces)
        } else {
          selectVertices(groupSelection.vertices)
          selectFaces(groupSelection.faces)
        }
      } else if (effectiveSubMode === 'vertex') {
        const sel = result as { geosetIndex: number, index: number }
        if (isShift) {
          removeVertexSelection([sel])
        } else if (isCtrl) {
          addVertexSelection([sel])
        } else {
          selectVertex(sel, false)
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
    if (!canvasRef.current) return

    const canvas = canvasRef.current

    const resizeObserver = new ResizeObserver(() => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (width > 0 && height > 0) {
        canvas.width = width
        canvas.height = height

        // Update viewport only if we actually have a WebGL context.
        // Create a WebGL context for the viewer canvas.
        if (glRef.current) {
          glRef.current.viewport(0, 0, width, height)
        } else if (rendererRef.current && typeof (rendererRef.current as any).resize === 'function') {
          ; (rendererRef.current as any).resize(width, height)
        }

        // Render immediately to prevent flicker (canvas clears on resize)
        // scheduleNext=false prevents spawning new RAF chains
        if (renderRef.current) {
          renderRef.current(performance.now(), false)
        }
      }
    })
    resizeObserver.observe(canvas)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    // Native non-passive wheel listener so we can call preventDefault() on Ctrl+Wheel
    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const { nodeSize, setNodeSize } = useRendererStore.getState()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setNodeSize((nodeSize ?? 1.0) + delta)
      }
    }
    canvas.addEventListener('wheel', handleNativeWheel, { passive: false })

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('wheel', handleNativeWheel)
    }
  }, [])

  const initializeRendererBackend = (canvas: HTMLCanvasElement, newRenderer: ModelRenderer): void => {
    const gl =
      (canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl', WEBGL_CONTEXT_ATTRIBUTES) as WebGLRenderingContext | null)

    if (!gl) {
      throw new Error('Neither WebGPU nor WebGL could be initialized for the viewer canvas')
    }

    glRef.current = gl
    gl.clearColor(0.2, 0.2, 0.2, 1)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.viewport(0, 0, canvas.width, canvas.height)

    gridRenderer.current.init(gl)
    debugRenderer.current.init(gl)
    newRenderer.initGL(gl)
  }

  const loadModel = async (path: string, inMemoryData?: any) => {
    lastFrameTime.current = performance.now()

    // IMMEDIATE CLEAR: Remove old renderer reference
    if (renderer) {
      console.log('[Viewer] Detaching old renderer (lifecycle managed by store)')
      setRenderer(null)
    }

    setLoading(true)
    setLoadingStatus('读取模型文件...')

    // Clear the canvas without creating a context.
    const canvas = canvasRef.current
    if (!canvas) {
      throw new Error('Viewer canvas is not ready')
    }
    if (canvas) {
      // Resetting width/height clears the drawing buffer.
      const w = canvas.width
      const h = canvas.height
      canvas.width = w
      canvas.height = h
    }
    setTexturePreview(null)

    try {
      console.time('[Viewer] FullModelLoad')
      canvas.focus()

      const readPathBytes = async (assetPath: string): Promise<Uint8Array> => {
        try {
          return await readFile(assetPath)
        } catch {
          const mpqPayload = await invokeReadMpqFile<any>(assetPath, 'Viewer.loadBackgroundAsset').catch(() => null)
          const mpqBytes = toUint8Array(mpqPayload)
          if (!mpqBytes || mpqBytes.byteLength === 0) {
            throw new Error(`无法读取资源文件: ${assetPath}`)
          }
          return mpqBytes
        }
      }

      // Texture preview mode (.blp/.tga)
      if (isTexturePreviewPath(path)) {
        const bytes = await readPathBytes(path)
        const imageData = decodeTextureData(toTightArrayBuffer(bytes), path, { preferredBLPMip: 0 })
        if (!imageData) {
          throw new Error(`无法解码贴图文件: ${path}`)
        }

        const previewCanvas = document.createElement('canvas')
        previewCanvas.width = imageData.width
        previewCanvas.height = imageData.height
        const previewCtx = previewCanvas.getContext('2d')
        if (!previewCtx) {
          throw new Error('Failed to create texture preview canvas context')
        }
        previewCtx.putImageData(imageData, 0, 0)

        const previewUrl = previewCanvas.toDataURL('image/png')
        setTexturePreview({
          path,
          width: imageData.width,
          height: imageData.height,
          url: previewUrl
        })

        onModelLoaded({ path, Textures: [], Geosets: [], Nodes: [], Sequences: [] } as any)
        setLoading(false)
        console.timeEnd('[Viewer] FullModelLoad')
        return
      }

      setTexturePreview(null)

      glRef.current = null

      let model: any

      console.time('[Viewer] MDX Parse')
      const parseStart = performance.now()
      if (inMemoryData) {
        console.log('[Viewer] Loading model from in-memory data')
        model = inMemoryData
      } else {
        setLoadingStatus('正在解析模型...')
        const buffer = await readPathBytes(path)
        const parseWithWorker = (bytes: Uint8Array) =>
          new Promise<{ model: any; parseMs?: number }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Model parsing timeout')), 30000)
            const oldOnMessage = parseWorker.onmessage
            parseWorker.onmessage = (e: any) => {
              const { type, payload } = e.data
              if (type === 'PARSE_SUCCESS') {
                clearTimeout(timer)
                parseWorker.onmessage = oldOnMessage
                resolve({
                  model: payload.model,
                  parseMs: payload.parseMs
                })
              } else if (type === 'ERROR') {
                clearTimeout(timer)
                parseWorker.onmessage = oldOnMessage
                reject(new Error(payload.error))
              }
            }
            const tightBuffer = toTightArrayBuffer(bytes)
            parseWorker.postMessage({
              type: 'PARSE_MODEL',
              payload: { buffer: tightBuffer, path }
            }, [tightBuffer])
          })

        const cacheKey = createModelParseCacheKey(path, buffer)
        const cachedModel = getCachedParsedModel(cacheKey)
        if (cachedModel) {
          model = cachedModel
          console.log('[Viewer] Loaded parsed model from cache')
        } else {
          const parseResult = await parseWithWorker(buffer)
          model = parseResult.model
          setCachedParsedModel(cacheKey, model)
        }
      }
      console.timeEnd('[Viewer] MDX Parse')
      console.log(`[Viewer] Model Parsing took ${(performance.now() - parseStart).toFixed(1)}ms`)

      // Log to production CMD window
      logModelInfo(path, model, performance.now() - parseStart)
      // console.log('[Viewer] Parsed model:', {
      //   Sequences: model.Sequences?.length || 0,
      //   ParticleEmitters2: model.ParticleEmitters2?.length || 0,
      //   Nodes: model.Nodes?.length || 0,
      //   Bones: model.Bones?.length || 0,
      //   GlobalSequences: model.GlobalSequences?.length || 0,
      // })
      if (model.Sequences && model.Sequences.length > 0) {
        // Log ALL sequences with their intervals to trace corruption
        // model.Sequences.forEach((seq: any, index: number) => {
        //   const intervalType = seq.Interval instanceof Uint32Array ? 'Uint32Array' : Array.isArray(seq.Interval) ? 'Array' : typeof seq.Interval;
        //   console.log(`[Viewer] Sequence ${index} "${seq.Name}" Interval (${intervalType}): [${seq.Interval[0]}, ${seq.Interval[1]}]`);
        // });
      }
      if (model.ParticleEmitters2 && model.ParticleEmitters2.length > 0) {
        // console.log('[Viewer] First ParticleEmitter2:', model.ParticleEmitters2[0])
      }

      // 与 WebGL/ModelRenderer 初始化并行：Rust 侧批量读贴图（invoke 已发起即与后续 JS 重叠）
      const textureLoadContext = prepareModelForTextureLoad(model, {})
      const batchPayloadPromise =
        textureLoadContext.effectiveTexturePaths.length > 0
          ? invoke<Uint8Array>('load_textures_batch_bin', {
              modelPath: path,
              texturePaths: textureLoadContext.effectiveTexturePaths
            })
          : undefined

      ignoreNextModelDataUpdate.current = true
      onModelLoaded(model)

      // CRITICAL FIX: Validate and fix ParticleEmitters2 before creating renderer
      // This prevents production-only rendering issues caused by invalid/missing properties
      validateAllParticleEmitters(model)

      const rendererStart = performance.now()
      const blendCompatibleModel = createRendererBlendCompatibleModel(model)
      const { model: rendererModelWithSequences, usedFallback } = ensureRendererSequences(blendCompatibleModel)
      const { model: rendererModel, defaultNodeId } = ensureRenderNodes(rendererModelWithSequences)
      ensureGeosetGroups(rendererModel, defaultNodeId)
      console.log('[Viewer] Initializing Renderer Backend (WebGL)...')
      const newRenderer = new ModelRenderer(rendererModel)
      initializeRendererBackend(canvas, newRenderer)
      // NOTE: setRenderer(newRenderer) is called AFTER texture loading to avoid race condition
      newRenderer.update(0)
      resetCamera()
      console.log(`[Viewer] Renderer Init took ${(performance.now() - rendererStart).toFixed(1)}ms`)

      setLoadingStatus('加载贴图资源...')
      // 模型贴图与队伍色替换贴图互不依赖，并行缩短首帧前等待时间
      const [textureResults] = await Promise.all([
        loadAllTextures(
          model,
          newRenderer,
          path,
          textureWorkers,
          512,
          {
            yieldUploads: false,
            textureLoadContext,
            batchPayloadPromise
          }
        ),
        loadTeamColorTextures(newRenderer, teamColor)
      ])

      // Track missing textures or unsupported formats for warning UI
      const missingPaths = textureResults
        .filter(r => !r.loaded)
        .map(r => r.path)
      useRendererStore.getState().setMissingTextures(missingPaths)

      if (usedFallback && typeof (newRenderer as any).setSequence === 'function') {
        ; (newRenderer as any).setSequence(0)
      }

      setRenderer(newRenderer)
      setLoading(false)
      console.timeEnd('[Viewer] FullModelLoad')
    } catch (error) {
      console.error('[Viewer] Error loading model:', error)
      setLoading(false)
    }
  }

  const reloadRendererWithData = async (model: any, modelPath: string) => {
    console.log('[Viewer] ========== FULL RELOAD START ==========')
    const safeModelPath = typeof modelPath === 'string' ? modelPath : ''
    const previousRendererGeosets = Array.isArray(renderer?.model?.Geosets) ? renderer.model.Geosets : null
    console.log('[Viewer] reloadRendererWithData called with path:', safeModelPath)
    console.log('[Viewer] Model data summary:', {
      Geosets: model.Geosets?.length || 0,
      Textures: model.Textures?.length || 0,
      Materials: model.Materials?.length || 0,
      ParticleEmitters2: model.ParticleEmitters2?.length || 0,
      Nodes: model.Nodes?.length || 0,
      Sequences: model.Sequences?.length || 0
    })
    const reloadTimerLabel = `[Viewer] ReloadModel:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6).toString(36)}`
    let reloadTimerStarted = false
    console.time(reloadTimerLabel)
    reloadTimerStarted = true
    setLoading(true)
    setLoadingStatus('同步模型数据...')

    try {
      const canvas = canvasRef.current
      if (!canvas) {
        console.error('[Viewer] Canvas reference is null')
        return
      }

      const modelForReload =
        (!Array.isArray(model?.Materials) || model.Materials.length === 0) && Array.isArray(renderer?.model?.Materials) && renderer.model.Materials.length > 0
          ? { ...model, Materials: renderer.model.Materials }
          : model

      const sanitizedModel = sanitizeModelGeosetsForReload(modelForReload, previousRendererGeosets)

      // Cleanup old renderer only after we know the incoming model is safe enough to attempt a reload.
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }

      if (renderer) {
        try {
          if (typeof renderer.destroy === 'function') {
            renderer.destroy()
          }
        } catch (e) {
          console.warn('[Viewer] Error destroying renderer:', e)
        }
        setRenderer(null)
      }

      // CRITICAL FIX: Validate and fix ParticleEmitters2 before creating renderer
      // Same validation as in loadModel - prevents production-only rendering issues
      const blendCompatibleModel = createRendererBlendCompatibleModel(sanitizedModel)
      const { model: rendererModelWithNodes, defaultNodeId } = ensureRenderNodes(blendCompatibleModel)
      ensureGeosetGroups(rendererModelWithNodes, defaultNodeId)
      console.log('[Viewer] Step 1: Validating particles...')
      validateAllParticleEmitters(sanitizedModel)
      console.log('[Viewer] Step 1: Particle validation complete')

      // 与 loadModel 一致：提前发起 Rust 批量读贴图，与后续 WebGL 初始化重叠
      const textureLoadContextReload = prepareModelForTextureLoad(sanitizedModel, {})
      const batchPayloadPromiseReload =
        textureLoadContextReload.effectiveTexturePaths.length > 0
          ? invoke<Uint8Array>('load_textures_batch_bin', {
              modelPath: safeModelPath,
              texturePaths: textureLoadContextReload.effectiveTexturePaths
            })
          : undefined

      console.log('[Viewer] Step 2: Creating ModelRenderer...')
      const rendererStart = performance.now()
      const { model: rendererModelWithSequences, usedFallback } = ensureRendererSequences(rendererModelWithNodes)
      const newRenderer = new ModelRenderer(rendererModelWithSequences)
      console.log('[Viewer] Step 2: ModelRenderer created')

      console.log('[Viewer] Step 3: Initializing Renderer Backend (WebGL)...')
      initializeRendererBackend(canvas, newRenderer)
      console.log('[Viewer] Step 3: WebGL initialized')

      // NOTE: setRenderer(newRenderer) is called AFTER texture loading to avoid race condition
      console.log('[Viewer] Step 4: First update(0)...')
      newRenderer.update(0)
      console.log('[Viewer] Step 4: First update complete')

      console.log('[Viewer] Step 5: Resetting camera...')
      resetCamera()
      console.log(`[Viewer] reloadRendererWithData: Renderer Init took ${(performance.now() - rendererStart).toFixed(1)}ms`)

      // Load textures using concurrent loader with mipmap optimization
      console.log('[Viewer] Step 6: Loading textures...')
      const [textureResults] = await Promise.all([
        loadAllTextures(sanitizedModel, newRenderer, safeModelPath, textureWorkers, 512, {
          yieldUploads: false,
          textureLoadContext: textureLoadContextReload,
          batchPayloadPromise: batchPayloadPromiseReload
        }),
        loadTeamColorTextures(newRenderer, teamColor)
      ])
      console.log('[Viewer] Step 6: Textures + team colors loaded')

      // Keep missing texture warning in sync after a full reload
      const missingPaths = textureResults
        .filter(r => {
          if (!r.loaded) return true
          const ext = r.path.split('.').pop()?.toLowerCase()
          return ext !== 'blp' && ext !== 'tga'
        })
        .map(r => r.path)
      useRendererStore.getState().setMissingTextures(missingPaths)

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
      if (usedFallback && typeof (newRenderer as any).setSequence === 'function') {
        ; (newRenderer as any).setSequence(0)
      }

      (newRenderer as any).__modelPath = safeModelPath
      setRenderer(newRenderer)
      console.log('[Viewer] ========== FULL RELOAD COMPLETE ==========')
      console.timeEnd(reloadTimerLabel)
      reloadTimerStarted = false
      setLoading(false)
    } catch (error) {
      console.error('[Viewer] ========== FULL RELOAD CRASHED ==========')
      console.error('[Viewer] Error reloading renderer with data:', error)
      console.error('[Viewer] Stack:', (error as Error).stack)
      if (reloadTimerStarted) {
        console.timeEnd(reloadTimerLabel)
      }
      setLoading(false)
    }
  }

  // Watch for renderer reload trigger from store (e.g., when particles are updated)
  const lastReloadTrigger = useRef(0) // Start at 0 to match initial store value
  const lastGeosetAnimsRef = useRef<any[] | undefined>(undefined)
  useEffect(() => {
    // Skip only initial mount (when trigger is still 0)
    // After that, any change should trigger sync
    const isInitialMount = rendererReloadTrigger === 0
    const hasChanged = rendererReloadTrigger !== lastReloadTrigger.current

    if (!isInitialMount && hasChanged) {
      if (import.meta.env.DEV) {
        console.log('[Viewer] Model data sync triggered, trigger:', rendererReloadTrigger)
      }

      // Sync model data to renderer without recreating the entire renderer
      // This is the LIGHTWEIGHT SYNC approach - only updates internal data arrays
      if (renderer && modelData) {
        const modelPathHint = (modelData as any)?.__modelPath || (modelData as any)?.path || ''
          ; (renderer as any).__modelPath = modelPath || modelPathHint || (renderer as any).__modelPath || ''
        // Check for structural changes that require full reload
        if ((modelData as any).__forceFullReload) {
          delete (modelData as any).__forceFullReload
          console.log('[Viewer] Forced full reload due to geometry transform')
          reloadRendererWithData(modelData, modelPath || '')
          lastReloadTrigger.current = rendererReloadTrigger
          return
        }
        const { needsReload, reason } = checkForStructuralChanges(modelData, renderer.model)

        if (needsReload) {
          console.log('[Viewer] Structural change detected:', reason, '. Triggering full reload.')
          reloadRendererWithData(modelData, modelPath || '')
          lastReloadTrigger.current = rendererReloadTrigger
          return
        }
        // === NODES ===
        // Sync Nodes array for correct node transforms - MUST do this BEFORE ParticleEmitters2
        if (modelData.Nodes && modelData.Nodes.length > 0) {
          renderer.model.Nodes = modelData.Nodes
          // Reinitialize rendererData.nodes so new nodes are accessible
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncNodes === 'function') {
            (renderer as any).modelInstance.syncNodes()
          }
        } else if (!renderer.model.Nodes || renderer.model.Nodes.length === 0) {
          const { model: rendererModelWithNodes } = ensureRenderNodes(renderer.model)
          renderer.model.Nodes = rendererModelWithNodes.Nodes
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncNodes === 'function') {
            (renderer as any).modelInstance.syncNodes()
          }
        }

        // === PARTICLES ===
        // Sync ParticleEmitters2 array - always sync to handle deletions
        // Default to empty array if undefined to properly handle particle node deletion
        // CRITICAL: Validate particles BEFORE syncing to prevent crashes from invalid new particles
        // 轻量同步时 viewerModelData 可能 Materials/Textures 为空数组（merge 或仅节点补丁），但 renderer 已含完整贴图；
        // 若用 textureCount=0 校验会误改 TextureID，粒子立即消失。校验前浅克隆，避免原地改 Zustand 中的发射器引用。
        let pe2ForSync: any[] | null = null
        if (modelData.ParticleEmitters2 && modelData.ParticleEmitters2.length > 0) {
          const texturesForValidation =
            (modelData.Textures && modelData.Textures.length > 0)
              ? modelData.Textures
              : (renderer.model?.Textures && renderer.model.Textures.length > 0)
                ? renderer.model.Textures
                : (modelData.Textures || [])
          pe2ForSync = modelData.ParticleEmitters2.map((e: any) => ({ ...e }))
          validateAllParticleEmitters({
            ParticleEmitters2: pe2ForSync,
            Textures: texturesForValidation,
          })
        }
        const nextEmitters = pe2ForSync ?? (modelData.ParticleEmitters2 || [])
        const currentEmitters = renderer.model.ParticleEmitters2 || []
        if (currentEmitters.length === nextEmitters.length) {
          syncParticleEmitters2InPlace(currentEmitters, nextEmitters)
          renderer.model.ParticleEmitters2 = currentEmitters
        } else {
          renderer.model.ParticleEmitters2 = nextEmitters
        }
        if (import.meta.env.DEV) {
          console.log('[Viewer] Synced ParticleEmitters2:', renderer.model.ParticleEmitters2.length, 'emitters')
        }
        if (pe2PreviewDebugEnabled()) {
          const pe2List = renderer.model.ParticleEmitters2 || []
          pe2List.forEach((em: any, i: number) => {
            console.log(`[PE2预览] Viewer 轻量同步后 PE2[${i}]`, {
              Name: em?.Name,
              ObjectId: em?.ObjectId,
              Visibility: describePe2AnimOrScalar(em?.Visibility),
              VisibilityAnim: describePe2AnimOrScalar(em?.VisibilityAnim),
              EmissionRate: describePe2AnimOrScalar(em?.EmissionRate),
              LifeSpan: em?.LifeSpan,
              TextureID: em?.TextureID,
            })
          })
        }

        // === RIBBON EMITTERS ===
        if (modelData.RibbonEmitters) {
          renderer.model.RibbonEmitters = modelData.RibbonEmitters
          if ((renderer as any).modelInstance?.ribbonsController?.syncEmitters) {
            ; (renderer as any).modelInstance.ribbonsController.syncEmitters()
          }
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

        // === TEXTURES & MATERIALS ===
        // Keep Textures ahead of Materials so layers referencing a newly imported TextureID
        // never observe the old texture array during the same lightweight sync tick.
        if (modelData.Textures && modelData.Textures.length > 0) {
          // Detect new textures that need to be loaded
          const oldTexturePaths = new Set(renderer.model.Textures?.map((t: any) => t.Image) || [])
          const newTextures = modelData.Textures.filter((t: any) => !oldTexturePaths.has(t.Image))

          // Update the textures array first
          renderer.model.Textures = modelData.Textures
          // WebGPU path requires sampler array length to keep up with Textures length.
          // Missing sampler can crash render pass and freeze RAF loop after texture import.
          ensureWebGpuTextureSamplers(renderer, renderer.model.Textures)
          // 仅改 Flags（笼罩宽/高）时不会走 loadAllTextures，须把 WRAP 同步到已有 GPU 纹理
          if (typeof (renderer as any).syncTextureWrapParametersFromModel === 'function') {
            ;(renderer as any).syncTextureWrapParametersFromModel()
          }

          // Load any new textures asynchronously
          if (newTextures.length > 0) {
            console.log('[Viewer] Lightweight sync: Loading', newTextures.length, 'new textures')
            const textureModelPath = (renderer as any).__modelPath || modelPath || (modelData as any)?.__modelPath || (modelData as any)?.path || ''
            void loadAllTextures(
              renderer.model,
              renderer,
              textureModelPath,
              textureWorkers,
              undefined,
              {
                yieldUploads: true,
                targetPaths: newTextures.map((texture: any) => texture.Image).filter(Boolean),
                workerDecodeMinTextures: 1,
                workerDecodeMinBytes: 1
              }
            ).then((results) => {
              const failed = results.filter((result) => !result.loaded)
              if (failed.length > 0) {
                failed.forEach((result) => {
                  console.warn('[Viewer] Failed to load new texture:', result.path, result.error)
                })
              }
              // After all textures loaded, rebuild material layer cache
              if ((renderer as any).modelInstance?.syncMaterials) {
                (renderer as any).modelInstance.syncMaterials()
                console.log('[Viewer] Rebuilt material cache after texture load')
              }
            }).catch((e) => {
              console.error('[Viewer] Error loading new textures via lightweight sync:', e)
            })
          }
        } else if (Array.isArray(modelData.Textures) && modelData.Textures.length === 0) {
          if (import.meta.env.DEV) {
            console.debug('[Viewer] Skip applying empty Textures patch (keep renderer textures)')
          }
        }
        if (Array.isArray(modelData.Materials) && modelData.Materials.length > 0) {
          console.log('[Viewer] Syncing materials. Count:', modelData.Materials.length)
          const sanitizedMaterials = sanitizeMaterialsForRenderer(modelData.Materials, renderer.model.Textures?.length || 0)
          renderer.model.Materials = cloneMaterialsWithReferenceBlendCompat(sanitizedMaterials)
          // Lightweight sync: rebuild materialLayerTextureID cache
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncMaterials === 'function') {
            (renderer as any).modelInstance.syncMaterials()
          }
          if ((renderer as any).modelInstance?.ribbonsController?.syncEmitters) {
            ; (renderer as any).modelInstance.ribbonsController.syncEmitters()
          }
        } else if (Array.isArray(modelData.Materials) && modelData.Materials.length === 0) {
          // 无材质数组的模型或仅节点补丁时属正常，勿用 warn 误导为异常
          if (import.meta.env.DEV) {
            console.debug('[Viewer] Skip applying empty Materials patch (keep renderer materials)')
          }
        }
        if (modelData.TextureAnims && Array.isArray(modelData.TextureAnims)) {
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
        // However, we DO need to sync MaterialID and other property changes.
        let geosetMaterialChanged = false
        console.log('[Viewer] Geoset sync check - modelData.Geosets:', modelData.Geosets?.length, 'renderer.model.Geosets:', renderer.model.Geosets?.length)
        if (modelData.Geosets && renderer.model.Geosets) {
          const minLen = Math.min(modelData.Geosets.length, renderer.model.Geosets.length)
          console.log('[Viewer] Syncing', minLen, 'geosets')
          for (let i = 0; i < minLen; i++) {
            const geoset = modelData.Geosets[i]
            const rendererGeoset = renderer.model.Geosets[i]

            // Sync MaterialID changes
            if (geoset?.MaterialID !== undefined) {
              const materialCount = modelData.Materials?.length || 0
              const rawMatId = typeof geoset.MaterialID === 'number' ? geoset.MaterialID : Number(geoset.MaterialID)
              const safeMatId = Number.isFinite(rawMatId)
                ? Math.min(Math.max(0, Math.floor(rawMatId)), materialCount > 0 ? materialCount - 1 : 0)
                : 0
              if (rendererGeoset.MaterialID !== safeMatId) {
                console.log(`[Viewer] Syncing Geoset[${i}] MaterialID: ${rendererGeoset.MaterialID} -> ${safeMatId}`)
                rendererGeoset.MaterialID = safeMatId
                geosetMaterialChanged = true
              }
            }

            // Sync SelectionGroup changes
            if (geoset?.SelectionGroup !== undefined && rendererGeoset.SelectionGroup !== geoset.SelectionGroup) {
              rendererGeoset.SelectionGroup = geoset.SelectionGroup
            }

            // Sync normal buffers so menu-driven recalculate normals updates immediately
            if (geoset?.Normals) {
              const normalData = geoset.Normals instanceof Float32Array
                ? geoset.Normals
                : new Float32Array(geoset.Normals)
              if (rendererGeoset.Normals !== normalData) {
                rendererGeoset.Normals = normalData
                ; (renderer as any).updateGeosetNormals?.(i, normalData)
              }
            }

            // Sync UV texture coordinate buffers
            if (geoset?.TVertices?.[0]) {
              const uvData = geoset.TVertices[0]
              const float32Data = uvData instanceof Float32Array
                ? uvData
                : new Float32Array(uvData)
                ; (renderer as any).updateGeosetTexCoords?.(i, float32Data)
            }
          }
        }

        // If any geoset MaterialID changed, rebuild material layer texture ID cache
        if (geosetMaterialChanged) {
          console.log('[Viewer] Geoset MaterialID changed, checking syncMaterials availability')
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncMaterials === 'function') {
            console.log('[Viewer] Calling syncMaterials to rebuild texture ID cache')
              ; (renderer as any).modelInstance.syncMaterials()
            console.log('[Viewer] syncMaterials completed')
          } else {
            console.warn('[Viewer] syncMaterials not available!')
          }
        }

        // === GEOSET ANIMATIONS ===
        if (modelData.GeosetAnims) {
          renderer.model.GeosetAnims = modelData.GeosetAnims
          if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncMaterials === 'function') {
            ; (renderer as any).modelInstance.syncMaterials()
          }
        }

        // === SEQUENCES ===
        if (modelData.Sequences && modelData.Sequences.length > 0) {
          renderer.model.Sequences = modelData.Sequences
        } else if (!renderer.model.Sequences || renderer.model.Sequences.length === 0) {
          renderer.model.Sequences = ensureRendererSequences(renderer.model).model.Sequences
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

        if (import.meta.env.DEV) {
          console.log('[Viewer] Lightweight sync complete')
        }
      }
    }
    lastReloadTrigger.current = rendererReloadTrigger
  }, [rendererReloadTrigger, modelData, renderer])

  useEffect(() => {
    if (!renderer || !modelData?.GeosetAnims) {
      lastGeosetAnimsRef.current = modelData?.GeosetAnims
      return
    }

    if (lastGeosetAnimsRef.current === modelData.GeosetAnims) {
      return
    }

    renderer.model.GeosetAnims = modelData.GeosetAnims
    if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncMaterials === 'function') {
      ; (renderer as any).modelInstance.syncMaterials()
    }
    lastGeosetAnimsRef.current = modelData.GeosetAnims
  }, [renderer, modelData?.GeosetAnims])

  // Handle Animation and Mode Changes
  useEffect(() => {
    // CRITICAL: Cancel any existing RAF loop BEFORE creating a new one
    // This prevents duplicate loops when dependencies change (e.g., mode switch)
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }

    // CRITICAL FIX: Use a closure object instead of shared ref
    // Each useEffect instance gets its own `runState` object
    // When cleanup sets shouldRun = false, it only affects THIS render function
    const runState = { shouldRun: true }

    if (renderer && canvasRef.current) {
      const gl =
        glRef.current ||
        (canvasRef.current.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null) ||
        (canvasRef.current.getContext('webgl', WEBGL_CONTEXT_ATTRIBUTES) as WebGLRenderingContext | null)

      if (!gl) return undefined
      glRef.current = gl

      // Clear the canvas before initializing (use alpha 0 for transparency)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      // Reinitialize helper renderers with the current GL context.
      gridRenderer.current.init(gl)
      debugRenderer.current.init(gl)
      gizmoRenderer.current.init(gl)

      // Reset time tracking to prevent huge delta on first frame after reload
      // FPS FIX: Also reset frameCount and lastFpsTime to prevent FPS accumulation on mode switch
      lastFrameTime.current = performance.now()
      lastFpsTime.current = performance.now()
      frameCount.current = 0

      // Singleton Loop Pattern:
      // Increment global ID for this new effect instance
      globalRenderLoopId++
      const myLoopId = globalRenderLoopId

      const render = (time: DOMHighResTimeStamp, scheduleNext = true) => {
        // STRONG GUARD: If a newer loop has started, kill this one immediately
        if (globalRenderLoopId !== myLoopId) {
          // Log only once when killing to avoid spam, or finding a way to log it without spamming
          // console.warn(`[Viewer] Render Loop #${myLoopId} killed by new loop #${globalRenderLoopId}`)
          return
        }

        // CRITICAL: Check THIS closure's flag at the VERY START
        if (!runState.shouldRun) {
          return // Do not schedule next frame, loop is stopped
        }

        try {
          const framePerfStart = performance.now()
          let stageStart = framePerfStart

          const canvas = canvasRef.current
          const mdlRenderer = rendererRef.current

          if (!canvas || !mdlRenderer) {
            // Only continue polling if we should still run AND this is still the active loop
            if (runState.shouldRun && globalRenderLoopId === myLoopId) {
              animationFrameId.current = requestAnimationFrame(render)
            }
            return
          }

          if (gl) {
            const [r, g, b] = hexToRgb(backgroundColorRef.current)
            gl.clearColor(r, g, b, 1.0)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
          }
          const clearMs = performance.now() - stageStart
          stageStart = performance.now()
          const delta = time - lastFrameTime.current
          lastFrameTime.current = time

          const cameraPos = cameraPosRef.current
          const cameraUp = cameraUpRef.current
          const cameraQuat = cameraQuatRef.current
          quat.identity(cameraQuat)
          const pMatrix = pMatrixRef.current
          const mvMatrix = mvMatrixRef.current

          if (gl) {
            gl.enable(gl.DEPTH_TEST)
            gl.depthFunc(gl.LEQUAL)
            gl.enable(gl.BLEND)
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
          }

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
          const cameraMs = performance.now() - stageStart
          stageStart = performance.now()

          const { geometrySubMode, transformMode, selectedVertexIds, selectedFaceIds, animationSubMode: currentAnimationSubMode, mainMode: currentMainMode, isGlobalTransformMode } = useSelectionStore.getState()
          const previewTransform = previewTransformRef.current
          const baseMvMatrix = isGlobalTransformMode ? mat4.clone(mvMatrix) : null
          const globalPivot = getModelCenter()
          const isBindPoseMode =
            animationIndex === -1 ||
            currentMainMode === 'geometry' ||
            (currentMainMode === 'animation' && currentAnimationSubMode === 'binding')
          const stateMs = performance.now() - stageStart
          stageStart = performance.now()

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
            mdlRenderer.update(delta * playbackSpeedRef.current)
            needsRendererUpdateRef.current = false

            // Auto-pause if not looping and reached end
            if (!isLooping && mdlRenderer.rendererData &&
              mdlRenderer.rendererData.animationInfo &&
              mdlRenderer.rendererData.frame >= mdlRenderer.rendererData.animationInfo.Interval[1] - 0.1) {
              onTogglePlay()
            }

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
            // Animation paused or bind pose mode
            // 性能优化：仅在必要时更新骨骼矩阵（如 Gizmo 拖动或帧变化）
            // 静态姿态时跳过矩阵计算，节省 CPU
            const gizmoDragging = gizmoState.current.isDragging
            let currentFrame = mdlRenderer.rendererData?.frame ?? 0

            let forceFrameRefresh = false
            let simulatedTimelineStep = false

            // In animation mode, Timeline is authoritative (store -> renderer).
            // In view/geometry/uv modes, renderer frame is authoritative to avoid pause reset jumps.
            const storeFrame = useModelStore.getState().currentFrame
            if (mdlRenderer.rendererData) {
              if (currentMainMode === 'animation') {
                if (Math.abs(storeFrame - currentFrame) > 0.0001) {
                  const interval = mdlRenderer.rendererData.animationInfo?.Interval
                  const hasInterval =
                    !!interval &&
                    typeof (interval as any).length === 'number' &&
                    (interval as any).length >= 2

                  if (hasInterval && Number.isFinite(storeFrame)) {
                    const sequenceStart = Number(interval[0])
                    const sequenceEnd = Number(interval[1])
                    const targetFrame = Math.min(Math.max(storeFrame, sequenceStart), sequenceEnd)

                    // Deterministic paused preview:
                    // Keep a single authoritative frame for ribbons and other anim channels.
                    const globalSequenceDurations = mdlRenderer.model?.GlobalSequences
                    const globalSequenceCount =
                      typeof (globalSequenceDurations as ArrayLike<number> | undefined)?.length === 'number'
                        ? Number((globalSequenceDurations as ArrayLike<number>).length)
                        : 0
                    const hasGlobalSeq = globalSequenceCount > 0 && Array.isArray(mdlRenderer.rendererData.globalSequencesFrames)
                    if (hasGlobalSeq) {
                      const currentFrameInGlobalSeq = targetFrame
                      const currentGlobalFrames = mdlRenderer.rendererData.globalSequencesFrames
                      const maxIndex = Math.min(globalSequenceCount, currentGlobalFrames.length)
                      for (let i = 0; i < maxIndex; ++i) {
                        const duration = Number(globalSequenceDurations[i])
                        if (!Number.isFinite(duration) || duration <= 0) {
                          currentGlobalFrames[i] = 0
                          continue
                        }

                        let nextFrame = currentFrameInGlobalSeq % duration
                        if (nextFrame < 0) {
                          nextFrame += duration
                        }
                        if (nextFrame === 0 && currentFrameInGlobalSeq > 0) {
                          nextFrame = duration
                        }
                        currentGlobalFrames[i] = nextFrame
                      }
                    }
                    const ribbonsController = (mdlRenderer as any)?.modelInstance?.ribbonsController
                    if (ribbonsController && typeof ribbonsController.resetEmitters === 'function') {
                      ribbonsController.resetEmitters()
                    }

                    // Keep renderer exactly on requested timeline position.
                    mdlRenderer.rendererData.frame = targetFrame
                    mdlRenderer.update(0)

                    // [Ultrathink] Deterministic stateless reverse-construction for Ribbons:
                    // Bypass the error-prone accumulated simulation path and pull out
                    // the exact mathematical node trajectory from history to shape the ribbon instantly.
                    if (ribbonsController && typeof ribbonsController.buildHistoryAt === 'function') {
                      ribbonsController.buildHistoryAt(targetFrame)
                    }

                    currentFrame = Number(mdlRenderer.rendererData.frame ?? targetFrame)
                    simulatedTimelineStep = true
                    frameCacheRef.current = currentFrame
                    needsRendererUpdateRef.current = false
                  } else {
                    mdlRenderer.rendererData.frame = storeFrame
                    currentFrame = storeFrame
                    forceFrameRefresh = true
                  }
                }
              } else {
                if (Math.abs(storeFrame - currentFrame) > 0.1) {
                  useModelStore.getState().setFrame(currentFrame)
                }
              }
            }

            // 使用 ref 替代 window 全局变量，避免污染和潜在冲突
            const lastFrame = frameCacheRef.current

            const needsUpdate = needsRendererUpdateRef.current || forceFrameRefresh
            if (!simulatedTimelineStep && (gizmoDragging || needsUpdate || currentFrame !== lastFrame)) {
              // Update with delta=0 to refresh bone matrices without advancing animation
              mdlRenderer.update(0)
              frameCacheRef.current = currentFrame
              needsRendererUpdateRef.current = false

              // NOTE:
              // Do not reset ribbon history every frame during keyframe dragging.
              // In paused keyframe mode we call update(0), which means no new ribbon
              // points are emitted; per-frame reset would immediately clear all ribbons.
            }

            // In animation mode, timeline/store is authoritative (store -> renderer).
            // Do not write renderer frame back to store here, otherwise it fights timeline
            // dragging and can lock scrubbing around the first processed frame.
          }
          const updateMs = performance.now() - stageStart
          const sceneStageStart = performance.now()
          let sceneMs = 0
          let overlayStageStart = sceneStageStart


          // === Camera Frustum Rendering ===
          if (gl && showCamerasRef.current) {
            const cameraNodes = getAvailableCameras();

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

            // === DNC Environment Lighting Update ===
            const envManager = getEnvironmentManager()
            if (envManager.isEnabled()) {
              envManager.update(delta)
              const envParams = envManager.getLightParams()
              if ((mdlRenderer as any).setEnvironmentLight) {
                (mdlRenderer as any).setEnvironmentLight(
                  envParams.lightDirection,
                  envParams.lightColor,
                  envParams.ambientColor
                )
              }
            }

            // === Global Transform Preview Injection ===
            // Apply previewMatrix to mvMatrix instead of individual bone matrices.
            // This ensures:
            // 1. Mesh moves correctly (mvMatrix affects final view position)
            // 2. Particles move in real-time (rendered with same mvMatrix)
            // 3. Skeleton visualization moves together (uses same mvMatrix)
            // 4. Skinning is preserved (bone matrices remain untouched)
            if (isGlobalTransformMode) {
              const previewMatrix = mat4.create()
              const rotQuat = quat.create()
              // quat.fromEuler expects degrees
              quat.fromEuler(rotQuat, previewTransform.rotation[0], previewTransform.rotation[1], previewTransform.rotation[2])
              const rotScale = mat4.create()
              mat4.fromRotationTranslationScale(rotScale, rotQuat, [0, 0, 0], previewTransform.scale)
              mat4.translate(previewMatrix, previewMatrix, previewTransform.translation)
              mat4.translate(previewMatrix, previewMatrix, globalPivot as [number, number, number])
              mat4.multiply(previewMatrix, previewMatrix, rotScale)
              mat4.translate(previewMatrix, previewMatrix, [-globalPivot[0], -globalPivot[1], -globalPivot[2]])

              // Apply to mvMatrix - transforms the entire rendered scene including mesh, particles, skeleton
              mat4.multiply(mvMatrix, mvMatrix, previewMatrix)
            }

            const { gridSettings, showGridXY, showGridXZ, showGridYZ } = useRendererStore.getState()

            const renderOpts = {
              wireframe: showWireframeRef.current,
              enableLighting: enableLightingRef.current
            } as any

            // WebGL render
            // Runtime toggles for particles/ribbons share the same state as ViewSettings.
            const modelInstance = (mdlRenderer as any)?.modelInstance
            const particlesController = modelInstance?.particlesController
            const ribbonsController = modelInstance?.ribbonsController
            const noopRender = () => { }
            // Keep ribbon visibility behavior consistent with autoplay while scrubbing.
            // Forcing preview visibility makes first-frame and paused results diverge.
            const forceRibbonPreviewVisibility = false

            const originalParticleRender = particlesController?.render
            const originalParticleRenderGPU = particlesController?.renderGPU
            const originalRibbonRender = ribbonsController?.render
            const originalRibbonRenderGPU = ribbonsController?.renderGPU

            if (ribbonsController && typeof ribbonsController.setPreviewVisibility === 'function') {
              ribbonsController.setPreviewVisibility(forceRibbonPreviewVisibility)
            }

            if (particlesController && !showParticlesRef.current) {
              particlesController.render = noopRender
              particlesController.renderGPU = noopRender
            }
            if (ribbonsController && !showRibbonsRef.current) {
              ribbonsController.render = noopRender
              ribbonsController.renderGPU = noopRender
            }

            try {
              mdlRenderer.render(mvMatrix, pMatrix, renderOpts)
            } finally {
              if (particlesController) {
                particlesController.render = originalParticleRender
                particlesController.renderGPU = originalParticleRenderGPU
              }
              if (ribbonsController) {
                ribbonsController.render = originalRibbonRender
                ribbonsController.renderGPU = originalRibbonRenderGPU
              }
            }

            // === Grid Rendering (Moved AFTER model for correct depth/overlay handling) ===
            if (gl && (showGridXY || showGridXZ || showGridYZ)) {
              gridRenderer.current.updateBuffers(gl as WebGLRenderingContext, gridSettings.gridSize || 2048)
              gridRenderer.current.render(gl as WebGLRenderingContext, baseMvMatrix || mvMatrix, pMatrix, gridSettings, showGridXY, showGridXZ, showGridYZ)
            }


            // === Attachment Point Rendering (Moved AFTER main scene to handle depth/overlay) ===
            if (gl && showAttachmentsRef.current && mdlRenderer.rendererData?.nodes) {
              // Filter nodes that are attachments
              const attachmentNodes = (mdlRenderer.rendererData.nodes as any[]).filter((n: any) =>
                n.node.type === NodeType.ATTACHMENT ||
                n.node.type === 'Attachment' ||
                n.node.AttachmentID !== undefined ||
                n.node.hasOwnProperty('AttachmentID')
              );

              if (attachmentNodes.length > 0) {
                const attachmentPositions: number[] = [];
                const tempPos = vec3.create();

                attachmentNodes.forEach((nodeWrapper: any) => {
                  const matrix = nodeWrapper.matrix || nodeWrapper.worldMatrix;
                  // Handle potential differences in property capitalization
                  const pivot = nodeWrapper.node.PivotPoint || nodeWrapper.node.pivot || [0, 0, 0];

                  if (matrix) {
                    vec3.transformMat4(tempPos, pivot as vec3, matrix);
                    attachmentPositions.push(tempPos[0], tempPos[1], tempPos[2]);
                  }
                });

                if (attachmentPositions.length > 0) {
                  debugRenderer.current.renderSolidTetrahedrons(
                    gl,
                    mvMatrix,
                    pMatrix,
                    attachmentPositions,
                    1.5, // Scale down further
                    (() => {
                      const attachmentHex = useRendererStore.getState().nodeColors?.Attachment || '#ffff00'
                      const [r, g, b] = hexToRgb(attachmentHex)
                      return [r, g, b, 1]
                    })(),
                    false // Disable depth test so points are always visible
                  );
                }
              }
            }

            // Restore original geoset alphas
            if (originalGeosetAlphas.size > 0 && mdlRenderer.rendererData.geosetAlpha) {
              originalGeosetAlphas.forEach((alpha, index) => {
                mdlRenderer.rendererData.geosetAlpha[index] = alpha
              })
            }
            sceneMs = performance.now() - sceneStageStart
            overlayStageStart = performance.now()

            // === Hover Highlight ===
            // If a geoset is hovered, render a highlight overlay using animated (skinned) vertex positions
            if (hoveredGeosetId !== null && mdlRenderer.model.Geosets && mdlRenderer.model.Geosets[hoveredGeosetId]) {
              const geoset = mdlRenderer.model.Geosets[hoveredGeosetId]
              if (geoset && geoset.Faces && geoset.Vertices) {
                // Build skinned vertex positions using bone matrices from rendererData.nodes
                const bindVerts = geoset.Vertices
                const vertCount = bindVerts.length / 3
                let skinnedVerts = bindVerts // fallback to bind pose

                const rendererNodes = mdlRenderer.rendererData?.nodes
                if (rendererNodes && geoset.VertexGroup && geoset.Groups) {
                  const skinned = new Float32Array(bindVerts.length)
                  // Build ObjectId → matrix lookup from rendererData.nodes
                  const nodeMatrixByObjectId = new Map<number, Float32Array | number[]>()
                  for (const nodeWrapper of rendererNodes as any[]) {
                    const objId = nodeWrapper?.node?.ObjectId
                    const mtx = nodeWrapper?.matrix || nodeWrapper?.worldMatrix
                    if (objId !== undefined && mtx) {
                      nodeMatrixByObjectId.set(Number(objId), mtx)
                    }
                  }

                  const tempIn = new Float32Array(3)
                  const tempOut = new Float32Array(3)

                  for (let vi = 0; vi < vertCount; vi++) {
                    const groupIndex = geoset.VertexGroup[vi]
                    const boneIds = geoset.Groups[groupIndex]
                    const bx = bindVerts[vi * 3]
                    const by = bindVerts[vi * 3 + 1]
                    const bz = bindVerts[vi * 3 + 2]

                    if (boneIds && boneIds.length > 0) {
                      // Average transform across all bones in this group
                      let sx = 0, sy = 0, sz = 0
                      let validBones = 0
                      for (const boneId of boneIds) {
                        const mtx = nodeMatrixByObjectId.get(Number(boneId))
                        if (!mtx) continue
                        // mat4 transform: out = M * in (column-major 4x4)
                        const ox = mtx[0] * bx + mtx[4] * by + mtx[8] * bz + mtx[12]
                        const oy = mtx[1] * bx + mtx[5] * by + mtx[9] * bz + mtx[13]
                        const oz = mtx[2] * bx + mtx[6] * by + mtx[10] * bz + mtx[14]
                        sx += ox; sy += oy; sz += oz
                        validBones++
                      }
                      if (validBones > 0) {
                        const inv = 1 / validBones
                        skinned[vi * 3] = sx * inv
                        skinned[vi * 3 + 1] = sy * inv
                        skinned[vi * 3 + 2] = sz * inv
                      } else {
                        skinned[vi * 3] = bx
                        skinned[vi * 3 + 1] = by
                        skinned[vi * 3 + 2] = bz
                      }
                    } else {
                      skinned[vi * 3] = bx
                      skinned[vi * 3 + 1] = by
                      skinned[vi * 3 + 2] = bz
                    }
                  }
                  skinnedVerts = skinned
                }

                const faces = geoset.Faces
                const isWireframeMode = showWireframeRef.current

                if (isWireframeMode && gl && debugRenderer.current) {
                  const linePositions: number[] = []
                  for (let i = 0; i < faces.length; i += 3) {
                    const i1 = faces[i] * 3, i2 = faces[i + 1] * 3, i3 = faces[i + 2] * 3
                    linePositions.push(skinnedVerts[i1], skinnedVerts[i1 + 1], skinnedVerts[i1 + 2], skinnedVerts[i2], skinnedVerts[i2 + 1], skinnedVerts[i2 + 2])
                    linePositions.push(skinnedVerts[i2], skinnedVerts[i2 + 1], skinnedVerts[i2 + 2], skinnedVerts[i3], skinnedVerts[i3 + 1], skinnedVerts[i3 + 2])
                    linePositions.push(skinnedVerts[i3], skinnedVerts[i3 + 1], skinnedVerts[i3 + 2], skinnedVerts[i1], skinnedVerts[i1 + 1], skinnedVerts[i1 + 2])
                  }
                  gl.disable(gl.DEPTH_TEST)
                  debugRenderer.current.renderLines(gl as WebGLRenderingContext, mvMatrix, pMatrix, linePositions, [1, 0, 0, 1])
                  gl.enable(gl.DEPTH_TEST)
                } else {
                  const { hoverColor } = useRendererStore.getState()
                  const hoverColorRgb = hexToRgb(hoverColor)
                  const positions: number[] = []
                  for (let i = 0; i < faces.length; i += 3) {
                    const i1 = faces[i] * 3
                    const i2 = faces[i + 1] * 3
                    const i3 = faces[i + 2] * 3
                    positions.push(
                      skinnedVerts[i1], skinnedVerts[i1 + 1], skinnedVerts[i1 + 2],
                      skinnedVerts[i2], skinnedVerts[i2 + 1], skinnedVerts[i2 + 2],
                      skinnedVerts[i3], skinnedVerts[i3 + 1], skinnedVerts[i3 + 2]
                    )
                  }
                  gl.disable(gl.DEPTH_TEST)
                  debugRenderer.current.renderTriangles(
                    gl as WebGLRenderingContext,
                    mvMatrix,
                    pMatrix,
                    positions,
                    [hoverColorRgb[0], hoverColorRgb[1], hoverColorRgb[2], 1],
                    false
                  )
                  gl.enable(gl.DEPTH_TEST)
                }
              }
            }

            if (nodeRenderModeRef.current !== 'hidden' && mdlRenderer.rendererData.nodes && currentMainMode !== 'geometry') {
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

                    if (boundVertices.length > 0 && showVerticesRef.current) {
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

              const nodeTypeColors = (() => {
                const colors = useRendererStore.getState().nodeColors
                if (!colors) return undefined
                const toRgba = (hex: string): number[] => {
                  const [r, g, b] = hexToRgb(hex)
                  return [r, g, b, 1]
                }
                return {
                  Bone: toRgba(colors.Bone),
                  Helper: toRgba(colors.Helper),
                  Attachment: toRgba(colors.Attachment),
                  ParticleEmitter: toRgba(colors.ParticleEmitter),
                  ParticleEmitter2: toRgba(colors.ParticleEmitter2),
                  RibbonEmitter: toRgba(colors.RibbonEmitter),
                  Light: toRgba(colors.Light),
                  EventObject: toRgba(colors.EventObject),
                  CollisionShape: toRgba(colors.CollisionShape),
                  Camera: toRgba(colors.Camera),
                  ParticleEmitterPopcorn: toRgba(colors.ParticleEmitterPopcorn)
                }
              })()

              const nodeCubeEdgeWorldSize = getScreenStableWorldScale(18, cameraRef.current?.target)
              const nodeSize = (nodeCubeEdgeWorldSize / 4.8) * (useRendererStore.getState().nodeSize ?? 1.0)

              debugRenderer.current.renderNodes(
                gl as WebGLRenderingContext,
                mvMatrix,
                pMatrix,
                mdlRenderer.rendererData.nodes as any,
                selectedNodeIds,
                parentOfSelected,
                childrenOfSelected,
                nodeTypeColors,
                currentMainMode === 'animation' && currentAnimationSubMode === 'keyframe',
                nodeSize,
                nodeRenderModeRef.current === 'wireframe' ? 'wireframe' : 'solid'
              )

              // 粒子发射器2：在视图/动画等模式下显示宽长矩形框与发射方向（与 particles.ts 中局部 +Z 初速一致）
              if (selectedNodeIds.length > 0) {
                try {
                  const storeNodes = useModelStore.getState().nodes as any[]
                  const selectedIdNums = selectedNodeIds
                    .map((id: any) => Number(id))
                    .filter((id: number) => Number.isFinite(id))
                  if (selectedIdNums.length === 0) {
                    // Nothing to visualize.
                  } else {
                    const storeNodeById = new Map<number, any>()
                    for (const n of storeNodes) {
                      const id = Number(n?.ObjectId)
                      if (Number.isFinite(id)) storeNodeById.set(id, n)
                    }
                    const pe2ById = new Map<number, any>()
                    const pe2List = (mdlRenderer.model as any)?.ParticleEmitters2 || []
                    for (const pe of pe2List) {
                      const id = Number(pe?.ObjectId)
                      if (Number.isFinite(id)) pe2ById.set(id, pe)
                    }
                    const frameForParticleBox = Number(mdlRenderer.rendererData?.frame ?? useModelStore.getState().currentFrame ?? 0)
                    const toScalar = (raw: any, fallback: number): number => {
                      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : fallback
                      if (Array.isArray(raw) || ArrayBuffer.isView(raw)) {
                        const n = Number((raw as any)[0])
                        return Number.isFinite(n) ? n : fallback
                      }
                      if (raw && typeof raw === 'object') {
                        const direct = Number(raw.Value ?? raw.value)
                        if (Number.isFinite(direct)) return direct
                      }
                      const n = Number(raw)
                      return Number.isFinite(n) ? n : fallback
                    }
                    const resolveScalarAtFrame = (prop: any, frame: number, fallback: number): number => {
                      if (!prop) return fallback
                      if (typeof prop === 'number' || Array.isArray(prop) || ArrayBuffer.isView(prop)) {
                        return toScalar(prop, fallback)
                      }
                      const keysRaw = prop?.Keys
                      if (!Array.isArray(keysRaw) || keysRaw.length === 0) {
                        return toScalar(prop, fallback)
                      }
                      const keys = keysRaw
                        .filter((k: any) => k && !k._isPreviewKey && Number.isFinite(Number(k.Frame)))
                        .sort((a: any, b: any) => Number(a.Frame) - Number(b.Frame))
                      if (keys.length === 0) return fallback
                      const keyScalar = (k: any) => {
                        const vec = k?.Vector ?? k?.Value
                        return toScalar(vec, fallback)
                      }
                      const target = Number.isFinite(frame) ? frame : Number(keys[0].Frame)
                      if (target <= Number(keys[0].Frame)) return keyScalar(keys[0])
                      const last = keys[keys.length - 1]
                      if (target >= Number(last.Frame)) return keyScalar(last)
                      for (let i = 0; i < keys.length - 1; i++) {
                        const k0 = keys[i]
                        const k1 = keys[i + 1]
                        const f0 = Number(k0.Frame)
                        const f1 = Number(k1.Frame)
                        if (target < f0 || target > f1) continue
                        const span = f1 - f0
                        if (!Number.isFinite(span) || Math.abs(span) < 1e-8) return keyScalar(k1)
                        const t = (target - f0) / span
                        const v0 = keyScalar(k0)
                        const v1 = keyScalar(k1)
                        return v0 + (v1 - v0) * Math.max(0, Math.min(1, t))
                      }
                      return keyScalar(last)
                    }

                    const tempCorner = vec3.create()
                    const pivotWorld = vec3.create()
                    const emitDir = vec3.create()
                    const tipPt = vec3.create()
                    const basePt = vec3.create()
                    const sideA = vec3.create()
                    const sideB = vec3.create()
                    const cornerPt = vec3.create()
                    const tmpDir4 = vec4.create()
                    const localEmitZ = vec4.fromValues(0, 0, 1, 0)
                    const linePositions: number[] = []
                    const minVisualAxis = 2 // Keep tiny Width/Length still visible.
                    const rdNodes = mdlRenderer.rendererData.nodes as any
                    for (const nodeId of selectedIdNums) {
                      const nodeWrapper =
                        rdNodes[nodeId] ??
                        (mdlRenderer.rendererData.nodes as any[]).find((n: any) => Number(n?.node?.ObjectId) === nodeId)
                      const storeNode = storeNodeById.get(nodeId)
                      const pe2Node = pe2ById.get(nodeId)
                      const nodeData = (nodeWrapper?.node || storeNode) as any
                      const nodeType = nodeData?.type || storeNode?.type
                      const isPe2Type = nodeType === NodeType.PARTICLE_EMITTER_2 || nodeType === 'ParticleEmitter2'
                      if (!isPe2Type && !pe2Node) continue

                      const widthProp =
                        pe2Node?.Width ?? pe2Node?.WidthAnim ?? pe2Node?.props?.Width ??
                        nodeData?.Width ?? nodeData?.WidthAnim ?? storeNode?.Width ?? storeNode?.WidthAnim
                      const lengthProp =
                        pe2Node?.Length ?? pe2Node?.LengthAnim ?? pe2Node?.props?.Length ??
                        nodeData?.Length ?? nodeData?.LengthAnim ?? storeNode?.Length ?? storeNode?.LengthAnim
                      const width = Math.abs(resolveScalarAtFrame(widthProp, frameForParticleBox, 0))
                      const length = Math.abs(resolveScalarAtFrame(lengthProp, frameForParticleBox, 0))
                      const halfW = Math.max(width, minVisualAxis) * 0.5
                      const halfL = Math.max(length, minVisualAxis) * 0.5

                      const pivot =
                        nodeData?.PivotPoint ||
                        pe2Node?.PivotPoint ||
                        storeNode?.PivotPoint ||
                        [0, 0, 0]
                      // Match particles.ts: emission uses rendererData.nodes[ObjectId].matrix.
                      const nodeMatrix = (nodeWrapper as any)?.matrix || (nodeWrapper as any)?.worldMatrix
                      if (!nodeMatrix) continue

                      const localCorners: Array<[number, number, number]> = [
                        [pivot[0] - halfW, pivot[1] - halfL, pivot[2]],
                        [pivot[0] + halfW, pivot[1] - halfL, pivot[2]],
                        [pivot[0] + halfW, pivot[1] + halfL, pivot[2]],
                        [pivot[0] - halfW, pivot[1] + halfL, pivot[2]]
                      ]
                      const worldCorners = localCorners.map((c) => {
                        vec3.set(tempCorner, c[0], c[1], c[2])
                        vec3.transformMat4(tempCorner, tempCorner, nodeMatrix)
                        return [tempCorner[0], tempCorner[1], tempCorner[2]] as [number, number, number]
                      })
                      const pushLine = (a: [number, number, number], b: [number, number, number]) => {
                        linePositions.push(a[0], a[1], a[2], b[0], b[1], b[2])
                      }
                      pushLine(worldCorners[0], worldCorners[1])
                      pushLine(worldCorners[1], worldCorners[2])
                      pushLine(worldCorners[2], worldCorners[3])
                      pushLine(worldCorners[3], worldCorners[0])
                      // Cross lines help visibility when the rectangle is small or edge-on.
                      pushLine(worldCorners[0], worldCorners[2])
                      pushLine(worldCorners[1], worldCorners[3])

                      // 发射方向：与 particles.ts createParticle 中 localDirection (0,0,1) 经节点矩阵变换一致
                      vec3.set(tempCorner, pivot[0], pivot[1], pivot[2])
                      vec3.transformMat4(pivotWorld, tempCorner, nodeMatrix)
                      vec4.transformMat4(tmpDir4, localEmitZ, nodeMatrix)
                      vec3.set(emitDir, tmpDir4[0], tmpDir4[1], tmpDir4[2])
                      const dirLen = vec3.length(emitDir)
                      if (dirLen > 1e-6) {
                        vec3.scale(emitDir, emitDir, 1 / dirLen)
                        const arrowLen = Math.max(nodeSize * 0.9, Math.min(halfW, halfL) * 0.65)
                        vec3.scaleAndAdd(tipPt, pivotWorld, emitDir, arrowLen)
                        pushLine(
                          [pivotWorld[0], pivotWorld[1], pivotWorld[2]],
                          [tipPt[0], tipPt[1], tipPt[2]]
                        )
                        const headBack = Math.min(arrowLen * 0.22, halfW * 0.45)
                        vec3.scaleAndAdd(basePt, tipPt, emitDir, -headBack)
                        vec3.set(tempCorner, Math.abs(emitDir[1]) < 0.99 ? 0 : 1, Math.abs(emitDir[1]) < 0.99 ? 1 : 0, 0)
                        vec3.cross(sideA, emitDir, tempCorner)
                        vec3.normalize(sideA, sideA)
                        vec3.cross(sideB, emitDir, sideA)
                        vec3.normalize(sideB, sideB)
                        const hr = headBack * 0.55
                        const headPts: Array<[number, number]> = [[hr, hr], [hr, -hr], [-hr, hr], [-hr, -hr]]
                        for (const [sx, sy] of headPts) {
                          vec3.scaleAndAdd(cornerPt, basePt, sideA, sx)
                          vec3.scaleAndAdd(cornerPt, cornerPt, sideB, sy)
                          pushLine(
                            [tipPt[0], tipPt[1], tipPt[2]],
                            [cornerPt[0], cornerPt[1], cornerPt[2]]
                          )
                        }
                      }
                    }

                    if (linePositions.length > 0) {
                      debugRenderer.current.renderLines(
                        gl as WebGLRenderingContext,
                        mvMatrix,
                        pMatrix,
                        linePositions,
                        [1, 0.35, 0.8, 1]
                      )
                    }
                  }
                } catch (err) {
                  console.error('[Viewer] ParticleEmitter2 gizmo box render failed:', err)
                }
              }

              if (showAttachmentsRef.current) {
                // Render attachment nodes as yellow tetrahedrons
                debugRenderer.current.renderAttachmentNodes(
                gl as WebGLRenderingContext,
                mvMatrix,
                pMatrix,
                mdlRenderer.rendererData.nodes as any,
                selectedNodeIds,
                nodeTypeColors
                )
              }
            }

            if (showSkeletonRef.current && mdlRenderer.rendererData.nodes && currentMainMode !== 'uv') {
              const { selectedNodeIds } = useSelectionStore.getState()
              if (gl) {
                gl.disable(gl.DEPTH_TEST)
                  ; (mdlRenderer as any).renderSkeleton(mvMatrix, pMatrix, null, selectedNodeIds)
                gl.enable(gl.DEPTH_TEST)
              }
            }

            // === Light Object Rendering ===
            if (gl && showLightsRef.current && mdlRenderer.rendererData.nodes) {
              const { nodes } = useModelStore.getState()
              const lightNodes = nodes.filter((n: any) => n && n.type === 'Light')

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

            // === Collision Shape Rendering ===
            if (gl && showCollisionShapesRef.current && mdlRenderer.rendererData.nodes) {
              const collisionNodes = mdlRenderer.rendererData.nodes.filter((n: any) => n.node.hasOwnProperty('Shape') || n.node.type === 'CollisionShape')
              if (collisionNodes.length > 0) {
                const viewMatrix = mvMatrix
                const projectionMatrix = pMatrix
                const nodeMVMatrix = mat4.create()

                collisionNodes.forEach((nodeWrapper: any) => {
                  const node = nodeWrapper.node
                  let worldMatrix = nodeWrapper.worldMatrix || nodeWrapper.matrix || mat4.create()
                  if (!viewMatrix) return
                  mat4.multiply(nodeMVMatrix, viewMatrix, worldMatrix)

                  let isSphere = false
                  if (node.Shape === 2 || node.ShapeType === 'Sphere') {
                    isSphere = true
                  } else if (node.Shape === 0 || node.ShapeType === 'Box') {
                    isSphere = false
                  } else if (node.BoundsRadius && node.BoundsRadius > 0) {
                    isSphere = true
                  }

                  if (isSphere) {
                    let center
                    if (node.Vertices) {
                      if (node.Vertices instanceof Float32Array || (node.Vertices.length === 3 && typeof node.Vertices[0] === 'number')) {
                        center = node.Vertices
                      } else if (node.Vertices.length > 0) {
                        center = node.Vertices[0]
                      }
                    }
                    if (!center) center = node.Vertex1 || [0, 0, 0]
                    const radius = node.BoundsRadius || 0

                    if (center && gl) {
                      debugRenderer.current.renderWireframeSphere(
                        gl as WebGLRenderingContext,
                        nodeMVMatrix,
                        projectionMatrix,
                        radius,
                        center,
                        12, // rows
                        12, // cols
                        [1, 0.5, 0, 1]
                      )
                    }
                  } else {
                    let v1, v2
                    if (node.Vertices) {
                      if (node.Vertices instanceof Float32Array || (typeof node.Vertices[0] === 'number' && node.Vertices.length >= 6)) {
                        v1 = node.Vertices.subarray ? node.Vertices.subarray(0, 3) : node.Vertices.slice(0, 3)
                        v2 = node.Vertices.subarray ? node.Vertices.subarray(3, 6) : node.Vertices.slice(3, 6)
                      } else if (node.Vertices.length >= 2) {
                        v1 = node.Vertices[0]
                        v2 = node.Vertices[1]
                      }
                    }
                    if (!v1) v1 = node.Vertex1
                    if (!v2) v2 = node.Vertex2

                    if (v1 && v2 && gl) {
                      debugRenderer.current.renderWireframeBox(
                        gl as WebGLRenderingContext,
                        nodeMVMatrix,
                        projectionMatrix,
                        v1,
                        v2,
                        [1, 0.5, 0, 1]
                      )
                    }
                  }
                })
              }
            }

          }

          if (gl && (currentMainMode === 'view' ||
            (currentMainMode === 'geometry' && geometrySubMode === 'vertex') ||
            (currentMainMode === 'animation' && currentAnimationSubMode === 'binding'))) {
            // Get geoset visibility state from modelStore
            const { hiddenGeosetIds, forceShowAllGeosets, hoveredGeosetId } = useModelStore.getState()
            // Get color settings from rendererStore
            const { vertexColor, selectionColor, hoverColor } = useRendererStore.getState()
            const vertexColorRgb = hexToRgb(vertexColor)
            const selectionColorRgb = hexToRgb(selectionColor)
            const hoverColorRgb = hexToRgb(hoverColor)

            // gl_PointSize 是屏幕像素。这里保持顶点在大模型/远距离下仍然可见，
            // 只做轻微缩放，避免旧逻辑把点压到接近 1px。
            let pointScale = 1.0
            if (cameraRef.current) {
              if (cameraRef.current.projectionMode === 'orthographic') {
                pointScale = Math.pow(200 / Math.max(1, cameraRef.current.orthoSize), 0.15)
              } else {
                pointScale = Math.pow(400 / Math.max(1, cameraRef.current.distance), 0.15)
              }
            }
            pointScale = Math.max(0.9, Math.min(1.25, pointScale))
            const basePointSize = 4.5 * pointScale
            const hoverPointSize = 7.0 * pointScale
            // 选中顶点只改变颜色，大小与普通顶点一致
            const selectedPointSize = basePointSize

            // Render all visible geoset vertices (only if show vertices is enabled)
            if (showVerticesRef.current) {
              for (let geosetIndex = 0; geosetIndex < mdlRenderer.model.Geosets.length; geosetIndex++) {
                const geoset = mdlRenderer.model.Geosets[geosetIndex]
                if (!geoset.Vertices) continue

                // Skip hidden geosets (based on hiddenGeosetIds from modelStore)
                if (hiddenGeosetIds.includes(geosetIndex) && !forceShowAllGeosets) continue

                // Use different color for hovered geoset vertices
                if (hoveredGeosetId === geosetIndex) {
                  // Hovered geoset: use hover color from settings
                  debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, geoset.Vertices, [...hoverColorRgb, 1], hoverPointSize, vertexSettingsRef.current.enableDepth)
                } else {
                  // Normal geoset: use vertex color from settings
                  debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, geoset.Vertices, [...vertexColorRgb, 0.8], basePointSize, vertexSettingsRef.current.enableDepth)
                }
              }
            }

            if (selectedVertexIds.length > 0 && showVerticesRef.current) {
              const selectedPositions: number[] = []
              const shouldRenderGroupEdges = currentMainMode === 'geometry' && geometrySubMode === 'group'

              if (shouldRenderGroupEdges) {
                const linePositions: number[] = []
                for (const sel of selectedFaceIds) {
                  const geoset = mdlRenderer.model.Geosets[sel.geosetIndex]
                  if (geoset && geoset.Faces && geoset.Vertices) {
                    const verts = geoset.Vertices
                    const fIndex = sel.index * 3
                    const i1 = geoset.Faces[fIndex] * 3
                    const i2 = geoset.Faces[fIndex + 1] * 3
                    const i3 = geoset.Faces[fIndex + 2] * 3
                    linePositions.push(verts[i1], verts[i1 + 1], verts[i1 + 2], verts[i2], verts[i2 + 1], verts[i2 + 2])
                    linePositions.push(verts[i2], verts[i2 + 1], verts[i2 + 2], verts[i3], verts[i3 + 1], verts[i3 + 2])
                    linePositions.push(verts[i3], verts[i3 + 1], verts[i3 + 2], verts[i1], verts[i1 + 1], verts[i1 + 2])
                  }
                }
                gl.disable(gl.DEPTH_TEST)
                debugRenderer.current.renderLines(gl as WebGLRenderingContext, mvMatrix, pMatrix, linePositions, [...selectionColorRgb, 1])
                gl.enable(gl.DEPTH_TEST)
              } else {
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
                debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, selectedPositions, [...selectionColorRgb, 1], selectedPointSize, false)
                gl.enable(gl.DEPTH_TEST)
              }
            }
          }

          if (gl && currentMainMode === 'geometry' && (geometrySubMode === 'face' || geometrySubMode === 'group')) {
            if (selectedFaceIds.length > 0) {
              const { selectionColor } = useRendererStore.getState()
              const selectionColorRgb = hexToRgb(selectionColor)
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
              debugRenderer.current.renderTriangles(
                gl as WebGLRenderingContext,
                mvMatrix,
                pMatrix,
                selectedPositions,
                [1, 0, 0, 0.55],
                false
              )

              const linePositions: number[] = []
              for (let i = 0; i < selectedPositions.length; i += 9) {
                linePositions.push(selectedPositions[i], selectedPositions[i + 1], selectedPositions[i + 2])
                linePositions.push(selectedPositions[i + 3], selectedPositions[i + 4], selectedPositions[i + 5])
                linePositions.push(selectedPositions[i + 3], selectedPositions[i + 4], selectedPositions[i + 5])
                linePositions.push(selectedPositions[i + 6], selectedPositions[i + 7], selectedPositions[i + 8])
                linePositions.push(selectedPositions[i + 6], selectedPositions[i + 7], selectedPositions[i + 8])
                linePositions.push(selectedPositions[i], selectedPositions[i + 1], selectedPositions[i + 2])
              }
              debugRenderer.current.renderLines(
                gl as WebGLRenderingContext,
                mvMatrix,
                pMatrix,
                linePositions,
                [1, 0.35, 0.35, 1],
                false
              )
              gl.enable(gl.DEPTH_TEST)
            }
          }

          if (transformMode) {
            const center = vec3.create()
            let count = 0
            let showGizmo = false

            if (currentMainMode === 'geometry') {
              if ((geometrySubMode === 'vertex' || geometrySubMode === 'group') && selectedVertexIds.length > 0) {
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
                  const nodeWrapper = mdlRenderer.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
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
                    count++;
                    // 更新全局骨骼位置，供 BoneParameterPanel 使用
                    (window as any)._selectedBoneWorldPos = [x, y, z]
                  }
                }
                showGizmo = true
              }
            }
            // 全局变换模式显示 Gizmo
            else if (isGlobalTransformMode) {
              center[0] = globalPivot[0]
              center[1] = globalPivot[1]
              center[2] = globalPivot[2]
              count = 1
              showGizmo = true
            }

            if (gl && showGizmo && count > 0) {
              vec3.scale(center, center, 1.0 / count)

              const gizmoScale = getGizmoScale(center)
              const gizmoOrientation = useRendererStore.getState().gizmoOrientation
              const gizmoBasis = getGizmoBasis(gizmoOrientation)

              gizmoRenderer.current.render(
                gl as WebGLRenderingContext,
                mvMatrix,
                pMatrix,
                center,
                transformMode as any,
                gizmoState.current.activeAxis,
                gizmoScale,
                gizmoBasis
              )
            }
          }

          // Grid already rendered before model for proper depth occlusion

          // Always render the axis indicator in bottom-left corner
          if (gl) {
            axisIndicator.current.render(gl as WebGLRenderingContext, baseMvMatrix || mvMatrix, canvas.width, canvas.height)
          }
          const overlayMs = performance.now() - overlayStageStart

          frameCount.current++
          if (time - lastFpsTime.current >= 1000) {
            setFps(Math.round(frameCount.current * 1000 / (time - lastFpsTime.current)))
            frameCount.current = 0
            lastFpsTime.current = time
          }
          recordFramePerfSample({
            totalMs: performance.now() - framePerfStart,
            clearMs,
            cameraMs,
            stateMs,
            updateMs,
            sceneMs,
            overlayMs,
          }, {
            mainMode: currentMainMode,
            animationSubMode: currentAnimationSubMode,
            transformMode: transformMode || 'none',
            playing: isPlayingRef.current,
          })
          // NOTE: requestAnimationFrame is called AFTER the catch block, not here!
        } catch (e: any) {
          const now = performance.now()
          const shouldReport = now - lastRenderErrorReportTimeRef.current > 1000
          if (shouldReport) {
            lastRenderErrorReportTimeRef.current = now
            const rendererModel = (rendererRef.current as any)?.model
            const materialCount = Array.isArray(rendererModel?.Materials) ? rendererModel.Materials.length : 0
            const textureCount = Array.isArray(rendererModel?.Textures) ? rendererModel.Textures.length : 0
            console.error('[Viewer] Render Loop Crash:', e)
            console.error('[Viewer] Render loop context:', {
              materialCount,
              textureCount,
              currentSequence: (rendererRef.current as any)?.rendererData?.animationInfo?.Name,
              currentFrame: (rendererRef.current as any)?.rendererData?.frame,
            })
          }
          // Keep RAF alive after a bad frame so UI controls and camera never hard-freeze.
          // This allows hot-sync fixes (e.g., texture/material patch) to recover next frame.
          if (runState.shouldRun && scheduleNext && globalRenderLoopId === myLoopId) {
            animationFrameId.current = requestAnimationFrame(render)
          }
          return
        }
        // CRITICAL: Check THIS closure's flag AND singleton ID before scheduling next frame
        if (runState.shouldRun && scheduleNext && globalRenderLoopId === myLoopId) {
          animationFrameId.current = requestAnimationFrame(render)
        }
      }

      renderRef.current = render
      animationFrameId.current = requestAnimationFrame(render)

      return () => {
        // CRITICAL: Set THIS closure's flag to false
        // Only affects this specific render function, not new ones
        console.log('[Viewer] Cleanup: stopping RAF loop for mode:', appMainMode)
        flushFramePerfSummary('cleanup', true)
        runState.shouldRun = false
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current)
          animationFrameId.current = null
        }
      }
    }
    return undefined
    // PERFORMANCE: animationSubMode is read via getState() inside render, so don't include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, appMainMode, animationIndex, flushFramePerfSummary, recordFramePerfSample])

  useEffect(() => {
    // Guard: Only set sequence if renderer is fully initialized with valid rendererData
    // NOTE: Don't require animationInfo to be set - it gets set BY setSequence!
    // Requiring it creates chicken-and-egg problem where animation never starts.
    if (renderer && renderer.rendererData && typeof (renderer as any).setSequence === 'function') {
      const hasSequences = !!renderer.model?.Sequences?.length
      if (hasSequences && animationIndex >= 0) {
        ; (renderer as any).setSequence(animationIndex)
      } else {
        renderer.rendererData.frame = 0
      }
    }
  }, [renderer, animationIndex])

  useEffect(() => {
    if (appMainMode === 'geometry' && renderer) {
      if (renderer.rendererData) {
        renderer.rendererData.frame = 0
      }
    }
  }, [appMainMode, renderer])

  const getModelCenter = (): [number, number, number] => {
    const modelData = useModelStore.getState().modelData as any
    const min = modelData?.Info?.MinimumExtent
    const max = modelData?.Info?.MaximumExtent
    const minX = Number(min?.[0])
    const minY = Number(min?.[1])
    const minZ = Number(min?.[2])
    const maxX = Number(max?.[0])
    const maxY = Number(max?.[1])
    const maxZ = Number(max?.[2])
    if (
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(minZ) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY) &&
      Number.isFinite(maxZ)
    ) {
      return [
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        minZ
      ]
    }

    const renderer = rendererRef.current
    const rendererNodes = renderer?.rendererData?.nodes
    if (Array.isArray(rendererNodes) && rendererNodes.length > 0) {
      let nodeMinX = Number.POSITIVE_INFINITY
      let nodeMinY = Number.POSITIVE_INFINITY
      let nodeMinZ = Number.POSITIVE_INFINITY
      let nodeMaxX = Number.NEGATIVE_INFINITY
      let nodeMaxY = Number.NEGATIVE_INFINITY
      let nodeMaxZ = Number.NEGATIVE_INFINITY
      let count = 0

      for (const nodeWrapper of rendererNodes) {
        const matrix = nodeWrapper?.matrix
        if (!matrix) continue

        let pivot = nodeWrapper?.node?.PivotPoint
        const objectId = Number(nodeWrapper?.node?.ObjectId)
        if ((!pivot || pivot.length < 3) && Number.isInteger(objectId)) {
          pivot = renderer?.model?.PivotPoints?.[objectId]
        }

        const px = Number(pivot?.[0] ?? 0)
        const py = Number(pivot?.[1] ?? 0)
        const pz = Number(pivot?.[2] ?? 0)
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue

        const x = matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12]
        const y = matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13]
        const z = matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14]
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

        nodeMinX = Math.min(nodeMinX, x)
        nodeMinY = Math.min(nodeMinY, y)
        nodeMinZ = Math.min(nodeMinZ, z)
        nodeMaxX = Math.max(nodeMaxX, x)
        nodeMaxY = Math.max(nodeMaxY, y)
        nodeMaxZ = Math.max(nodeMaxZ, z)
        count++
      }

      if (count > 0) {
        return [
          (nodeMinX + nodeMaxX) * 0.5,
          (nodeMinY + nodeMaxY) * 0.5,
          nodeMinZ
        ]
      }
    }

    const pivotPoints = modelData?.PivotPoints
    if (Array.isArray(pivotPoints) && pivotPoints.length > 0) {
      let pivotMinX = Number.POSITIVE_INFINITY
      let pivotMinY = Number.POSITIVE_INFINITY
      let pivotMinZ = Number.POSITIVE_INFINITY
      let pivotMaxX = Number.NEGATIVE_INFINITY
      let pivotMaxY = Number.NEGATIVE_INFINITY
      let pivotMaxZ = Number.NEGATIVE_INFINITY
      let count = 0

      for (const pivot of pivotPoints) {
        const x = Number(pivot?.[0])
        const y = Number(pivot?.[1])
        const z = Number(pivot?.[2])
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

        pivotMinX = Math.min(pivotMinX, x)
        pivotMinY = Math.min(pivotMinY, y)
        pivotMinZ = Math.min(pivotMinZ, z)
        pivotMaxX = Math.max(pivotMaxX, x)
        pivotMaxY = Math.max(pivotMaxY, y)
        pivotMaxZ = Math.max(pivotMaxZ, z)
        count++
      }

      if (count > 0) {
        return [
          (pivotMinX + pivotMaxX) * 0.5,
          (pivotMinY + pivotMaxY) * 0.5,
          pivotMinZ
        ]
      }
    }

    return [0, 0, 0]
  }

  const toNumberArray = (v: any, fallback: number[]): number[] => {
    if (!v) return [...fallback]
    if (typeof v.length === 'number' && v.length === 0) return [...fallback]
    const arr = Array.isArray(v) ? [...v] : Array.from(v) as number[]
    if (!arr || arr.length === 0) return [...fallback]

    // Keep shape stable and avoid propagating NaN/Infinity into keyframes.
    return fallback.map((def, idx) => {
      const n = Number(arr[idx])
      return Number.isFinite(n) ? n : def
    })
  }

  const normalizeQuatSafe = (q: number[]): number[] => {
    const x = Number(q[0])
    const y = Number(q[1])
    const z = Number(q[2])
    const w = Number(q[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w)) {
      return [0, 0, 0, 1]
    }
    const len = Math.hypot(x, y, z, w)
    if (!Number.isFinite(len) || len < 1e-8) {
      return [0, 0, 0, 1]
    }
    return [x / len, y / len, z / len, w / len]
  }

  const sanitizeTransformValue = (
    propertyName: 'Translation' | 'Rotation' | 'Scaling',
    value: any,
    defaultVal: number[]
  ): number[] => {
    const base = toNumberArray(value, defaultVal)
    if (propertyName === 'Rotation') {
      return normalizeQuatSafe(base)
    }
    // Translation / Scaling: just guarantee finite values and stable length.
    return base
  }

  const interpolateValueAtFrame = (keys: any[] | undefined, frame: number, defaultVal: number[]): number[] => {
    if (!keys || keys.length === 0) return defaultVal
    const filtered = keys.filter((k: any) => !k?._isPreviewKey)
    if (filtered.length === 0) return defaultVal
    const sorted = [...filtered].sort((a: any, b: any) => a.Frame - b.Frame)
    if (frame <= sorted[0].Frame) return toNumberArray(sorted[0].Vector, defaultVal)
    if (frame >= sorted[sorted.length - 1].Frame) return toNumberArray(sorted[sorted.length - 1].Vector, defaultVal)
    for (let i = 0; i < sorted.length - 1; i++) {
      if (frame >= sorted[i].Frame && frame <= sorted[i + 1].Frame) {
        const startFrame = Number(sorted[i].Frame)
        const endFrame = Number(sorted[i + 1].Frame)
        const span = endFrame - startFrame
        if (!Number.isFinite(span) || Math.abs(span) < 1e-8) {
          return toNumberArray(sorted[i + 1].Vector, defaultVal)
        }
        const tRaw = (frame - startFrame) / span
        const t = Math.max(0, Math.min(1, tRaw))
        const from = toNumberArray(sorted[i].Vector, defaultVal)
        const to = toNumberArray(sorted[i + 1].Vector, defaultVal)
        return from.map((v, idx) => v + (to[idx] - v) * t)
      }
    }
    return defaultVal
  }

  const getOrCreateNodePivot = (nodeWrapper: any): Float32Array | number[] | null => {
    if (!nodeWrapper?.node || typeof nodeWrapper.node.ObjectId !== 'number') return null
    let pivot = nodeWrapper.node.PivotPoint as any
    const model = rendererRef.current?.model
    if (model && !model.PivotPoints) {
      model.PivotPoints = []
    }
    const pivots = model?.PivotPoints
    if (!pivot && pivots) {
      pivot = pivots[nodeWrapper.node.ObjectId]
    }
    if (!pivot && pivots) {
      pivot = new Float32Array([0, 0, 0])
      pivots[nodeWrapper.node.ObjectId] = pivot
    }
    if (pivot && !nodeWrapper.node.PivotPoint) {
      nodeWrapper.node.PivotPoint = pivot
    }
    return pivot ?? null
  }

  const computeCurrentGizmoCenter = (): { center: vec3, count: number, show: boolean } => {
    const { mainMode, selectedVertexIds, selectedFaceIds, geometrySubMode, selectedNodeIds, isGlobalTransformMode } = useSelectionStore.getState()
    const center = vec3.create()
    let count = 0
    let show = false

    if (!rendererRef.current) {
      return { center, count, show }
    }

    if (mainMode === 'geometry') {
      if ((geometrySubMode === 'vertex' || geometrySubMode === 'group') && selectedVertexIds.length > 0) {
        for (const sel of selectedVertexIds) {
          const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
          if (!geoset?.Vertices) continue
          const vIndex = sel.index * 3
          center[0] += geoset.Vertices[vIndex]
          center[1] += geoset.Vertices[vIndex + 1]
          center[2] += geoset.Vertices[vIndex + 2]
          count++
        }
        show = true
      } else if (geometrySubMode === 'face' && selectedFaceIds.length > 0) {
        const expandedFaceSelection = getExpandedFaceVertexSelection(selectedFaceIds as Array<{ geosetIndex: number; index: number }>)
        for (const sel of expandedFaceSelection) {
          const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
          if (!geoset?.Vertices) continue
          const vIndex = sel.index * 3
          center[0] += geoset.Vertices[vIndex]
          center[1] += geoset.Vertices[vIndex + 1]
          center[2] += geoset.Vertices[vIndex + 2]
          count++
        }
        show = expandedFaceSelection.length > 0
      }
    } else if (mainMode === 'animation' && selectedNodeIds.length > 0) {
      show = true
      for (const nodeId of selectedNodeIds) {
        const nodeWrapper = rendererRef.current.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
        if (!nodeWrapper?.matrix) continue
        let pivot = [0, 0, 0]
        if (nodeWrapper.node && nodeWrapper.node.PivotPoint) {
          pivot = nodeWrapper.node.PivotPoint
        } else if (rendererRef.current.model.PivotPoints && rendererRef.current.model.PivotPoints[nodeId]) {
          pivot = rendererRef.current.model.PivotPoints[nodeId]
        }
        const matrix = nodeWrapper.matrix
        center[0] += matrix[0] * pivot[0] + matrix[4] * pivot[1] + matrix[8] * pivot[2] + matrix[12]
        center[1] += matrix[1] * pivot[0] + matrix[5] * pivot[1] + matrix[9] * pivot[2] + matrix[13]
        center[2] += matrix[2] * pivot[0] + matrix[6] * pivot[1] + matrix[10] * pivot[2] + matrix[14]
        count++
      }
    } else if (isGlobalTransformMode) {
      const pivot = getModelCenter()
      center[0] = pivot[0]
      center[1] = pivot[1]
      center[2] = pivot[2]
      count = 1
      show = true
    }

    if (count > 0) {
      vec3.scale(center, center, 1.0 / count)
    }

    return { center, count, show }
  }

  const handleMouseMove = (e: any) => {
    // 1. Gizmo Dragging
    const { transformMode, mainMode, animationSubMode: subMode, isGlobalTransformMode } = useSelectionStore.getState()

    // --- Calculate Gizmo Center (Hoisted) ---
    // We need center for Ray-Plane intersection in drag mode
    const gizmoInfo = computeCurrentGizmoCenter()
    let gizmoCenter = gizmoInfo.center
    let gizmoCount = gizmoInfo.count
    let showGizmo = gizmoInfo.show
    if (gizmoState.current.isDragging && gizmoState.current.dragCenter) {
      gizmoCenter = vec3.clone(gizmoState.current.dragCenter)
      gizmoCount = 1
      showGizmo = true
    }
    // ----------------------------------------

    if (gizmoState.current.isDragging && gizmoState.current.activeAxis && rendererRef.current) {
      const deltaX = e.clientX - mouseState.current.lastMouseX
      const deltaY = e.clientY - mouseState.current.lastMouseY
      mouseState.current.lastMouseX = e.clientX
      mouseState.current.lastMouseY = e.clientY
      const axis = gizmoState.current.activeAxis

      // Allowed modes for Gizmo dragging
      if (!isGlobalTransformMode &&
        mainMode !== 'geometry' &&
        !(mainMode === 'animation' && (subMode === 'binding' || subMode === 'keyframe'))) {
        return
      }

      const { theta, phi, distance } = targetCamera.current
      // Use pre-allocated vectors to avoid GC pressure
      const vecs = mouseMoveVecs.current
      vec3.set(vecs.forward, Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
      vec3.cross(vecs.right, vecs.forward, vecs.up)
      vec3.normalize(vecs.right, vecs.right)
      vec3.cross(vecs.camUp, vecs.right, vecs.forward)
      vec3.normalize(vecs.camUp, vecs.camUp)
      const gizmoOrientation = useRendererStore.getState().gizmoOrientation
      const axisBasis = gizmoOrientation === 'camera'
        ? { x: vecs.right, y: vecs.camUp, z: vecs.forward }
        : { x: vec3.fromValues(1, 0, 0), y: vec3.fromValues(0, 1, 0), z: vec3.fromValues(0, 0, 1) }
      const axisX = axisBasis.x
      const axisY = axisBasis.y
      const axisZ = axisBasis.z

      const canvas = canvasRef.current
      const hasCanvas = !!canvas && canvas.width > 0 && canvas.height > 0
      const viewSize =
        cameraRef.current?.projectionMode === 'orthographic'
          ? cameraRef.current.orthoSize
          : distance
      const aspect = hasCanvas ? canvas!.width / canvas!.height : 1
      const moveScaleX = hasCanvas ? (viewSize * aspect * 2) / canvas!.width : distance * 0.005
      const moveScaleY = hasCanvas ? (viewSize * 2) / canvas!.height : distance * 0.005

      // Standard Camera-Plane Delta (screen-to-world)
      vec3.zero(vecs.worldMoveDelta)
      vec3.scaleAndAdd(vecs.worldMoveDelta, vecs.worldMoveDelta, vecs.right, deltaX * moveScaleX)
      vec3.scaleAndAdd(vecs.worldMoveDelta, vecs.worldMoveDelta, vecs.camUp, -deltaY * moveScaleY)

      const getViewMatrices = () => {
        if (!hasCanvas) return null
        const pMatrix = mat4.create()
        const mvMatrix = mat4.create()
        if (cameraRef.current) {
          cameraRef.current.getMatrix(mvMatrix, pMatrix)
        } else {
          const { distance, theta, phi, target } = targetCamera.current
          const cx = distance * Math.sin(phi) * Math.cos(theta)
          const cy = distance * Math.sin(phi) * Math.sin(theta)
          const cz = distance * Math.cos(phi)
          const cameraPos = vec3.fromValues(cx, cy, cz)
          vec3.add(cameraPos, cameraPos, target)
          mat4.perspective(pMatrix, Math.PI / 4, canvas!.width / canvas!.height, 1, 5000)
          const cameraUp = vec3.fromValues(0, 0, 1)
          mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
        }
        return { mvMatrix, pMatrix }
      }

      const viewMatrices = getViewMatrices()

      const projectToScreen = (point: vec3) => {
        if (!viewMatrices || !hasCanvas) return null
        const v4 = vec4.fromValues(point[0], point[1], point[2], 1.0)
        const clip = vec4.create()
        vec4.transformMat4(clip, v4, viewMatrices.mvMatrix)
        vec4.transformMat4(clip, clip, viewMatrices.pMatrix)
        if (clip[3] === 0) return null
        const ndcX = clip[0] / clip[3]
        const ndcY = clip[1] / clip[3]
        const screenX = (ndcX * 0.5 + 0.5) * canvas!.width
        const screenY = (1 - (ndcY * 0.5 + 0.5)) * canvas!.height
        return [screenX, screenY] as [number, number]
      }

      const getRay = (sx: number, sy: number) => {
        if (!viewMatrices || !hasCanvas) return null
        const ndcX = (sx / canvas!.width) * 2 - 1
        const ndcY = -((sy / canvas!.height) * 2 - 1)
        const invProj = mat4.create(); mat4.invert(invProj, viewMatrices.pMatrix)
        const invView = mat4.create(); mat4.invert(invView, viewMatrices.mvMatrix)
        const rayClipNear = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
        const rayClipFar = vec4.fromValues(ndcX, ndcY, 1.0, 1.0)
        const rayEyeNear = vec4.create(); vec4.transformMat4(rayEyeNear, rayClipNear, invProj)
        const rayEyeFar = vec4.create(); vec4.transformMat4(rayEyeFar, rayClipFar, invProj)
        if (rayEyeNear[3] !== 0) vec4.scale(rayEyeNear, rayEyeNear, 1.0 / rayEyeNear[3])
        if (rayEyeFar[3] !== 0) vec4.scale(rayEyeFar, rayEyeFar, 1.0 / rayEyeFar[3])
        const rayWorldNear = vec4.create(); vec4.transformMat4(rayWorldNear, rayEyeNear, invView)
        const rayWorldFar = vec4.create(); vec4.transformMat4(rayWorldFar, rayEyeFar, invView)
        const origin = vec3.fromValues(rayWorldNear[0], rayWorldNear[1], rayWorldNear[2])
        const target = vec3.fromValues(rayWorldFar[0], rayWorldFar[1], rayWorldFar[2])
        const dir = vec3.create(); vec3.subtract(dir, target, origin); vec3.normalize(dir, dir)
        return { origin, dir }
      }

      let singleAxisWorldDelta: vec3 | null = null
      const isSingleAxis = axis === 'x' || axis === 'y' || axis === 'z'
      if (isSingleAxis && gizmoCount > 0) {
        const axisDir = axis === 'x' ? axisX : axis === 'y' ? axisY : axisZ
        const axisDotView = vec3.dot(axisDir, vecs.forward)

        let axisScreenSign = 0
        if (viewMatrices && hasCanvas) {
          const centerScreen = projectToScreen(gizmoCenter)
          const axisEnd = vec3.create(); vec3.add(axisEnd, gizmoCenter, axisDir)
          const endScreen = projectToScreen(axisEnd)
          if (centerScreen && endScreen) {
            const dirX = endScreen[0] - centerScreen[0]
            const dirY = endScreen[1] - centerScreen[1]
            const len = Math.hypot(dirX, dirY)
            if (len > 0.001) {
              const dot = dirX * deltaX + dirY * deltaY
              axisScreenSign = dot >= 0 ? 1 : -1
            }
          }
        }

        if (Math.abs(axisDotView) > 0.95) {
          const axisSign = axisDotView < 0 ? 1 : -1
          let axisDelta = -deltaY * moveScaleY * axisSign
          if (axisScreenSign !== 0) axisDelta = axisScreenSign * Math.abs(axisDelta)
          singleAxisWorldDelta = vec3.create()
          vec3.scale(singleAxisWorldDelta, axisDir, axisDelta)
        } else {
          const rayCurr = getRay(e.clientX, e.clientY)
          const rayPrev = getRay(e.clientX - deltaX, e.clientY - deltaY)
          if (rayCurr && rayPrev) {
            const candidates: vec3[] = []
            const n1 = vec3.create(); vec3.cross(n1, axisDir, vecs.forward)
            if (vec3.length(n1) > 0.0001) candidates.push(n1)
            const n2 = vec3.create(); vec3.cross(n2, axisDir, vecs.camUp)
            if (vec3.length(n2) > 0.0001) candidates.push(n2)
            const n3 = vec3.create(); vec3.cross(n3, axisDir, vecs.right)
            if (vec3.length(n3) > 0.0001) candidates.push(n3)

            let bestNormal: vec3 | null = null
            let bestDenom = 0
            for (const n of candidates) {
              vec3.normalize(n, n)
              const denomCurr = Math.abs(vec3.dot(rayCurr.dir, n))
              const denomPrev = Math.abs(vec3.dot(rayPrev.dir, n))
              const denom = Math.min(denomCurr, denomPrev)
              if (denom > bestDenom) {
                bestDenom = denom
                bestNormal = n
              }
            }

            if (bestNormal && bestDenom > 0.0001) {
              const diffCurr = vec3.create()
              vec3.sub(diffCurr, gizmoCenter, rayCurr.origin)
              const tCurr = vec3.dot(diffCurr, bestNormal) / vec3.dot(rayCurr.dir, bestNormal)
              const hitCurr = vec3.create()
              vec3.scaleAndAdd(hitCurr, rayCurr.origin, rayCurr.dir, tCurr)

              const diffPrev = vec3.create()
              vec3.sub(diffPrev, gizmoCenter, rayPrev.origin)
              const tPrev = vec3.dot(diffPrev, bestNormal) / vec3.dot(rayPrev.dir, bestNormal)
              const hitPrev = vec3.create()
              vec3.scaleAndAdd(hitPrev, rayPrev.origin, rayPrev.dir, tPrev)

              const delta = vec3.create()
              vec3.sub(delta, hitCurr, hitPrev)
              let axisDelta = vec3.dot(delta, axisDir)
              if (axisScreenSign !== 0) axisDelta = axisScreenSign * Math.abs(axisDelta)
              singleAxisWorldDelta = vec3.create()
              vec3.scale(singleAxisWorldDelta, axisDir, axisDelta)
            }
          }
        }
      }

      // Precise Ray-Plane Delta (For Dual Axis)
      if (['xy', 'xz', 'yz'].includes(axis) && gizmoCount > 0) {
        const planeNormal = vec3.create()
        if (axis === 'xy') vec3.copy(planeNormal, axisZ)
        else if (axis === 'xz') vec3.copy(planeNormal, axisY)
        else if (axis === 'yz') vec3.copy(planeNormal, axisX)

        const rayCurr = getRay(e.clientX, e.clientY)
        const rayPrev = getRay(e.clientX - deltaX, e.clientY - deltaY)
        if (!rayCurr || !rayPrev) return

        const denomCurr = vec3.dot(rayCurr.dir, planeNormal)
        const denomPrev = vec3.dot(rayPrev.dir, planeNormal)

        // Only process if not parallel
        if (Math.abs(denomCurr) > 0.0001 && Math.abs(denomPrev) > 0.0001) {
          const diffCurr = vec3.create()
          vec3.sub(diffCurr, gizmoCenter, rayCurr.origin)
          const tCurr = vec3.dot(diffCurr, planeNormal) / denomCurr

          const hitCurr = vec3.create()
          vec3.scaleAndAdd(hitCurr, rayCurr.origin, rayCurr.dir, tCurr)

          const diffPrev = vec3.create()
          vec3.sub(diffPrev, gizmoCenter, rayPrev.origin)
          const tPrev = vec3.dot(diffPrev, planeNormal) / denomPrev

          const hitPrev = vec3.create()
          vec3.scaleAndAdd(hitPrev, rayPrev.origin, rayPrev.dir, tPrev)

          vec3.sub(vecs.worldMoveDelta, hitCurr, hitPrev)
        }
      }

      const { snapTranslateEnabled, snapTranslateStep, snapRotateEnabled, snapRotateStep } = useRendererStore.getState()
      const applyTranslateSnap = (moveVec: vec3) => {
        if (!snapTranslateEnabled || snapTranslateStep <= 0) return
        const snap = snapDragRef.current
        for (let i = 0; i < 3; i++) {
          snap.translationDelta[i] += moveVec[i]
          const snapped = Math.round(snap.translationDelta[i] / snapTranslateStep) * snapTranslateStep
          const delta = snapped - snap.translationApplied[i]
          moveVec[i] = delta
          snap.translationApplied[i] = snapped
        }
      }
      const applyRotateSnapDeg = (axisKey: 'x' | 'y' | 'z', angleDeg: number) => {
        if (!snapRotateEnabled || snapRotateStep <= 0) return angleDeg
        const snap = snapDragRef.current
        const idx = axisKey === 'x' ? 0 : axisKey === 'y' ? 1 : 2
        snap.rotationDelta[idx] += angleDeg
        const snapped = Math.round(snap.rotationDelta[idx] / snapRotateStep) * snapRotateStep
        const delta = snapped - snap.rotationApplied[idx]
        snap.rotationApplied[idx] = snapped
        return delta
      }
      const buildMoveVec = (axisKey: GizmoAxis) => {
        vec3.zero(vecs.moveVec)
        if (singleAxisWorldDelta) {
          vec3.copy(vecs.moveVec, singleAxisWorldDelta)
          return vecs.moveVec
        }
        if (axisKey === 'x') {
          const d = vec3.dot(vecs.worldMoveDelta, axisX)
          vec3.scale(vecs.moveVec, axisX, -d)
        } else if (axisKey === 'y') {
          const d = vec3.dot(vecs.worldMoveDelta, axisY)
          vec3.scale(vecs.moveVec, axisY, d)
        } else if (axisKey === 'z') {
          const d = vec3.dot(vecs.worldMoveDelta, axisZ)
          vec3.scale(vecs.moveVec, axisZ, d)
        } else if (axisKey === 'xy') {
          const dx = vec3.dot(vecs.worldMoveDelta, axisX)
          const dy = vec3.dot(vecs.worldMoveDelta, axisY)
          vec3.scale(vecs.moveVec, axisX, dx)
          vec3.scaleAndAdd(vecs.moveVec, vecs.moveVec, axisY, dy)
        } else if (axisKey === 'xz') {
          const dx = vec3.dot(vecs.worldMoveDelta, axisX)
          const dz = vec3.dot(vecs.worldMoveDelta, axisZ)
          vec3.scale(vecs.moveVec, axisX, dx)
          vec3.scaleAndAdd(vecs.moveVec, vecs.moveVec, axisZ, dz)
        } else if (axisKey === 'yz') {
          const dy = vec3.dot(vecs.worldMoveDelta, axisY)
          const dz = vec3.dot(vecs.worldMoveDelta, axisZ)
          vec3.scale(vecs.moveVec, axisY, dy)
          vec3.scaleAndAdd(vecs.moveVec, vecs.moveVec, axisZ, dz)
        }
        return vecs.moveVec
      }
      const applyScaleInBasis = (v: Float32Array, i: number, scaleVec: vec3, center: vec3) => {
        const p = vec3.fromValues(v[i] - center[0], v[i + 1] - center[1], v[i + 2] - center[2])
        const lx = vec3.dot(p, axisX)
        const ly = vec3.dot(p, axisY)
        const lz = vec3.dot(p, axisZ)
        const sx = lx * scaleVec[0]
        const sy = ly * scaleVec[1]
        const sz = lz * scaleVec[2]
        const scaled = vec3.create()
        vec3.scale(scaled, axisX, sx)
        vec3.scaleAndAdd(scaled, scaled, axisY, sy)
        vec3.scaleAndAdd(scaled, scaled, axisZ, sz)
        v[i] = center[0] + scaled[0]
        v[i + 1] = center[1] + scaled[1]
        v[i + 2] = center[2] + scaled[2]
      }
      const applyHudTranslate = (moveVec: vec3) => {
        const hud = gizmoHudRef.current
        hud.translation[0] += moveVec[0]
        hud.translation[1] += moveVec[1]
        hud.translation[2] += moveVec[2]
        updateHudPosition(e, 'translate')
      }
      const applyHudRotate = (axisKey: 'x' | 'y' | 'z', angleDeg: number) => {
        const hud = gizmoHudRef.current
        const idx = axisKey === 'x' ? 0 : axisKey === 'y' ? 1 : 2
        hud.rotation[idx] += angleDeg
        updateHudPosition(e, 'rotate')
      }
      const applyHudScale = (scaleVec: vec3) => {
        const hud = gizmoHudRef.current
        hud.scale[0] *= scaleVec[0]
        hud.scale[1] *= scaleVec[1]
        hud.scale[2] *= scaleVec[2]
        updateHudPosition(e, 'scale')
      }

      if (isGlobalTransformMode) {
        const previewTransform = previewTransformRef.current

        if (transformMode === 'translate') {
          buildMoveVec(axis)

          applyTranslateSnap(vecs.moveVec)
          applyHudTranslate(vecs.moveVec)
          previewTransform.translation = [
            previewTransform.translation[0] + vecs.moveVec[0],
            previewTransform.translation[1] + vecs.moveVec[1],
            previewTransform.translation[2] + vecs.moveVec[2]
          ]
        } else if (transformMode === 'rotate') {
          let angle = 0
          const rotationSpeed = 2.0
          if (axis === 'x') angle = -deltaY * rotationSpeed
          else if (axis === 'y') angle = -deltaX * rotationSpeed
          else if (axis === 'z') angle = deltaX * rotationSpeed
          if (angle !== 0 && (axis === 'x' || axis === 'y' || axis === 'z')) {
            angle = applyRotateSnapDeg(axis, angle)
          }

          if (axis === 'x' || axis === 'y' || axis === 'z') {
            applyHudRotate(axis, angle)
            if (angle !== 0) {
              const axisVec = axis === 'x' ? axisX : axis === 'y' ? axisY : axisZ
              const deltaQuat = quat.create()
              quat.setAxisAngle(deltaQuat, axisVec, angle * Math.PI / 180)
              const currentQuat = quat.create()
              quat.fromEuler(currentQuat, previewTransform.rotation[0], previewTransform.rotation[1], previewTransform.rotation[2])
              // World-space rotation: delta * current
              quat.multiply(currentQuat, deltaQuat, currentQuat)
              previewTransform.rotation = quatToEulerDeg(currentQuat)
            }
          }
        } else if (transformMode === 'scale') {
          const scaleFactor = 1 + (deltaX - deltaY) * 0.005
          const currentScale = [...previewTransform.scale]
          const scaleVec = vec3.fromValues(1, 1, 1)

          if (axis === 'x') currentScale[0] *= scaleFactor
          else if (axis === 'y') currentScale[1] *= scaleFactor
          else if (axis === 'z') currentScale[2] *= scaleFactor
          else if (axis === 'center') {
            currentScale[0] *= scaleFactor
            currentScale[1] *= scaleFactor
            currentScale[2] *= scaleFactor
          } else if (axis === 'xy') {
            currentScale[0] *= scaleFactor
            currentScale[1] *= scaleFactor
          } else if (axis === 'xz') {
            currentScale[0] *= scaleFactor
            currentScale[2] *= scaleFactor
          } else if (axis === 'yz') {
            currentScale[1] *= scaleFactor
            currentScale[2] *= scaleFactor
          }

          previewTransform.scale = currentScale as [number, number, number]
          if (axis === 'x') scaleVec[0] = scaleFactor
          else if (axis === 'y') scaleVec[1] = scaleFactor
          else if (axis === 'z') scaleVec[2] = scaleFactor
          else if (axis === 'center') vec3.set(scaleVec, scaleFactor, scaleFactor, scaleFactor)
          else if (axis === 'xy') { scaleVec[0] = scaleFactor; scaleVec[1] = scaleFactor }
          else if (axis === 'xz') { scaleVec[0] = scaleFactor; scaleVec[2] = scaleFactor }
          else if (axis === 'yz') { scaleVec[1] = scaleFactor; scaleVec[2] = scaleFactor }

          applyHudScale(scaleVec)
        }

        return
      }

      if (transformMode === 'translate' && mainMode === 'geometry') {
        buildMoveVec(axis)

        applyTranslateSnap(vecs.moveVec)
        applyHudTranslate(vecs.moveVec)
        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()
        const expandedFaceSelection = geometrySubMode === 'face'
          ? getExpandedFaceVertexSelection(selectedFaceIds as Array<{ geosetIndex: number; index: number }>)
          : []
        const affectedGeosets = new Set<number>()

        const updateVertex = (geosetIndex: number, vertexIndex: number, updateFn: (v: Float32Array, idx: number) => void) => {
          if (!rendererRef.current) return
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if (!geoset) return
          updateFn(geoset.Vertices, vertexIndex * 3)
          affectedGeosets.add(geosetIndex)
        }

        const applyToSelection = (updateFn: (v: Float32Array, idx: number) => void) => {
          if (geometrySubMode === 'vertex' || geometrySubMode === 'group') {
            selectedVertexIds.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
          } else if (geometrySubMode === 'face') {
            expandedFaceSelection.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
          }
        }

        applyToSelection((v, i) => {
          v[i] += vecs.moveVec[0]
          v[i + 1] += vecs.moveVec[1]
          v[i + 2] += vecs.moveVec[2]
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
        const { autoKeyframe: _autoKeyframe, currentFrame, nodes, updateNode: _updateNode } = useModelStore.getState()
        buildMoveVec(axis)

        applyTranslateSnap(vecs.moveVec)
        applyHudTranslate(vecs.moveVec)
        const selectedSet = new Set(selectedNodeIds)
        const nodeMap = new Map(nodes.map((n: any) => [n.ObjectId, n]))
        const hasSelectedAncestor = (nodeId: number) => {
          let parentId = nodeMap.get(nodeId)?.Parent
          while (parentId !== undefined && parentId !== null && parentId >= 0) {
            if (selectedSet.has(parentId)) return true
            parentId = nodeMap.get(parentId)?.Parent
          }
          return false
        }
        const effectiveNodeIds = subMode === 'keyframe'
          ? selectedNodeIds.filter((id) => !hasSelectedAncestor(id))
          : selectedNodeIds

        if (effectiveNodeIds.length > 0 && rendererRef.current && rendererRef.current.rendererData.nodes) {
          effectiveNodeIds.forEach(nodeId => {
            const nodeWrapper = rendererRef.current!.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
            const pivot = nodeWrapper ? getOrCreateNodePivot(nodeWrapper) : null
            if (nodeWrapper && pivot) {
              let localMoveVec = vec3.fromValues(vecs.moveVec[0], vecs.moveVec[1], vecs.moveVec[2])

              // For keyframe mode: Transform world-space delta to bone's local space
              // Based on mdlvis AbsVectorToTranslation algorithm:
              // Translation is relative to PARENT's coordinate system, not the bone's own rotation
              // So we need to use the PARENT's rotation matrix inverse
              if (subMode === 'keyframe') {
                const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                const parentId = storeNode?.Parent

                if (parentId !== undefined && parentId >= 0) {
                  // Get parent's node wrapper from renderer
                  const parentWrapper = rendererRef.current!.rendererData.nodes.find(
                    (n: any) => n.node.ObjectId === parentId
                  )

                  if (parentWrapper?.matrix) {
                    // Extract parent's rotation part and invert it (transpose for orthonormal)
                    const pm = parentWrapper.matrix as mat4
                    const invParentRot = mat3.fromValues(
                      pm[0], pm[4], pm[8],   // Transpose row 0 = column 0
                      pm[1], pm[5], pm[9],   // Transpose row 1 = column 1
                      pm[2], pm[6], pm[10]   // Transpose row 2 = column 2
                    )

                    // Transform world delta through inverse parent rotation
                    vec3.transformMat3(localMoveVec, localMoveVec, invParentRot)
                  }
                }
                // If no parent (root bone), world delta = local delta (no transformation needed)
              }

              // binding 模式：修改 PivotPoint（静态绑定位置）
              if (subMode === 'binding') {
                pivot[0] += localMoveVec[0]
                pivot[1] += localMoveVec[1]
                pivot[2] += localMoveVec[2]
              }
              // keyframe 模式：累计 delta 并注入临时 Translation 关键帧用于实时预览
              else if (subMode === 'keyframe') {
                // 累积本地偏移到全局变量（用于 MouseUp 时提交）
                if (!(window as any)._keyframeDragDelta) {
                  (window as any)._keyframeDragDelta = {}
                }
                if (!(window as any)._keyframeDragDelta[nodeId]) {
                  (window as any)._keyframeDragDelta[nodeId] = [0, 0, 0]
                }
                (window as any)._keyframeDragDelta[nodeId][0] += localMoveVec[0];
                (window as any)._keyframeDragDelta[nodeId][1] += localMoveVec[1];
                (window as any)._keyframeDragDelta[nodeId][2] += localMoveVec[2];

                // 实时预览：注入临时 Translation 关键帧到渲染模型
                // 使用 baseTranslation + accumulatedDelta 作为预览值
                // baseTranslation 优先使用当前帧的现有关键帧值
                const dragData = keyframeDragData.current
                if (dragData && rendererRef.current) {
                  const delta = (window as any)._keyframeDragDelta[nodeId]
                  const frame = Math.round(currentFrame)

                  // 获取渲染器中的节点
                  const rendererNode = rendererRef.current.model?.Nodes?.find((n: any) => n.ObjectId === nodeId)
                  if (rendererNode) {
                    // 确保 Translation 属性存在，并从 store 复制现有关键帧
                    // 这样渲染器才能正确插值其他帧
                    if (!rendererNode.Translation || !rendererNode.Translation.Keys?.length) {
                      const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                      const storeKeys = storeNode?.Translation?.Keys || []
                      // 深拷贝现有关键帧（不包含预览关键帧）
                      const copiedKeys = storeKeys
                        .filter((k: any) => !k._isPreviewKey)
                        .map((k: any) => ({
                          Frame: k.Frame,
                          Vector: Array.isArray(k.Vector) ? [...k.Vector] : Array.from(k.Vector || [0, 0, 0]),
                          InTan: k.InTan ? (Array.isArray(k.InTan) ? [...k.InTan] : Array.from(k.InTan)) : undefined,
                          OutTan: k.OutTan ? (Array.isArray(k.OutTan) ? [...k.OutTan] : Array.from(k.OutTan)) : undefined
                        }))
                      rendererNode.Translation = {
                        Keys: copiedKeys,
                        InterpolationType: storeNode?.Translation?.InterpolationType || 1
                      }
                    }

                    // 获取基础值：优先使用现有关键帧，否则实时从 store 插值
                    let baseTranslation = [0, 0, 0]
                    let baseSource = 'default'
                    const existingKey = rendererNode.Translation.Keys.find(
                      (k: any) => !k._isPreviewKey && Math.abs(k.Frame - frame) < 0.1
                    )

                    if (existingKey && existingKey.Vector) {
                      const v = existingKey.Vector
                      baseTranslation = Array.isArray(v) ? [...v] : Array.from(v) as number[]
                      baseSource = 'exactKeyframe'
                    } else {
                      // 没有精确关键帧时，从 store 节点的关键帧实时插值
                      const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                      const storeKeys = storeNode?.Translation?.Keys
                      if (storeKeys && storeKeys.length > 0) {
                        // 鎻掑€艰绠?
                        const sortedKeys = [...storeKeys].filter((k: any) => !k._isPreviewKey).sort((a: any, b: any) => a.Frame - b.Frame)
                        if (sortedKeys.length > 0) {
                          const toArr = (v: any) => Array.isArray(v) ? [...v] : Array.from(v || [0, 0, 0]) as number[]
                          if (frame <= sortedKeys[0].Frame) {
                            baseTranslation = toArr(sortedKeys[0].Vector)
                            baseSource = 'interpolated-first'
                          } else if (frame >= sortedKeys[sortedKeys.length - 1].Frame) {
                            baseTranslation = toArr(sortedKeys[sortedKeys.length - 1].Vector)
                            baseSource = 'interpolated-last'
                          } else {
                            for (let i = 0; i < sortedKeys.length - 1; i++) {
                              if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
                                const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
                                const from = toArr(sortedKeys[i].Vector)
                                const to = toArr(sortedKeys[i + 1].Vector)
                                baseTranslation = from.map((v, idx) => v + (to[idx] - v) * t)
                                baseSource = 'interpolated-middle'
                                break
                              }
                            }
                          }
                        }
                      } else {
                        // Fallback to initialVals
                        const initialVals = dragData.initialValues.get(nodeId) as any
                        if (initialVals?.translation?.length >= 3) {
                          baseTranslation = [...initialVals.translation]
                          baseSource = 'initialVals'
                        }
                      }
                    }

                    // Debug log (first call only per drag)
                    if (!((window as any)._baseTransLogOnce)) {
                      console.log('[DEBUG Preview] NodeId:', nodeId, 'Frame:', frame, 'BaseSource:', baseSource, 'BaseTranslation:', baseTranslation)
                        ; (window as any)._baseTransLogOnce = true
                    }

                    const previewTranslation = [
                      baseTranslation[0] + delta[0],
                      baseTranslation[1] + delta[1],
                      baseTranslation[2] + delta[2]
                    ]

                    // 在当前帧注入临时关键帧用于预览
                    const tempKeyIndex = rendererNode.Translation.Keys.findIndex((k: any) => k._isPreviewKey)
                    if (tempKeyIndex >= 0) {
                      rendererNode.Translation.Keys[tempKeyIndex].Vector = previewTranslation
                      rendererNode.Translation.Keys[tempKeyIndex].Frame = frame
                    } else {
                      rendererNode.Translation.Keys.push({
                        Frame: frame,
                        Vector: previewTranslation,
                        _isPreviewKey: true
                      })
                      rendererNode.Translation.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                    }
                  }
                }
              }
            }
          })

          // Defer renderer update to the render loop to avoid blocking mousemove
          if (subMode === 'binding' || subMode === 'keyframe') {
            needsRendererUpdateRef.current = true
          }
        }
      } else if ((transformMode === 'rotate' || transformMode === 'scale') && mainMode === 'geometry') {
        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()
        const expandedFaceSelection = geometrySubMode === 'face'
          ? getExpandedFaceVertexSelection(selectedFaceIds as Array<{ geosetIndex: number; index: number }>)
          : []

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

        if (geometrySubMode === 'vertex' || geometrySubMode === 'group') {
          selectedVertexIds.forEach(sel => accumulateCenter(sel.geosetIndex, sel.index))
        } else if (geometrySubMode === 'face') {
          expandedFaceSelection.forEach(sel => accumulateCenter(sel.geosetIndex, sel.index))
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
            if (geometrySubMode === 'vertex' || geometrySubMode === 'group') {
              selectedVertexIds.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
            } else if (geometrySubMode === 'face') {
              expandedFaceSelection.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
            }
          }

          if (transformMode === 'rotate') {
            let angle = 0
            const rotAxis = vec3.create()

            if (axis === 'x') {
              angle = -deltaY * 0.01 // Negated to fix rotation direction
              vec3.copy(rotAxis, axisX)
            } else if (axis === 'y') {
              angle = -deltaX * 0.01
              vec3.copy(rotAxis, axisY)
            } else if (axis === 'z') {
              angle = deltaX * 0.01
              vec3.copy(rotAxis, axisZ)
            }

            if (angle !== 0 && (axis === 'x' || axis === 'y' || axis === 'z')) {
              const snappedDeg = applyRotateSnapDeg(axis, angle * 180 / Math.PI)
              angle = snappedDeg * Math.PI / 180
            }

            if (axis === 'x' || axis === 'y' || axis === 'z') {
              applyHudRotate(axis, angle * 180 / Math.PI)
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

            applyHudScale(scaleVec)
            if (scaleVec[0] !== 1 || scaleVec[1] !== 1 || scaleVec[2] !== 1) {
              applyToSelection((v, i) => {
                applyScaleInBasis(v, i, scaleVec, center)
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
          keyframeTransformDirty.current = false

          selectedNodeIds.forEach(nodeId => {
            // 1. Snapshot original KEYS from STORE (source of truth)
            const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
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
            const resolvedPivot = getOrCreateNodePivot(nodeWrapper)
            if (resolvedPivot) pivot = resolvedPivot
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
          if (axis === 'x') { angle = -deltaY * 0.01; vec3.copy(rotAxis, axisX) }
          else if (axis === 'y') { angle = -deltaX * 0.01; vec3.copy(rotAxis, axisY) }
          else if (axis === 'z') { angle = deltaX * 0.01; vec3.copy(rotAxis, axisZ) }

          if (angle !== 0 && (axis === 'x' || axis === 'y' || axis === 'z')) {
            const snappedDeg = applyRotateSnapDeg(axis, angle * 180 / Math.PI)
            angle = snappedDeg * Math.PI / 180
          }

          if (axis === 'x' || axis === 'y' || axis === 'z') {
            applyHudRotate(axis, angle * 180 / Math.PI)
          }
          if (angle !== 0) {
            keyframeTransformDirty.current = true
            const worldDeltaQuat = quat.create()
            quat.setAxisAngle(worldDeltaQuat, rotAxis, angle)

            selectedNodeIds.forEach(nodeId => {
              const currentVal = keyframeDragData.current?.initialValues.get(nodeId)
              if (currentVal) {
                const localDeltaQuat = quat.clone(worldDeltaQuat)
                const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                const parentId = storeNode?.Parent
                if (parentId !== undefined && parentId !== null && parentId >= 0) {
                  const parentWrapper = rendererRef.current!.rendererData.nodes.find(
                    (n: any) => n && n.node && n.node.ObjectId === parentId
                  )
                  if (parentWrapper?.matrix) {
                    const parentRot = quat.create()
                    mat4.getRotation(parentRot, parentWrapper.matrix as mat4)
                    const invParentRot = quat.create()
                    quat.invert(invParentRot, parentRot)
                    const localAxis = vec3.create()
                    vec3.transformQuat(localAxis, rotAxis, invParentRot)
                    if (vec3.length(localAxis) > 0.000001) {
                      vec3.normalize(localAxis, localAxis)
                      quat.setAxisAngle(localDeltaQuat, localAxis, angle)
                    }
                  }
                }
                const newRot = quat.create()
                // Apply delta in parent-local space to keep world/camera-axis drag continuous.
                quat.multiply(newRot, localDeltaQuat, currentVal.rotation as any)

                // Update current value so next frame accumulates
                quat.copy(currentVal.rotation as any, newRot)

                // INJECT into Renderer Model for PREVIEW
                const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n && n.ObjectId === nodeId)
                if (rendererNode) {
                  const frame = Math.round(currentFrame)
                  if (!rendererNode.Rotation || !rendererNode.Rotation.Keys?.length) {
                    const storeKeys = storeNode?.Rotation?.Keys || []
                    const copiedKeys = storeKeys
                      .filter((k: any) => !k._isPreviewKey)
                      .map((k: any) => ({
                        Frame: k.Frame,
                        Vector: Array.isArray(k.Vector) ? [...k.Vector] : Array.from(k.Vector || [0, 0, 0, 1]),
                        InTan: k.InTan ? (Array.isArray(k.InTan) ? [...k.InTan] : Array.from(k.InTan)) : undefined,
                        OutTan: k.OutTan ? (Array.isArray(k.OutTan) ? [...k.OutTan] : Array.from(k.OutTan)) : undefined
                      }))
                    rendererNode.Rotation = {
                      Keys: copiedKeys,
                      InterpolationType: storeNode?.Rotation?.InterpolationType || 1
                    }
                  }

                  const keys = rendererNode.Rotation.Keys || []
                  const previewIndex = keys.findIndex((k: any) => k._isPreviewKey)
                  if (previewIndex >= 0) {
                    keys[previewIndex].Vector = [newRot[0], newRot[1], newRot[2], newRot[3]]
                    keys[previewIndex].Frame = frame
                  } else {
                    keys.push({
                      Frame: frame,
                      Vector: [newRot[0], newRot[1], newRot[2], newRot[3]],
                      _isPreviewKey: true
                    })
                  }
                  keys.sort((a: any, b: any) => a.Frame - b.Frame)
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
          else if (axis === 'xz') { scaleVec[0] = scaleFactor; scaleVec[2] = scaleFactor; }
          else if (axis === 'yz') { scaleVec[1] = scaleFactor; scaleVec[2] = scaleFactor; }

          applyHudScale(scaleVec)
          if (scaleFactor !== 1) {
            keyframeTransformDirty.current = true
          }

          selectedNodeIds.forEach(nodeId => {
            const currentVal = keyframeDragData.current?.initialValues.get(nodeId)
            if (currentVal) {
              const newScale = vec3.create()
              // Aggregate scale: New = Current * Delta
              vec3.multiply(newScale, currentVal.scaling as any, scaleVec)

              // Update current value
              vec3.copy(currentVal.scaling as any, newScale)
              keyframeTransformDirty.current = true

              // INJECT into Renderer Model for PREVIEW
              const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n && n.ObjectId === nodeId)
              if (rendererNode) {
                const frame = Math.round(currentFrame)
                if (!rendererNode.Scaling || !rendererNode.Scaling.Keys?.length) {
                  const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                  const storeKeys = storeNode?.Scaling?.Keys || []
                  const copiedKeys = storeKeys
                    .filter((k: any) => !k._isPreviewKey)
                    .map((k: any) => ({
                      Frame: k.Frame,
                      Vector: Array.isArray(k.Vector) ? [...k.Vector] : Array.from(k.Vector || [1, 1, 1]),
                      InTan: k.InTan ? (Array.isArray(k.InTan) ? [...k.InTan] : Array.from(k.InTan)) : undefined,
                      OutTan: k.OutTan ? (Array.isArray(k.OutTan) ? [...k.OutTan] : Array.from(k.OutTan)) : undefined
                    }))
                  rendererNode.Scaling = {
                    Keys: copiedKeys,
                    InterpolationType: storeNode?.Scaling?.InterpolationType || 1
                  }
                }

                const keys = rendererNode.Scaling.Keys || []
                const previewIndex = keys.findIndex((k: any) => k._isPreviewKey)
                if (previewIndex >= 0) {
                  keys[previewIndex].Vector = [newScale[0], newScale[1], newScale[2]]
                  keys[previewIndex].Frame = frame
                } else {
                  keys.push({
                    Frame: frame,
                    Vector: [newScale[0], newScale[1], newScale[2]],
                    _isPreviewKey: true
                  })
                }
                keys.sort((a: any, b: any) => a.Frame - b.Frame)
              }
            }
          })
        }

        // Defer renderer update to the render loop to keep drag responsive
        needsRendererUpdateRef.current = true
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
      const { mainMode } = useSelectionStore.getState()
      if (mainMode === 'animation' && qPressedRef.current) {
        // While holding Q in animation mode, don't show gizmo hover hit and don't set activeAxis.
        if (gizmoState.current.activeAxis) gizmoState.current.activeAxis = null
        return
      }

      // Center is already calculated at top of handleMouseMove
      // gizmoCenter and gizmoCount are used here from closure
      const center = gizmoCenter
      const count = gizmoCount
      if (gizmoCount > 0 && transformMode) {
        const gizmoScale = getGizmoScale(center)

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

          if (cameraRef.current) {
            cameraRef.current.getMatrix(mvMatrix, pMatrix)
          } else {
            // Fallback
            const { distance, theta, phi, target } = targetCamera.current
            const cx = distance * Math.sin(phi) * Math.cos(theta)
            const cy = distance * Math.sin(phi) * Math.sin(theta)
            const cz = distance * Math.cos(phi)
            const cameraPos = vec3.fromValues(cx, cy, cz)
            vec3.add(cameraPos, cameraPos, target)

            mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 5000)
            const cameraUp = vec3.fromValues(0, 0, 1)
            mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
          }

          // Robust Raycasting (Perspective + Orthographic)
          const ndcX = (x / canvasRef.current.width) * 2 - 1
          const ndcY = -((y / canvasRef.current.height) * 2 - 1)

          const invProj = mat4.create(); mat4.invert(invProj, pMatrix)
          const invView = mat4.create(); mat4.invert(invView, mvMatrix)

          // Unproject Near and Far points
          const rayClipNear = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
          const rayClipFar = vec4.fromValues(ndcX, ndcY, 1.0, 1.0)

          const rayEyeNear = vec4.create(); vec4.transformMat4(rayEyeNear, rayClipNear, invProj)
          const rayEyeFar = vec4.create(); vec4.transformMat4(rayEyeFar, rayClipFar, invProj)

          // Perspective Divide (Normalize W)
          if (rayEyeNear[3] !== 0) vec4.scale(rayEyeNear, rayEyeNear, 1.0 / rayEyeNear[3])
          if (rayEyeFar[3] !== 0) vec4.scale(rayEyeFar, rayEyeFar, 1.0 / rayEyeFar[3])

          // Transform to World Space
          const rayWorldNear = vec4.create(); vec4.transformMat4(rayWorldNear, rayEyeNear, invView)
          const rayWorldFar = vec4.create(); vec4.transformMat4(rayWorldFar, rayEyeFar, invView)

          const rayOrigin = vec3.fromValues(rayWorldNear[0], rayWorldNear[1], rayWorldNear[2])
          const rayTarget = vec3.fromValues(rayWorldFar[0], rayWorldFar[1], rayWorldFar[2])

          const rayDir = vec3.create(); vec3.subtract(rayDir, rayTarget, rayOrigin); vec3.normalize(rayDir, rayDir)

          // Pass rayOrigin as cameraPos to raycast (it serves as the ray start point)
          const gizmoOrientation = useRendererStore.getState().gizmoOrientation
          const gizmoBasis = getGizmoBasis(gizmoOrientation)
          const hit = gizmoRenderer.current.raycast(rayOrigin, rayDir, center, transformMode as any, gizmoScale, gizmoBasis)
          gizmoState.current.activeAxis = hit
        }
      }
    }
  }

  const handleRecalculateNormals = () => {
    console.log('[Viewer] Recalculating normals (Smooth)...')
    useModelStore.getState().recalculateNormals()
  }

  // Split vertices handler - now opens dialog for material selection
  const handleSplitVertices = () => {
    if (!rendererRef.current) return
    const { geometrySubMode, mainMode } = useSelectionStore.getState()
    const splitSelection = getSplitVertexSelection()
    if (mainMode !== 'geometry' || !['vertex', 'face', 'group'].includes(geometrySubMode) || splitSelection.length < 1) return

    console.log('[Viewer] Opening separate dialog for', splitSelection.length, 'vertices')
    // Get source geoset from first selected vertex
    const geosetIdx = splitSelection[0].geosetIndex
    setSeparateSourceGeosetIndex(geosetIdx)
    setSeparateDialogVisible(true)
  }

  const handleAutoSeparateLayers = () => {
    if (!rendererRef.current) {
      message.warning('当前渲染器未就绪')
      return
    }
    const { mainMode } = useSelectionStore.getState()
    if (mainMode !== 'geometry') {
      message.warning('请先切换到顶点模式')
      return
    }

    message.loading({ content: '正在执行一键分层...', key: 'auto-separate-layers', duration: 0 })
    const cmd = new AutoSeparateLayersCommand(rendererRef.current)
    commandManager.execute(cmd)

    if (!cmd.lastResult) {
      message.warning({ content: '一键分层未返回结果', key: 'auto-separate-layers' })
      return
    }

    if (cmd.lastResult.changedGeosetCount <= 0) {
      message.info({ content: '当前模型不需要分层', key: 'auto-separate-layers' })
      return
    }

    message.success({
      content: `一键分层完成：${cmd.lastResult.sourceGeosetCount} -> ${cmd.lastResult.resultGeosetCount}，处理 ${cmd.lastResult.changedGeosetCount} 个多边形组`,
      key: 'auto-separate-layers'
    })
  }

  // Handle separate dialog confirmation
  const handleSeparateConfirm = (config: {
    mode: 'keep' | 'new' | 'existing';
    materialIndex?: number;
    newLayerConfig?: LayerConfig;
  }) => {
    if (!rendererRef.current) return
    const splitSelection = getSplitVertexSelection()
    if (splitSelection.length < 1) return

    let targetMaterialId: number

    if (config.mode === 'keep') {
      targetMaterialId = config.materialIndex!
    } else if (config.mode === 'existing') {
      targetMaterialId = config.materialIndex!
    } else if (config.mode === 'new' && config.newLayerConfig) {
      // Create new material from layer config
      const modelStore = useModelStore.getState()
      const materials: any[] = [...(modelStore.modelData?.Materials || [])]
      const newLayer = layerConfigToMaterialLayer(config.newLayerConfig)

      materials.push({
        Layers: [newLayer],
        PriorityPlane: 0,
        RenderMode: 0
      })

      targetMaterialId = materials.length - 1
      modelStore.setMaterials(materials)
    } else {
      // Fallback
      targetMaterialId = rendererRef.current.model.Geosets[separateSourceGeosetIndex]?.MaterialID ?? 0
    }

    console.log('[Viewer] Splitting', splitSelection.length, 'vertices with materialId:', targetMaterialId)
    const cmd = new SplitVerticesCommand(rendererRef.current, splitSelection, targetMaterialId)
    commandManager.execute(cmd)

    setSeparateDialogVisible(false)
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
    const wasGizmoDragging = gizmoState.current.isDragging

    mouseState.current.isDragging = false
    mouseState.current.isBoxSelecting = false
    mouseState.current.dragButton = -1
    setSelectionBox(null)
    if (cameraRef.current) cameraRef.current.enabled = true

    if (wasGizmoDragging) {
      gizmoState.current.isDragging = false
      gizmoState.current.activeAxis = null
      gizmoState.current.dragCenter = null
      setGizmoHud(null)

      if (rendererRef.current) {
        const { mainMode, animationSubMode, isGlobalTransformMode } = useSelectionStore.getState()

        if (isGlobalTransformMode) {
          const previewTransform = previewTransformRef.current
          const commitTransform = {
            translation: [...previewTransform.translation] as [number, number, number],
            rotation: [...previewTransform.rotation] as [number, number, number],
            scale: [...previewTransform.scale] as [number, number, number]
          }
          const hasTransform = commitTransform.translation.some(v => v !== 0) ||
            commitTransform.rotation.some(v => v !== 0) ||
            commitTransform.scale.some(v => v !== 1)

          // CRITICAL: Execute command FIRST to bake transform into model data,
          // then reset preview. Otherwise model visually jumps back before bake completes.
          if (hasTransform) {
            const pivot = getModelCenter()
            const cmd = new GlobalTransformCommand(commitTransform, rendererRef.current, pivot)
            commandManager.execute(cmd)
            console.log('[Viewer] Global transform applied via command')
          }

          // Reset local preview transform reference
          previewTransformRef.current = {
            translation: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        }
        snapDragRef.current.translationDelta = [0, 0, 0]
        snapDragRef.current.translationApplied = [0, 0, 0]
        snapDragRef.current.rotationDelta = [0, 0, 0]
        snapDragRef.current.rotationApplied = [0, 0, 0]

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
              if (nodeWrapper) {
                const pivot = getOrCreateNodePivot(nodeWrapper)
                if (!pivot) return
                const newPos: [number, number, number] = [pivot[0], pivot[1], pivot[2]]

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
          const { selectedNodeIds } = useSelectionStore.getState()
          // 1. Translation (using DragDelta)
          const dragDelta = (window as any)._keyframeDragDelta
          if (dragDelta) {
            const { autoKeyframe, currentFrame, nodes } = useModelStore.getState()

            // FIRST: Clean up preview keyframes from renderer model
            if (rendererRef.current && rendererRef.current.model && rendererRef.current.model.Nodes) {
              selectedNodeIds.forEach(nodeId => {
                const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n && n.ObjectId === nodeId)
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
                  const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                  if (storeNode) {
                    const oldKeys = storeNode.Translation?.Keys || []
                    const existingKey = oldKeys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)

                    // IMPORTANT: Use existing keyframe value as base (if present)
                    // This ensures we only modify the axis the user actually dragged
                    let baseTranslation = [0, 0, 0]

                    if (existingKey && existingKey.Vector) {
                      // Use existing keyframe value
                      const v = existingKey.Vector
                      baseTranslation = Array.isArray(v) ? [...v] : Array.from(v) as number[]
                    } else {
                      // No keyframe at this frame, interpolate from store keys in real-time
                      const storeKeys = storeNode.Translation?.Keys
                      if (storeKeys && storeKeys.length > 0) {
                        const sortedKeys = [...storeKeys].filter((k: any) => !k._isPreviewKey).sort((a: any, b: any) => a.Frame - b.Frame)
                        if (sortedKeys.length > 0) {
                          const toArr = (v: any) => Array.isArray(v) ? [...v] : Array.from(v || [0, 0, 0]) as number[]
                          if (frame <= sortedKeys[0].Frame) {
                            baseTranslation = toArr(sortedKeys[0].Vector)
                          } else if (frame >= sortedKeys[sortedKeys.length - 1].Frame) {
                            baseTranslation = toArr(sortedKeys[sortedKeys.length - 1].Vector)
                          } else {
                            for (let i = 0; i < sortedKeys.length - 1; i++) {
                              if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
                                const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
                                const from = toArr(sortedKeys[i].Vector)
                                const to = toArr(sortedKeys[i + 1].Vector)
                                baseTranslation = from.map((v, idx) => v + (to[idx] - v) * t)
                                break
                              }
                            }
                          }
                        }
                      }
                      // If still [0,0,0], try initialVals as fallback
                      if (baseTranslation[0] === 0 && baseTranslation[1] === 0 && baseTranslation[2] === 0) {
                        const dragData = keyframeDragData.current
                        if (dragData) {
                          const initialVals = dragData.initialValues.get(nodeId) as any
                          if (initialVals?.translation?.length >= 3) {
                            baseTranslation = [...initialVals.translation]
                          }
                        }
                      }
                    }

                    // Only add delta to the axes that were actually dragged (non-zero delta)
                    const newTranslation = [
                      baseTranslation[0] + delta[0],
                      baseTranslation[1] + delta[1],
                      baseTranslation[2] + delta[2]
                    ]

                    // DEBUG: Log commit data
                    console.log('[DEBUG MouseUp] NodeId:', nodeId)
                    console.log('[DEBUG MouseUp] Delta:', [...delta])
                    console.log('[DEBUG MouseUp] BaseTranslation:', [...baseTranslation], existingKey ? '(from keyframe)' : '(interpolated)')
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

          // Clean up preview keys for Rotation/Scaling
          if (rendererRef.current && rendererRef.current.model && rendererRef.current.model.Nodes) {
            selectedNodeIds.forEach(nodeId => {
              const rendererNode = rendererRef.current!.model.Nodes.find((n: any) => n && n.ObjectId === nodeId)
              if (rendererNode?.Rotation?.Keys) {
                rendererNode.Rotation.Keys = rendererNode.Rotation.Keys.filter((k: any) => !k._isPreviewKey)
              }
              if (rendererNode?.Scaling?.Keys) {
                rendererNode.Scaling.Keys = rendererNode.Scaling.Keys.filter((k: any) => !k._isPreviewKey)
              }
            })
          }

          // Rotation/Scale Keyframe Commit (after gizmo drag)
          const { transformMode } = useSelectionStore.getState()
          if ((transformMode === 'rotate' || transformMode === 'scale') && keyframeDragData.current) {
            const { autoKeyframe, currentFrame, nodes } = useModelStore.getState()
            if (autoKeyframe) {
              const frame = Math.round(currentFrame)
              const changes: KeyframeChange[] = []

              const isSameVec = (a: number[] | null, b: number[] | null, eps = 1e-4) => {
                if (!a || !b || a.length !== b.length) return false
                for (let i = 0; i < a.length; i++) {
                  if (Math.abs(a[i] - b[i]) > eps) return false
                }
                return true
              }

              const interpolateValue = (keys: any[] | undefined, frameVal: number, defaultVal: number[]) => {
                if (!keys || keys.length === 0) return defaultVal
                const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)
                const toArray = (v: any, fallback: number[]) => {
                  if (!v) return fallback
                  const arr = Array.isArray(v) ? [...v] : Array.from(v) as number[]
                  return arr.length > 0 ? arr : fallback
                }
                if (frameVal <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, defaultVal)
                if (frameVal >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, defaultVal)
                for (let i = 0; i < sortedKeys.length - 1; i++) {
                  if (frameVal >= sortedKeys[i].Frame && frameVal <= sortedKeys[i + 1].Frame) {
                    const t = (frameVal - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
                    const from = toArray(sortedKeys[i].Vector, defaultVal)
                    const to = toArray(sortedKeys[i + 1].Vector, defaultVal)
                    return from.map((v, idx) => v + (to[idx] - v) * t)
                  }
                }
                return defaultVal
              }

              const { selectedNodeIds } = useSelectionStore.getState()
              selectedNodeIds.forEach(nodeId => {
                const storeNode = nodes.find((n: any) => n && n.ObjectId === nodeId)
                if (!storeNode) return

                if (transformMode === 'rotate') {
                  const currentVal = keyframeDragData.current?.initialValues.get(nodeId)
                  if (!currentVal) return
                  const newValue = Array.from(currentVal.rotation as any) as number[]
                  const existingKey = storeNode.Rotation?.Keys?.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
                  const oldValue = existingKey?.Vector ? (Array.isArray(existingKey.Vector) ? [...existingKey.Vector] : Array.from(existingKey.Vector)) : null
                  const baseValue = existingKey?.Vector
                    ? (Array.isArray(existingKey.Vector) ? [...existingKey.Vector] : Array.from(existingKey.Vector))
                    : interpolateValue(storeNode.Rotation?.Keys, frame, [0, 0, 0, 1])
                  if (!oldValue && isSameVec(newValue, baseValue)) return
                  if (oldValue && isSameVec(newValue, oldValue)) return
                  changes.push({
                    nodeId,
                    propertyName: 'Rotation',
                    frame,
                    oldValue,
                    newValue
                  })
                } else if (transformMode === 'scale') {
                  const currentVal = keyframeDragData.current?.initialValues.get(nodeId)
                  if (!currentVal) return
                  const newValue = Array.from(currentVal.scaling as any) as number[]
                  const existingKey = storeNode.Scaling?.Keys?.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
                  const oldValue = existingKey?.Vector ? (Array.isArray(existingKey.Vector) ? [...existingKey.Vector] : Array.from(existingKey.Vector)) : null
                  const baseValue = existingKey?.Vector
                    ? (Array.isArray(existingKey.Vector) ? [...existingKey.Vector] : Array.from(existingKey.Vector))
                    : interpolateValue(storeNode.Scaling?.Keys, frame, [1, 1, 1])
                  if (!oldValue && isSameVec(newValue, baseValue)) return
                  if (oldValue && isSameVec(newValue, oldValue)) return
                  changes.push({
                    nodeId,
                    propertyName: 'Scaling',
                    frame,
                    oldValue,
                    newValue
                  })
                }
              })

              if (changes.length > 0) {
                const cmd = new UpdateKeyframeCommand(rendererRef.current, changes)
                commandManager.execute(cmd)
                console.log('[Viewer] Committed Rotation/Scaling Keyframe changes via command', changes.length)
              }
            }
          }

          keyframeTransformDirty.current = false
          // Clear keyframeDragData after keyframe commit
          keyframeDragData.current = null
        }
      }
      return
    }

    const deltaX = Math.abs(e.clientX - startX)
    const deltaY = Math.abs(e.clientY - startY)
    const isCtrl = e.ctrlKey || e.metaKey
    const isAlt = e.altKey

    if (wasBoxSelecting && deltaX > 5 && deltaY > 5) {
      handleBoxSelection(startX, startY, e.clientX, e.clientY, e.shiftKey, isCtrl)
    } else if (deltaX < 5 && deltaY < 5 && dragButton === 0) {
      // Pass isAlt for geoset picking, isCtrl for multi-select
      handleSelectionClick(e.clientX, e.clientY, e.shiftKey, isCtrl, isAlt)
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

  const getPrimarySelectedNode = () => {
    const { selectedNodeIds } = useSelectionStore.getState()
    if (selectedNodeIds.length === 0) return null
    return stableStoreNodes.find((n) => n.ObjectId === selectedNodeIds[0]) ?? null
  }

  const selectParentNode = (): boolean => {
    const { mainMode, selectNode } = useSelectionStore.getState()
    if (mainMode !== 'animation') return false
    const node = getPrimarySelectedNode()
    if (!node || node.Parent === undefined || node.Parent === null || node.Parent < 0) return false
    markNodeManagerListScrollFromTree()
    selectNode(node.Parent)
    return true
  }

  const selectChildNode = (): boolean => {
    const { mainMode, selectNode } = useSelectionStore.getState()
    if (mainMode !== 'animation') return false
    const node = getPrimarySelectedNode()
    if (!node) return false
    const children = stableStoreNodes.filter((n) => n.Parent === node.ObjectId)
    if (children.length === 0) return false
    children.sort((a, b) => a.ObjectId - b.ObjectId)
    markNodeManagerListScrollFromTree()
    selectNode(children[0].ObjectId)
    return true
  }

  const selectAllChildren = (): boolean => {
    const { mainMode, selectNodes } = useSelectionStore.getState()
    if (mainMode !== 'animation') return false
    const node = getPrimarySelectedNode()
    if (!node) return false
    const collected: number[] = []
    const queue: number[] = [node.ObjectId]
    while (queue.length > 0) {
      const parentId = queue.shift() as number
      const children = stableStoreNodes.filter((n) => n.Parent === parentId)
      for (const child of children) {
        collected.push(child.ObjectId)
        queue.push(child.ObjectId)
      }
    }
    if (collected.length === 0) return false
    markNodeManagerListScrollFromTree()
    selectNodes(collected)
    return true
  }

  const editSelectedNode = (): boolean => {
    const node = getPrimarySelectedNode()
    if (!node) return false
    const kind = nodeTypeToEditorKind(node.type)
    if (kind) {
      void openNodeEditor(kind, node.ObjectId)
    } else {
      void openNodeEditor('genericNode', node.ObjectId)
    }
    return true
  }

  const deleteSelectedNode = (): boolean => {
    setNodeContextMenu(null)
    const node = getPrimarySelectedNode()
    if (!node) return false
    useModelStore.getState().deleteNode(node.ObjectId)
    useSelectionStore.getState().clearNodeSelection()
    return true
  }

  const copyPoseAtCurrentFrame = (): boolean => {
    const { nodes, currentFrame } = useModelStore.getState()
    if (!nodes || nodes.length === 0) return false
    const frame = Math.round(currentFrame)
    const poseNodes = nodes
      .filter((n: any) => typeof n.ObjectId === 'number' && n.ObjectId >= 0 && n.type !== NodeType.CAMERA)
      .map((n: any) => ({
        nodeId: n.ObjectId,
        translation: sanitizeTransformValue('Translation', interpolateValueAtFrame(n.Translation?.Keys, frame, [0, 0, 0]), [0, 0, 0]),
        rotation: sanitizeTransformValue('Rotation', interpolateValueAtFrame(n.Rotation?.Keys, frame, [0, 0, 0, 1]), [0, 0, 0, 1]),
        scaling: sanitizeTransformValue('Scaling', interpolateValueAtFrame(n.Scaling?.Keys, frame, [1, 1, 1]), [1, 1, 1])
      }))

    if (poseNodes.length === 0) return false

    poseClipboardRef.current = { frame, nodes: poseNodes }
    return true
  }

  const pastePoseAtCurrentFrame = (): boolean => {
    const clipboard = poseClipboardRef.current
    if (!clipboard) return false
    const { nodes, currentFrame } = useModelStore.getState()
    if (!nodes || nodes.length === 0) return false
    const frame = Math.round(currentFrame)
    const nodeMap = new Map(
      nodes
        .filter((n: any) => typeof n.ObjectId === 'number' && n.ObjectId >= 0 && n.type !== NodeType.CAMERA)
        .map((n: any) => [n.ObjectId, n])
    )
    const changes: KeyframeChange[] = []

    const pushChange = (
      nodeId: number,
      propertyName: 'Translation' | 'Rotation' | 'Scaling',
      value: number[],
      defaultVal: number[]
    ) => {
      const node = nodeMap.get(nodeId)
      if (!node) return
      const prop = node[propertyName]
      const existingKey = prop?.Keys?.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
      const oldValue = existingKey?.Vector ? sanitizeTransformValue(propertyName, existingKey.Vector, defaultVal) : null
      const newValue = sanitizeTransformValue(propertyName, value, defaultVal)
      changes.push({
        nodeId,
        propertyName,
        frame,
        oldValue,
        newValue
      })
    }

    clipboard.nodes.forEach((n) => {
      pushChange(n.nodeId, 'Translation', n.translation, [0, 0, 0])
      pushChange(n.nodeId, 'Rotation', n.rotation, [0, 0, 0, 1])
      pushChange(n.nodeId, 'Scaling', n.scaling, [1, 1, 1])
    })

    if (changes.length === 0) return false
    const cmd = new UpdateKeyframeCommand(rendererRef.current, changes)
    commandManager.execute(cmd)
    return true
  }

  useEffect(() => {
    const isGeometryVertexMode = () => {
      const { mainMode, geometrySubMode } = useSelectionStore.getState()
      return mainMode === 'geometry' && geometrySubMode === 'vertex'
    }

    const isNotUvMode = () => useSelectionStore.getState().mainMode !== 'uv'
    const switchSequence = (direction: -1 | 1) => {
      const { sequences, currentSequence, setSequence } = useModelStore.getState()
      if (!Array.isArray(sequences) || sequences.length === 0) return false

      let nextIndex = 0
      if (currentSequence >= 0 && currentSequence < sequences.length) {
        nextIndex = (currentSequence + direction + sequences.length) % sequences.length
      } else if (direction < 0) {
        nextIndex = sequences.length - 1
      }

      setSequence(nextIndex)
      window.dispatchEvent(new Event('timeline-fit-current-sequence'))
      return true
    }

    const unsubscribeHandlers = [
      registerShortcutHandler('animation.playPause', () => {
        onTogglePlay()
        return true
      }),
      registerShortcutHandler('animation.prevSequence', () => {
        return switchSequence(-1)
      }),
      registerShortcutHandler('animation.nextSequence', () => {
        return switchSequence(1)
      }),
      registerShortcutHandler('view.fitToView', () => {
        handleFitToView()
        return true
      }),
      registerShortcutHandler(
        'view.perspective',
        () => {
          if (cameraRef.current?.projectionMode !== 'orthographic') {
            return false
          }
          applyViewPreset('perspective')
          return true
        },
        { priority: 100 }
      ),
      registerShortcutHandler(
        'view.orthographic',
        () => {
          if (cameraRef.current?.projectionMode !== 'perspective') {
            return false
          }
          applyViewPreset('orthographic')
          return true
        },
        { priority: 100 }
      ),
      registerShortcutHandler('view.toggleWireframe', () => {
        onToggleWireframe()
        return true
      }),
      registerShortcutHandler('animation.selectParentNode', () => {
        return selectParentNode()
      }),
      registerShortcutHandler('animation.selectChildNode', () => {
        return selectChildNode()
      }),
      registerShortcutHandler('view.cameraViewToggle', () => {
        handleCameraViewToggle()
        return true
      }),
      registerShortcutHandler(
        'transform.translate',
        () => {
          useSelectionStore.getState().setTransformMode('translate')
          return true
        },
        { isActive: isNotUvMode }
      ),
      registerShortcutHandler(
        'transform.rotate',
        () => {
          useSelectionStore.getState().setTransformMode('rotate')
          return true
        },
        { isActive: isNotUvMode }
      ),
      registerShortcutHandler(
        'transform.scale',
        () => {
          useSelectionStore.getState().setTransformMode('scale')
          return true
        },
        { isActive: isNotUvMode }
      ),
      registerShortcutHandler('geometry.copyVertices', () => {
        if (!isGeometryVertexMode()) return false
        handleCopyVertices()
        return true
      }),
      registerShortcutHandler('geometry.pasteVertices', () => {
        if (!isGeometryVertexMode()) return false
        handlePasteVertices()
        return true
      }),
      registerShortcutHandler('geometry.deleteVertices', () => {
        if (!isGeometryVertexMode()) return false
        handleDeleteVertices()
        return true
      })
    ]

    return () => {
      unsubscribeHandlers.forEach((unsubscribe) => unsubscribe())
    }
  }, [
    handleCameraViewToggle,
    handleCopyVertices,
    handleDeleteVertices,
    handleFitToView,
    handlePasteVertices,
    onTogglePlay,
    onToggleWireframe,
    selectChildNode,
    selectParentNode
  ])

  const isTexturePreviewMode = texturePreview !== null

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: isTexturePreviewMode ? 'none' : 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!e.altKey) {
            setContextMenu(null)
            setNodeContextMenu(null)
            return
          }
          const { mainMode, geometrySubMode, selectedVertexIds } = useSelectionStore.getState()
          // Show context menu in vertex mode when vertices are selected AND Alt is pressed
          if (mainMode === 'geometry' && geometrySubMode === 'vertex' && selectedVertexIds.length > 0 && e.altKey) {
            setNodeContextMenu(null)
            setContextMenu({ x: e.clientX, y: e.clientY })
            return
          }
          if (mainMode === 'animation') {
            const node = getPrimarySelectedNode()
            const nodeId = node?.type === NodeType.BONE ? node.ObjectId : null
            setContextMenu(null)
            setNodeContextMenu({ x: e.clientX, y: e.clientY, nodeId })
            return
          }
          setContextMenu(null)
          setNodeContextMenu(null)
        }}
        onWheel={handleWheel}
      />

      {texturePreview && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'repeating-conic-gradient(#2a2a2a 0% 25%, #1f1f1f 0% 50%) 50% / 24px 24px'
          }}
        >
          <img
            src={texturePreview.url}
            alt={texturePreview.path}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              imageRendering: 'pixelated'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 12,
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 12,
              color: '#ddd',
              background: 'rgba(0, 0, 0, 0.55)'
            }}
          >
            {texturePreview.path.split(/[/]/).pop()} ({texturePreview.width}x{texturePreview.height})
          </div>
        </div>
      )}

      {/* Progress bar - hidden in animation mode (has its own timeline) */}
      {!isTexturePreviewMode && appMainMode !== 'animation' && (
        <div style={{
          position: 'absolute',
          bottom: '15px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          width: '60%',
          maxWidth: '600px',
          backgroundColor: 'rgba(0, 0, 0, 0.45)', // Slightly more transparent
          padding: '4px 12px', // Significantly reduced vertical padding
          borderRadius: '20px', // More pill-like
          pointerEvents: 'auto',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%'
          }}>
            <button
              onClick={onTogglePlay}
              title={isPlaying ? '暂停' : '播放'}
              style={{
                background: 'none',
                border: 'none',
                color: isPlaying ? '#1890ff' : 'white',
                cursor: 'pointer',
                fontSize: '18px',
                width: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
            >
              {isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            </button>
            <input
              type="range"
              min={renderer?.rendererData?.animationInfo?.Interval[0] || 0}
              max={renderer?.rendererData?.animationInfo?.Interval[1] || 100}
              value={progress}
              onChange={handleSeek}
              style={{
                flex: 1,
                cursor: 'pointer',
                accentColor: '#1890ff'
              }}
            />
            <span style={{
              color: 'rgba(255, 255, 255, 0.85)',
              fontSize: '11px',
              fontFamily: 'monospace',
              minWidth: '70px',
              textAlign: 'center'
            }}>
              {Math.round(progress)} / {Math.round(duration)}
            </span>
            <button
              onClick={() => setLooping(!isLooping)}
              title={isLooping ? '循环开启' : '循环关闭'}
              style={{
                background: 'none',
                border: 'none',
                color: isLooping ? '#52c41a' : 'rgba(255, 255, 255, 0.45)',
                cursor: 'pointer',
                fontSize: '16px',
                width: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
            >
              <SyncOutlined spin={isPlaying && isLooping && !!renderer} />
            </button>
          </div>
        </div>
      )}
      {!isTexturePreviewMode && showFPS && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          color: (renderer as any)?.device ? '#00f2ff' : '#00ff00',
          padding: '4px 10px',
          borderRadius: '4px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          fontFamily: 'monospace',
          fontSize: '13px',
          pointerEvents: 'none',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontWeight: 'bold' }}>{fps} FPS</div>
        </div>
      )}

      {/* Camera Selector Dropdown */}
      {!isTexturePreviewMode && (() => {
        const cameraList = getAvailableCameras();
        const hasCamera = cameraList.length > 0
        const hasSelectedCamera = selectedCameraIndex >= 0 && selectedCameraIndex < cameraList.length
        const viewMenuItems = [
          { key: 'perspective', label: '透视', shortcut: '~' },
          { key: 'orthographic', label: '正交', shortcut: '~' },
          { key: 'camera', label: '镜头模式', shortcut: '', disabled: !hasSelectedCamera, dividerAfter: true },
          { key: 'top', label: '顶视图', shortcut: 'F3' },
          { key: 'bottom', label: '底视图', shortcut: 'F4' },
          { key: 'front', label: '前视图', shortcut: 'F1' },
          { key: 'back', label: '后视图', shortcut: 'F2' },
          { key: 'left', label: '左视图', shortcut: 'F5' },
          { key: 'right', label: '右视图', shortcut: 'F6' }
        ]

        return (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 2200,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'auto'
          }}>
            <select
              id="camera-selector"
              title="选择模型相机"
              style={{
                background: 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                border: '1px solid #555',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
              disabled={!hasCamera}
              value={hasSelectedCamera ? String(selectedCameraIndex) : '-1'}
              onChange={(e) => {
                const idx = parseInt(e.target.value);
                setSelectedCameraIndex(idx)
                if (idx >= 0 && idx < cameraList.length) {
                  const cam = cameraList[idx];
                  // Select the camera node instead of switching view
                  // usage of selectNode(id, multiSelect)
                  markNodeManagerListScrollFromTree();
                  useSelectionStore.getState().selectNode(cam.ObjectId);
                }
              }}
            >
              <option value="-1" disabled>选择相机...</option>
              {cameraList.map((cam: any, i: number) => (
                <option key={i} value={i}>{cam.Name || `Camera ${i + 1}`}</option>
              ))}
            </select>
            <button
              type="button"
              title="复制相机参数"
              onClick={copySelectedCameraParams}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                background: 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                border: '1px solid #555',
                borderRadius: '4px',
                cursor: hasCamera ? 'pointer' : 'not-allowed',
                opacity: hasCamera ? 1 : 0.45
              }}
              disabled={!hasCamera}
            >
              <CopyOutlined style={{ fontSize: '12px' }} />
            </button>
            <button
              type="button"
              title="按当前视角新建相机"
              onClick={() => onAddCameraFromView?.()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                background: 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                border: '1px solid #555',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              <CameraOutlined style={{ fontSize: '12px' }} />
            </button>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                title="视图菜单"
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setShowViewMenu((prev) => !prev)
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '38px',
                  height: '24px',
                  padding: '0 10px',
                  background: 'rgba(0, 0, 0, 0.7)',
                  color: '#fff',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                视图
              </button>
              {showViewMenu && (
                <div style={{
                  position: 'absolute',
                  top: '30px',
                  left: 0,
                  minWidth: '140px',
                  background: '#2f2f2f',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                  overflow: 'hidden',
                  zIndex: 2201,
                  pointerEvents: 'auto'
                }}>
                  {viewMenuItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (item.disabled) return
                        applyViewPreset(item.key)
                        setShowViewMenu(false)
                      }}
                      onMouseEnter={(e) => {
                        if (!item.disabled) {
                          e.currentTarget.style.background = '#3a3a3a'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'transparent',
                        color: item.disabled ? '#707070' : '#eee',
                        border: 'none',
                        borderBottom: item.dividerAfter ? '1px solid #444' : 'none',
                        cursor: item.disabled ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                        textAlign: 'left',
                        opacity: item.disabled ? 0.65 : 1
                      }}
                    >
                      <span>{item.label}</span>
                      <span style={{ color: '#888', fontSize: '11px' }}>{item.shortcut}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {!isTexturePreviewMode && (() => {
        const cameraMatte = getActiveCameraMatte()
        if (!cameraMatte) return null

        return (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1200 }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: cameraMatte.top,
              background: 'rgba(0, 0, 0, 0.38)'
            }} />
            <div style={{
              position: 'absolute',
              left: 0,
              top: cameraMatte.top + cameraMatte.height,
              width: '100%',
              height: cameraMatte.bottomInset,
              background: 'rgba(0, 0, 0, 0.38)'
            }} />
            <div style={{
              position: 'absolute',
              left: 0,
              top: cameraMatte.top,
              width: cameraMatte.left,
              height: cameraMatte.height,
              background: 'rgba(0, 0, 0, 0.32)'
            }} />
            <div style={{
              position: 'absolute',
              right: 0,
              top: cameraMatte.top,
              width: cameraMatte.rightInset,
              height: cameraMatte.height,
              background: 'rgba(0, 0, 0, 0.32)'
            }} />
            <div style={{
              position: 'absolute',
              left: cameraMatte.left,
              top: cameraMatte.top,
              width: cameraMatte.width,
              height: cameraMatte.height,
              border: '1px solid rgba(99, 214, 255, 0.9)',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35) inset'
            }} />
            <div style={{
              position: 'absolute',
              left: cameraMatte.left + 10,
              top: Math.max(10, cameraMatte.top + 10),
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              color: '#d8f8ff',
              background: 'rgba(0, 16, 24, 0.72)',
              border: '1px solid rgba(99, 214, 255, 0.35)',
              backdropFilter: 'blur(4px)',
              whiteSpace: 'nowrap'
            }}>
              {cameraMatte.label}
            </div>
          </div>
        )
      })()}

      {/* Missing Texture Warning - Absolute positioned on the left as requested */}
      {!isTexturePreviewMode && <div style={{
        position: 'absolute',
        top: '55px',
        left: '15px',
        zIndex: 500,
        pointerEvents: 'none'
      }}>
        <MissingTextureWarning />
      </div>}

      {!isTexturePreviewMode && selectionBox && (
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
      {!isTexturePreviewMode && gizmoHud && (
        <div
          style={{
            position: 'fixed',
            left: gizmoHud.x,
            top: gizmoHud.y,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 1500
          }}
        >
          {gizmoHud.text}
        </div>
      )}

      {!isTexturePreviewMode && showModelInfo && (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
          <div
            style={{
              position: 'absolute',
              top: 50,
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

      {!isTexturePreviewMode && <ViewerToolbar
        // Remount toolbar if needed
        key="viewer-toolbar"
        onRecalculateNormals={handleRecalculateNormals}
        onSplitVertices={handleSplitVertices}
        onAutoSeparateLayers={handleAutoSeparateLayers}
        onWeldVertices={handleWeldVertices}
        onFitToView={handleFitToView}
      />}


      {!isTexturePreviewMode && appMainMode === 'geometry' && <VertexEditor renderer={renderer} onBeginUpdate={() => { ignoreNextModelDataUpdate.current = true }} />}

      {/* Context Menu for Vertex Operations */}
      {!isTexturePreviewMode && contextMenu && (
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
            鍒嗙椤剁偣
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
            鐒婃帴椤剁偣
          </div>
        </div>
      )}

      {/* Context Menu for Bone Operations */}
      {!isTexturePreviewMode && nodeContextMenu && (() => {
        const node = nodeContextMenu.nodeId !== null
          ? stableStoreNodes.find((n) => n.ObjectId === nodeContextMenu.nodeId) ?? null
          : null
        const hasNode = !!node
        const hasParent = hasNode && node.Parent !== undefined && node.Parent !== null && node.Parent >= 0
        const children = node ? stableStoreNodes.filter((n) => n.Parent === node.ObjectId) : []
        const hasChild = children.length > 0
        const canCopyPose = stableStoreNodes.length > 0
        const canPastePose = !!poseClipboardRef.current
        const menuItemStyle = (enabled: boolean) => ({
          padding: '6px 12px',
          cursor: enabled ? 'pointer' : 'not-allowed',
          color: enabled ? 'white' : '#666',
          fontSize: '13px'
        })
        const dividerStyle: React.CSSProperties = {
          height: 1,
          backgroundColor: '#444',
          margin: '4px 0'
        }
        return (
          <div
            style={{
              position: 'fixed',
              left: nodeContextMenu.x,
              top: nodeContextMenu.y,
              backgroundColor: '#2b2b2b',
              border: '1px solid #555',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              zIndex: 2000,
              minWidth: '140px',
              padding: '4px 0'
            }}
            onClick={() => setNodeContextMenu(null)}
          >
            <div
              style={menuItemStyle(canCopyPose)}
              onMouseEnter={(e) => {
                if (canCopyPose) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (canCopyPose) copyPoseAtCurrentFrame()
                setNodeContextMenu(null)
              }}
            >
              {'复制姿态'}
            </div>
            <div
              style={menuItemStyle(canPastePose)}
              onMouseEnter={(e) => {
                if (canPastePose) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (canPastePose) pastePoseAtCurrentFrame()
                setNodeContextMenu(null)
              }}
            >
              {'粘贴姿态'}
            </div>
            <div style={dividerStyle} />
            <div
              style={menuItemStyle(hasNode)}
              onMouseEnter={(e) => {
                if (hasNode) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (hasNode) editSelectedNode()
                setNodeContextMenu(null)
              }}
            >
              编辑节点
            </div>
            <div
              style={menuItemStyle(hasParent)}
              onMouseEnter={(e) => {
                if (hasParent) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (hasParent) selectParentNode()
                setNodeContextMenu(null)
              }}
            >
              选择父节点
            </div>
            <div
              style={menuItemStyle(hasChild)}
              onMouseEnter={(e) => {
                if (hasChild) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (hasChild) selectChildNode()
                setNodeContextMenu(null)
              }}
            >
              选择子节点
            </div>
            <div
              style={menuItemStyle(hasChild)}
              onMouseEnter={(e) => {
                if (hasChild) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (hasChild) selectAllChildren()
                setNodeContextMenu(null)
              }}
            >
              选择所有子节点
            </div>
            <div
              style={menuItemStyle(hasNode)}
              onMouseEnter={(e) => {
                if (hasNode) (e.target as HTMLDivElement).style.backgroundColor = '#177ddc'
              }}
              onMouseLeave={(e) => (e.target as HTMLDivElement).style.backgroundColor = 'transparent'}
              onClick={() => {
                if (hasNode) deleteSelectedNode()
                setNodeContextMenu(null)
              }}
            >
              删除节点
            </div>
          </div>
        )
      })()}

      {/* Click outside to close context menu */}
      {!isTexturePreviewMode && (contextMenu || nodeContextMenu) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1999,
          }}
          onClick={() => {
            setContextMenu(null)
            setNodeContextMenu(null)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu(null)
            setNodeContextMenu(null)
          }}
        />
      )}

      {/* Separate Dialog for Material Selection */}
      <GeosetSeparateDialog
        visible={separateDialogVisible}
        sourceGeosetIndex={separateSourceGeosetIndex}
        onCancel={() => setSeparateDialogVisible(false)}
        onConfirm={handleSeparateConfirm}
      />

      {loading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(2px)',
          color: 'white',
          pointerEvents: 'none'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(255,255,255,0.2)',
            borderTop: '3px solid #1890ff',
            borderRadius: '50%',
            animation: 'viewer-spin 1s linear infinite',
            marginBottom: '12px'
          }} />
          <div style={{
            fontSize: '14px',
            fontWeight: 500,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            letterSpacing: '0.05em'
          }}>
            {loadingStatus}
          </div>
          <style>{`
            @keyframes viewer-spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
    </div>
  )
})

export default Viewer
