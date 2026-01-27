import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useModelStore } from '../../store/modelStore'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
// @ts-ignore
import { decodeBLP, getBLPImageData } from 'war3-model'
import { Button, Tooltip } from 'antd'
import { useSelectionStore } from '../../store/selectionStore'
import { registerShortcutHandler } from '../../shortcuts/manager'
import {
    BorderOutlined,
    LineOutlined,
    AppstoreOutlined,
    GroupOutlined,
    DragOutlined,
    SelectOutlined,
    RotateLeftOutlined,
    ColumnWidthOutlined,
    SwapOutlined,
    VerticalAlignMiddleOutlined,
    UndoOutlined,
    RedoOutlined,
    EyeOutlined,
    EyeInvisibleOutlined,
    CompressOutlined
} from '@ant-design/icons'
import { ColorPicker } from 'antd'

interface UVEditorProps {
    modelPath: string | null
    showModelView: boolean
    onToggleModelView: () => void
    visibleGeosetIds: number[]
    selectedTextureId: number | null
}

interface UVSelection {
    geosetIndex: number
    indices: number[]
}

type UVSubMode = 'vertex' | 'edge' | 'face' | 'group'
type UVTransformMode = 'select' | 'translate' | 'rotate' | 'scale'

const MAX_HISTORY = 10

const UVEditor: React.FC<UVEditorProps> = ({
    modelPath,
    showModelView,
    onToggleModelView,
    visibleGeosetIds,
    selectedTextureId
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // State
    const [uvSubMode, setUvSubMode] = useState<UVSubMode>('vertex')
    const [transformMode, setTransformMode] = useState<UVTransformMode>('select')
    const [zoom, setZoom] = useState(1)
    const [panX, setPanX] = useState(0)
    const [panY, setPanY] = useState(0)
    const [isPanning, setIsPanning] = useState(false)
    const [isSelecting, setIsSelecting] = useState(false)
    const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null)
    const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null)
    const [textureImage, setTextureImage] = useState<HTMLImageElement | null>(null)
    const [isLoadingTexture, setIsLoadingTexture] = useState(false)
    const [canvasBackgroundColor, setCanvasBackgroundColor] = useState('#1a1a1a')
    const [selectedUVs, setSelectedUVs] = useState<UVSelection[]>([])

    // Dragging state for transforms
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

    // History for Undo/Redo (max 10 steps)
    const [history, setHistory] = useState<{ geosetIndex: number; tVertices: Float32Array }[][]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    // Gizmo State: 'x', 'y', 'xy' (dual axis), null
    const [hoveredAxis, setHoveredAxis] = useState<'x' | 'y' | 'xy' | null>(null)
    const [activeAxis, setActiveAxis] = useState<'x' | 'y' | 'xy' | null>(null)

    // Render tick - increment to force canvas redraw
    const [renderTick, setRenderTick] = useState(0)

    // Model store
    const modelData = useModelStore(state => state.modelData)
    const updateGeoset = useModelStore(state => state.updateGeoset)

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    const uvToCanvas = useCallback((u: number, v: number): { x: number; y: number } => {
        const canvas = canvasRef.current
        if (!canvas) return { x: 0, y: 0 }

        const centerX = canvas.width / 2 + panX
        const centerY = canvas.height / 2 + panY
        const size = Math.min(canvas.width, canvas.height) * 0.8 * zoom

        const x = centerX - size / 2 + u * size
        const y = centerY - size / 2 + v * size

        return { x, y }
    }, [panX, panY, zoom])

    const getGeosetUVs = useCallback((geoset: any): Float32Array | number[] | null => {
        if (!geoset?.TVertices) return null
        const tv = geoset.TVertices as any
        if (Array.isArray(tv)) {
            if (tv.length === 0) return null
            if (Array.isArray(tv[0]) || tv[0] instanceof Float32Array) return tv[0]
            return tv
        }
        if (tv instanceof Float32Array) return tv
        return null
    }, [])

    const getSelectionCenter = useCallback(() => {
        if (!modelData?.Geosets || selectedUVs.length === 0) return null

        let sumU = 0, sumV = 0, count = 0

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (uvs) {
                sel.indices.forEach(i => {
                    sumU += (uvs[i * 2] as number)
                    sumV += (uvs[i * 2 + 1] as number)
                    count++
                })
            }
        })

        if (count === 0) return null
        return { u: sumU / count, v: sumV / count }
    }, [modelData, selectedUVs, getGeosetUVs])

    // Fit to view - calculate zoom and pan to fit texture
    const fitToView = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        // Reset to fit the 0-1 UV space in the canvas
        // Canvas size calculation available for future use if needed
        // const canvasSize = Math.min(canvas.width, canvas.height)
        setZoom(1)
        setPanX(0)
        setPanY(0)
    }, [])

    // -------------------------------------------------------------------------
    // LOGIC: Undo/Redo & Store Sync
    // -------------------------------------------------------------------------

    const addToHistory = useCallback(() => {
        if (!modelData?.Geosets || selectedUVs.length === 0) return

        const snapshot = selectedUVs.map(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (uvs) {
                return {
                    geosetIndex: sel.geosetIndex,
                    tVertices: new Float32Array(uvs)
                }
            }
            return null
        }).filter(item => item !== null) as { geosetIndex: number; tVertices: Float32Array }[]

        if (snapshot.length > 0) {
            const newHistory = history.slice(0, historyIndex + 1)
            newHistory.push(snapshot)
            // Limit to MAX_HISTORY steps
            if (newHistory.length > MAX_HISTORY) {
                newHistory.shift()
            }
            setHistory(newHistory)
            setHistoryIndex(Math.min(newHistory.length - 1, MAX_HISTORY - 1))
        }
    }, [modelData, selectedUVs, history, historyIndex])

    // Get triggerRendererReload from store
    const triggerRendererReload = useModelStore(state => state.triggerRendererReload)

    const syncToStore = useCallback(() => {
        if (!modelData?.Geosets) return

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (uvs) {
                updateGeoset(sel.geosetIndex, {
                    TVertices: [Array.from(uvs)]
                })
            }
        })

        // Trigger Viewer to refresh and re-render with updated UV data
        triggerRendererReload()
    }, [modelData, selectedUVs, updateGeoset, triggerRendererReload, getGeosetUVs])

    const undo = useCallback(() => {
        if (historyIndex < 0 || !modelData?.Geosets) return

        const snapshot = history[historyIndex]
        snapshot.forEach(item => {
            updateGeoset(item.geosetIndex, {
                TVertices: [item.tVertices]
            })
        })

        setHistoryIndex(prev => prev - 1)
        // Update 3D view immediately
        triggerRendererReload()
    }, [history, historyIndex, modelData, updateGeoset, triggerRendererReload])

    const redo = useCallback(() => {
        if (historyIndex >= history.length - 1 || !modelData?.Geosets) return

        const snapshot = history[historyIndex + 1]
        snapshot.forEach(item => {
            updateGeoset(item.geosetIndex, {
                TVertices: [item.tVertices]
            })
        })

        setHistoryIndex(prev => prev + 1)
        // Update 3D view immediately
        triggerRendererReload()
    }, [history, historyIndex, modelData, updateGeoset, triggerRendererReload])

    // -------------------------------------------------------------------------
    // LOGIC: Transformation
    // -------------------------------------------------------------------------

    const applyTranslation = useCallback((dx: number, dy: number) => {
        if (!modelData?.Geosets) return

        const canvas = canvasRef.current
        if (!canvas) return

        const size = Math.min(canvas.width, canvas.height) * 0.8 * zoom
        const du = dx / size
        const dv = dy / size

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (!uvs) return
            sel.indices.forEach(i => {
                const currentU = uvs[i * 2] as number
                const currentV = uvs[i * 2 + 1] as number
                uvs[i * 2] = currentU + du
                uvs[i * 2 + 1] = currentV + dv
            })
        })

        setRenderTick(t => t + 1)
    }, [modelData, selectedUVs, zoom, getGeosetUVs])

    const applyScale = useCallback((dx: number, dy: number) => {
        if (!modelData?.Geosets) return
        const center = getSelectionCenter()
        if (!center) return

        const canvas = canvasRef.current
        if (!canvas) return

        const size = Math.min(canvas.width, canvas.height) * 0.8 * zoom
        // Scale factor based on mouse movement
        const scaleFactor = 1 + (dx + dy) / size

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (!uvs) return
            sel.indices.forEach(i => {
                const currentU = uvs[i * 2] as number
                const currentV = uvs[i * 2 + 1] as number
                // Scale around center
                let newU = center.u + (currentU - center.u) * scaleFactor
                let newV = center.v + (currentV - center.v) * scaleFactor

                // Apply axis constraint
                if (activeAxis === 'x') {
                    newV = currentV
                } else if (activeAxis === 'y') {
                    newU = currentU
                }

                uvs[i * 2] = newU
                uvs[i * 2 + 1] = newV
            })
        })

        setRenderTick(t => t + 1)
    }, [modelData, selectedUVs, zoom, getSelectionCenter, activeAxis, getGeosetUVs])

    const applyRotation = useCallback((dx: number, dy: number) => {
        if (!modelData?.Geosets) return
        const center = getSelectionCenter()
        if (!center) return

        const canvas = canvasRef.current
        if (!canvas) return

        // Rotation angle based on mouse movement (negative for correct direction)
        const angle = -(dx - dy) * 0.01 // Radians

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (!uvs) return
            sel.indices.forEach(i => {
                const currentU = uvs[i * 2] as number
                const currentV = uvs[i * 2 + 1] as number
                // Rotate around center
                const relU = currentU - center.u
                const relV = currentV - center.v
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                uvs[i * 2] = center.u + relU * cos - relV * sin
                uvs[i * 2 + 1] = center.v + relU * sin + relV * cos
            })
        })

        setRenderTick(t => t + 1)
    }, [modelData, selectedUVs, getSelectionCenter, getGeosetUVs])

    const mirrorHorizontal = useCallback(() => {
        if (!modelData?.Geosets) return
        addToHistory()

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (!uvs) return
            let sumU = 0
            sel.indices.forEach(i => { sumU += (uvs[i * 2] as number) })
            const centerU = sumU / sel.indices.length

            sel.indices.forEach(i => {
                const currentU = uvs[i * 2] as number
                uvs[i * 2] = 2 * centerU - currentU
            })
        })

        syncToStore()
    }, [modelData, selectedUVs, addToHistory, syncToStore, getGeosetUVs])

    const mirrorVertical = useCallback(() => {
        if (!modelData?.Geosets) return
        addToHistory()

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            const uvs = getGeosetUVs(geoset)
            if (!uvs) return
            let sumV = 0
            sel.indices.forEach(i => { sumV += (uvs[i * 2 + 1] as number) })
            const centerV = sumV / sel.indices.length

            sel.indices.forEach(i => {
                const currentV = uvs[i * 2 + 1] as number
                uvs[i * 2 + 1] = 2 * centerV - currentV
            })
        })

        syncToStore()
    }, [modelData, selectedUVs, addToHistory, syncToStore, getGeosetUVs])

    // -------------------------------------------------------------------------
    // RENDERING
    // -------------------------------------------------------------------------

    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.fillStyle = canvasBackgroundColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const centerX = canvas.width / 2 + panX
        const centerY = canvas.height / 2 + panY
        const size = Math.min(canvas.width, canvas.height) * 0.8 * zoom

        // Texture background
        if (textureImage) {
            ctx.globalAlpha = 0.7
            ctx.drawImage(textureImage, centerX - size / 2, centerY - size / 2, size, size)
            ctx.globalAlpha = 1
        }

        // Grid
        ctx.strokeStyle = '#444'
        ctx.lineWidth = 1
        ctx.strokeRect(centerX - size / 2, centerY - size / 2, size, size)

        ctx.strokeStyle = '#333'
        for (let i = 1; i < 4; i++) {
            const offset = (size / 4) * i
            ctx.beginPath()
            ctx.moveTo(centerX - size / 2 + offset, centerY - size / 2)
            ctx.lineTo(centerX - size / 2 + offset, centerY + size / 2)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(centerX - size / 2, centerY - size / 2 + offset)
            ctx.lineTo(centerX + size / 2, centerY - size / 2 + offset)
            ctx.stroke()
        }

        // UV wireframe
        if (modelData?.Geosets) {
            visibleGeosetIds.forEach((geosetIndex: number) => {
                const geoset = modelData!.Geosets![geosetIndex]
                const uvs = getGeosetUVs(geoset)
                if (!uvs || !geoset.Faces) return
                const faces = geoset.Faces

                ctx.strokeStyle = '#0af'
                ctx.lineWidth = 1
                ctx.beginPath()
                for (let i = 0; i < faces.length; i += 3) {
                    const i0 = Number(faces[i]), i1 = Number(faces[i + 1]), i2 = Number(faces[i + 2])
                    const uv0 = uvToCanvas(Number(uvs[i0 * 2]), Number(uvs[i0 * 2 + 1]))
                    const uv1 = uvToCanvas(Number(uvs[i1 * 2]), Number(uvs[i1 * 2 + 1]))
                    const uv2 = uvToCanvas(Number(uvs[i2 * 2]), Number(uvs[i2 * 2 + 1]))
                    ctx.moveTo(uv0.x, uv0.y); ctx.lineTo(uv1.x, uv1.y); ctx.lineTo(uv2.x, uv2.y); ctx.lineTo(uv0.x, uv0.y)
                }
                ctx.stroke()

                // Vertices
                const vertexCount = uvs.length / 2
                for (let i = 0; i < vertexCount; i++) {
                    const pos = uvToCanvas(uvs[i * 2] as number, uvs[i * 2 + 1] as number)
                    const isSelected = selectedUVs.some(sel => sel.geosetIndex === geosetIndex && sel.indices.includes(i))
                    ctx.beginPath()
                    ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2)
                    ctx.fillStyle = isSelected ? '#fff000' : '#00aaff'
                    ctx.fill()
                }
            })
        }

        // Gizmo drawing based on transform mode
        const selectionCenter = getSelectionCenter()
        if (selectionCenter && selectedUVs.length > 0 && transformMode !== 'select') {
            const cp = uvToCanvas(selectionCenter.u, selectionCenter.v)
            const axisLength = 60

            if (transformMode === 'translate') {
                // Move Gizmo: Arrows
                ctx.lineWidth = 2

                // X Axis (Red)
                ctx.strokeStyle = (hoveredAxis === 'x' || activeAxis === 'x') ? '#ff6666' : '#ff0000'
                ctx.beginPath()
                ctx.moveTo(cp.x, cp.y)
                ctx.lineTo(cp.x + axisLength, cp.y)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(cp.x + axisLength, cp.y)
                ctx.lineTo(cp.x + axisLength - 8, cp.y - 4)
                ctx.lineTo(cp.x + axisLength - 8, cp.y + 4)
                ctx.closePath()
                ctx.fillStyle = (hoveredAxis === 'x' || activeAxis === 'x') ? '#ff6666' : '#ff0000'
                ctx.fill()

                // Y Axis (Green) - UP
                ctx.strokeStyle = (hoveredAxis === 'y' || activeAxis === 'y') ? '#66ff66' : '#00ff00'
                ctx.beginPath()
                ctx.moveTo(cp.x, cp.y)
                ctx.lineTo(cp.x, cp.y - axisLength)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(cp.x, cp.y - axisLength)
                ctx.lineTo(cp.x - 4, cp.y - axisLength + 8)
                ctx.lineTo(cp.x + 4, cp.y - axisLength + 8)
                ctx.closePath()
                ctx.fillStyle = (hoveredAxis === 'y' || activeAxis === 'y') ? '#66ff66' : '#00ff00'
                ctx.fill()

                // XY Plane handle
                const xySize = 15
                ctx.fillStyle = (hoveredAxis === 'xy' || activeAxis === 'xy') ? 'rgba(255,255,0,0.6)' : 'rgba(255,255,0,0.3)'
                ctx.fillRect(cp.x + 8, cp.y - 8 - xySize, xySize, xySize)
                ctx.strokeStyle = '#ffff00'
                ctx.lineWidth = 1
                ctx.strokeRect(cp.x + 8, cp.y - 8 - xySize, xySize, xySize)

            } else if (transformMode === 'rotate') {
                // Rotate Gizmo: Circle
                const radius = 40
                ctx.strokeStyle = (hoveredAxis === 'xy' || activeAxis === 'xy') ? '#66aaff' : '#4488ff'
                ctx.lineWidth = 3
                ctx.beginPath()
                ctx.arc(cp.x, cp.y, radius, 0, Math.PI * 2)
                ctx.stroke()

                // Arc indicator
                ctx.beginPath()
                ctx.arc(cp.x, cp.y, radius - 5, -Math.PI / 4, Math.PI / 4)
                ctx.stroke()

            } else if (transformMode === 'scale') {
                // Scale Gizmo: Lines with square ends
                ctx.lineWidth = 2

                // X Axis (Red)
                ctx.strokeStyle = (hoveredAxis === 'x' || activeAxis === 'x') ? '#ff6666' : '#ff0000'
                ctx.beginPath()
                ctx.moveTo(cp.x, cp.y)
                ctx.lineTo(cp.x + axisLength, cp.y)
                ctx.stroke()
                ctx.fillStyle = (hoveredAxis === 'x' || activeAxis === 'x') ? '#ff6666' : '#ff0000'
                ctx.fillRect(cp.x + axisLength - 5, cp.y - 5, 10, 10)

                // Y Axis (Green) - UP
                ctx.strokeStyle = (hoveredAxis === 'y' || activeAxis === 'y') ? '#66ff66' : '#00ff00'
                ctx.beginPath()
                ctx.moveTo(cp.x, cp.y)
                ctx.lineTo(cp.x, cp.y - axisLength)
                ctx.stroke()
                ctx.fillStyle = (hoveredAxis === 'y' || activeAxis === 'y') ? '#66ff66' : '#00ff00'
                ctx.fillRect(cp.x - 5, cp.y - axisLength - 5, 10, 10)

                // XY Plane handle (uniform scale)
                const xySize = 15
                ctx.fillStyle = (hoveredAxis === 'xy' || activeAxis === 'xy') ? 'rgba(255,255,0,0.6)' : 'rgba(255,255,0,0.3)'
                ctx.fillRect(cp.x + 8, cp.y - 8 - xySize, xySize, xySize)
                ctx.strokeStyle = '#ffff00'
                ctx.lineWidth = 1
                ctx.strokeRect(cp.x + 8, cp.y - 8 - xySize, xySize, xySize)
            }
        }

        // Selection rectangle
        if (isSelecting && selectionStart && selectionEnd) {
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 1
            ctx.setLineDash([5, 5])
            ctx.strokeRect(
                Math.min(selectionStart.x, selectionEnd.x),
                Math.min(selectionStart.y, selectionEnd.y),
                Math.abs(selectionEnd.x - selectionStart.x),
                Math.abs(selectionEnd.y - selectionStart.y)
            )
            ctx.setLineDash([])
        }
    }, [modelData, visibleGeosetIds, textureImage, panX, panY, zoom, uvToCanvas, selectedUVs, isSelecting, selectionStart, selectionEnd, hoveredAxis, activeAxis, getSelectionCenter, transformMode, canvasBackgroundColor])

    // -------------------------------------------------------------------------
    // EVENT HANDLERS
    // -------------------------------------------------------------------------

    // Zoom at mouse position
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor))

        // Adjust pan to zoom at mouse position
        const zoomRatio = newZoom / zoom
        const canvasCenterX = canvas.width / 2
        const canvasCenterY = canvas.height / 2

        setPanX(prev => (prev + canvasCenterX - mouseX) * zoomRatio - canvasCenterX + mouseX)
        setPanY(prev => (prev + canvasCenterY - mouseY) * zoomRatio - canvasCenterY + mouseY)
        setZoom(newZoom)
    }, [zoom])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        if (e.button === 2) {
            setIsPanning(true)
            setDragStart({ x: e.clientX, y: e.clientY })
        } else if (e.button === 0) {
            // Check Gizmo Hit first (only when in transform mode with selection)
            if (transformMode !== 'select' && selectedUVs.length > 0) {
                const center = getSelectionCenter()
                if (center) {
                    const cp = uvToCanvas(center.u, center.v)
                    const axisLength = 60
                    const xySize = 15

                    if (transformMode === 'rotate') {
                        // Rotate: hit anywhere on the circle
                        const dist = Math.sqrt((x - cp.x) ** 2 + (y - cp.y) ** 2)
                        if (dist >= 30 && dist <= 50) {
                            setActiveAxis('xy')
                            addToHistory()
                            setIsDragging(true)
                            setDragStart({ x: e.clientX, y: e.clientY })
                            return
                        }
                    } else {
                        // XY plane handle
                        if (x >= cp.x + 8 && x <= cp.x + 8 + xySize && y >= cp.y - 8 - xySize && y <= cp.y - 8) {
                            setActiveAxis('xy')
                            addToHistory()
                            setIsDragging(true)
                            setDragStart({ x: e.clientX, y: e.clientY })
                            return
                        }
                        // X-axis hit
                        if (y >= cp.y - 8 && y <= cp.y + 8 && x >= cp.x && x <= cp.x + axisLength) {
                            setActiveAxis('x')
                            addToHistory()
                            setIsDragging(true)
                            setDragStart({ x: e.clientX, y: e.clientY })
                            return
                        }
                        // Y-axis hit
                        if (x >= cp.x - 8 && x <= cp.x + 8 && y >= cp.y - axisLength && y <= cp.y) {
                            setActiveAxis('y')
                            addToHistory()
                            setIsDragging(true)
                            setDragStart({ x: e.clientX, y: e.clientY })
                            return
                        }
                    }
                }
            }

            // If not hitting gizmo, start box selection (LMB directly)
            setIsSelecting(true)
            setSelectionStart({ x, y })
            setSelectionEnd({ x, y })
        }
    }, [transformMode, selectedUVs, uvToCanvas, getSelectionCenter, addToHistory])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        // Gizmo Hover Update
        if (transformMode !== 'select' && !isDragging && selectedUVs.length > 0) {
            const center = getSelectionCenter()
            if (center) {
                const cp = uvToCanvas(center.u, center.v)
                const axisLength = 60
                const xySize = 15
                let hover: 'x' | 'y' | 'xy' | null = null

                if (transformMode === 'rotate') {
                    const dist = Math.sqrt((x - cp.x) ** 2 + (y - cp.y) ** 2)
                    if (dist >= 30 && dist <= 50) hover = 'xy'
                } else {
                    if (x >= cp.x + 8 && x <= cp.x + 8 + xySize && y >= cp.y - 8 - xySize && y <= cp.y - 8) hover = 'xy'
                    else if (y >= cp.y - 8 && y <= cp.y + 8 && x >= cp.x && x <= cp.x + axisLength) hover = 'x'
                    else if (x >= cp.x - 8 && x <= cp.x + 8 && y >= cp.y - axisLength && y <= cp.y) hover = 'y'
                }

                if (hover !== hoveredAxis) setHoveredAxis(hover)
            }
        } else if (hoveredAxis !== null && !isDragging) {
            setHoveredAxis(null)
        }

        if (isPanning && dragStart) {
            const dx = e.clientX - dragStart.x
            const dy = e.clientY - dragStart.y
            setPanX(prev => prev + dx)
            setPanY(prev => prev + dy)
            setDragStart({ x: e.clientX, y: e.clientY })
        } else if (isSelecting) {
            setSelectionEnd({ x, y })
        } else if (isDragging && dragStart && selectedUVs.length > 0) {
            const clientDx = e.clientX - dragStart.x
            const clientDy = e.clientY - dragStart.y

            if (transformMode === 'translate') {
                let constraintX = clientDx
                let constraintY = clientDy

                if (activeAxis === 'x') constraintY = 0
                else if (activeAxis === 'y') constraintX = 0

                applyTranslation(constraintX, constraintY)
            } else if (transformMode === 'scale') {
                applyScale(clientDx, clientDy)
            } else if (transformMode === 'rotate') {
                applyRotation(clientDx, clientDy)
            }

            setDragStart({ x: e.clientX, y: e.clientY })
        }
    }, [isPanning, isSelecting, isDragging, dragStart, transformMode, selectedUVs, uvToCanvas, getSelectionCenter, hoveredAxis, activeAxis, applyTranslation, applyScale, applyRotation])

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        if (isSelecting && selectionStart && selectionEnd) {
            const minX = Math.min(selectionStart.x, selectionEnd.x)
            const maxX = Math.max(selectionStart.x, selectionEnd.x)
            const minY = Math.min(selectionStart.y, selectionEnd.y)
            const maxY = Math.max(selectionStart.y, selectionEnd.y)

            const newSelections: UVSelection[] = []

            // Helper: check if a point is inside selection box
            const isInBox = (u: number, v: number) => {
                const pos = uvToCanvas(u, v)
                return pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY
            }

            if (modelData?.Geosets) {
                visibleGeosetIds.forEach((geosetIndex: number) => {
                    const geoset = modelData!.Geosets![geosetIndex]
                    const uvs = getGeosetUVs(geoset)
                    if (!uvs) return
                    const faces = geoset.Faces
                    const vertexCount = uvs.length / 2
                    const selectedSet = new Set<number>()

                    if (uvSubMode === 'vertex') {
                        // VERTEX MODE: Select individual vertices in box
                        for (let i = 0; i < vertexCount; i++) {
                            if (isInBox(uvs[i * 2] as number, uvs[i * 2 + 1] as number)) {
                                selectedSet.add(i)
                            }
                        }
                    } else if (uvSubMode === 'edge' && faces) {
                        // EDGE MODE: Select both vertices of each edge that has at least one vertex in box
                        for (let i = 0; i < faces.length; i += 3) {
                            const i0 = Number(faces[i])
                            const i1 = Number(faces[i + 1])
                            const i2 = Number(faces[i + 2])

                            const v0In = isInBox(Number(uvs[i0 * 2]), Number(uvs[i0 * 2 + 1]))
                            const v1In = isInBox(Number(uvs[i1 * 2]), Number(uvs[i1 * 2 + 1]))
                            const v2In = isInBox(Number(uvs[i2 * 2]), Number(uvs[i2 * 2 + 1]))

                            // Edge 0-1
                            if (v0In || v1In) { selectedSet.add(i0); selectedSet.add(i1) }
                            // Edge 1-2
                            if (v1In || v2In) { selectedSet.add(i1); selectedSet.add(i2) }
                            // Edge 2-0
                            if (v2In || v0In) { selectedSet.add(i2); selectedSet.add(i0) }
                        }
                    } else if (uvSubMode === 'face' && faces) {
                        // FACE MODE: Select all 3 vertices of each triangle with any vertex in box
                        for (let i = 0; i < faces.length; i += 3) {
                            const i0 = Number(faces[i])
                            const i1 = Number(faces[i + 1])
                            const i2 = Number(faces[i + 2])

                            const anyInBox = isInBox(Number(uvs[i0 * 2]), Number(uvs[i0 * 2 + 1])) ||
                                isInBox(Number(uvs[i1 * 2]), Number(uvs[i1 * 2 + 1])) ||
                                isInBox(Number(uvs[i2 * 2]), Number(uvs[i2 * 2 + 1]))

                            if (anyInBox) {
                                selectedSet.add(i0)
                                selectedSet.add(i1)
                                selectedSet.add(i2)
                            }
                        }
                    } else if (uvSubMode === 'group') {
                        // GROUP MODE: Select ALL vertices of geoset if any vertex is in box
                        let anyInBox = false
                        for (let i = 0; i < vertexCount; i++) {
                            if (isInBox(uvs[i * 2] as number, uvs[i * 2 + 1] as number)) {
                                anyInBox = true
                                break
                            }
                        }
                        if (anyInBox) {
                            for (let i = 0; i < vertexCount; i++) {
                                selectedSet.add(i)
                            }
                        }
                    }

                    if (selectedSet.size > 0) {
                        newSelections.push({ geosetIndex, indices: Array.from(selectedSet) })
                    }
                })
            }

            if (e.ctrlKey) {
                setSelectedUVs(prev => {
                    const result = [...prev]
                    newSelections.forEach(newSel => {
                        const existing = result.find(s => s.geosetIndex === newSel.geosetIndex)
                        if (existing) {
                            const combined = new Set([...existing.indices, ...newSel.indices])
                            existing.indices = Array.from(combined)
                        } else {
                            result.push(newSel)
                        }
                    })
                    return result
                })
            } else if (e.shiftKey) {
                setSelectedUVs(prev => prev.map(sel => {
                    const toRemove = newSelections.find(n => n.geosetIndex === sel.geosetIndex)
                    if (toRemove) {
                        return {
                            ...sel,
                            indices: sel.indices.filter(i => !toRemove.indices.includes(i))
                        }
                    }
                    return sel
                }).filter(sel => sel.indices.length > 0))
            } else {
                setSelectedUVs(newSelections)
            }
        }

        // Sync to store after drag operations (deferred for performance)
        if (isDragging && selectedUVs.length > 0) {
            syncToStore()
        }

        setIsPanning(false)
        setIsSelecting(false)
        setIsDragging(false)
        setActiveAxis(null)
        setSelectionStart(null)
        setSelectionEnd(null)
        setDragStart(null)
    }, [isSelecting, selectionStart, selectionEnd, modelData, visibleGeosetIds, uvToCanvas, isDragging, selectedUVs, syncToStore, uvSubMode])

    // -------------------------------------------------------------------------
    // EFFECTS
    // -------------------------------------------------------------------------

    useEffect(() => {
        const isUvMode = () => useSelectionStore.getState().mainMode === 'uv'

        const unsubscribeHandlers = [
            registerShortcutHandler(
                'edit.undo',
                () => {
                    undo()
                    return true
                },
                { isActive: isUvMode, priority: 10 }
            ),
            registerShortcutHandler(
                'edit.redo',
                () => {
                    redo()
                    return true
                },
                { isActive: isUvMode, priority: 10 }
            ),
            registerShortcutHandler(
                'transform.translate',
                () => {
                    setTransformMode('translate')
                    return true
                },
                { isActive: isUvMode, priority: 10 }
            ),
            registerShortcutHandler(
                'transform.rotate',
                () => {
                    setTransformMode('rotate')
                    return true
                },
                { isActive: isUvMode, priority: 10 }
            ),
            registerShortcutHandler(
                'transform.scale',
                () => {
                    setTransformMode('scale')
                    return true
                },
                { isActive: isUvMode, priority: 10 }
            )
        ]

        return () => {
            unsubscribeHandlers.forEach((unsubscribe) => unsubscribe())
        }
    }, [undo, redo])

    // Load texture
    useEffect(() => {
        const loadTexture = async () => {
            if (!modelData || !modelPath || selectedTextureId === null) {
                setTextureImage(null)
                setIsLoadingTexture(false)
                return
            }

            setIsLoadingTexture(true)

            const texture = modelData.Textures?.[selectedTextureId]
            if (!texture?.Image) {
                setTextureImage(null)
                return
            }

            try {
                let fullPath = texture.Image
                if (!fullPath.match(/^[a-zA-Z]:/) && !fullPath.startsWith('/')) {
                    const modelDir = modelPath.substring(0, modelPath.lastIndexOf('\\'))
                    fullPath = `${modelDir}\\${fullPath}`
                }

                const isBlp = fullPath.toLowerCase().endsWith('.blp')

                if (isBlp) {
                    let buffer: ArrayBuffer | null = null
                    try {
                        const data = await readFile(fullPath)
                        buffer = data.buffer
                    } catch {
                        try {
                            const mpqData = await invoke<number[]>('read_mpq_file', { path: texture.Image })
                            if (mpqData) {
                                buffer = new Uint8Array(mpqData).buffer
                            }
                        } catch {
                            console.warn('[UVEditor] Failed to load texture from MPQ:', texture.Image)
                        }
                    }

                    if (buffer) {
                        const blp = decodeBLP(buffer)
                        const imageData = getBLPImageData(blp, 0)
                        if (imageData) {
                            const canvas = document.createElement('canvas')
                            canvas.width = imageData.width
                            canvas.height = imageData.height
                            const ctx = canvas.getContext('2d')
                            if (ctx) {
                                const realImageData = new ImageData(
                                    new Uint8ClampedArray(imageData.data),
                                    imageData.width,
                                    imageData.height
                                )
                                ctx.putImageData(realImageData, 0, 0)
                                const dataUrl = canvas.toDataURL()
                                const img = new Image()
                                img.onload = () => {
                                    setTextureImage(img)
                                    setIsLoadingTexture(false)
                                }
                                img.src = dataUrl
                            }
                        }
                    }
                } else {
                    const img = new Image()
                    img.onload = () => {
                        setTextureImage(img)
                        setIsLoadingTexture(false)
                    }
                    img.src = `file://${fullPath}`
                }
            } catch (e) {
                console.error('[UVEditor] Failed to load texture:', e)
                setIsLoadingTexture(false)
            }
        }

        loadTexture()
    }, [modelData, modelPath, selectedTextureId])

    // Resize canvas
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const resizeObserver = new ResizeObserver(() => {
            const canvas = canvasRef.current
            if (canvas && container) {
                canvas.width = container.clientWidth
                canvas.height = container.clientHeight
                renderCanvas()
            }
        })

        resizeObserver.observe(container)
        return () => resizeObserver.disconnect()
    }, [renderCanvas])

    useEffect(() => {
        renderCanvas()
    }, [renderCanvas, renderTick])

    // -------------------------------------------------------------------------
    // DOM
    // -------------------------------------------------------------------------

    const toolbarStyle: React.CSSProperties = {
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '4px',
        padding: '6px 10px',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        borderRadius: '6px',
        zIndex: 100
    }

    const btnStyle: React.CSSProperties = {
        backgroundColor: '#444',
        borderColor: '#555',
        color: '#ddd'
    }

    const btnActiveStyle: React.CSSProperties = {
        backgroundColor: '#1890ff',
        borderColor: '#1890ff',
        color: '#fff'
    }

    const btnDisabledStyle: React.CSSProperties = {
        backgroundColor: '#333',
        borderColor: '#444',
        color: '#666'
    }

    return (
        <div
            ref={containerRef}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                backgroundColor: '#1a1a1a',
                overflow: 'hidden'
            }}
            onContextMenu={e => e.preventDefault()}
        >
            {/* Toolbar */}
            <div style={toolbarStyle}>
                {/* Sub-mode: Vertex/Edge/Face/Group */}
                <Tooltip title="选择顶点">
                    <Button size="small" icon={<BorderOutlined />} style={uvSubMode === 'vertex' ? btnActiveStyle : btnStyle} onClick={() => setUvSubMode('vertex')} />
                </Tooltip>
                <Tooltip title="选择边">
                    <Button size="small" icon={<LineOutlined />} style={uvSubMode === 'edge' ? btnActiveStyle : btnStyle} onClick={() => setUvSubMode('edge')} />
                </Tooltip>
                <Tooltip title="选择面">
                    <Button size="small" icon={<AppstoreOutlined />} style={uvSubMode === 'face' ? btnActiveStyle : btnStyle} onClick={() => setUvSubMode('face')} />
                </Tooltip>
                <Tooltip title="选择组">
                    <Button size="small" icon={<GroupOutlined />} style={uvSubMode === 'group' ? btnActiveStyle : btnStyle} onClick={() => setUvSubMode('group')} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 4px' }} />

                {/* Transform modes */}
                <Tooltip title="框选">
                    <Button size="small" icon={<SelectOutlined />} style={transformMode === 'select' ? btnActiveStyle : btnStyle} onClick={() => setTransformMode('select')} />
                </Tooltip>
                <Tooltip title="移动 (W)">
                    <Button size="small" icon={<DragOutlined />} style={transformMode === 'translate' ? btnActiveStyle : btnStyle} onClick={() => setTransformMode('translate')} />
                </Tooltip>
                <Tooltip title="旋转 (E)">
                    <Button size="small" icon={<RotateLeftOutlined />} style={transformMode === 'rotate' ? btnActiveStyle : btnStyle} onClick={() => setTransformMode('rotate')} />
                </Tooltip>
                <Tooltip title="缩放 (R)">
                    <Button size="small" icon={<ColumnWidthOutlined />} style={transformMode === 'scale' ? btnActiveStyle : btnStyle} onClick={() => setTransformMode('scale')} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 4px' }} />

                {/* Mirror */}
                <Tooltip title="水平镜像">
                    <Button size="small" icon={<SwapOutlined />} style={selectedUVs.length === 0 ? btnDisabledStyle : btnStyle} onClick={mirrorHorizontal} disabled={selectedUVs.length === 0} />
                </Tooltip>
                <Tooltip title="垂直镜像">
                    <Button size="small" icon={<VerticalAlignMiddleOutlined style={{ transform: 'rotate(90deg)' }} />} style={selectedUVs.length === 0 ? btnDisabledStyle : btnStyle} onClick={mirrorVertical} disabled={selectedUVs.length === 0} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 4px' }} />

                {/* Undo/Redo - always visible */}
                <Tooltip title="撤销 (Ctrl+Z)">
                    <Button size="small" icon={<UndoOutlined />} style={historyIndex < 0 ? btnDisabledStyle : btnStyle} onClick={undo} disabled={historyIndex < 0} />
                </Tooltip>
                <Tooltip title="重做 (Ctrl+Y)">
                    <Button size="small" icon={<RedoOutlined />} style={historyIndex >= history.length - 1 ? btnDisabledStyle : btnStyle} onClick={redo} disabled={historyIndex >= history.length - 1} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 4px' }} />

                {/* Fit to view */}
                <Tooltip title="适应视图">
                    <Button size="small" icon={<CompressOutlined />} style={btnStyle} onClick={fitToView} />
                </Tooltip>

                {/* Toggle 3D view - icon only */}
                <Tooltip title={showModelView ? '隐藏3D视图' : '显示3D视图'}>
                    <Button size="small" icon={showModelView ? <EyeInvisibleOutlined /> : <EyeOutlined />} style={btnStyle} onClick={onToggleModelView} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 4px' }} />

                {/* Background color picker */}
                <Tooltip title="画布背景颜色">
                    <div>
                        <ColorPicker
                            value={canvasBackgroundColor}
                            onChange={(color) => setCanvasBackgroundColor(color.toHexString())}
                            size="small"
                            showText={false}
                        />
                    </div>
                </Tooltip>

            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', cursor: isPanning ? 'grabbing' : isDragging ? 'move' : 'crosshair' }}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />

            {/* Status bar */}
            <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                color: '#888',
                fontSize: '12px',
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '4px 8px',
                borderRadius: '4px'
            }}>
                缩放: {(zoom * 100).toFixed(0)}% |
                选中: {selectedUVs.reduce((sum, s) => sum + s.indices.length, 0)} 顶点 |
                可见: {visibleGeosetIds.length} |
                贴图: {isLoadingTexture ? '加载中...' : (textureImage ? `${textureImage.width}×${textureImage.height}` : '无')}
            </div>
        </div>
    )
}

export default UVEditor
