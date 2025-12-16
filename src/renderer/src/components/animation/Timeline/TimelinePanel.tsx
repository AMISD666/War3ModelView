import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useModelStore } from '../../../store/modelStore'
import { useSelectionStore } from '../../../store/selectionStore'
import { useRendererStore } from '../../../store/rendererStore'
import { Button, Space, Tooltip, InputNumber, Slider } from 'antd'
import {
    PlayCircleOutlined,
    PauseCircleOutlined,
    StepBackwardOutlined,
    StepForwardOutlined,
    FastBackwardOutlined,
    FastForwardOutlined
} from '@ant-design/icons'

/**
 * 时间轴面板 - 使用 refs 避免每帧重渲染
 * 支持点击/拖动跳帧，自动K帧开关
 */
const TimelinePanel: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number | null>(null)

    // 只订阅不会频繁变化的状态
    const currentSequence = useModelStore(state => state.currentSequence)
    const sequences = useModelStore(state => state.sequences)
    const isPlaying = useModelStore(state => state.isPlaying)
    const playbackSpeed = useModelStore(state => state.playbackSpeed)
    const autoKeyframe = useModelStore(state => state.autoKeyframe)

    const setPlaying = useModelStore(state => state.setPlaying)
    const setPlaybackSpeed = useModelStore(state => state.setPlaybackSpeed)
    const setFrame = useModelStore(state => state.setFrame)
    const setAutoKeyframe = useModelStore(state => state.setAutoKeyframe)

    const sequence = currentSequence >= 0 && sequences ? sequences[currentSequence] : null
    const seqStart = sequence ? sequence.Interval[0] : 0
    const seqEnd = sequence ? sequence.Interval[1] : 1000

    const [pixelsPerMs, setPixelsPerMs] = useState(0.1)
    const [scrollX, setScrollX] = useState(0)
    const [displayFrame, setDisplayFrame] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [isEditingFrame, setIsEditingFrame] = useState(false)
    const [inputFrameValue, setInputFrameValue] = useState('') // 独立的输入框值

    // 用 ref 存储变化频繁的值
    const frameRef = useRef(0)
    const pixelsPerMsRef = useRef(pixelsPerMs)
    const scrollXRef = useRef(scrollX)
    const seqStartRef = useRef(seqStart)
    const seqEndRef = useRef(seqEnd)
    const isDraggingRef = useRef(false)

    // 同步 refs
    useEffect(() => { pixelsPerMsRef.current = pixelsPerMs }, [pixelsPerMs])
    useEffect(() => { scrollXRef.current = scrollX }, [scrollX])
    useEffect(() => { seqStartRef.current = seqStart }, [seqStart])
    useEffect(() => { seqEndRef.current = seqEnd }, [seqEnd])
    useEffect(() => { isDraggingRef.current = isDragging }, [isDragging])

    // 计算最大帧（最后一个动画尾帧 + 100）
    const maxFrame = sequences && sequences.length > 0
        ? Math.max(...sequences.map((s: any) => s.Interval[1])) + 100
        : 1100

    // 切换序列时自动调整时间轴范围和缩放
    useEffect(() => {
        if (sequence && containerRef.current) {
            const duration = sequence.Interval[1] - sequence.Interval[0]
            const containerWidth = containerRef.current.clientWidth || 400
            // 自动缩放以显示整个序列范围，前后各留 10% 空间
            const paddedDuration = duration * 1.2
            const newPixelsPerMs = containerWidth / paddedDuration
            setPixelsPerMs(Math.max(0.01, Math.min(2, newPixelsPerMs)))
            // 滚动到序列起始位置，留出 10% 空间
            setScrollX(Math.max(0, sequence.Interval[0] - duration * 0.1))
            setFrame(sequence.Interval[0])
            setDisplayFrame(sequence.Interval[0])
        }
    }, [currentSequence, sequence, setFrame])

    // 动画循环绘制 - 不依赖 React 渲染
    useEffect(() => {
        let lastDrawTime = 0
        let lastDisplayUpdate = 0
        const FPS_LIMIT = 60 // 限制时间轴刷新率
        const frameInterval = 1000 / FPS_LIMIT
        const DISPLAY_UPDATE_INTERVAL = 16 // Update display every frame (60fps)

        const animate = (time: number) => {
            const elapsed = time - lastDrawTime

            if (elapsed >= frameInterval) {
                lastDrawTime = time
                // 直接从渲染器读取帧数（比 store 更新更频繁，避免光标跳跃）
                if (!isDraggingRef.current) {
                    const renderer = useRendererStore.getState().renderer
                    if (renderer && renderer.rendererData && typeof renderer.rendererData.frame === 'number') {
                        frameRef.current = renderer.rendererData.frame
                    } else {
                        // Fallback to store
                        frameRef.current = useModelStore.getState().currentFrame
                    }
                }
                draw()

                // Update displayFrame for the UI (only when not editing and not dragging)
                if (!isEditingFrame && !isDraggingRef.current && time - lastDisplayUpdate >= DISPLAY_UPDATE_INTERVAL) {
                    lastDisplayUpdate = time
                    const roundedFrame = Math.round(frameRef.current)
                    setDisplayFrame(roundedFrame)
                }
            }

            rafRef.current = requestAnimationFrame(animate)
        }

        rafRef.current = requestAnimationFrame(animate)

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current)
            }
        }
    }, [])

    // 绘制函数 - 直接读取 refs
    const draw = useCallback(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const width = container.clientWidth
        const height = container.clientHeight

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
        }

        const rulerHeight = 28
        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const start = seqStartRef.current
        const end = seqEndRef.current
        const frame = frameRef.current

        // 清除背景
        ctx.fillStyle = '#1e1e1e'
        ctx.fillRect(0, 0, width, height)

        // 标尺背景
        ctx.fillStyle = '#252526'
        ctx.fillRect(0, 0, width, rulerHeight)

        // 刻度
        const startTime = scroll
        const endTime = scroll + width / pxPerMs

        let tickInterval = 100
        const idealMsPerTick = 100 / pxPerMs
        if (idealMsPerTick > 5000) tickInterval = 5000
        else if (idealMsPerTick > 1000) tickInterval = 1000
        else if (idealMsPerTick > 500) tickInterval = 500
        else if (idealMsPerTick > 100) tickInterval = 100
        else tickInterval = 50

        const firstTick = Math.floor(startTime / tickInterval) * tickInterval

        ctx.font = '10px Microsoft YaHei'
        ctx.fillStyle = '#888'
        ctx.textAlign = 'left'

        for (let t = firstTick; t <= endTime; t += tickInterval) {
            const x = (t - scroll) * pxPerMs
            if (x < -50) continue

            ctx.strokeStyle = '#444'
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, rulerHeight)
            ctx.stroke()

            ctx.fillText(t.toString(), x + 3, 11)
        }

        // 序列范围高亮
        const startX = (start - scroll) * pxPerMs
        const endX = (end - scroll) * pxPerMs

        ctx.fillStyle = 'rgba(70, 144, 226, 0.15)'
        ctx.fillRect(startX, rulerHeight, Math.max(0, endX - startX), height - rulerHeight)

        ctx.strokeStyle = 'rgba(70, 144, 226, 0.6)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(startX, 0)
        ctx.lineTo(startX, height)
        ctx.moveTo(endX, 0)
        ctx.lineTo(endX, height)
        ctx.stroke()

        // 播放头
        const scrubberX = (frame - scroll) * pxPerMs

        ctx.strokeStyle = '#ff4444'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(scrubberX, 0)
        ctx.lineTo(scrubberX, height)
        ctx.stroke()

        // 播放头三角
        ctx.fillStyle = '#ff4444'
        ctx.beginPath()
        ctx.moveTo(scrubberX - 6, 0)
        ctx.lineTo(scrubberX + 6, 0)
        ctx.lineTo(scrubberX + 6, 10)
        ctx.lineTo(scrubberX, 16)
        ctx.lineTo(scrubberX - 6, 10)
        ctx.closePath()
        ctx.fill()

        // 绘制选中骨骼的关键帧（按模式着色）- 只显示当前序列范围内的关键帧
        const { selectedNodeIds, transformMode } = useSelectionStore.getState()
        const nodes = useModelStore.getState().nodes
        const seqStart = seqStartRef.current
        const seqEnd = seqEndRef.current
        if (selectedNodeIds.length === 1) {
            const node = nodes.find((n: any) => n.ObjectId === selectedNodeIds[0])
            if (node) {
                const drawKeyframesForProp = (prop: any, color: string) => {
                    if (!prop || !prop.Keys) return
                    ctx.fillStyle = color
                    for (const key of prop.Keys) {
                        // 只绘制当前序列范围内的关键帧
                        if (key.Frame < seqStart || key.Frame > seqEnd) continue
                        const kx = (key.Frame - scroll) * pxPerMs
                        if (kx >= -5 && kx <= width + 5) {
                            ctx.beginPath()
                            ctx.arc(kx, rulerHeight + 12, 4, 0, Math.PI * 2)
                            ctx.fill()
                        }
                    }
                }
                // 只绘制当前模式对应的关键帧
                if (transformMode === 'translate') {
                    drawKeyframesForProp(node.Translation, '#ff4d4f') // 红色
                } else if (transformMode === 'rotate') {
                    drawKeyframesForProp(node.Rotation, '#52c41a') // 绿色
                } else if (transformMode === 'scale') {
                    drawKeyframesForProp(node.Scaling, '#1890ff') // 蓝色
                } else {
                    // 默认显示所有
                    drawKeyframesForProp(node.Translation, '#ff4d4f')
                    drawKeyframesForProp(node.Rotation, '#52c41a')
                    drawKeyframesForProp(node.Scaling, '#1890ff')
                }
            }
        }

    }, [])

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        if (e.ctrlKey) {
            const zoomSpeed = 0.001
            const newPixelsPerMs = Math.max(0.01, Math.min(2, pixelsPerMs * (1 - e.deltaY * zoomSpeed)))
            setPixelsPerMs(newPixelsPerMs)
        } else {
            setScrollX(prev => Math.max(0, prev + e.deltaY / pixelsPerMs))
        }
    }

    // 拖动时只更新显示（红色光标跟随）
    const updateRequestRef = useRef<number | null>(null)

    const scrubToPositionVisual = useCallback((clientX: number) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const frame = scrollXRef.current + x / pixelsPerMsRef.current
        const clampedFrame = Math.max(seqStartRef.current, Math.min(seqEndRef.current, Math.round(frame)))

        frameRef.current = clampedFrame
        setDisplayFrame(clampedFrame)

        // 性能优化：直接设置渲染器帧，并使用 requestAnimationFrame 节流 update(0)
        const renderer = useRendererStore.getState().renderer
        if (renderer && renderer.rendererData) {
            renderer.rendererData.frame = clampedFrame

            if (updateRequestRef.current === null) {
                updateRequestRef.current = requestAnimationFrame(() => {
                    if (typeof renderer.update === 'function') {
                        renderer.update(0)
                    }
                    updateRequestRef.current = null
                })
            }
        }
    }, [])

    // 確认跳帧 - 更新渲染器帧并刷新骨骼
    const confirmScrub = useCallback(() => {
        const clampedFrame = frameRef.current
        setFrame(clampedFrame)
        const renderer = useRendererStore.getState().renderer
        if (renderer && renderer.rendererData) {
            renderer.rendererData.frame = clampedFrame
            // 调用 update(0) 刷新骨骼矩阵
            if (typeof renderer.update === 'function') {
                renderer.update(0)
            }
        }
    }, [setFrame])

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        setIsDragging(true)
        setPlaying(false) // 拖动时暂停播放
        scrubToPositionVisual(e.clientX)
        // 点击时立即跳帧
        confirmScrub()
    }, [setPlaying, scrubToPositionVisual, confirmScrub])

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isDragging) {
            scrubToPositionVisual(e.clientX)
            // 移除这里的 confirmScrub()，因为 scrubToPositionVisual 现在已经包含了节流后的更新逻辑
        }
    }, [isDragging, scrubToPositionVisual])

    const handleMouseUp = useCallback(() => {
        if (isDragging) {
            confirmScrub()
        }
        setIsDragging(false)
    }, [isDragging, confirmScrub])

    const handleMouseLeave = useCallback(() => {
        if (isDragging) {
            confirmScrub() // 离开时也确保更新
        }
        setIsDragging(false)
    }, [isDragging, confirmScrub])

    // 工具栏按钮功能
    const handleGoToStart = () => {
        setFrame(seqStart)
        setDisplayFrame(seqStart)
    }
    const handlePrevFrame = () => {
        const newFrame = Math.max(seqStart, Math.round(frameRef.current) - 33) // ~30fps step
        setFrame(newFrame)
        setDisplayFrame(newFrame)
    }
    const handleNextFrame = () => {
        const newFrame = Math.min(seqEnd, Math.round(frameRef.current) + 33)
        setFrame(newFrame)
        setDisplayFrame(newFrame)
    }
    const handleGoToEnd = () => {
        setFrame(seqEnd)
        setDisplayFrame(seqEnd)
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1e' }}>
            {/* 工具栏 - 居中布局 */}
            <div style={{ height: '36px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 10px', justifyContent: 'center', position: 'relative' }}>
                {/* 左侧帧输入框 */}
                <div style={{ position: 'absolute', left: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#888', fontSize: '10px' }}>帧:</span>
                    <input
                        type="text"
                        value={isEditingFrame ? inputFrameValue : displayFrame}
                        onFocus={(e) => {
                            setIsEditingFrame(true)
                            setInputFrameValue(displayFrame.toString())
                            // 选中全部文字方便输入
                            e.target.select()
                        }}
                        onChange={(e) => {
                            setInputFrameValue(e.target.value)
                        }}
                        onKeyDown={(e) => {
                            e.stopPropagation() // 阻止全局快捷键
                            if (e.key === 'Enter') {
                                const val = parseInt(inputFrameValue)
                                if (!isNaN(val)) {
                                    const clampedVal = Math.max(seqStart, Math.min(seqEnd, val))
                                    setFrame(clampedVal)
                                    frameRef.current = clampedVal
                                    setDisplayFrame(clampedVal)
                                    // 同步更新渲染器
                                    const renderer = useRendererStore.getState().renderer
                                    if (renderer && renderer.rendererData) {
                                        renderer.rendererData.frame = clampedVal
                                        if (typeof renderer.update === 'function') {
                                            renderer.update(0)
                                        }
                                    }
                                }
                                setIsEditingFrame(false)
                                    ; (e.target as HTMLInputElement).blur()
                            } else if (e.key === 'Escape') {
                                setIsEditingFrame(false)
                                    ; (e.target as HTMLInputElement).blur()
                            }
                        }}
                        onBlur={() => {
                            const val = parseInt(inputFrameValue)
                            if (!isNaN(val)) {
                                const clampedVal = Math.max(seqStart, Math.min(seqEnd, val))
                                setFrame(clampedVal)
                                frameRef.current = clampedVal
                                setDisplayFrame(clampedVal)
                                // 同步更新渲染器
                                const renderer = useRendererStore.getState().renderer
                                if (renderer && renderer.rendererData) {
                                    renderer.rendererData.frame = clampedVal
                                    if (typeof renderer.update === 'function') {
                                        renderer.update(0)
                                    }
                                }
                            }
                            setIsEditingFrame(false)
                        }}
                        style={{
                            width: 60,
                            backgroundColor: isEditingFrame ? '#444' : '#333',
                            border: isEditingFrame ? '1px solid #1890ff' : '1px solid #555',
                            borderRadius: 3,
                            color: '#fff',
                            padding: '2px 6px',
                            fontSize: '11px',
                            textAlign: 'center'
                        }}
                    />
                </div>

                {/* 中间播放控制 */}
                <Space>
                    <Tooltip title="跳到开始">
                        <Button type="text" icon={<FastBackwardOutlined />} size="small" style={{ color: '#ccc' }} onClick={handleGoToStart} />
                    </Tooltip>
                    <Tooltip title="上一帧">
                        <Button type="text" icon={<StepBackwardOutlined />} size="small" style={{ color: '#ccc' }} onClick={handlePrevFrame} />
                    </Tooltip>
                    <Button
                        type="text"
                        icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: '18px', color: '#faad14' }} /> : <PlayCircleOutlined style={{ fontSize: '18px', color: '#52c41a' }} />}
                        onClick={() => setPlaying(!isPlaying)}
                    />
                    <Tooltip title="下一帧">
                        <Button type="text" icon={<StepForwardOutlined />} size="small" style={{ color: '#ccc' }} onClick={handleNextFrame} />
                    </Tooltip>
                    <Tooltip title="跳到结束">
                        <Button type="text" icon={<FastForwardOutlined />} size="small" style={{ color: '#ccc' }} onClick={handleGoToEnd} />
                    </Tooltip>

                    {/* K帧开关按钮 - 小圆点 */}
                    <Tooltip title={autoKeyframe ? "自动K帧: 开启" : "自动K帧: 关闭"}>
                        <Button
                            type="text"
                            size="small"
                            onClick={() => setAutoKeyframe(!autoKeyframe)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginLeft: 8
                            }}
                        >
                            <span style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                backgroundColor: autoKeyframe ? '#ff4444' : '#666',
                                display: 'inline-block',
                                transition: 'background-color 0.2s'
                            }} />
                        </Button>
                    </Tooltip>
                </Space>

                {/* 右侧速度控制 */}
                <div style={{ position: 'absolute', right: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#888', fontSize: '11px' }}>速度:</span>
                    <InputNumber
                        size="small"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={playbackSpeed}
                        onChange={(val) => setPlaybackSpeed(val || 1.0)}
                        style={{ width: 55 }}
                    />
                </div>
            </div>
            {/* 时间轴画布 */}
            <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <canvas
                    ref={canvasRef}
                    style={{ display: 'block', cursor: isDragging ? 'grabbing' : 'pointer' }}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                />
            </div>
            {/* 底部缩放滑块 */}
            <div style={{ height: '24px', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
                <span style={{ color: '#888', fontSize: '10px' }}>缩放:</span>
                <Slider
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={pixelsPerMs}
                    onChange={(val) => setPixelsPerMs(val)}
                    style={{ flex: 1, margin: 0 }}
                    tooltip={{ formatter: (v) => `${(v || 0).toFixed(2)}` }}
                />
            </div>
        </div>
    )
}

export default TimelinePanel

