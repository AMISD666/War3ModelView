import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useModelStore } from '../../../store/modelStore'
import { useSelectionStore } from '../../../store/selectionStore'
import { useRendererStore } from '../../../store/rendererStore'
import {
    PlayCircleOutlined,
    PauseCircleOutlined,
    StepBackwardOutlined,
    StepForwardOutlined,
    FastBackwardOutlined,
    FastForwardOutlined,
    ZoomInOutlined,
    ZoomOutOutlined,
    EyeOutlined,
    EyeInvisibleOutlined
} from '@ant-design/icons'
import { useHistoryStore } from '../../../store/historyStore'
import { Button, Slider, Input, InputNumber, Radio, Tooltip } from 'antd'
import { SwapOutlined, GlobalOutlined } from '@ant-design/icons'

interface TimelinePanelProps {
    isActive?: boolean
}

// Constants
const RULER_HEIGHT = 28
// Track visual settings
const KEYFRAME_SIZE = 5
const SNAP_THRESHOLD_X = 50 // px, distance in X to snap (Large range)
const CLICK_MOVE_THRESHOLD = 5 // px, max movement to count as click

const LANE_HEIGHT = 14
const OFFSET_TRANSLATION = 12
const OFFSET_ROTATION = 26
const OFFSET_SCALING = 40

const TimelinePanel: React.FC<TimelinePanelProps> = ({ isActive = true }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number | null>(null)
    const containerSizeRef = useRef<{ width: number; height: number }>({ width: 400, height: 180 })

    // Stores
    const {
        sequences,
        currentSequence,
        isPlaying,
        playbackSpeed,
        autoKeyframe,
        modelData,
        nodes: modelNodes,
        setPlaying,
        setPlaybackSpeed,
        setFrame,
        setAutoKeyframe
    } = useModelStore()

    const { selectedNodeIds, transformMode, multiMoveMode, setMultiMoveMode } = useSelectionStore()

    // Derived Animation Info
    const sequence = currentSequence >= 0 && sequences ? sequences[currentSequence] : null
    const seqStart = sequence ? sequence.Interval[0] : 0
    const seqEnd = sequence ? sequence.Interval[1] : 1000

    // State (Visual)
    const [pixelsPerMs, setPixelsPerMs] = useState(0.1)
    const [scrollX, setScrollX] = useState(0)
    const [displayFrame, setDisplayFrame] = useState(0)
    const [isEditingFrame, setIsEditingFrame] = useState(false)
    const [inputFrameValue, setInputFrameValue] = useState('')
    const [showAllKeyframes, setShowAllKeyframes] = useState(false)

    // Missing State from previous error
    const [isDragging, setIsDragging] = useState(false)
    const [dragTargetSequenceIndex, setDragTargetSequenceIndex] = useState<number | null>(null)

    // State (Selection)
    const [selectedKeyframeUids, setSelectedKeyframeUids] = useState<Set<string>>(new Set())
    const [selectionRect, setSelectionRect] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null)
    const [hoveredSequenceIndex, setHoveredSequenceIndex] = useState<number | null>(null)

    // Clipboard State for Keyframes
    const [clipboardKeyframes, setClipboardKeyframes] = useState<{
        keyframes: { nodeId: number, type: string, frame: number, value: any, inTan?: any, outTan?: any }[]
        isCut: boolean
        baseFrame: number
    } | null>(null)

    // Drag Keyframe Preview State
    const [dragKeyframeOffset, setDragKeyframeOffset] = useState<number>(0)

    // Refs for RAF
    const frameRef = useRef(0)
    const pixelsPerMsRef = useRef(pixelsPerMs)
    const scrollXRef = useRef(scrollX)
    const seqStartRef = useRef(seqStart)
    const seqEndRef = useRef(seqEnd)
    const isDraggingRef = useRef(isDragging)
    const activeKeyframesRef = useRef<any[]>([])
    const selectedKeyframeUidsRef = useRef<Set<string>>(new Set())
    const selectionRectRef = useRef<{ startX: number, startY: number, endX: number, endY: number } | null>(null)
    const showAllKeyframesRef = useRef(showAllKeyframes)
    const transformModeRef = useRef(transformMode)
    const dragKeyframeOffsetRef = useRef(0)

    // Interaction Refs
    const interactionRef = useRef({
        mode: 'none' as 'none' | 'scrub' | 'pan' | 'boxSelect' | 'dragSequence' | 'dragSequenceStart' | 'dragSequenceEnd' | 'pendingDragKeyframes' | 'dragKeyframes',
        startX: 0,
        startY: 0,
        lastMouseX: 0,
        initialScrollX: 0,
        dragSequenceIndex: -1,
        initialInterval: [0, 0],
        dragKeyframeStartFrame: 0,
        dragKeyframeData: [] as { nodeId: number, type: string, originalFrame: number, keyIndex: number }[]
    })

    // Derived Global Info
    const allSequencesMax = useMemo(() => {
        if (!sequences || sequences.length === 0) return 1000
        return sequences.reduce((max, s) => Math.max(max, s.Interval[1]), 0)
    }, [sequences])

    // Sync Refs
    useEffect(() => { pixelsPerMsRef.current = pixelsPerMs }, [pixelsPerMs])
    useEffect(() => { scrollXRef.current = scrollX }, [scrollX])
    useEffect(() => {
        // If showing all, use 0-Max. Else use current sequence.
        if (showAllKeyframes) {
            seqStartRef.current = 0
            seqEndRef.current = allSequencesMax
        } else {
            seqStartRef.current = seqStart
            seqEndRef.current = seqEnd
        }
    }, [seqStart, seqEnd, showAllKeyframes, allSequencesMax])

    useEffect(() => { selectedKeyframeUidsRef.current = selectedKeyframeUids }, [selectedKeyframeUids])
    useEffect(() => { selectionRectRef.current = selectionRect }, [selectionRect])
    useEffect(() => { showAllKeyframesRef.current = showAllKeyframes }, [showAllKeyframes])
    useEffect(() => { transformModeRef.current = transformMode }, [transformMode])
    useEffect(() => { isDraggingRef.current = isDragging }, [isDragging])
    useEffect(() => { dragKeyframeOffsetRef.current = dragKeyframeOffset }, [dragKeyframeOffset])

    // Cache active keyframes
    useEffect(() => {
        if (!modelData || selectedNodeIds.length === 0) {
            activeKeyframesRef.current = []
            return
        }

        const keyframes: any[] = []

        selectedNodeIds.forEach(nodeId => {
            const node = modelNodes.find((n: any) => n.ObjectId === nodeId)
            if (!node) return

            const addKeys = (propData: any, type: string, color: string) => {
                if (propData && Array.isArray(propData.Keys)) {
                    propData.Keys.forEach((k: any, idx: number) => {
                        keyframes.push({
                            frame: k.Frame,
                            nodeId,
                            type,
                            uid: `${nodeId} -${type} -${idx} `,
                            color
                        })
                    })
                }
            }

            addKeys(node.Translation, 'Translation', '#ff4d4f')
            addKeys(node.Rotation, 'Rotation', '#52c41a')
            addKeys(node.Scaling, 'Scaling', '#1890ff')
        })

        activeKeyframesRef.current = keyframes
    }, [modelData, selectedNodeIds, modelNodes])

    // Auto-fit sequence change
    const lastSequenceIndexRef = useRef(currentSequence)
    useEffect(() => {
        // Only auto-fit if the SEQUENCE INDEX changed
        // We do NOT want to auto-fit if we are just updating the start/end of the SAME sequence (dragging)

        const indexChanged = lastSequenceIndexRef.current !== currentSequence
        lastSequenceIndexRef.current = currentSequence

        if (!containerRef.current) return

        // If dragging, absolutely do not resize view
        if (isDraggingRef.current) return

        // If only data changed but not index, we probably still don't want to re-fit aggressively
        if (!indexChanged) return

        let start = 0
        let end = 1000
        if (sequence) {
            start = sequence.Interval[0]
            end = sequence.Interval[1]
        }

        const duration = end - start
        const containerWidth = containerRef.current.clientWidth || 400
        const paddedDuration = Math.max(100, duration * 1.2)
        const newPixelsPerMs = containerWidth / paddedDuration

        // Apply
        setPixelsPerMs(Math.max(0.01, Math.min(2, newPixelsPerMs)))
        setScrollX(Math.max(0, start - duration * 0.1))

    }, [currentSequence, allSequencesMax, sequence]) // Removed showAllKeyframes from dep and logic

    // Resize Observer
    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                containerSizeRef.current = {
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                }
            }
        })
        resizeObserver.observe(container)
        containerSizeRef.current = { width: container.clientWidth, height: container.clientHeight }
        return () => resizeObserver.disconnect()
    }, [])

    // RAF Loop
    useEffect(() => {
        if (!isActive) {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
            return
        }

        const runState = { shouldRun: true }
        let lastDrawTime = 0
        let lastDisplayUpdate = 0
        const frameInterval = 1000 / 60
        const DISPLAY_UPDATE_INTERVAL = 50

        const animate = (time: number) => {
            if (!runState.shouldRun) return

            const elapsed = time - lastDrawTime
            if (elapsed >= frameInterval) {
                lastDrawTime = time

                if (!isDraggingRef.current && interactionRef.current.mode !== 'scrub' && interactionRef.current.mode !== 'dragSequence' && interactionRef.current.mode !== 'dragSequenceStart' && interactionRef.current.mode !== 'dragSequenceEnd') {
                    const renderer = useRendererStore.getState().renderer
                    if (renderer && renderer.rendererData && typeof renderer.rendererData.frame === 'number') {
                        frameRef.current = renderer.rendererData.frame
                    } else {
                        frameRef.current = useModelStore.getState().currentFrame
                    }
                }

                draw()

                if (!isEditingFrame && time - lastDisplayUpdate > DISPLAY_UPDATE_INTERVAL) {
                    lastDisplayUpdate = time
                    setDisplayFrame(Math.round(frameRef.current))
                }
            }

            if (runState.shouldRun) {
                rafRef.current = requestAnimationFrame(animate)
            }
        }
        rafRef.current = requestAnimationFrame(animate)

        return () => {
            runState.shouldRun = false
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [isActive, isEditingFrame])

    // Draw Function
    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const width = containerSizeRef.current.width
        const height = containerSizeRef.current.height
        const SEQUENCE_HEIGHT = 30 // Increased for Name below markers

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
        }

        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const start = seqStartRef.current
        const end = seqEndRef.current
        const frame = frameRef.current
        const activeKeyframes = activeKeyframesRef.current
        const selectedUids = selectedKeyframeUidsRef.current
        const selRect = selectionRectRef.current
        const showAll = showAllKeyframesRef.current
        const currentMode = transformModeRef.current

        // Bg
        ctx.fillStyle = '#1e1e1e'
        ctx.fillRect(0, 0, width, height)

        // Ruler Bg
        ctx.fillStyle = '#252526'
        ctx.fillRect(0, 0, width, RULER_HEIGHT)
        ctx.strokeStyle = '#333'
        ctx.beginPath()
        ctx.moveTo(0, RULER_HEIGHT)
        ctx.lineTo(width, RULER_HEIGHT)
        ctx.stroke()

        // Sequence Track Bg (Bottom)
        const seqTrackY = height - SEQUENCE_HEIGHT
        ctx.fillStyle = '#202020'
        ctx.fillRect(0, seqTrackY, width, SEQUENCE_HEIGHT)
        ctx.strokeStyle = '#333'
        ctx.beginPath()
        ctx.moveTo(0, seqTrackY)
        ctx.lineTo(width, seqTrackY)
        ctx.stroke()

        // Ticks
        const startTime = scroll
        const endTime = scroll + width / pxPerMs

        let tickInterval = 50
        const idealMsPerTick = 100 / pxPerMs
        if (idealMsPerTick > 5000) tickInterval = 5000
        else if (idealMsPerTick > 1000) tickInterval = 1000
        else if (idealMsPerTick > 500) tickInterval = 500
        else if (idealMsPerTick > 100) tickInterval = 100

        const firstTick = Math.floor(startTime / tickInterval) * tickInterval
        ctx.font = '10px Microsoft YaHei'
        ctx.textAlign = 'left'

        for (let t = firstTick; t <= endTime; t += tickInterval) {
            const x = (t - scroll) * pxPerMs
            if (x < -20) continue

            // Ruler Line
            ctx.strokeStyle = '#444'
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, RULER_HEIGHT)
            // Grid Line in Track
            ctx.moveTo(x, RULER_HEIGHT)
            ctx.lineTo(x, seqTrackY) // Stop at Sequence Track
            ctx.stroke()

            // Text
            ctx.fillStyle = '#888'
            ctx.fillText(t.toString(), x + 4, 12)
        }

        // Sequence Bounds Highlight (Ruler + Track)
        const startX = (start - scroll) * pxPerMs
        const endX = (end - scroll) * pxPerMs
        ctx.fillStyle = 'rgba(70, 144, 226, 0.15)' // Increased opacity from 0.05 to 0.15
        ctx.fillRect(startX, RULER_HEIGHT, Math.max(0, endX - startX), seqTrackY - RULER_HEIGHT)

        ctx.strokeStyle = 'rgba(70, 144, 226, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(startX, 0); ctx.lineTo(startX, seqTrackY)
        ctx.moveTo(endX, 0); ctx.lineTo(endX, seqTrackY)
        ctx.stroke()

        // Draw Sequence Markers (Bottom Track)
        const storeSequences = useModelStore.getState().sequences
        /* 
           Draw Markers: Start Triangle, End Triangle.
           Name: Below the markers.
        */
        if (storeSequences) {
            ctx.font = '10px Microsoft YaHei' // Smaller font for name
            storeSequences.forEach((seq, idx) => {
                const isCurrent = idx === useModelStore.getState().currentSequence
                if (!showAll && !isCurrent) return

                const sx = (seq.Interval[0] - scroll) * pxPerMs
                const ex = (seq.Interval[1] - scroll) * pxPerMs

                if (ex < 0 || sx > width) return

                // Draw Markers at Top of Sequence Track
                const markerY = seqTrackY + 2
                const handleSize = 8

                const isDragStart = interactionRef.current.mode === 'dragSequenceStart' && interactionRef.current.dragSequenceIndex === idx
                const isDragEnd = interactionRef.current.mode === 'dragSequenceEnd' && interactionRef.current.dragSequenceIndex === idx

                // Start Marker (Right pointing or Down pointing triangle?)
                // Let's do Downward pointing triangle at start pos
                ctx.fillStyle = (isCurrent || isDragStart) ? '#1890ff' : '#666'
                ctx.beginPath()
                ctx.moveTo(sx, markerY)
                ctx.lineTo(sx + handleSize, markerY)
                ctx.lineTo(sx, markerY + handleSize)
                ctx.closePath()
                ctx.fill()

                // End Marker
                ctx.fillStyle = (isCurrent || isDragEnd) ? '#1890ff' : '#666'
                ctx.beginPath()
                ctx.moveTo(ex, markerY)
                ctx.lineTo(ex - handleSize, markerY)
                ctx.lineTo(ex, markerY + handleSize)
                ctx.closePath()
                ctx.fill()

                // Name Text - Below markers
                // Centered between markers or below Start? User: "in respective marker's below" (在各自的标记的下面)
                // "Each action's start/end frame has a drag marker, and displayed sequence name is below the respective markers"
                // This might mean: Name under Start Marker, and Name under End Marker?
                // Or just Name in the track. "Below the markers" likely means Y-axis below.
                // Let's put text below the start marker for now, as is typical.

                ctx.textAlign = 'left'
                ctx.fillStyle = isCurrent ? '#eee' : '#666'
                // Draw name below Start Marker
                ctx.fillText(seq.Name, sx, markerY + handleSize + 10)
                // Draw name below End Marker
                ctx.fillText(seq.Name, ex, markerY + handleSize + 10)
            })
        }

        // Draw Keyframes (Track Area with Lanes)
        activeKeyframes.forEach(kf => {
            const kx = (kf.frame - scroll) * pxPerMs
            if (kx < -10 || kx > width + 10) return

            // Filter logic
            let isVisible = false
            if (showAll) {
                isVisible = true
            } else {
                if (currentMode === 'translate' && kf.type === 'Translation') isVisible = true
                else if (currentMode === 'rotate' && kf.type === 'Rotation') isVisible = true
                else if (currentMode === 'scale' && kf.type === 'Scaling') isVisible = true
            }

            if (!isVisible) return

            let laneY = RULER_HEIGHT + 20
            if (kf.type === 'Translation') laneY = RULER_HEIGHT + OFFSET_TRANSLATION
            else if (kf.type === 'Rotation') laneY = RULER_HEIGHT + OFFSET_ROTATION
            else if (kf.type === 'Scaling') laneY = RULER_HEIGHT + OFFSET_SCALING

            const isSelected = selectedUids.has(kf.uid)

            // Apply drag offset to selected keyframes for real-time preview
            const dragOffset = dragKeyframeOffsetRef.current
            const drawX = isSelected && dragOffset !== 0 ? kx + dragOffset * pxPerMs : kx

            ctx.fillStyle = isSelected ? '#ffcc00' : kf.color

            ctx.beginPath()
            ctx.moveTo(drawX, laneY - KEYFRAME_SIZE)
            ctx.lineTo(drawX + KEYFRAME_SIZE, laneY)
            ctx.lineTo(drawX, laneY + KEYFRAME_SIZE)
            ctx.lineTo(drawX - KEYFRAME_SIZE, laneY)
            ctx.fill()

            if (isSelected) {
                ctx.strokeStyle = '#fff'
                ctx.lineWidth = 1
                ctx.stroke()
            }
        })

        // Draw Selection Rect
        if (selRect) {
            ctx.strokeStyle = '#1890ff'
            ctx.fillStyle = 'rgba(24, 144, 255, 0.2)'
            const rx = Math.min(selRect.startX, selRect.endX)
            const ry = Math.min(selRect.startY, selRect.endY)
            const rw = Math.abs(selRect.endX - selRect.startX)
            const rh = Math.abs(selRect.endY - selRect.startY)
            ctx.fillRect(rx, ry, rw, rh)
            ctx.strokeRect(rx, ry, rw, rh)
        }

        // Playhead
        const playheadX = (frame - scroll) * pxPerMs

        ctx.strokeStyle = '#ff4444'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(playheadX, 0)
        ctx.lineTo(playheadX, height) // Full height
        ctx.stroke()

        // Playhead handle
        ctx.fillStyle = '#ff4444'
        ctx.beginPath()
        ctx.moveTo(playheadX - 6, 0)
        ctx.lineTo(playheadX + 6, 0)
        ctx.lineTo(playheadX + 6, RULER_HEIGHT / 2)
        ctx.lineTo(playheadX, RULER_HEIGHT - 2)
        ctx.lineTo(playheadX - 6, RULER_HEIGHT / 2)
        ctx.closePath()
        ctx.fill()
    }, [sequences]) // Added sequences dependency

    // Interaction Handlers
    const getKeyframeAtPos = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top // Relative Y

        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const showAll = showAllKeyframesRef.current
        const currentMode = transformModeRef.current

        let found: any = null // Explicit type fix
        let minDistX = SNAP_THRESHOLD_X

        activeKeyframesRef.current.forEach(kf => {
            let isVisible = false
            if (showAll) {
                isVisible = true
            } else {
                if (currentMode === 'translate' && kf.type === 'Translation') isVisible = true
                else if (currentMode === 'rotate' && kf.type === 'Rotation') isVisible = true
                else if (currentMode === 'scale' && kf.type === 'Scaling') isVisible = true
            }
            if (!isVisible) return

            const kx = (kf.frame - scroll) * pxPerMs
            const dist = Math.abs(kx - x)

            // X Check only (vertical column snap)
            if (dist < minDistX) {
                minDistX = dist
                found = kf
            }
        })
        return found
    }

    // NEW Hit Test for Start/End Markers
    const getSequenceHandleAtPos = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top

        const SEQUENCE_HEIGHT = 30 // Must match draw
        const height = canvas.height
        const seqTrackY = height - SEQUENCE_HEIGHT

        if (y < seqTrackY) return null // Only check bottom track

        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const sequences = useModelStore.getState().sequences
        const currentIdx = useModelStore.getState().currentSequence

        if (!sequences || currentIdx < 0) return null

        // Only check current sequence handles
        const seq = sequences[currentIdx]
        const sx = (seq.Interval[0] - scroll) * pxPerMs
        const ex = (seq.Interval[1] - scroll) * pxPerMs

        const HIT_RADIUS = 10
        const handleSize = 8
        // Marker is [sx, seqTrackY+2] -> [sx+8, seqTrackY+2] ...

        // Start: sx is left edge
        if (x >= sx - 4 && x <= sx + handleSize + 4) return { type: 'start', index: currentIdx }

        // End: ex is right edge
        if (x >= ex - handleSize - 4 && x <= ex + 4) return { type: 'end', index: currentIdx }

        return null
    }

    const mouseToFrame = (clientX: number) => {
        const canvas = canvasRef.current
        if (!canvas) return 0
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        return scrollXRef.current + x / pixelsPerMsRef.current
    }

    const updateFrame = (targetFrame: number) => {
        const clamped = Math.max(seqStartRef.current, Math.min(seqEndRef.current, Math.round(targetFrame)))
        frameRef.current = clamped

        const renderer = useRendererStore.getState().renderer
        if (renderer && renderer.rendererData) {
            renderer.rendererData.frame = clamped
            if (typeof renderer.update === 'function') {
                renderer.update(0)
            }
        }
    }

    const confirmScrub = useCallback(() => {
        const clampedFrame = frameRef.current
        setFrame(clampedFrame)
    }, [setFrame])

    // ================== KEYFRAME OPERATIONS ==================

    // Helper: Get keyframe data for selected UIDs
    const getSelectedKeyframeData = useCallback(() => {
        const result: { nodeId: number, type: string, frame: number, keyIndex: number, value: any, inTan?: any, outTan?: any }[] = []
        const nodes = useModelStore.getState().nodes as any[]

        activeKeyframesRef.current.forEach((kf, _idx) => {
            if (!selectedKeyframeUids.has(kf.uid)) return

            const node = nodes.find((n: any) => n.ObjectId === kf.nodeId)
            if (!node) return

            const propData = node[kf.type]
            if (!propData?.Keys) return

            // Find actual key index by frame
            const keyIndex = propData.Keys.findIndex((k: any) => k.Frame === kf.frame)
            if (keyIndex === -1) return

            const key = propData.Keys[keyIndex]
            result.push({
                nodeId: kf.nodeId,
                type: kf.type,
                frame: kf.frame,
                keyIndex,
                value: Array.isArray(key.Vector) ? [...key.Vector] : key.Vector,
                inTan: key.InTan ? [...key.InTan] : undefined,
                outTan: key.OutTan ? [...key.OutTan] : undefined
            })
        })
        return result
    }, [selectedKeyframeUids])

    // Delete selected keyframes
    const deleteSelectedKeyframes = useCallback(() => {
        if (selectedKeyframeUids.size === 0) return

        const keyframeData = getSelectedKeyframeData()
        if (keyframeData.length === 0) return

        const nodes = useModelStore.getState().nodes
        const nodesCopy = JSON.parse(JSON.stringify(nodes))

        // Group by nodeId and type for efficient deletion
        const grouped = new Map<string, { nodeId: number, type: string, frames: number[] }>()
        keyframeData.forEach(kf => {
            const key = `${kf.nodeId}-${kf.type}`
            if (!grouped.has(key)) {
                grouped.set(key, { nodeId: kf.nodeId, type: kf.type, frames: [] })
            }
            grouped.get(key)!.frames.push(kf.frame)
        })

        // Delete keyframes (reverse order to preserve indices)
        grouped.forEach(({ nodeId, type, frames }) => {
            const node = nodesCopy.find((n: any) => n.ObjectId === nodeId)
            if (!node || !node[type]?.Keys) return

            node[type].Keys = node[type].Keys.filter((k: any) => !frames.includes(k.Frame))

            // If no keys left, remove the AnimVector
            if (node[type].Keys.length === 0) {
                delete node[type]
            }
        })

        // Push to history
        const oldNodes = nodes
        useHistoryStore.getState().push({
            name: `删除 ${keyframeData.length} 个关键帧`,
            undo: () => useModelStore.setState({ nodes: oldNodes as any }),
            redo: () => useModelStore.setState({ nodes: nodesCopy })
        })

        useModelStore.setState({ nodes: nodesCopy })
        setSelectedKeyframeUids(new Set())
    }, [selectedKeyframeUids, getSelectedKeyframeData])

    // Copy keyframes to clipboard (isCut = true for cut operation)
    const copyKeyframes = useCallback((isCut: boolean) => {
        if (selectedKeyframeUids.size === 0) return

        const keyframeData = getSelectedKeyframeData()
        if (keyframeData.length === 0) return

        // Find minimum frame as base
        const baseFrame = Math.min(...keyframeData.map(kf => kf.frame))

        setClipboardKeyframes({
            keyframes: keyframeData.map(kf => ({
                nodeId: kf.nodeId,
                type: kf.type,
                frame: kf.frame,
                value: kf.value,
                inTan: kf.inTan,
                outTan: kf.outTan
            })),
            isCut,
            baseFrame
        })

        if (isCut) {
            deleteSelectedKeyframes()
        }
    }, [selectedKeyframeUids, getSelectedKeyframeData, deleteSelectedKeyframes])

    // Paste keyframes at current frame position
    const pasteKeyframes = useCallback(() => {
        if (!clipboardKeyframes || clipboardKeyframes.keyframes.length === 0) return

        const currentFrame = frameRef.current
        const offset = currentFrame - clipboardKeyframes.baseFrame

        const nodes = useModelStore.getState().nodes
        const nodesCopy = JSON.parse(JSON.stringify(nodes))

        clipboardKeyframes.keyframes.forEach(kf => {
            const node = nodesCopy.find((n: any) => n.ObjectId === kf.nodeId)
            if (!node) return

            const targetFrame = kf.frame + offset

            // Ensure AnimVector exists
            if (!node[kf.type]) {
                node[kf.type] = {
                    Keys: [],
                    LineType: 1, // Linear interpolation default
                    GlobalSeqId: -1
                }
            }

            // Check if a key already exists at this frame
            const existingIdx = node[kf.type].Keys.findIndex((k: any) => k.Frame === targetFrame)
            const newKey: any = {
                Frame: targetFrame,
                Vector: Array.isArray(kf.value) ? [...kf.value] : kf.value
            }
            if (kf.inTan) newKey.InTan = [...kf.inTan]
            if (kf.outTan) newKey.OutTan = [...kf.outTan]

            if (existingIdx >= 0) {
                node[kf.type].Keys[existingIdx] = newKey
            } else {
                node[kf.type].Keys.push(newKey)
                // Sort by frame
                node[kf.type].Keys.sort((a: any, b: any) => a.Frame - b.Frame)
            }
        })

        // Push to history
        const oldNodes = nodes
        useHistoryStore.getState().push({
            name: `粘贴 ${clipboardKeyframes.keyframes.length} 个关键帧`,
            undo: () => useModelStore.setState({ nodes: oldNodes as any }),
            redo: () => useModelStore.setState({ nodes: nodesCopy })
        })

        useModelStore.setState({ nodes: nodesCopy })

        // Clear clipboard if it was a cut operation
        if (clipboardKeyframes.isCut) {
            setClipboardKeyframes(null)
        }
    }, [clipboardKeyframes])

    // Keyboard event handler for keyframe operations
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle when timeline is active and has focus context
            if (!isActive) return

            // Delete key
            if (e.key === 'Delete' && selectedKeyframeUids.size > 0) {
                e.preventDefault()
                deleteSelectedKeyframes()
                return
            }

            // Ctrl+C - Copy
            if (e.ctrlKey && e.key === 'c' && selectedKeyframeUids.size > 0) {
                e.preventDefault()
                copyKeyframes(false)
                return
            }

            // Ctrl+X - Cut
            if (e.ctrlKey && e.key === 'x' && selectedKeyframeUids.size > 0) {
                e.preventDefault()
                copyKeyframes(true)
                return
            }

            // Ctrl+V - Paste
            if (e.ctrlKey && e.key === 'v' && clipboardKeyframes) {
                e.preventDefault()
                pasteKeyframes()
                return
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isActive, selectedKeyframeUids, clipboardKeyframes, deleteSelectedKeyframes, copyKeyframes, pasteKeyframes])

    // --- Global Window Handlers for Robust Dragging ---

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        // Failsafe state check
        if (e.buttons === 0) {
            // Stop any drag
            if (interactionRef.current.mode !== 'none') {
                setIsDragging(false)
                interactionRef.current.mode = 'none'
                setDragTargetSequenceIndex(null)
                setSelectionRect(null)
            }
            return
        }

        const { mode, lastMouseX } = interactionRef.current

        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        if (mode === 'pan') {
            const dx = e.clientX - lastMouseX
            const scrollDelta = dx / pixelsPerMsRef.current
            setScrollX(prev => Math.max(0, prev - scrollDelta))
            interactionRef.current.lastMouseX = e.clientX
        } else if (mode === 'scrub') {
            updateFrame(mouseToFrame(e.clientX))
        } else if (mode === 'dragSequenceStart' || mode === 'dragSequenceEnd') {
            // Drag Sequence START ONLY or END ONLY
            const idx = interactionRef.current.dragSequenceIndex
            const dxPixels = e.clientX - interactionRef.current.startX
            const dxFrames = Math.round(dxPixels / pixelsPerMsRef.current)

            const initialInterval = interactionRef.current.initialInterval
            if (initialInterval && idx >= 0) {
                let updatedInterval = [initialInterval[0], initialInterval[1]]

                if (mode === 'dragSequenceStart') {
                    // Update Start
                    let newStart = initialInterval[0] + dxFrames
                    // Constraint: Start < End
                    newStart = Math.min(newStart, initialInterval[1] - 1)
                    updatedInterval = [newStart, initialInterval[1]]
                } else {
                    // Update End
                    let newEnd = initialInterval[1] + dxFrames
                    // Constraint: End > Start
                    newEnd = Math.max(newEnd, initialInterval[0] + 1)
                    updatedInterval = [initialInterval[0], newEnd]
                }

                // 1. Update Store (Updates UI)
                useModelStore.getState().updateSequence(idx, { Interval: updatedInterval })

                // 2. Update Live Renderer (Updates Playback Range IMMEDIATELY)
                const renderer = useRendererStore.getState().renderer
                if (renderer) {
                    // Check if updating currently playing sequence
                    if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                        renderer.rendererData.animationInfo.Interval = [updatedInterval[0], updatedInterval[1]]
                    }
                    // Update model source data to persist change for this session's renderer instance
                    if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[idx]) {
                        renderer.model.Sequences[idx].Interval = [updatedInterval[0], updatedInterval[1]]
                    }
                }
            }

        } else if (mode === 'pendingDragKeyframes') {
            // 检查是否超过拖动阈值，只有超过才进入真正的拖动模式
            const DRAG_THRESHOLD = 8 // 像素
            const dx = Math.abs(e.clientX - interactionRef.current.startX)
            const dy = Math.abs(e.clientY - interactionRef.current.startY)
            if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                // 进入真正的拖动模式
                interactionRef.current.mode = 'dragKeyframes'
                setIsDragging(true)
            }
        } else if (mode === 'dragKeyframes') {
            // Calculate frame offset from drag start
            const currentFrame = mouseToFrame(e.clientX)
            const startFrame = interactionRef.current.dragKeyframeStartFrame
            const frameOffset = Math.round(currentFrame - startFrame)

            // Update lastMouseX for tracking
            interactionRef.current.lastMouseX = e.clientX

            // Update state for real-time visual feedback in draw
            setDragKeyframeOffset(frameOffset)
        } else if (mode === 'boxSelect') {
            setSelectionRect(prev => ({
                startX: interactionRef.current.startX,
                startY: interactionRef.current.startY,
                endX: mouseX,
                endY: mouseY
            }))
        }
    }, [])

    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        const { mode, startX } = interactionRef.current

        window.removeEventListener('mousemove', handleGlobalMouseMove)
        window.removeEventListener('mouseup', handleGlobalMouseUp)

        const canvas = canvasRef.current
        if (!canvas) {
            interactionRef.current.mode = 'none'
            setIsDragging(false)
            setSelectionRect(null)
            return
        }

        if (mode === 'scrub') {
            setIsDragging(false)
            confirmScrub()
        } else if (mode === 'dragSequenceStart' || mode === 'dragSequenceEnd') {
            setIsDragging(false)
            const idx = interactionRef.current.dragSequenceIndex
            const initialInterval = interactionRef.current.initialInterval

            if (idx >= 0 && initialInterval) {
                const sequences = useModelStore.getState().sequences
                const newInterval = sequences[idx].Interval

                // Only push history if actual change occurred
                if (newInterval[0] !== initialInterval[0] || newInterval[1] !== initialInterval[1]) {
                    useHistoryStore.getState().push({
                        name: `Adjust Sequence ${sequences[idx].Name} Range`,
                        undo: () => {
                            useModelStore.getState().updateSequence(idx, { Interval: initialInterval })
                            // Sync Renderer
                            const renderer = useRendererStore.getState().renderer
                            if (renderer?.model?.Sequences?.[idx]) {
                                renderer.model.Sequences[idx].Interval = [...initialInterval]
                                if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                                    renderer.rendererData.animationInfo.Interval = [...initialInterval]
                                }
                            }
                        },
                        redo: () => {
                            useModelStore.getState().updateSequence(idx, { Interval: newInterval })
                            // Sync Renderer
                            const renderer = useRendererStore.getState().renderer
                            if (renderer?.model?.Sequences?.[idx]) {
                                renderer.model.Sequences[idx].Interval = [...newInterval]
                                if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                                    renderer.rendererData.animationInfo.Interval = [...newInterval]
                                }
                            }
                        }
                    })
                }
            }

            setDragTargetSequenceIndex(null)
            // Force refresh global max if needed
        } else if (mode === 'pendingDragKeyframes') {
            // 未超过拖动阈值，视为点击操作 - 仅选中关键帧，不移动
            setIsDragging(false)
            // 如果点击的是关键帧，跳转到该帧
            const clickedKf = getKeyframeAtPos(e.clientX, e.clientY)
            if (clickedKf) {
                updateFrame(clickedKf.frame)
                confirmScrub()
                setSelectedKeyframeUids(new Set([clickedKf.uid]))
            }
        } else if (mode === 'dragKeyframes') {
            setIsDragging(false)

            // Calculate final frame offset
            const currentFrame = mouseToFrame(e.clientX)
            const startFrame = interactionRef.current.dragKeyframeStartFrame
            const frameOffset = Math.round(currentFrame - startFrame)

            // Only process if there was actual movement
            if (frameOffset !== 0 && interactionRef.current.dragKeyframeData.length > 0) {
                const nodes = useModelStore.getState().nodes
                const nodesCopy = JSON.parse(JSON.stringify(nodes))

                // Apply frame offset to all dragged keyframes
                interactionRef.current.dragKeyframeData.forEach(kfData => {
                    const node = nodesCopy.find((n: any) => n.ObjectId === kfData.nodeId)
                    if (!node || !node[kfData.type]?.Keys) return

                    // Find and update the keyframe
                    const keyIdx = node[kfData.type].Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                    if (keyIdx >= 0) {
                        node[kfData.type].Keys[keyIdx].Frame = kfData.originalFrame + frameOffset
                    }
                })

                // Sort keys by frame after moving
                interactionRef.current.dragKeyframeData.forEach(kfData => {
                    const node = nodesCopy.find((n: any) => n.ObjectId === kfData.nodeId)
                    if (node && node[kfData.type]?.Keys) {
                        node[kfData.type].Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                    }
                })

                // Push to history
                const oldNodes = nodes
                useHistoryStore.getState().push({
                    name: `移动 ${interactionRef.current.dragKeyframeData.length} 个关键帧`,
                    undo: () => useModelStore.setState({ nodes: oldNodes as any }),
                    redo: () => useModelStore.setState({ nodes: nodesCopy })
                })

                useModelStore.setState({ nodes: nodesCopy })

                // Clear selection as UIDs have changed
                setSelectedKeyframeUids(new Set())
            }

            // Reset drag offset preview
            setDragKeyframeOffset(0)
        } else if (mode === 'boxSelect') {
            const rect = canvas.getBoundingClientRect()
            const mouseX = e.clientX - rect.left
            const mouseY = e.clientY - rect.top

            const dist = Math.sqrt((mouseX - startX) ** 2 + (mouseY - interactionRef.current.startY) ** 2)

            if (dist < CLICK_MOVE_THRESHOLD) {
                const kf = getKeyframeAtPos(e.clientX, e.clientY)
                if (kf) {
                    updateFrame(kf.frame)
                    confirmScrub()
                    setSelectedKeyframeUids(new Set([kf.uid]))
                } else {
                    setSelectedKeyframeUids(new Set())
                }
            } else {
                const rectStart = Math.min(interactionRef.current.startX, mouseX)
                const rectEnd = Math.max(interactionRef.current.startX, mouseX)

                const pxPerMs = pixelsPerMsRef.current
                const scroll = scrollXRef.current
                const showAll = showAllKeyframesRef.current
                const currentMode = transformModeRef.current

                const ids = new Set<string>()
                activeKeyframesRef.current.forEach(kf => {
                    let isVisible = false
                    if (showAll) isVisible = true
                    else {
                        if (currentMode === 'translate' && kf.type === 'Translation') isVisible = true
                        else if (currentMode === 'rotate' && kf.type === 'Rotation') isVisible = true
                        else if (currentMode === 'scale' && kf.type === 'Scaling') isVisible = true
                    }
                    if (!isVisible) return

                    const kx = (kf.frame - scroll) * pxPerMs
                    if (kx >= rectStart && kx <= rectEnd) {
                        ids.add(kf.uid)
                    }
                })
                setSelectedKeyframeUids(ids)
            }
            setSelectionRect(null)
        }

        interactionRef.current.mode = 'none'
    }, [handleGlobalMouseMove])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        window.addEventListener('mousemove', handleGlobalMouseMove)
        window.addEventListener('mouseup', handleGlobalMouseUp)

        if (e.button === 2) {
            interactionRef.current = {
                mode: 'pan',
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: scrollXRef.current,
                dragSequenceIndex: -1,
                initialInterval: [0, 0],
                dragKeyframeStartFrame: 0,
                dragKeyframeData: []
            }
            return
        }

        // 1. Check for Sequence Handles (Hit Test at Bottom)
        const handleHit = getSequenceHandleAtPos(e.clientX, e.clientY)
        if (handleHit) {
            const seq = useModelStore.getState().sequences[handleHit.index]
            interactionRef.current = {
                mode: handleHit.type === 'start' ? 'dragSequenceStart' : 'dragSequenceEnd',
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: 0,
                dragSequenceIndex: handleHit.index,
                initialInterval: [...seq.Interval],
                dragKeyframeStartFrame: 0,
                dragKeyframeData: []
            }
            setIsDragging(true)
            setDragTargetSequenceIndex(handleHit.index)
            return
        }

        if (mouseY < RULER_HEIGHT) {
            // Scrub
            interactionRef.current = {
                mode: 'scrub',
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: 0,
                dragSequenceIndex: -1,
                initialInterval: [0, 0],
                dragKeyframeStartFrame: 0,
                dragKeyframeData: []
            }
            setIsDragging(true)
            setPlaying(false)
            updateFrame(mouseToFrame(e.clientX))
            confirmScrub()
        } else {
            // Check if clicking on a selected keyframe (to drag)
            const clickedKf = getKeyframeAtPos(e.clientX, e.clientY)
            if (clickedKf && selectedKeyframeUids.has(clickedKf.uid)) {
                // 开始待定拖动模式（需要移动超过阈值才能真正拖动）
                const dragData = getSelectedKeyframeData().map(kf => ({
                    nodeId: kf.nodeId,
                    type: kf.type,
                    originalFrame: kf.frame,
                    keyIndex: kf.keyIndex
                }))

                interactionRef.current = {
                    mode: 'pendingDragKeyframes',
                    startX: e.clientX,
                    startY: e.clientY,
                    lastMouseX: mouseX,
                    initialScrollX: 0,
                    dragSequenceIndex: -1,
                    initialInterval: [0, 0],
                    dragKeyframeStartFrame: clickedKf.frame,
                    dragKeyframeData: dragData
                }
                // 注意：这里不设置 setIsDragging(true)，等待超过阈值后再设置
            } else {
                // Box select mode
                interactionRef.current = {
                    mode: 'boxSelect',
                    startX: mouseX,
                    startY: mouseY,
                    lastMouseX: mouseX,
                    initialScrollX: 0,
                    dragSequenceIndex: -1,
                    initialInterval: [0, 0],
                    dragKeyframeStartFrame: 0,
                    dragKeyframeData: []
                }
                setSelectionRect({ startX: mouseX, startY: mouseY, endX: mouseX, endY: mouseY })
            }
        }
    }, [handleGlobalMouseMove, handleGlobalMouseUp, setPlaying, selectedKeyframeUids, getSelectedKeyframeData])

    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove)
            window.removeEventListener('mouseup', handleGlobalMouseUp)
        }
    }, [handleGlobalMouseMove, handleGlobalMouseUp])


    const handleWheel = (e: React.WheelEvent) => {
        const zoomSpeed = 0.001
        const delta = -e.deltaY
        const factor = 1 + delta * zoomSpeed

        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseFrame = scrollXRef.current + mouseX / pixelsPerMsRef.current

        const newPixelsPerMs = Math.max(0.01, Math.min(5, pixelsPerMs * factor))
        setPixelsPerMs(newPixelsPerMs)
        setScrollX(Math.max(0, mouseFrame - mouseX / newPixelsPerMs))
    }

    const handleGoToStart = () => { setFrame(seqStart); setDisplayFrame(seqStart) }
    const handlePrevFrame = () => { setFrame(Math.max(seqStart, Math.round(frameRef.current) - 33)) }
    const handleNextFrame = () => { setFrame(Math.min(seqEnd, Math.round(frameRef.current) + 33)) }
    const handleGoToEnd = () => { setFrame(seqEnd); setDisplayFrame(seqEnd) }

    // Toolbar Handlers
    const handleFrameInputChange = (e: any) => {
        const val = parseInt(e.target.value)
        if (!isNaN(val)) {
            setFrame(val)
            setDisplayFrame(val)
        }
    }

    const handleSeqStartChange = (val: number | null) => {
        if (val !== null && currentSequence >= 0 && sequences) {
            const currentEnd = sequences[currentSequence].Interval[1]
            const oldInterval = [...sequences[currentSequence].Interval] // Snap old
            const newInterval = [val, currentEnd]

            const idx = currentSequence

            const doUpdate = (interval: number[]) => {
                useModelStore.getState().updateSequence(idx, { Interval: interval })
                // Sync Renderer
                const renderer = useRendererStore.getState().renderer
                if (renderer) {
                    if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                        renderer.rendererData.animationInfo.Interval = [...interval]
                    }
                    if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[idx]) {
                        renderer.model.Sequences[idx].Interval = [...interval]
                    }
                }
            }

            doUpdate(newInterval)

            useHistoryStore.getState().push({
                name: `Set Sequence Start`,
                undo: () => doUpdate(oldInterval),
                redo: () => doUpdate(newInterval)
            })
        }
    }

    const handleSeqEndChange = (val: number | null) => {
        if (val !== null && currentSequence >= 0 && sequences) {
            const currentStart = sequences[currentSequence].Interval[0]
            const oldInterval = [...sequences[currentSequence].Interval]
            const newInterval = [currentStart, val]

            const idx = currentSequence

            const doUpdate = (interval: number[]) => {
                useModelStore.getState().updateSequence(idx, { Interval: interval })
                // Sync Renderer
                const renderer = useRendererStore.getState().renderer
                if (renderer) {
                    if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                        renderer.rendererData.animationInfo.Interval = [...interval]
                    }
                    if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[idx]) {
                        renderer.model.Sequences[idx].Interval = [...interval]
                    }
                }
            }

            doUpdate(newInterval)

            useHistoryStore.getState().push({
                name: `Set Sequence End`,
                undo: () => doUpdate(oldInterval),
                redo: () => doUpdate(newInterval)
            })
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1e', userSelect: 'none' }} onContextMenu={(e) => e.preventDefault()}>
            {/* Toolbar */}
            <div style={{ height: '36px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 10px', justifyContent: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 10, display: 'flex', alignItems: 'center', gap: 8 }}>

                    {/* Frame/Current */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: '#aaa', fontSize: '12px' }}>当前:</span>
                        <Input
                            size="small"
                            style={{ width: 60, height: 22, backgroundColor: '#333', border: '1px solid #555', color: '#eee' }}
                            value={isEditingFrame ? inputFrameValue : displayFrame}
                            onChange={(e) => {
                                setIsEditingFrame(true)
                                setInputFrameValue(e.target.value)
                            }}
                            onBlur={(e) => {
                                setIsEditingFrame(false)
                                handleFrameInputChange(e)
                            }}
                            onPressEnter={(e: any) => {
                                setIsEditingFrame(false)
                                handleFrameInputChange(e)
                            }}
                        />
                    </div>

                    {/* Drag Offset Display (only during drag) */}
                    {dragKeyframeOffset !== 0 && (() => {
                        // Calculate target frame from first selected keyframe
                        const firstSelectedKf = activeKeyframesRef.current.find(kf => selectedKeyframeUids.has(kf.uid))
                        const targetFrame = firstSelectedKf ? firstSelectedKf.frame + dragKeyframeOffset : null
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, backgroundColor: 'rgba(24, 144, 255, 0.2)', padding: '2px 8px', borderRadius: 4 }}>
                                <span style={{ color: '#1890ff', fontSize: '12px', fontWeight: 'bold' }}>
                                    偏移: {dragKeyframeOffset > 0 ? '+' : ''}{dragKeyframeOffset}帧
                                </span>
                                {targetFrame !== null && (
                                    <span style={{ color: '#52c41a', fontSize: '12px', fontWeight: 'bold' }}>
                                        → 帧 {targetFrame}
                                    </span>
                                )}
                            </div>
                        )
                    })()}

                </div>

                {/* Multi-Move Mode Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 16 }}>
                    <button
                        onClick={() => setMultiMoveMode('relative')}
                        style={{
                            padding: '2px 8px',
                            fontSize: '11px',
                            border: 'none',
                            borderRadius: '3px 0 0 3px',
                            cursor: 'pointer',
                            backgroundColor: multiMoveMode === 'relative' ? '#2a4a6a' : '#3a3a3a',
                            color: multiMoveMode === 'relative' ? '#7eb8e8' : '#888'
                        }}
                    >
                        相继移动
                    </button>
                    <button
                        onClick={() => setMultiMoveMode('worldUniform')}
                        style={{
                            padding: '2px 8px',
                            fontSize: '11px',
                            border: 'none',
                            borderRadius: '0 3px 3px 0',
                            cursor: 'pointer',
                            backgroundColor: multiMoveMode === 'worldUniform' ? '#2a4a6a' : '#3a3a3a',
                            color: multiMoveMode === 'worldUniform' ? '#7eb8e8' : '#888'
                        }}
                    >
                        世界移动
                    </button>
                </div>

                {/* Playback Controls */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <Button type="text" icon={<StepBackwardOutlined />} onClick={handleGoToStart} style={{ color: '#eee' }} />
                    <Button type="text" icon={<FastBackwardOutlined />} onClick={handlePrevFrame} style={{ color: '#eee' }} />

                    <Button
                        type="text"
                        shape="circle"
                        icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: '24px', color: '#1890ff' }} /> : <PlayCircleOutlined style={{ fontSize: '24px', color: '#eee' }} />}
                        onClick={() => setPlaying(!isPlaying)}
                    />

                    <Button type="text" icon={<FastForwardOutlined />} onClick={handleNextFrame} style={{ color: '#eee' }} />
                    <Button type="text" icon={<StepForwardOutlined />} onClick={handleGoToEnd} style={{ color: '#eee' }} />

                    {/* Auto Keyframe Toggle (Moved to Right of Playback) */}
                    <Button
                        type="text"
                        onClick={() => setAutoKeyframe(!autoKeyframe)}
                        title="自动记录关键帧"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}
                    >
                        <div style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: autoKeyframe ? '#ff4d4f' : '#555',
                            border: '1px solid #777'
                        }} />
                    </Button>

                    {/* Show All Keyframes Toggle (Moved to Right of Auto Key) */}
                    <Button
                        type="text"
                        icon={showAllKeyframes ? <EyeOutlined style={{ color: '#1890ff' }} /> : <EyeInvisibleOutlined />}
                        title="显示所有关键帧类型"
                        onClick={() => setShowAllKeyframes(!showAllKeyframes)}
                        style={{ color: showAllKeyframes ? '#1890ff' : '#eee' }}
                    />
                </div>

                {/* Zoom & Sequence Range (Right Aligned) */}
                <div style={{ position: 'absolute', right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Sequence Range Inputs */}
                    {sequence && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: '#888', fontSize: '11px' }}>序列:</span>
                            <InputNumber
                                size="small"
                                style={{ width: 55, height: 20, backgroundColor: '#333', border: '1px solid #555', color: '#eee', fontSize: '11px' }}
                                value={sequence.Interval[0]}
                                onChange={handleSeqStartChange}
                                controls={false}
                            />
                            <span style={{ color: '#666', fontSize: '11px' }}>-</span>
                            <InputNumber
                                size="small"
                                style={{ width: 55, height: 20, backgroundColor: '#333', border: '1px solid #555', color: '#eee', fontSize: '11px' }}
                                value={sequence.Interval[1]}
                                onChange={handleSeqEndChange}
                                controls={false}
                            />
                        </div>
                    )}
                    <span style={{ color: '#444', fontSize: '12px' }}>|</span>
                    <ZoomOutOutlined style={{ color: '#888' }} />
                    <Slider
                        min={0.01}
                        max={2}
                        step={0.01}
                        value={pixelsPerMs}
                        onChange={(v) => {
                            const centerFrame = scrollX + (containerSizeRef.current.width / 2) / pixelsPerMs
                            setPixelsPerMs(v as number)
                            // Keep center focused
                            setScrollX(Math.max(0, centerFrame - (containerSizeRef.current.width / 2) / (v as number)))
                        }}
                        style={{ width: 100 }}
                        tooltip={{ formatter: null }}
                    />
                    <ZoomInOutlined style={{ color: '#888' }} />
                </div>
            </div>

            {/* Canvas Container */}
            <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }} onWheel={handleWheel}>
                <canvas
                    ref={canvasRef}
                    style={{ width: '100%', height: '100%', display: 'block', cursor: isDragging ? 'grabbing' : 'default' }}
                    onMouseDown={handleMouseDown}
                />
            </div>
        </div>
    )
}

const btnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', color: '#ccc'
}

export default React.memo(TimelinePanel)
