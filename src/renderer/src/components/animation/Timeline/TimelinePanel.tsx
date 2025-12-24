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
import { Button, Slider, Input, InputNumber } from 'antd'

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

    const { selectedNodeIds, transformMode } = useSelectionStore()

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

    // Interaction Refs
    const interactionRef = useRef({
        mode: 'none' as 'none' | 'scrub' | 'pan' | 'boxSelect' | 'dragSequence' | 'dragSequenceStart' | 'dragSequenceEnd',
        startX: 0,
        startY: 0,
        lastMouseX: 0,
        initialScrollX: 0,
        dragSequenceIndex: -1,
        initialInterval: [0, 0]
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
                            uid: `${nodeId}-${type}-${idx}`,
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
        // Only auto-fit if the SEQUENCE INDEX changed, or if we toggled ShowAll
        // We do NOT want to auto-fit if we are just updating the start/end of the SAME sequence (dragging)

        const indexChanged = lastSequenceIndexRef.current !== currentSequence
        lastSequenceIndexRef.current = currentSequence

        if (!containerRef.current) return

        // If dragging, absolutely do not resize view
        if (isDraggingRef.current) return

        // If only data changed but not index, and we are not in ShowAll, we probably still don't want to re-fit aggressively
        // unless it's a fresh selection.
        if (!indexChanged && !showAllKeyframes) return

        let start = 0
        let end = 1000
        if (showAllKeyframes) {
            start = 0
            end = allSequencesMax
        } else if (sequence) {
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

    }, [currentSequence, showAllKeyframes, allSequencesMax, sequence]) // Added sequence to dependency but guarded logic

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
        ctx.fillStyle = 'rgba(70, 144, 226, 0.05)'
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
                ctx.fillText(seq.Name, sx, markerY + handleSize + 10)
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

            ctx.fillStyle = isSelected ? '#ffcc00' : kf.color

            ctx.beginPath()
            ctx.moveTo(kx, laneY - KEYFRAME_SIZE)
            ctx.lineTo(kx + KEYFRAME_SIZE, laneY)
            ctx.lineTo(kx, laneY + KEYFRAME_SIZE)
            ctx.lineTo(kx - KEYFRAME_SIZE, laneY)
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
            setDragTargetSequenceIndex(null)
            // Force refresh global max if needed
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
                initialInterval: [0, 0]
            }
            return
        }

        // 1. Check for Sequence Handles (Hit Test at Bottom)
        const handleHit = getSequenceHandleAtPos(e.clientX, e.clientY)
        if (handleHit) {
            const seq = useModelStore.getState().sequences[handleHit.index]
            interactionRef.current = {
                mode: handleHit.type === 'start' ? 'dragSequenceStart' : 'dragSequenceEnd', // Separate modes
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: 0,
                dragSequenceIndex: handleHit.index,
                initialInterval: [...seq.Interval]
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
                initialInterval: [0, 0]
            }
            setIsDragging(true)
            setPlaying(false)
            updateFrame(mouseToFrame(e.clientX))
            confirmScrub()
        } else {
            interactionRef.current = {
                mode: 'boxSelect',
                startX: mouseX,
                startY: mouseY,
                lastMouseX: mouseX,
                initialScrollX: 0,
                dragSequenceIndex: -1,
                initialInterval: [0, 0]
            }
            setSelectionRect({ startX: mouseX, startY: mouseY, endX: mouseX, endY: mouseY })
        }
    }, [handleGlobalMouseMove, handleGlobalMouseUp, setPlaying])

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
            useModelStore.getState().updateSequence(currentSequence, { Interval: [val, currentEnd] })

            // Sync Renderer
            const renderer = useRendererStore.getState().renderer
            if (renderer) {
                if (renderer.rendererData.animation === currentSequence && renderer.rendererData.animationInfo) {
                    renderer.rendererData.animationInfo.Interval = [val, currentEnd]
                }
                if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[currentSequence]) {
                    renderer.model.Sequences[currentSequence].Interval = [val, currentEnd]
                }
            }
        }
    }

    const handleSeqEndChange = (val: number | null) => {
        if (val !== null && currentSequence >= 0 && sequences) {
            const currentStart = sequences[currentSequence].Interval[0]
            useModelStore.getState().updateSequence(currentSequence, { Interval: [currentStart, val] })

            // Sync Renderer
            const renderer = useRendererStore.getState().renderer
            if (renderer) {
                if (renderer.rendererData.animation === currentSequence && renderer.rendererData.animationInfo) {
                    renderer.rendererData.animationInfo.Interval = [currentStart, val]
                }
                if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[currentSequence]) {
                    renderer.model.Sequences[currentSequence].Interval = [currentStart, val]
                }
            }
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

                    {/* Sequence Range Inputs */}
                    {sequence && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                            <span style={{ color: '#aaa', fontSize: '12px' }}>Start:</span>
                            <InputNumber
                                size="small"
                                style={{ width: 60, height: 22, backgroundColor: '#333', border: '1px solid #555', color: '#eee' }}
                                value={sequence.Interval[0]}
                                onChange={handleSeqStartChange}
                                controls={false}
                            />
                            <span style={{ color: '#aaa', fontSize: '12px' }}>End:</span>
                            <InputNumber
                                size="small"
                                style={{ width: 60, height: 22, backgroundColor: '#333', border: '1px solid #555', color: '#eee' }}
                                value={sequence.Interval[1]}
                                onChange={handleSeqEndChange}
                                controls={false}
                            />
                        </div>
                    )}

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
                </div>

                {/* Zoom & Options */}
                <div style={{ position: 'absolute', right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                        type="text"
                        icon={showAllKeyframes ? <EyeOutlined style={{ color: '#1890ff' }} /> : <EyeInvisibleOutlined />}
                        title="Show All Keyframes (Auto-Range)"
                        onClick={() => setShowAllKeyframes(!showAllKeyframes)}
                        style={{ color: showAllKeyframes ? '#1890ff' : '#eee' }}
                    />
                    <span style={{ color: '#666', fontSize: '12px' }}>|</span>
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
