import React, { useEffect, useMemo, useRef, useState } from 'react'
import { mat4, vec3 } from 'gl-matrix'
import { createWar3ModelRenderer, type War3ModelRenderer } from '../../infrastructure/render'
import { createRetargetRendererModel } from '../../application/retarget/retargetRendererModel'
import { WEBGL_CONTEXT_ATTRIBUTES } from '../viewer/ViewerRenderConstants'
import { DebugRenderer } from '../DebugRenderer'
import { loadAllTextures } from '../viewer/textureLoader'
import { hexToRgb } from '../viewer/types'
import { SimpleOrbitCamera } from '../../utils/SimpleOrbitCamera'
import { useRendererStore } from '../../store/rendererStore'
import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import {
    createNodeScreenLabels,
    drawNodeNameOverlay,
    findClosestNodeLabel,
    type NodeScreenLabel,
} from '../viewer/nodeNameOverlay'
import { filterVisibleRendererNodes } from '../../types/nodeVisibility'

interface RetargetModelViewport3DProps {
    label: string
    modelPath: string | null
    modelData: ModelData | null | undefined
    nodes: ModelNode[]
    selectedNodeId: number | null
    onSelectNode: (node: ModelNode) => void
}

interface RetargetCameraSnapshot {
    horizontalAngle: number
    verticalAngle: number
    distance: number
    target: [number, number, number]
    farClipPlane: number
    projectionMode: SimpleOrbitCamera['projectionMode']
    orthoSize: number
}

const readVec3 = (value: unknown): [number, number, number] | null => {
    const source = (Array.isArray(value) || ArrayBuffer.isView(value)) ? value as ArrayLike<number> : null
    if (!source || source.length < 3) return null
    const x = Number(source[0])
    const y = Number(source[1])
    const z = Number(source[2])
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null
}

const getModelBounds = (model: any, modelData: any): { min: [number, number, number]; max: [number, number, number] } => {
    const info = model?.Info ?? modelData?.Model ?? modelData
    const extentMin = readVec3(info?.Extent?.Min) ?? readVec3(info?.MinimumExtent)
    const extentMax = readVec3(info?.Extent?.Max) ?? readVec3(info?.MaximumExtent)
    if (extentMin && extentMax) return { min: extentMin, max: extentMax }
    const radius = Number(info?.BoundsRadius ?? modelData?.Model?.BoundsRadius ?? 256)
    const r = Number.isFinite(radius) && radius > 0 ? radius : 256
    return { min: [-r, -r, -r], max: [r, r, r] }
}

const fitCameraToModel = (camera: SimpleOrbitCamera, model: any, modelData: any): void => {
    const bounds = getModelBounds(model, modelData)
    const min = vec3.fromValues(bounds.min[0], bounds.min[1], bounds.min[2])
    const max = vec3.fromValues(bounds.max[0], bounds.max[1], bounds.max[2])
    const center = vec3.create()
    vec3.add(center, min, max)
    vec3.scale(center, center, 0.5)
    const diagonal = Math.max(vec3.dist(min, max), 120)
    vec3.copy(camera.target, center)
    camera.distance = Math.max(diagonal * 1.2, 260)
    camera.horizontalAngle = Math.PI / 4
    camera.verticalAngle = Math.PI / 3
    camera.farClipPlane = Math.max(100000, diagonal * 100)
    camera.update()
}

const captureCameraSnapshot = (camera: SimpleOrbitCamera): RetargetCameraSnapshot => ({
    horizontalAngle: camera.horizontalAngle,
    verticalAngle: camera.verticalAngle,
    distance: camera.distance,
    target: [camera.target[0], camera.target[1], camera.target[2]],
    farClipPlane: camera.farClipPlane,
    projectionMode: camera.projectionMode,
    orthoSize: camera.orthoSize,
})

const restoreCameraSnapshot = (camera: SimpleOrbitCamera, snapshot: RetargetCameraSnapshot): void => {
    camera.horizontalAngle = snapshot.horizontalAngle
    camera.verticalAngle = snapshot.verticalAngle
    camera.distance = snapshot.distance
    camera.farClipPlane = snapshot.farClipPlane
    camera.projectionMode = snapshot.projectionMode
    camera.orthoSize = snapshot.orthoSize
    vec3.set(camera.target, snapshot.target[0], snapshot.target[1], snapshot.target[2])
    camera.update()
}

const getNodePivot = (modelData: any, node: ModelNode): vec3 | null => {
    const direct = readVec3((node as any).PivotPoint)
    const table = modelData?.PivotPoints
    const fallback = Array.isArray(table) && typeof node.ObjectId === 'number' ? readVec3(table[node.ObjectId]) : null
    const point = direct ?? fallback
    return point ? vec3.fromValues(point[0], point[1], point[2]) : null
}

const createNodeHitList = (
    rendererNodes: any[],
    mvMatrix: mat4,
    pMatrix: mat4,
    canvas: HTMLCanvasElement
): NodeScreenLabel[] => createNodeScreenLabels(rendererNodes, mvMatrix, pMatrix, canvas)

const stripNodePoseAnimationTracks = (node: any): any => {
    const next = { ...node }
    delete next.Translation
    delete next.Rotation
    delete next.Scaling
    return next
}

export const RetargetModelViewport3D: React.FC<RetargetModelViewport3DProps> = ({
    label,
    modelPath,
    modelData,
    nodes,
    selectedNodeId,
    onSelectNode,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const overlayRef = useRef<HTMLCanvasElement | null>(null)
    const rendererRef = useRef<War3ModelRenderer | null>(null)
    const cameraRef = useRef<SimpleOrbitCamera | null>(null)
    const debugRendererRef = useRef<DebugRenderer | null>(null)
    const rafRef = useRef<number | null>(null)
    const hitListRef = useRef<NodeScreenLabel[]>([])
    const hoveredNodeIdRef = useRef<number | null>(null)
    const dragStartRef = useRef<{ x: number; y: number } | null>(null)
    const selectedNodeIdRef = useRef<number | null>(selectedNodeId)
    const nodesRef = useRef(nodes)
    const modelDataRef = useRef(modelData)
    const cameraSnapshotRef = useRef<RetargetCameraSnapshot | null>(null)
    const lastCameraModelPathRef = useRef<string | null>(null)
    const [status, setStatus] = useState(modelData ? '加载中...' : '未打开模型')
    const backgroundColor = useRendererStore((state) => state.backgroundColor)
    const renderMode = useRendererStore((state) => state.renderMode)
    const showGridXY = useRendererStore((state) => state.showGridXY)
    const showSkeleton = useRendererStore((state) => state.showSkeleton)
    const nodeColors = useRendererStore((state) => state.nodeColors)
    const nodeSize = useRendererStore((state) => state.nodeSize)
    const nodeRenderMode = useRendererStore((state) => state.nodeRenderMode)
    const nodeNameDisplayMode = useRendererStore((state) => state.nodeNameDisplayMode)
    const nodeTypeVisibility = useRendererStore((state) => state.nodeTypeVisibility)
    const renderModeRef = useRef(renderMode)
    const showSkeletonRef = useRef(showSkeleton)
    const backgroundColorRef = useRef(backgroundColor)
    const nodeColorsRef = useRef(nodeColors)
    const nodeSizeRef = useRef(nodeSize)
    const nodeRenderModeRef = useRef(nodeRenderMode)
    const nodeNameDisplayModeRef = useRef(nodeNameDisplayMode)
    const nodeTypeVisibilityRef = useRef(nodeTypeVisibility)

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.ObjectId, node])), [nodes])

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId
    }, [selectedNodeId])

    useEffect(() => {
        nodesRef.current = nodes
    }, [nodes])

    useEffect(() => {
        modelDataRef.current = modelData
    }, [modelData])

    useEffect(() => {
        renderModeRef.current = renderMode
    }, [renderMode])

    useEffect(() => {
        showSkeletonRef.current = showSkeleton
    }, [showSkeleton])

    useEffect(() => {
        backgroundColorRef.current = backgroundColor
    }, [backgroundColor])

    useEffect(() => {
        nodeColorsRef.current = nodeColors
    }, [nodeColors])

    useEffect(() => {
        nodeSizeRef.current = nodeSize
    }, [nodeSize])

    useEffect(() => {
        nodeRenderModeRef.current = nodeRenderMode
    }, [nodeRenderMode])

    useEffect(() => {
        nodeNameDisplayModeRef.current = nodeNameDisplayMode
    }, [nodeNameDisplayMode])

    useEffect(() => {
        nodeTypeVisibilityRef.current = nodeTypeVisibility
    }, [nodeTypeVisibility])

    useEffect(() => {
        const canvas = canvasRef.current
        if (lastCameraModelPathRef.current !== modelPath) {
            cameraSnapshotRef.current = null
            lastCameraModelPathRef.current = modelPath
        }
        if (!canvas || !modelData) {
            setStatus(modelData ? '画布未就绪' : '未打开模型')
            return
        }

        let disposed = false
        setStatus('加载中...')
        const gl =
            (canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null) ||
            (canvas.getContext('webgl', WEBGL_CONTEXT_ATTRIBUTES) as WebGLRenderingContext | null)

        if (!gl) {
            setStatus('无法初始化 WebGL')
            return
        }

        const resize = () => {
            const rect = canvas.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1
            const width = Math.max(1, Math.floor(rect.width * dpr))
            const height = Math.max(1, Math.floor(rect.height * dpr))
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width
                canvas.height = height
                gl.viewport(0, 0, width, height)
            }
            const overlay = overlayRef.current
            if (overlay && (overlay.width !== width || overlay.height !== height)) {
                overlay.width = width
                overlay.height = height
            }
        }

        const rendererModel = createRetargetRendererModel(modelData)
        const renderer = createWar3ModelRenderer(rendererModel)
        rendererRef.current = renderer
        renderer.initGL(gl)
        ;(renderer as any).setSequence?.(-1)
        if ((renderer as any).rendererData) {
            ;(renderer as any).rendererData.animation = -1
            ;(renderer as any).rendererData.animationInfo = null
            ;(renderer as any).rendererData.frame = 0
        }
        renderer.update(0)
        ;(renderer as any).setTeamColor?.([1, 0, 0])
        const debugRenderer = new DebugRenderer()
        debugRenderer.init(gl)
        debugRendererRef.current = debugRenderer

        const camera = new SimpleOrbitCamera(canvas)
        cameraRef.current = camera
        if (cameraSnapshotRef.current) {
            restoreCameraSnapshot(camera, cameraSnapshotRef.current)
        } else {
            fitCameraToModel(camera, renderer.model, modelData)
            cameraSnapshotRef.current = captureCameraSnapshot(camera)
        }

        const mvMatrix = mat4.create()
        const pMatrix = mat4.create()
        const clear = () => {
            const rgb = backgroundColorRef.current.match(/[0-9a-f]{2}/gi)?.slice(0, 3).map((hex) => parseInt(hex, 16) / 255)
            if (rgb?.length === 3) {
                gl.clearColor(rgb[0], rgb[1], rgb[2], 1)
            } else {
                gl.clearColor(0.09, 0.09, 0.09, 1)
            }
            gl.enable(gl.DEPTH_TEST)
            gl.depthFunc(gl.LEQUAL)
            gl.enable(gl.BLEND)
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        }

        const buildNodeTypeColors = () => {
            const colors = nodeColorsRef.current
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
                ParticleEmitterPopcorn: toRgba(colors.ParticleEmitterPopcorn),
            }
        }

        const getScreenStableWorldScale = (targetPixels: number) => {
            const viewportHeight = Math.max(1, canvas.height || canvas.clientHeight || 1)
            const cam = cameraRef.current
            if (!cam) return 1
            const fov = (cam as any).fov || Math.PI / 4
            const depth = Math.max(0.1, cam.distance)
            return (2 * depth * Math.tan(fov / 2) / viewportHeight) * targetPixels
        }

        const drawNodeOverlay = () => {
            const overlay = overlayRef.current
            drawNodeNameOverlay(
                overlay,
                hitListRef.current,
                nodeNameDisplayModeRef.current,
                selectedNodeIdRef.current !== null ? [selectedNodeIdRef.current] : [],
                hoveredNodeIdRef.current
            )
        }

        const syncRendererNodesFromStore = () => {
            const nextNodes = nodesRef.current
            const rendererNodes = (renderer as any).rendererData?.nodes as any[] | undefined
            if (!Array.isArray(rendererNodes)) return rendererNodes ?? []
            const byId = new Map(nextNodes.map((node) => [node.ObjectId, node]))
            for (const wrapper of rendererNodes) {
                const replacement = byId.get(wrapper?.node?.ObjectId)
                if (replacement) {
                    wrapper.node = {
                        ...wrapper.node,
                        ...stripNodePoseAnimationTracks(replacement),
                        PivotPoint: getNodePivot(modelDataRef.current, replacement) ?? wrapper.node.PivotPoint,
                    }
                }
            }
            return rendererNodes
        }

        const render = () => {
            if (disposed) return
            resize()
            clear()
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
            camera.getMatrix(mvMatrix, pMatrix)
            const rendererNodes = filterVisibleRendererNodes(syncRendererNodesFromStore(), null, nodeTypeVisibilityRef.current)
            if ((renderer as any).rendererData) {
                ;(renderer as any).rendererData.animation = -1
                ;(renderer as any).rendererData.animationInfo = null
                ;(renderer as any).rendererData.frame = 0
            }
            renderer.update(0)
            renderer.render(mvMatrix, pMatrix, {
                wireframe: renderModeRef.current === 'wireframe',
                enableLighting: true,
            } as any)
            if (renderModeRef.current === 'texturedWireframe') {
                renderer.render(mvMatrix, pMatrix, {
                    wireframe: true,
                    enableLighting: false,
                } as any)
            }
            if (showSkeletonRef.current && (renderer as any).renderSkeleton) {
                gl.disable(gl.DEPTH_TEST)
                ;(renderer as any).renderSkeleton(mvMatrix, pMatrix, null, selectedNodeIdRef.current !== null ? [selectedNodeIdRef.current] : [])
                gl.enable(gl.DEPTH_TEST)
            }
            if (nodeRenderModeRef.current !== 'hidden' && rendererNodes.length > 0 && debugRendererRef.current) {
                const selectedNodeId = selectedNodeIdRef.current
                const selectedNode = selectedNodeId !== null
                    ? rendererNodes.find((node: any) => node?.node?.ObjectId === selectedNodeId)
                    : null
                const parentOfSelected = selectedNode?.node?.Parent ?? null
                const childrenOfSelected = selectedNodeId !== null
                    ? rendererNodes.filter((node: any) => node?.node?.Parent === selectedNodeId).map((node: any) => node.node.ObjectId)
                    : []
                const nodeWorldSize = (getScreenStableWorldScale(18) / 4.8) * (nodeSizeRef.current ?? 1)
                debugRendererRef.current.renderNodes(
                    gl,
                    mvMatrix,
                    pMatrix,
                    rendererNodes,
                    selectedNodeId !== null ? [selectedNodeId] : [],
                    parentOfSelected,
                    childrenOfSelected,
                    buildNodeTypeColors(),
                    false,
                    nodeWorldSize,
                    nodeRenderModeRef.current === 'wireframe' ? 'wireframe' : 'solid'
                )
            }
            hitListRef.current = rendererNodes.length > 0 ? createNodeHitList(rendererNodes, mvMatrix, pMatrix, canvas) : []
            drawNodeOverlay()
            rafRef.current = requestAnimationFrame(render)
        }

        resize()
        clear()
        setStatus('')
        rafRef.current = requestAnimationFrame(render)
        void loadAllTextures(renderer.model, renderer, modelPath || '', undefined, 512, {
            yieldUploads: true,
            workerDecodeMinTextures: 99,
        })

        return () => {
            disposed = true
            if (cameraRef.current) {
                cameraSnapshotRef.current = captureCameraSnapshot(cameraRef.current)
            }
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
            }
            camera.destroy()
            renderer.destroy?.()
            if (rendererRef.current === renderer) rendererRef.current = null
            if (cameraRef.current === camera) cameraRef.current = null
            if (debugRendererRef.current === debugRenderer) debugRendererRef.current = null
        }
    }, [modelPath, modelData])

    const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const dragStart = dragStartRef.current
        if (dragStart && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 4) {
            return
        }
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / Math.max(1, rect.width)
        const scaleY = canvas.height / Math.max(1, rect.height)
        const x = (event.clientX - rect.left) * scaleX
        const y = (event.clientY - rect.top) * scaleY
        const best = findClosestNodeLabel(hitListRef.current, x, y, 20)
        const node = best ? nodesRef.current.find((item) => item.ObjectId === best.id) : null
        if (node) onSelectNode(node)
    }

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / Math.max(1, rect.width)
        const scaleY = canvas.height / Math.max(1, rect.height)
        const x = (event.clientX - rect.left) * scaleX
        const y = (event.clientY - rect.top) * scaleY
        hoveredNodeIdRef.current = findClosestNodeLabel(hitListRef.current, x, y, 20)?.id ?? null
    }

    const selectedName = selectedNodeId !== null ? ((nodeById.get(selectedNodeId) as any)?.Name ?? `#${selectedNodeId}`) : ''

    return (
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#161616', overflow: 'hidden' }}>
            <canvas
                ref={canvasRef}
                onMouseDown={(event) => {
                    dragStartRef.current = { x: event.clientX, y: event.clientY }
                }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => {
                    hoveredNodeIdRef.current = null
                }}
                onClick={handleClick}
                tabIndex={0}
                style={{ width: '100%', height: '100%', display: 'block', outline: 'none', cursor: 'default' }}
            />
            <canvas
                ref={overlayRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />
            {showGridXY && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        backgroundImage: 'linear-gradient(#ffffff0d 1px, transparent 1px), linear-gradient(90deg, #ffffff0d 1px, transparent 1px)',
                        backgroundSize: '32px 32px',
                        opacity: 0.35,
                    }}
                />
            )}
            {selectedName && (
                <div style={{ position: 'absolute', left: 10, top: 8, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
                    <span style={{ color: '#9fc4ff', fontSize: 12 }}>{selectedName}</span>
                </div>
            )}
            {status && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', pointerEvents: 'none' }}>
                    {status}
                </div>
            )}
        </div>
    )
}

export default RetargetModelViewport3D
