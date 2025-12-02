import React, { useEffect, useRef, useState } from 'react'
import { ModelRenderer, parseMDX, parseMDL, decodeBLP, getBLPImageData } from 'war3-model'
import { mat4, vec3, vec4, quat } from 'gl-matrix'
import { GridRenderer } from './GridRenderer'
import { DebugRenderer } from './DebugRenderer'
import { GizmoRenderer, GizmoAxis } from './GizmoRenderer'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelInfoPanel } from './info/ModelInfoPanel'
import { ViewerToolbar } from './ViewerToolbar'
import { ConfigProvider, theme } from 'antd'
import { commandManager } from '../utils/CommandManager'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { VertexEditor } from './VertexEditor'
import BoneBindingPanel from './BoneBindingPanel'
interface ViewerProps {
  modelPath: string | null
  animationIndex: number
  teamColor: number
  showGrid: boolean
  showNodes: boolean
  showSkeleton: boolean
  showWireframe: boolean
  isPlaying: boolean
  onTogglePlay: () => void
  onModelLoaded: (model: any) => void
  backgroundColor: string
  showFPS: boolean
  viewPreset?: { type: string, time: number } | null
  modelData?: any
}

const Viewer: React.FC<ViewerProps> = ({
  modelPath,
  animationIndex,
  teamColor,
  showGrid,
  showNodes,
  showSkeleton,
  showWireframe,
  isPlaying,
  onTogglePlay,
  onModelLoaded,
  backgroundColor,
  showFPS,
  viewPreset,
  modelData
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderer, setRenderer] = useState<ModelRenderer | null>(null)
  const [fps, setFps] = useState<number>(0)
  const gridRenderer = useRef(new GridRenderer())
  const debugRenderer = useRef(new DebugRenderer())
  const gizmoRenderer = useRef(new GizmoRenderer())
  const rendererRef = useRef<ModelRenderer | null>(null)

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
  const showWireframeRef = useRef(showWireframe)
  const isPlayingRef = useRef(isPlaying)
  const backgroundColorRef = useRef(backgroundColor)

  // Progress bar state
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(100)
  const lastProgressUpdate = useRef(0)
  const ignoreNextModelDataUpdate = useRef(false)

  useEffect(() => {
    showGridRef.current = showGrid
    showNodesRef.current = showNodes
    showSkeletonRef.current = showSkeleton
    showWireframeRef.current = showWireframe
    isPlayingRef.current = isPlaying
    backgroundColorRef.current = backgroundColor
  }, [showGrid, showNodes, showSkeleton, showWireframe, isPlaying, backgroundColor])

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

  const resetCamera = () => {
    vec3.set(targetCamera.current.target, 0, 0, 0)
    targetCamera.current.distance = 500
    targetCamera.current.theta = Math.PI / 4
    targetCamera.current.phi = Math.PI / 4
  }

  // Mouse interaction state
  const mouseState = useRef({
    isDragging: false,
    dragButton: -1, // 0: Left, 1: Middle, 2: Right
    lastMouseX: 0,
    lastMouseY: 0,
    startX: 0,
    startY: 0,
    isBoxSelecting: false
  })

  const initialVertexPositions = useRef<Map<string, [number, number, number]>>(new Map())

  // Gizmo state
  const gizmoState = useRef<{
    activeAxis: GizmoAxis,
    isDragging: boolean,
    dragStartPos: vec3 | null
  }>({
    activeAxis: null,
    isDragging: false,
    dragStartPos: null
  })

  // Box selection overlay state
  const [selectionBox, setSelectionBox] = useState<{ x: number, y: number, width: number, height: number } | null>(null)

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
    if (renderer) {
      if (appMainMode === 'geometry') {
        // Force Bind Pose
        if ((renderer as any).setSequence) {
          (renderer as any).setSequence(-1)
        }
        // Reset frame to 0 to ensure static pose
        if (renderer.rendererData) {
          renderer.rendererData.frame = 0
        }
      } else {
        // Restore Animation
        if ((renderer as any).setSequence) {
          (renderer as any).setSequence(animationIndex)
        }
      }
    }
  }, [renderer, appMainMode, animationIndex])

  useEffect(() => {
    return () => {
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [])

  useEffect(() => {
    if (modelData && modelPath) {
      if (ignoreNextModelDataUpdate.current) {
        ignoreNextModelDataUpdate.current = false
        return
      }
      // If we have modelData, it means the model was updated (e.g., texture edit)
      // Reload the renderer with the updated modelData
      console.log('[Viewer] Reloading renderer with updated modelData')
      reloadRendererWithData(modelData, modelPath)
    } else if (modelPath) {
      // Otherwise load from file
      loadModel(modelPath)
    }
  }, [modelPath, modelData])

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
    // Check for Gizmo interaction first
    if (gizmoState.current.activeAxis && e.button === 0) {
      gizmoState.current.isDragging = true
      mouseState.current.lastMouseX = e.clientX
      mouseState.current.lastMouseY = e.clientY

      // Capture initial positions for Undo
      initialVertexPositions.current.clear()
      const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()

      const captureVertex = (geosetIndex: number, vertexIndex: number) => {
        if (!renderer) return
        const geoset = renderer.model.Geosets[geosetIndex]
        if (!geoset) return
        const vIndex = vertexIndex * 3
        const key = `${geosetIndex}-${vertexIndex}`
        if (!initialVertexPositions.current.has(key)) {
          initialVertexPositions.current.set(key, [geoset.Vertices[vIndex], geoset.Vertices[vIndex + 1], geoset.Vertices[vIndex + 2]])
        }
      }

      if (geometrySubMode === 'vertex') {
        selectedVertexIds.forEach(sel => captureVertex(sel.geosetIndex, sel.index))
      } else if (geometrySubMode === 'face') {
        selectedFaceIds.forEach(sel => {
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

    // Check for box selection start
    const { mainMode } = useSelectionStore.getState()
    // const isCtrl = e.ctrlKey || e.metaKey

    // Box Selection: Alt + Left Click
    if (e.button === 0 && e.altKey && (mainMode === 'geometry' || mainMode === 'animation')) {
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

    const { mainMode, geometrySubMode, addVertexSelection, addFaceSelection, removeVertexSelection, removeFaceSelection, selectVertices, selectFaces, selectNodes } = useSelectionStore.getState()

    if (mainMode !== 'geometry' && mainMode !== 'animation') return

    // Normalize box coordinates relative to canvas
    const rect = canvasRef.current.getBoundingClientRect()
    const boxLeft = Math.min(startX, endX) - rect.left
    const boxRight = Math.max(startX, endX) - rect.left
    const boxTop = Math.min(startY, endY) - rect.top
    const boxBottom = Math.max(startY, endY) - rect.top

    const { distance, theta, phi, target } = targetCamera.current
    const cameraPos = vec3.create()
    const cameraX = distance * Math.sin(phi) * Math.cos(theta)
    const cameraY = distance * Math.sin(phi) * Math.sin(theta)
    const cameraZ = distance * Math.cos(phi)
    vec3.set(cameraPos, cameraX, cameraY, cameraZ)
    vec3.add(cameraPos, cameraPos, target)

    const pMatrix = mat4.create()
    mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 20000)

    const mvMatrix = mat4.create()
    const cameraUp = vec3.fromValues(0, 0, 1)
    mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)

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

    if (geometrySubMode === 'vertex') {
      const newSelection: { geosetIndex: number, index: number }[] = []
      if (!rendererRef.current) return
      for (let i = 0; i < rendererRef.current.model.Geosets.length; i++) {
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
      for (let i = 0; i < rendererRef.current.model.Geosets.length; i++) {
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
            // Check if all vertices are inside (Window selection)
            const in0 = s0[0] >= boxLeft && s0[0] <= boxRight && s0[1] >= boxTop && s0[1] <= boxBottom
            const in1 = s1[0] >= boxLeft && s1[0] <= boxRight && s1[1] >= boxTop && s1[1] <= boxBottom
            const in2 = s2[0] >= boxLeft && s2[0] <= boxRight && s2[1] >= boxTop && s2[1] <= boxBottom

            if (in0 && in1 && in2) {
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
    } else if (mainMode === 'animation') {
      // Box Select Nodes
      const newSelection: number[] = []
      if (!rendererRef.current || !rendererRef.current.rendererData || !rendererRef.current.rendererData.nodes) return

      rendererRef.current.rendererData.nodes.forEach(nodeWrapper => {
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

    const { mainMode, geometrySubMode, selectVertex, selectFace, addVertexSelection, addFaceSelection, removeVertexSelection, removeFaceSelection, clearAllSelections, selectNode } = useSelectionStore.getState()

    // Handle Animation Mode Bone Selection
    if (mainMode === 'animation') {
      // Simple distance check for nodes
      // Project all nodes to screen and find closest
      const rect = canvasRef.current.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top

      const { distance, theta, phi, target } = targetCamera.current
      const cameraPos = vec3.create()
      const cameraX = distance * Math.sin(phi) * Math.cos(theta)
      const cameraY = distance * Math.sin(phi) * Math.sin(theta)
      const cameraZ = distance * Math.cos(phi)
      vec3.set(cameraPos, cameraX, cameraY, cameraZ)
      vec3.add(cameraPos, cameraPos, target)

      const pMatrix = mat4.create()
      mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 20000)

      const mvMatrix = mat4.create()
      const cameraUp = vec3.fromValues(0, 0, 1)
      mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)

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
        rendererRef.current.rendererData.nodes.forEach(nodeWrapper => {
          // Check Pivot Point
          const pivot = nodeWrapper.node.PivotPoint
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
        selectNode(closestNodeId, isCtrl) // Support multi-select with Ctrl
      } else if (!isCtrl) {
        selectNode(-1) // Clear selection
      }
      return
    }

    if (mainMode !== 'geometry') return

    const rect = canvasRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    // Calculate ray from camera
    const { distance, theta, phi, target } = targetCamera.current
    const cameraPos = vec3.create()
    const cameraX = distance * Math.sin(phi) * Math.cos(theta)
    const cameraY = distance * Math.sin(phi) * Math.sin(theta)
    const cameraZ = distance * Math.cos(phi)
    vec3.set(cameraPos, cameraX, cameraY, cameraZ)
    vec3.add(cameraPos, cameraPos, target)

    const pMatrix = mat4.create()
    mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 20000)

    const mvMatrix = mat4.create()
    const cameraUp = vec3.fromValues(0, 0, 1)
    mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)

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

    const result = rendererRef.current.raycast(cameraPos, rayDir, geometrySubMode)

    if (result) {
      if (geometrySubMode === 'vertex') {
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
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if input is focused
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key.toLowerCase()) {
        case 'f': // Focus / Reset
          vec3.set(targetCamera.current.target, 0, 0, 0)
          targetCamera.current.distance = 500
          targetCamera.current.theta = Math.PI / 4
          targetCamera.current.phi = Math.PI / 4
          break
        case '1': // Front
          targetCamera.current.theta = -Math.PI / 2
          targetCamera.current.phi = Math.PI / 2
          break
        case '2': // Back
          targetCamera.current.theta = Math.PI / 2
          targetCamera.current.phi = Math.PI / 2
          break
        case '3': // Left
          targetCamera.current.theta = 0
          targetCamera.current.phi = Math.PI / 2
          break
        case '4': // Right
          targetCamera.current.theta = Math.PI
          targetCamera.current.phi = Math.PI / 2
          break
        case '5': // Top
          targetCamera.current.phi = 0.01
          break
        case '6': // Bottom
          targetCamera.current.phi = Math.PI - 0.01
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  const loadModel = async (path: string) => {
    // Cleanup old renderer and animation frames
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }

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
      if (!canvas) {
        console.error('[Viewer] Canvas reference is null')
        return
      }

      // Create WebGL context with alpha channel enabled
      const contextAttributes: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true,  // Changed from false to true
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

      gl.clearColor(0.2, 0.2, 0.2, 0)  // Changed from 1.0 to 0 to support transparency
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      // Set initial viewport
      gl.viewport(0, 0, canvas.width, canvas.height)

      gridRenderer.current.init(gl)
      debugRenderer.current.init(gl)

      const buffer = await readFile(path)
      let model: any

      if (path.toLowerCase().endsWith('.mdl')) {
        const text = new TextDecoder().decode(buffer)
        model = parseMDL(text)
      } else {
        model = parseMDX(buffer.buffer)
      }

      ignoreNextModelDataUpdate.current = true
      onModelLoaded(model)

      const newRenderer = new ModelRenderer(model)
      newRenderer.initGL(gl)
      setRenderer(newRenderer)
      newRenderer.update(0)
      resetCamera()

      // Load textures with MPQ priority
      if (model.Textures) {
        for (let i = 0; i < model.Textures.length; i++) {
          const texture = model.Textures[i]
          const texturePath = texture.Image
          if (!texturePath) continue

          try {
            let loaded = false

            // Strategy 1: Try MPQ first for standard War3 paths
            const isMPQPath = /^(Textures|UI|ReplaceableTextures|Units|Buildings|Doodads|Environment)[\\/]/i.test(texturePath)

            if (isMPQPath) {
              try {
                const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })

                if (mpqData && mpqData.length > 0) {
                  const mpqBuffer = new Uint8Array(mpqData).buffer
                  const blp = decodeBLP(mpqBuffer)
                  const mipLevel0 = getBLPImageData(blp, 0)
                  const idata = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                  )
                  if (newRenderer.setTextureImageData) {
                    newRenderer.setTextureImageData(texturePath, [idata])
                  }
                  loaded = true
                }
              } catch (mpqError) {
                // MPQ loading failed, will try file system
              }
            }

            // Strategy 2: Try local file system if MPQ didn't work
            if (!loaded) {
              const normalize = (p: string) => p.replace(/\//g, '\\')
              let textureRelPath = normalize(texturePath)
              const modelDir = normalize(path.substring(0, path.lastIndexOf('\\')))

              if (textureRelPath.toLowerCase().startsWith('war3mapimported\\')) {
                textureRelPath = textureRelPath.substring('war3mapimported\\'.length)
              }

              const candidates: string[] = []
              candidates.push(`${modelDir}\\${textureRelPath}`)

              const filename = textureRelPath.split('\\').pop() || ''
              if (filename !== textureRelPath) {
                candidates.push(`${modelDir}\\${filename}`)
              }

              let currentDir = modelDir
              for (let depth = 0; depth < 3; depth++) {
                const lastSlash = currentDir.lastIndexOf('\\')
                if (lastSlash === -1) break
                currentDir = currentDir.substring(0, lastSlash)
                candidates.push(`${currentDir}\\${textureRelPath}`)
              }

              for (const candidate of candidates) {
                try {
                  const texBuffer = await readFile(candidate)
                  const blp = decodeBLP(texBuffer.buffer)
                  const mipLevel0 = getBLPImageData(blp, 0)
                  const idata = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                  )
                  if (newRenderer.setTextureImageData) {
                    newRenderer.setTextureImageData(texturePath, [idata])
                  }
                  loaded = true
                  break
                } catch (e) {
                  // Continue to next candidate
                }
              }
            }

            if (!loaded) {
              console.warn(`[Viewer] Failed to load texture: ${texturePath}`)
            }
          } catch (e) {
            console.error(`[Viewer] Error processing texture:`, e)
          }
        }
      }

      loadTeamColorTextures(teamColor)
    } catch (error) {
      console.error('[Viewer] Error loading model:', error)
    }
  }

  const reloadRendererWithData = async (model: any, path: string) => {
    // Cleanup old renderer
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }

    if (renderer) {
      console.log('[Viewer] Destroying old renderer for data reload')
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

      console.log('[Viewer] Creating new renderer with updated data')
      const newRenderer = new ModelRenderer(model)
      newRenderer.initGL(gl)
      setRenderer(newRenderer)
      newRenderer.update(0)
      resetCamera()

      // Load textures with MPQ priority (same logic as loadModel)
      if (model.Textures) {
        for (let i = 0; i < model.Textures.length; i++) {
          const texture = model.Textures[i]
          const texturePath = texture.Image
          if (!texturePath) continue

          try {
            let loaded = false

            // Strategy 1: Try MPQ first for standard War3 paths
            const isMPQPath = /^(Textures|UI|ReplaceableTextures|Units|Buildings|Doodads|Environment)[\\/]/i.test(texturePath)

            if (isMPQPath) {
              try {
                const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })

                if (mpqData && mpqData.length > 0) {
                  const mpqBuffer = new Uint8Array(mpqData).buffer
                  const blp = decodeBLP(mpqBuffer)
                  const mipLevel0 = getBLPImageData(blp, 0)
                  const idata = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                  )
                  if (newRenderer.setTextureImageData) {
                    newRenderer.setTextureImageData(texturePath, [idata])
                  }
                  loaded = true
                }
              } catch (mpqError) {
                // MPQ loading failed, will try file system
              }
            }

            // Strategy 2: Try local file system if MPQ didn't work
            if (!loaded) {
              const normalize = (p: string) => p.replace(/\//g, '\\')
              let textureRelPath = normalize(texturePath)
              const modelDir = normalize(path.substring(0, path.lastIndexOf('\\')))

              if (textureRelPath.toLowerCase().startsWith('war3mapimported\\')) {
                textureRelPath = textureRelPath.substring('war3mapimported\\'.length)
              }

              const candidates: string[] = []
              candidates.push(`${modelDir}\\${textureRelPath}`)

              const filename = textureRelPath.split('\\').pop() || ''
              if (filename !== textureRelPath) {
                candidates.push(`${modelDir}\\${filename}`)
              }

              let currentDir = modelDir
              for (let depth = 0; depth < 3; depth++) {
                const lastSlash = currentDir.lastIndexOf('\\')
                if (lastSlash === -1) break
                currentDir = currentDir.substring(0, lastSlash)
                candidates.push(`${currentDir}\\${textureRelPath}`)
              }

              for (const candidate of candidates) {
                try {
                  const texBuffer = await readFile(candidate)
                  const blp = decodeBLP(texBuffer.buffer)
                  const mipLevel0 = getBLPImageData(blp, 0)
                  const idata = new ImageData(
                    new Uint8ClampedArray(mipLevel0.data),
                    mipLevel0.width,
                    mipLevel0.height
                  )
                  if (newRenderer.setTextureImageData) {
                    newRenderer.setTextureImageData(texturePath, [idata])
                  }
                  loaded = true
                  break
                } catch (e) {
                  // Continue to next candidate
                }
              }
            }

            if (!loaded) {
              console.warn(`[Viewer] Failed to load texture: ${texturePath}`)
            }
          } catch (e) {
            console.error(`[Viewer] Error processing texture:`, e)
          }
        }
      }

      loadTeamColorTextures(teamColor)
    } catch (error) {
      console.error('[Viewer] Error reloading renderer with data:', error)
    }
  }

  // Handle Animation and Mode Changes
  useEffect(() => {
    if (renderer && canvasRef.current) {
      const contextAttributes: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true  // Changed from false to true
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

      const render = (time: DOMHighResTimeStamp) => {
        if (!gl || !canvasRef.current || !renderer) {
          animationFrameId.current = requestAnimationFrame(render)
          return
        }

        const canvas = canvasRef.current
        const mdlRenderer = renderer
        const delta = time - lastFrameTime.current
        lastFrameTime.current = time

        const cameraPos = vec3.create()
        const cameraUp = vec3.fromValues(0, 0, 1)
        const cameraQuat = quat.create()
        const pMatrix = mat4.create()
        const mvMatrix = mat4.create()

        const hexToRgb = (hex: string) => {
          const r = parseInt(hex.slice(1, 3), 16) / 255
          const g = parseInt(hex.slice(3, 5), 16) / 255
          const b = parseInt(hex.slice(5, 7), 16) / 255
          return [r, g, b]
        }
        const [r, g, b] = hexToRgb(backgroundColorRef.current)
        gl.clearColor(r, g, b, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

        const { distance, theta, phi, target } = targetCamera.current

        const x = distance * Math.sin(phi) * Math.cos(theta)
        const y = distance * Math.sin(phi) * Math.sin(theta)
        const z = distance * Math.cos(phi)

        vec3.set(cameraPos, x, y, z)
        vec3.add(cameraPos, cameraPos, target) // Add target offset

        mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)
        mat4.perspective(pMatrix, Math.PI / 4, canvas.width / canvas.height, 1, 5000)

        const { geometrySubMode, transformMode, selectedVertexIds, selectedFaceIds } = useSelectionStore.getState()

        // Determine if we should be in Bind Pose (static, no animation)
        const isBindPoseMode = appMainMode === 'geometry' || (appMainMode === 'animation' && animationSubMode === 'binding')

        // Update animation only when playing and NOT in Bind Pose mode
        if (isPlayingRef.current && !isBindPoseMode) {
          mdlRenderer.update(delta)
        }

        // Update progress bar
        if (mdlRenderer.rendererData && mdlRenderer.rendererData.animationInfo) {
          const info = mdlRenderer.rendererData.animationInfo
          const current = mdlRenderer.rendererData.frame
          updateProgress(current, info.Interval[1])
        }

        if (mdlRenderer.rendererData) {
          mdlRenderer.setCamera(cameraPos, cameraQuat)

          // Force Bind Pose in Geometry Mode or Bone Binding Mode
          if (isBindPoseMode) {
            // Force all node matrices to identity every frame to ensure strict Bind Pose
            // This prevents any residual animation or update logic from offsetting the mesh
            if (mdlRenderer.rendererData.nodes) {
              mdlRenderer.rendererData.nodes.forEach(node => {
                if (node && node.matrix) {
                  mat4.identity(node.matrix)
                }
              })
            }
            if (mdlRenderer.rendererData.rootNode) {
              mat4.identity(mdlRenderer.rendererData.rootNode.matrix)
            }
          }

          mdlRenderer.render(mvMatrix, pMatrix, { wireframe: showWireframeRef.current || (appMainMode === 'geometry' && geometrySubMode === 'face') })

          // Render nodes (debug) - not in geometry mode, but OK in binding mode
          if (showNodesRef.current && mdlRenderer.rendererData.nodes && appMainMode !== 'geometry') {
            debugRenderer.current.renderNodes(gl as WebGLRenderingContext, mvMatrix, pMatrix, mdlRenderer.rendererData.nodes as any)
          }

          // Render skeleton - show in animation mode (including binding submode), but not in geometry mode
          if (showSkeletonRef.current && mdlRenderer.rendererData.nodes && appMainMode === 'animation') {
            gl.disable(gl.DEPTH_TEST)
            mdlRenderer.renderSkeleton(mvMatrix, pMatrix, null)
            gl.enable(gl.DEPTH_TEST)
          }
        }


        // Render vertices in Geometry Mode (vertex submode) OR Bone Binding Mode
        if ((appMainMode === 'geometry' && geometrySubMode === 'vertex') ||
          (appMainMode === 'animation' && animationSubMode === 'binding')) {
          // Render all vertices as small blue dots
          for (const geoset of mdlRenderer.model.Geosets) {
            if (geoset.Vertices) {
              debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, geoset.Vertices, [0, 0, 1, 0.5], 5.0)
            }
          }

          // Render selected vertices as red dots
          if (selectedVertexIds.length > 0) {
            const selectedPositions: number[] = []
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
            debugRenderer.current.renderPoints(gl as WebGLRenderingContext, mvMatrix, pMatrix, selectedPositions, [1, 0, 0, 1], 5.0)
          }
        }

        // Render face selection (only in geometry mode, face submode)
        if (appMainMode === 'geometry' && geometrySubMode === 'face') {
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
            // Render filled triangles (semi-transparent red)
            debugRenderer.current.renderTriangles(gl as WebGLRenderingContext, mvMatrix, pMatrix, selectedPositions, [1, 0, 0, 0.5])

            // Prepare wireframe lines
            const linePositions: number[] = []
            for (let i = 0; i < selectedPositions.length; i += 9) {
              linePositions.push(selectedPositions[i], selectedPositions[i + 1], selectedPositions[i + 2])
              linePositions.push(selectedPositions[i + 3], selectedPositions[i + 4], selectedPositions[i + 5])
              linePositions.push(selectedPositions[i + 3], selectedPositions[i + 4], selectedPositions[i + 5])
              linePositions.push(selectedPositions[i + 6], selectedPositions[i + 7], selectedPositions[i + 8])
              linePositions.push(selectedPositions[i + 6], selectedPositions[i + 7], selectedPositions[i + 8])
              linePositions.push(selectedPositions[i], selectedPositions[i + 1], selectedPositions[i + 2])
            }

            // Render wireframe (solid red)
            debugRenderer.current.renderLines(gl as WebGLRenderingContext, mvMatrix, pMatrix, linePositions, [1, 0, 0, 1])
          }
        }

        // Render Gizmo
        if (transformMode) {
          const center = vec3.create()
          let count = 0
          let showGizmo = false

          // Case 1: Geometry Mode - Vertex/Face
          if (appMainMode === 'geometry') {
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
          // Case 2: Animation Mode (Binding) - Bones
          else if (appMainMode === 'animation' && animationSubMode === 'binding') {
            const { selectedNodeIds } = useSelectionStore.getState()
            if (selectedNodeIds && selectedNodeIds.length > 0) {
              for (const nodeId of selectedNodeIds) {
                const nodeWrapper = mdlRenderer.rendererData.nodes[nodeId]
                if (nodeWrapper && nodeWrapper.node && nodeWrapper.node.PivotPoint) {
                  const pivot = nodeWrapper.node.PivotPoint
                  center[0] += pivot[0]
                  center[1] += pivot[1]
                  center[2] += pivot[2]
                  count++
                }
              }
              showGizmo = true
            }
          }

          if (showGizmo && count > 0) {
            vec3.scale(center, center, 1.0 / count)
            gizmoRenderer.current.render(gl as WebGLRenderingContext, mvMatrix, pMatrix, center, transformMode as any, gizmoState.current.activeAxis)
          }
        }

        if (showGridRef.current) {
          gridRenderer.current.render(gl as WebGLRenderingContext, mvMatrix, pMatrix)
        }

        frameCount.current++
        if (time - lastFpsTime.current >= 1000) {
          setFps(Math.round(frameCount.current * 1000 / (time - lastFpsTime.current)))
          frameCount.current = 0
          lastFpsTime.current = time
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
    // If renderer or canvas is not ready, return undefined
    return undefined
  }, [renderer, appMainMode, animationSubMode, animationIndex])

  // Handle W/E/R Shortcuts
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

  // Reset animation when entering Geometry Mode to ensure Bind Pose
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

      const { transformMode, mainMode } = useSelectionStore.getState()
      const axis = gizmoState.current.activeAxis

      // Only allow vertex/face transformation in Geometry Mode
      if (mainMode !== 'geometry') {
        return
      }

      // Calculate Camera Vectors for World Movement
      const { theta, phi, distance } = targetCamera.current
      const forward = vec3.fromValues(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
      const up = vec3.fromValues(0, 0, 1)
      const right = vec3.create()
      vec3.cross(right, forward, up)
      vec3.normalize(right, right)
      const camUp = vec3.create()
      vec3.cross(camUp, right, forward)
      vec3.normalize(camUp, camUp)

      const moveScale = distance * 0.001

      // Calculate world movement delta based on camera orientation
      const worldMoveDelta = vec3.create()
      vec3.scaleAndAdd(worldMoveDelta, worldMoveDelta, right, deltaX * moveScale)
      vec3.scaleAndAdd(worldMoveDelta, worldMoveDelta, camUp, -deltaY * moveScale) // Inverted Y

      if (transformMode === 'translate') {
        const moveVec = vec3.create()

        if (axis === 'x') moveVec[0] = -worldMoveDelta[0] // Invert X
        else if (axis === 'y') moveVec[1] = -worldMoveDelta[1] // Invert Y
        else if (axis === 'z') moveVec[2] = worldMoveDelta[2]
        else if (axis === 'xy') { moveVec[0] = -worldMoveDelta[0]; moveVec[1] = -worldMoveDelta[1]; } // Invert X & Y
        else if (axis === 'xz') { moveVec[0] = -worldMoveDelta[0]; moveVec[2] = worldMoveDelta[2]; } // Invert X
        else if (axis === 'yz') { moveVec[1] = -worldMoveDelta[1]; moveVec[2] = worldMoveDelta[2]; } // Invert Y

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
      } else if (transformMode === 'rotate' || transformMode === 'scale') {
        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()

        // Calculate Center
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
              angle = deltaY * 0.01
              vec3.set(rotAxis, 1, 0, 0)
            } else if (axis === 'y') {
              angle = -deltaX * 0.01 // Inverted Y rotation as requested
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
            else if (axis === 'center') { vec3.set(scaleVec, scaleFactor, scaleFactor, scaleFactor) } // Uniform

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
      return // Consume event
    }

    // 2. Camera / Box Selection Dragging
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
        vec3.scale(panY, camUp, deltaY * panSpeed) // Inverted Y for Pan

        vec3.add(targetCamera.current.target, targetCamera.current.target, panX)
        vec3.add(targetCamera.current.target, targetCamera.current.target, panY)
      }

      if (mouseState.current.dragButton === 0 && !mouseState.current.isBoxSelecting) {
        doRotate()
      } else if (mouseState.current.dragButton === 2 || mouseState.current.dragButton === 1) {
        doPan()
      } else if (mouseState.current.dragButton === 0 && mouseState.current.isBoxSelecting) {
        // Box Selection Update
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

    // 3. Gizmo Hover Check (Only if not dragging anything)
    if (!gizmoState.current.isDragging && !mouseState.current.isDragging && rendererRef.current) {
      const { transformMode, selectedVertexIds, selectedFaceIds, geometrySubMode, mainMode, animationSubMode, selectedNodeIds } = useSelectionStore.getState()

      // Check if we should show Gizmo
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
      } else if (mainMode === 'animation' && animationSubMode === 'binding' && selectedNodeIds.length > 0) {
        showGizmo = true
        for (const nodeId of selectedNodeIds) {
          const nodeWrapper = rendererRef.current.rendererData.nodes[nodeId]
          if (nodeWrapper && nodeWrapper.node && nodeWrapper.node.PivotPoint) {
            const pivot = nodeWrapper.node.PivotPoint
            center[0] += pivot[0]
            center[1] += pivot[1]
            center[2] += pivot[2]
            count++
          }
        }
      }

      if (showGizmo && count > 0 && transformMode) {
        vec3.scale(center, center, 1.0 / count)

        // Raycast
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top

          const { distance, theta, phi, target } = targetCamera.current
          const cameraPos = vec3.create()
          const cx = distance * Math.sin(phi) * Math.cos(theta)
          const cy = distance * Math.sin(phi) * Math.sin(theta)
          const cz = distance * Math.cos(phi)
          vec3.set(cameraPos, cx, cy, cz)
          vec3.add(cameraPos, cameraPos, target)

          const pMatrix = mat4.create()
          mat4.perspective(pMatrix, Math.PI / 4, rect.width / rect.height, 1, 5000) // Match render perspective

          const mvMatrix = mat4.create()
          const cameraUp = vec3.fromValues(0, 0, 1)
          mat4.lookAt(mvMatrix, cameraPos, target, cameraUp)

          const ndcX = (x / rect.width) * 2 - 1
          const ndcY = -((y / rect.height) * 2 - 1)
          const rayClip = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
          const invProj = mat4.create(); mat4.invert(invProj, pMatrix)
          const rayEye = vec4.create(); vec4.transformMat4(rayEye, rayClip, invProj)
          rayEye[2] = -1.0; rayEye[3] = 0.0
          const invView = mat4.create(); mat4.invert(invView, mvMatrix)
          const rayWorld = vec4.create(); vec4.transformMat4(rayWorld, rayEye, invView)
          const rayDir = vec3.fromValues(rayWorld[0], rayWorld[1], rayWorld[2])
          vec3.normalize(rayDir, rayDir)

          const hit = gizmoRenderer.current.raycast(cameraPos, rayDir, center, transformMode as any)
          gizmoState.current.activeAxis = hit
        }
      }
    }
  }

  const handleMouseUp = (e: any) => {
    // const wasDragging = mouseState.current.isDragging
    const wasBoxSelecting = mouseState.current.isBoxSelecting
    const startX = mouseState.current.startX
    const startY = mouseState.current.startY
    const dragButton = mouseState.current.dragButton

    mouseState.current.isDragging = false
    mouseState.current.isBoxSelecting = false
    mouseState.current.dragButton = -1
    setSelectionBox(null)

    if (gizmoState.current.isDragging) {
      gizmoState.current.isDragging = false

      // Commit Undo Command
      if (initialVertexPositions.current.size > 0 && rendererRef.current) {
        const changes: VertexChange[] = []
        initialVertexPositions.current.forEach((oldPos, key) => {
          const [geosetIndexStr, vertexIndexStr] = key.split('-')
          const geosetIndex = parseInt(geosetIndexStr)
          const vertexIndex = parseInt(vertexIndexStr)

          if (!rendererRef.current) return
          const geoset = rendererRef.current.model.Geosets[geosetIndex]
          if (geoset) {
            const vIndex = vertexIndex * 3
            const newPos: [number, number, number] = [geoset.Vertices[vIndex], geoset.Vertices[vIndex + 1], geoset.Vertices[vIndex + 2]]

            if (oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1] || oldPos[2] !== newPos[2]) {
              changes.push({ geosetIndex, vertexIndex, oldPos, newPos })
            }
          }
        })

        if (changes.length > 0) {
          commandManager.execute(new MoveVerticesCommand(rendererRef.current, changes))
        }
        initialVertexPositions.current.clear()
      }
      return
    }

    // Check if it was a click (not a drag)
    const deltaX = Math.abs(e.clientX - startX)
    const deltaY = Math.abs(e.clientY - startY)
    const isCtrl = e.ctrlKey || e.metaKey

    if (wasBoxSelecting && deltaX > 5 && deltaY > 5) {
      // Perform Box Selection
      handleBoxSelection(startX, startY, e.clientX, e.clientY, e.shiftKey, isCtrl)
    } else if (deltaX < 5 && deltaY < 5 && dragButton === 0) {
      // It's a left click
      handleSelectionClick(e.clientX, e.clientY, e.shiftKey, isCtrl)
    }
  }

  useEffect(() => {
    const handleUndoRedo = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault()
          commandManager.undo()
        } else if (e.key === 'y') {
          e.preventDefault()
          commandManager.redo()
        }
      }
    }
    window.addEventListener('keydown', handleUndoRedo)
    return () => window.removeEventListener('keydown', handleUndoRedo)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleWheel}
      />

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

      {selectionBox && (
        <div
          style={{
            position: 'absolute',
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.width,
            height: selectionBox.height,
            border: '1px solid rgba(0, 255, 0, 0.8)',
            backgroundColor: 'rgba(0, 255, 0, 0.2)',
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
              width: 320,
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

      <ViewerToolbar />
      <BoneBindingPanel />
      {appMainMode === 'geometry' && <VertexEditor renderer={renderer} />}
    </div>
  )
}

export default Viewer

