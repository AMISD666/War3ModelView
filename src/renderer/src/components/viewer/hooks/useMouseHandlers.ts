/**
 * useMouseHandlers - Mouse event handling for the Viewer component
 * Handles mouseDown, mouseMove, mouseUp, and wheel events
 */

import { useCallback } from 'react'
import { useSelectionStore } from '../../../store/selectionStore'
import { SimpleOrbitCamera } from '../../../utils/SimpleOrbitCamera'
import type { MouseState, GizmoState, SelectionBox, CameraState } from '../types'

export interface UseMouseHandlersParams {
    canvasRef: React.RefObject<HTMLCanvasElement>
    cameraRef: React.MutableRefObject<SimpleOrbitCamera | null>
    rendererRef: React.MutableRefObject<any>
    targetCamera: React.MutableRefObject<CameraState>
    mouseState: React.MutableRefObject<MouseState>
    gizmoState: React.MutableRefObject<GizmoState>
    animationSubMode: string
    setSelectionBox: (box: SelectionBox | null) => void
    initialVertexPositions: React.MutableRefObject<Map<string, [number, number, number]>>
    initialNodePositions: React.MutableRefObject<Map<number, [number, number, number]>>
}

export function useMouseHandlers({
    canvasRef,
    cameraRef,
    rendererRef,
    targetCamera,
    mouseState,
    gizmoState,
    animationSubMode,
    setSelectionBox,
    initialVertexPositions,
    initialNodePositions
}: UseMouseHandlersParams) {

    /**
     * Handle mouse wheel for camera zoom
     */
    const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        targetCamera.current.distance = Math.max(10, targetCamera.current.distance * (1 + e.deltaY * 0.001))
    }, [targetCamera])

    /**
     * Capture initial vertex positions for undo functionality
     */
    const captureInitialPositions = useCallback(() => {
        if (!rendererRef.current) return

        initialVertexPositions.current.clear()
        const { selectedVertexIds, selectedFaceIds, geometrySubMode, mainMode, selectedNodeIds } = useSelectionStore.getState()
        const renderer = rendererRef.current

        const captureVertex = (geosetIndex: number, vertexIndex: number) => {
            const geoset = renderer.model.Geosets[geosetIndex]
            if (!geoset) return
            const vIndex = vertexIndex * 3
            const key = `${geosetIndex}-${vertexIndex}`
            if (!initialVertexPositions.current.has(key)) {
                initialVertexPositions.current.set(key, [
                    geoset.Vertices[vIndex],
                    geoset.Vertices[vIndex + 1],
                    geoset.Vertices[vIndex + 2]
                ])
            }
        }

        if (geometrySubMode === 'vertex') {
            selectedVertexIds.forEach(sel => captureVertex(sel.geosetIndex, sel.index))
        } else if (geometrySubMode === 'face') {
            selectedFaceIds.forEach(sel => {
                const geoset = renderer.model.Geosets[sel.geosetIndex]
                if (geoset) {
                    const fIndex = sel.index * 3
                    captureVertex(sel.geosetIndex, geoset.Faces[fIndex])
                    captureVertex(sel.geosetIndex, geoset.Faces[fIndex + 1])
                    captureVertex(sel.geosetIndex, geoset.Faces[fIndex + 2])
                }
            })
        } else if (mainMode === 'animation' && animationSubMode === 'binding') {
            // Capture initial node positions
            initialNodePositions.current.clear()
            if (renderer.rendererData?.nodes) {
                selectedNodeIds.forEach(nodeId => {
                    const nodeWrapper = renderer.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
                    if (nodeWrapper?.node.PivotPoint) {
                        initialNodePositions.current.set(nodeId, [
                            nodeWrapper.node.PivotPoint[0],
                            nodeWrapper.node.PivotPoint[1],
                            nodeWrapper.node.PivotPoint[2]
                        ])
                    }
                })
            }
        }
    }, [rendererRef, animationSubMode, initialVertexPositions, initialNodePositions])

    /**
     * Handle mouse down event
     */
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { mainMode } = useSelectionStore.getState()

        // Check for Gizmo interaction first
        if (gizmoState.current.activeAxis && e.button === 0) {
            if (cameraRef.current) cameraRef.current.enabled = false
            gizmoState.current.isDragging = true
            mouseState.current.lastMouseX = e.clientX
            mouseState.current.lastMouseY = e.clientY

            // Capture initial positions for Undo
            captureInitialPositions()
            return // Consume event
        }

        mouseState.current.isDragging = true
        mouseState.current.dragButton = e.button
        mouseState.current.lastMouseX = e.clientX
        mouseState.current.lastMouseY = e.clientY
        mouseState.current.startX = e.clientX
        mouseState.current.startY = e.clientY
        mouseState.current.isCtrlPressed = e.ctrlKey || e.metaKey

        // Box Selection: Alt + Left Click
        if (e.button === 0 && e.altKey && (mainMode === 'geometry' || mainMode === 'animation')) {
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
    }, [canvasRef, cameraRef, gizmoState, mouseState, setSelectionBox, captureInitialPositions])

    /**
     * Update selection box dimensions during drag
     */
    const updateSelectionBox = useCallback((clientX: number, clientY: number) => {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return

        const startX = mouseState.current.startX
        const startY = mouseState.current.startY

        const x = Math.min(startX, clientX) - rect.left
        const y = Math.min(startY, clientY) - rect.top
        const width = Math.abs(clientX - startX)
        const height = Math.abs(clientY - startY)

        setSelectionBox({ x, y, width, height })
    }, [canvasRef, mouseState, setSelectionBox])

    return {
        handleWheel,
        handleMouseDown,
        captureInitialPositions,
        updateSelectionBox
    }
}
