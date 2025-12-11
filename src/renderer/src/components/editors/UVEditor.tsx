import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useModelStore } from '../../store/modelStore'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
// @ts-ignore
import { decodeBLP, getBLPImageData } from 'war3-model'
import { Button, Tooltip } from 'antd'
import {
    BorderOutlined,
    DragOutlined,
    SelectOutlined,
    RotateLeftOutlined,
    ColumnWidthOutlined,
    SwapOutlined,
    VerticalAlignMiddleOutlined,
    UndoOutlined,
    RedoOutlined
} from '@ant-design/icons'

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

type UVSubMode = 'vertex' | 'edge' | 'face'
type UVTransformMode = 'select' | 'translate' | 'rotate' | 'scale'

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
    const [selectedUVs, setSelectedUVs] = useState<UVSelection[]>([])

    // Dragging state for transforms
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

    // History for Undo/Redo
    const [history, setHistory] = useState<{ geosetIndex: number; tVertices: Float32Array }[][]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    // Gizmo State: 'x', 'y', 'xy' (dual axis), null
    const [hoveredAxis, setHoveredAxis] = useState<'x' | 'y' | 'xy' | null>(null)
    const [activeAxis, setActiveAxis] = useState<'x' | 'y' | 'xy' | null>(null)

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

    const getSelectionCenter = useCallback(() => {
        if (!modelData?.Geosets || selectedUVs.length === 0) return null

        let sumU = 0, sumV = 0, count = 0

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (geoset?.TVertices?.[0]) {
                const uvs = geoset.TVertices[0]
                sel.indices.forEach(i => {
                    sumU += (uvs[i * 2] as number)
                    sumV += (uvs[i * 2 + 1] as number)
                    count++
                })
            }
        })

        if (count === 0) return null
        return { u: sumU / count, v: sumV / count }
    }, [modelData, selectedUVs])

    // -------------------------------------------------------------------------
    // LOGIC: Undo/Redo & Store Sync
    // -------------------------------------------------------------------------

    const addToHistory = useCallback(() => {
        if (!modelData?.Geosets || selectedUVs.length === 0) return

        const snapshot = selectedUVs.map(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (geoset && geoset.TVertices && geoset.TVertices[0]) {
                return {
                    geosetIndex: sel.geosetIndex,
                    tVertices: new Float32Array(geoset.TVertices[0])
                }
            }
            return null
        }).filter(item => item !== null) as { geosetIndex: number; tVertices: Float32Array }[]

        if (snapshot.length > 0) {
            const newHistory = history.slice(0, historyIndex + 1)
            newHistory.push(snapshot)
            setHistory(newHistory)
            setHistoryIndex(newHistory.length - 1)
        }
    }, [modelData, selectedUVs, history, historyIndex])

    const syncToStore = useCallback(() => {
        if (!modelData?.Geosets) return

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (geoset?.TVertices?.[0]) {
                updateGeoset(sel.geosetIndex, {
                    TVertices: [Array.from(geoset.TVertices[0])]
                })
            }
        })
    }, [modelData, selectedUVs, updateGeoset])

    const undo = useCallback(() => {
        if (historyIndex < 0 || !modelData?.Geosets) return

        const snapshot = history[historyIndex]
        snapshot.forEach(item => {
            updateGeoset(item.geosetIndex, {
                TVertices: [item.tVertices]
            })
        })

        setHistoryIndex(prev => prev - 1)
    }, [history, historyIndex, modelData, updateGeoset])

    const redo = useCallback(() => {
        if (historyIndex >= history.length - 1 || !modelData?.Geosets) return

        const snapshot = history[historyIndex + 1]
        snapshot.forEach(item => {
            updateGeoset(item.geosetIndex, {
                TVertices: [item.tVertices]
            })
        })

        setHistoryIndex(prev => prev + 1)
    }, [history, historyIndex, modelData, updateGeoset])

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
            if (!geoset?.TVertices?.[0]) return

            const uvs = geoset.TVertices[0]
            sel.indices.forEach(i => {
                const currentU = uvs[i * 2] as number
                const currentV = uvs[i * 2 + 1] as number
                uvs[i * 2] = currentU + du
                uvs[i * 2 + 1] = currentV + dv
            })
        })

        syncToStore()
    }, [modelData, selectedUVs, zoom, syncToStore])

    const mirrorHorizontal = useCallback(() => {
        if (!modelData?.Geosets) return
        addToHistory()

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset?.TVertices?.[0]) return

            const uvs = geoset.TVertices[0]
            let sumU = 0
            sel.indices.forEach(i => { sumU += (uvs[i * 2] as number) })
            const centerU = sumU / sel.indices.length

            sel.indices.forEach(i => {
                const currentU = uvs[i * 2] as number
                uvs[i * 2] = 2 * centerU - currentU
            })
        })

        syncToStore()
    }, [modelData, selectedUVs, addToHistory, syncToStore])

    const mirrorVertical = useCallback(() => {
        if (!modelData?.Geosets) return
        addToHistory()

        selectedUVs.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset?.TVertices?.[0]) return

            const uvs = geoset.TVertices[0]
            let sumV = 0
            sel.indices.forEach(i => { sumV += (uvs[i * 2 + 1] as number) })
            const centerV = sumV / sel.indices.length

            sel.indices.forEach(i => {
                const currentV = uvs[i * 2 + 1] as number
                uvs[i * 2 + 1] = 2 * centerV - currentV
            })
        })

        syncToStore()
    }, [modelData, selectedUVs, addToHistory, syncToStore])

    // -------------------------------------------------------------------------
    // RENDERING
    // -------------------------------------------------------------------------

    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.fillStyle = '#1a1a1a'
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
                if (!geoset?.TVertices?.[0] || !geoset.Faces) return

                const uvs = geoset.TVertices[0]
                const faces = geoset.Faces

                ctx.strokeStyle = '#0af'
                ctx.lineWidth = 1
                ctx.beginPath()
                for (let i = 0; i < faces.length; i += 3) {
                    const i0 = faces[i], i1 = faces[i + 1], i2 = faces[i + 2]
                    const uv0 = uvToCanvas(uvs[i0 * 2] as number, uvs[i0 * 2 + 1] as number)
                    const uv1 = uvToCanvas(uvs[i1 * 2] as number, uvs[i1 * 2 + 1] as number)
                    const uv2 = uvToCanvas(uvs[i2 * 2] as number, uvs[i2 * 2 + 1] as number)
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

        // Gizmo (only for transform modes, not select)
        const selectionCenter = getSelectionCenter()
        if (selectionCenter && (transformMode === 'translate' || transformMode === 'rotate' || transformMode === 'scale') && selectedUVs.length > 0) {
            const cp = uvToCanvas(selectionCenter.u, selectionCenter.v)
            const axisLength = 60

            ctx.lineWidth = 2

            // X Axis (Red) - pointing RIGHT
            ctx.strokeStyle = (hoveredAxis === 'x' || activeAxis === 'x') ? '#ff6666' : '#ff0000'
            ctx.beginPath()
            ctx.moveTo(cp.x, cp.y)
            ctx.lineTo(cp.x + axisLength, cp.y)
            ctx.stroke()
            // Arrow
            ctx.beginPath()
            ctx.moveTo(cp.x + axisLength, cp.y)
            ctx.lineTo(cp.x + axisLength - 8, cp.y - 4)
            ctx.lineTo(cp.x + axisLength - 8, cp.y + 4)
            ctx.closePath()
            ctx.fillStyle = (hoveredAxis === 'x' || activeAxis === 'x') ? '#ff6666' : '#ff0000'
            ctx.fill()

            // Y Axis (Green) - pointing UP (negative canvas Y)
            ctx.strokeStyle = (hoveredAxis === 'y' || activeAxis === 'y') ? '#66ff66' : '#00ff00'
            ctx.beginPath()
            ctx.moveTo(cp.x, cp.y)
            ctx.lineTo(cp.x, cp.y - axisLength)  // Note: UP is negative Y in canvas
            ctx.stroke()
            // Arrow
            ctx.beginPath()
            ctx.moveTo(cp.x, cp.y - axisLength)
            ctx.lineTo(cp.x - 4, cp.y - axisLength + 8)
            ctx.lineTo(cp.x + 4, cp.y - axisLength + 8)
            ctx.closePath()
            ctx.fillStyle = (hoveredAxis === 'y' || activeAxis === 'y') ? '#66ff66' : '#00ff00'
            ctx.fill()

            // XY Plane handle (dual axis) - small square at corner
            const xySize = 15
            ctx.fillStyle = (hoveredAxis === 'xy' || activeAxis === 'xy') ? 'rgba(255,255,0,0.6)' : 'rgba(255,255,0,0.3)'
            ctx.fillRect(cp.x + 8, cp.y - 8 - xySize, xySize, xySize)
            ctx.strokeStyle = '#ffff00'
            ctx.lineWidth = 1
            ctx.strokeRect(cp.x + 8, cp.y - 8 - xySize, xySize, xySize)
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
    }, [modelData, visibleGeosetIds, textureImage, panX, panY, zoom, uvToCanvas, selectedUVs, isSelecting, selectionStart, selectionEnd, hoveredAxis, activeAxis, getSelectionCenter, transformMode])

    // -------------------------------------------------------------------------
    // EVENT HANDLERS
    // -------------------------------------------------------------------------

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        setZoom(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)))
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        if (e.button === 2) {
            // Right click - pan
            setIsPanning(true)
            setDragStart({ x: e.clientX, y: e.clientY })
        } else if (e.button === 0) {
            // Alt + Left Click = Box Selection (always)
            if (e.altKey) {
                setIsSelecting(true)
                setSelectionStart({ x, y })
                setSelectionEnd({ x, y })
                return
            }

            // Check Gizmo Hit (only when in transform mode and has selection)
            if ((transformMode === 'translate' || transformMode === 'rotate' || transformMode === 'scale') && selectedUVs.length > 0) {
                const center = getSelectionCenter()
                if (center) {
                    const cp = uvToCanvas(center.u, center.v)
                    const axisLength = 60
                    const xySize = 15

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
                    // Y-axis hit (UP is negative Y)
                    if (x >= cp.x - 8 && x <= cp.x + 8 && y >= cp.y - axisLength && y <= cp.y) {
                        setActiveAxis('y')
                        addToHistory()
                        setIsDragging(true)
                        setDragStart({ x: e.clientX, y: e.clientY })
                        return
                    }
                }
            }

            // Select mode: box selection
            if (transformMode === 'select') {
                setIsSelecting(true)
                setSelectionStart({ x, y })
                setSelectionEnd({ x, y })
            }
            // Transform modes without hitting gizmo: do nothing (transform only via gizmo)
        }
    }, [transformMode, selectedUVs, uvToCanvas, getSelectionCenter, addToHistory])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        // Gizmo Hover Update
        if ((transformMode === 'translate' || transformMode === 'rotate' || transformMode === 'scale') && !isDragging && selectedUVs.length > 0) {
            const center = getSelectionCenter()
            if (center) {
                const cp = uvToCanvas(center.u, center.v)
                const axisLength = 60
                const xySize = 15
                let hover: 'x' | 'y' | 'xy' | null = null

                // XY plane
                if (x >= cp.x + 8 && x <= cp.x + 8 + xySize && y >= cp.y - 8 - xySize && y <= cp.y - 8) hover = 'xy'
                // X axis
                else if (y >= cp.y - 8 && y <= cp.y + 8 && x >= cp.x && x <= cp.x + axisLength) hover = 'x'
                // Y axis
                else if (x >= cp.x - 8 && x <= cp.x + 8 && y >= cp.y - axisLength && y <= cp.y) hover = 'y'

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
                let constraintY = clientDy  // Note: In UV space, we need to INVERT Y for proper direction

                if (activeAxis === 'x') {
                    constraintY = 0
                } else if (activeAxis === 'y') {
                    constraintX = 0
                }
                // 'xy' = no constraints

                applyTranslation(constraintX, constraintY)
            }
            // TODO: Implement rotate and scale transforms

            setDragStart({ x: e.clientX, y: e.clientY })
        }
    }, [isPanning, isSelecting, isDragging, dragStart, transformMode, selectedUVs, uvToCanvas, getSelectionCenter, hoveredAxis, activeAxis, applyTranslation])

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        if (isSelecting && selectionStart && selectionEnd) {
            const minX = Math.min(selectionStart.x, selectionEnd.x)
            const maxX = Math.max(selectionStart.x, selectionEnd.x)
            const minY = Math.min(selectionStart.y, selectionEnd.y)
            const maxY = Math.max(selectionStart.y, selectionEnd.y)

            const newSelections: UVSelection[] = []

            if (modelData?.Geosets) {
                visibleGeosetIds.forEach((geosetIndex: number) => {
                    const geoset = modelData!.Geosets![geosetIndex]
                    if (!geoset?.TVertices?.[0]) return

                    const uvs = geoset.TVertices[0]
                    const vertexCount = uvs.length / 2
                    const selectedIndices: number[] = []

                    for (let i = 0; i < vertexCount; i++) {
                        const pos = uvToCanvas(uvs[i * 2], uvs[i * 2 + 1])
                        if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
                            selectedIndices.push(i)
                        }
                    }

                    if (selectedIndices.length > 0) {
                        newSelections.push({ geosetIndex, indices: selectedIndices })
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

        setIsPanning(false)
        setIsSelecting(false)
        setIsDragging(false)
        setActiveAxis(null)
        setSelectionStart(null)
        setSelectionEnd(null)
        setDragStart(null)
    }, [isSelecting, selectionStart, selectionEnd, modelData, visibleGeosetIds, uvToCanvas])

    // -------------------------------------------------------------------------
    // EFFECTS
    // -------------------------------------------------------------------------

    // Keyboard shortcuts: W/E/R for Move/Rotate/Scale, Ctrl+Z/Y for Undo/Redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault()
                undo()
            } else if (e.ctrlKey && e.key === 'y') {
                e.preventDefault()
                redo()
            } else if (e.key === 'w' || e.key === 'W') {
                setTransformMode('translate')
            } else if (e.key === 'e' || e.key === 'E') {
                setTransformMode('rotate')
            } else if (e.key === 'r' || e.key === 'R') {
                setTransformMode('scale')
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [undo, redo])

    // Load texture
    useEffect(() => {
        const loadTexture = async () => {
            if (!modelData || !modelPath || selectedTextureId === null) {
                setTextureImage(null)
                return
            }

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
                                img.onload = () => setTextureImage(img)
                                img.src = dataUrl
                            }
                        }
                    }
                } else {
                    const img = new Image()
                    img.onload = () => setTextureImage(img)
                    img.src = `file://${fullPath}`
                }
            } catch (e) {
                console.error('[UVEditor] Failed to load texture:', e)
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

    // Re-render
    useEffect(() => {
        renderCanvas()
    }, [renderCanvas])

    // -------------------------------------------------------------------------
    // DOM
    // -------------------------------------------------------------------------

    const toolbarStyle: React.CSSProperties = {
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '5px',
        padding: '8px 12px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: '8px',
        zIndex: 100
    }

    const buttonStyle = (active: boolean): React.CSSProperties => ({
        backgroundColor: active ? '#1890ff' : '#333',
        borderColor: active ? '#1890ff' : '#555',
        color: '#fff'
    })

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
                {/* Sub-mode */}
                <Tooltip title="选择顶点">
                    <Button icon={<BorderOutlined />} style={buttonStyle(uvSubMode === 'vertex')} onClick={() => setUvSubMode('vertex')} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 5px' }} />

                {/* Transform modes */}
                <Tooltip title="选择框选">
                    <Button icon={<SelectOutlined />} style={buttonStyle(transformMode === 'select')} onClick={() => setTransformMode('select')} />
                </Tooltip>
                <Tooltip title="移动 (W)">
                    <Button icon={<DragOutlined />} style={buttonStyle(transformMode === 'translate')} onClick={() => setTransformMode('translate')} />
                </Tooltip>
                <Tooltip title="旋转 (E)">
                    <Button icon={<RotateLeftOutlined />} style={buttonStyle(transformMode === 'rotate')} onClick={() => setTransformMode('rotate')} />
                </Tooltip>
                <Tooltip title="缩放 (R)">
                    <Button icon={<ColumnWidthOutlined />} style={buttonStyle(transformMode === 'scale')} onClick={() => setTransformMode('scale')} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 5px' }} />

                {/* Mirror */}
                <Tooltip title="水平镜像">
                    <Button icon={<SwapOutlined />} onClick={mirrorHorizontal} disabled={selectedUVs.length === 0} />
                </Tooltip>
                <Tooltip title="垂直镜像">
                    <Button icon={<VerticalAlignMiddleOutlined style={{ transform: 'rotate(90deg)' }} />} onClick={mirrorVertical} disabled={selectedUVs.length === 0} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 5px' }} />

                {/* Undo/Redo with icons */}
                <Tooltip title="撤销 (Ctrl+Z)">
                    <Button icon={<UndoOutlined />} onClick={undo} disabled={historyIndex < 0} />
                </Tooltip>
                <Tooltip title="重做 (Ctrl+Y)">
                    <Button icon={<RedoOutlined />} onClick={redo} disabled={historyIndex >= history.length - 1} />
                </Tooltip>

                <div style={{ width: '1px', backgroundColor: '#555', margin: '0 5px' }} />

                {/* Toggle 3D view */}
                <Tooltip title={showModelView ? '隐藏模型视图' : '显示模型视图'}>
                    <Button style={buttonStyle(showModelView)} onClick={onToggleModelView}>
                        {showModelView ? '隐藏3D' : '显示3D'}
                    </Button>
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
                padding: '5px 10px',
                borderRadius: '4px'
            }}>
                缩放: {(zoom * 100).toFixed(0)}% |
                选中: {selectedUVs.reduce((sum, s) => sum + s.indices.length, 0)} 顶点 |
                可见多边形: {visibleGeosetIds.length}
            </div>
        </div>
    )
}

export default UVEditor
