import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useModelStore } from '../../../store/modelStore'
import { Button, Space, Tooltip, InputNumber } from 'antd'
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

    const setPlaying = useModelStore(state => state.setPlaying)
    const setPlaybackSpeed = useModelStore(state => state.setPlaybackSpeed)

    const sequence = currentSequence >= 0 && sequences ? sequences[currentSequence] : null
    const seqStart = sequence ? sequence.Interval[0] : 0
    const seqEnd = sequence ? sequence.Interval[1] : 1000

    const [pixelsPerMs, setPixelsPerMs] = useState(0.1)
    const [scrollX, setScrollX] = useState(0)
    const [displayFrame, setDisplayFrame] = useState(0)

    // 用 ref 存储变化频繁的值
    const frameRef = useRef(0)
    const pixelsPerMsRef = useRef(pixelsPerMs)
    const scrollXRef = useRef(scrollX)
    const seqStartRef = useRef(seqStart)
    const seqEndRef = useRef(seqEnd)

    // 同步 refs
    useEffect(() => { pixelsPerMsRef.current = pixelsPerMs }, [pixelsPerMs])
    useEffect(() => { scrollXRef.current = scrollX }, [scrollX])
    useEffect(() => { seqStartRef.current = seqStart }, [seqStart])
    useEffect(() => { seqEndRef.current = seqEnd }, [seqEnd])

    // 动画循环绘制 - 不依赖 React 渲染
    useEffect(() => {
        let lastDrawTime = 0
        const FPS_LIMIT = 30 // 限制时间轴刷新率
        const frameInterval = 1000 / FPS_LIMIT

        const animate = (time: number) => {
            const elapsed = time - lastDrawTime

            if (elapsed >= frameInterval) {
                lastDrawTime = time
                frameRef.current = useModelStore.getState().currentFrame
                draw()
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

    // 每500ms更新显示帧数
    useEffect(() => {
        const interval = setInterval(() => {
            setDisplayFrame(Math.round(useModelStore.getState().currentFrame))
        }, 500)
        return () => clearInterval(interval)
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1e' }}>
            {/* 工具栏 */}
            <div style={{ height: '36px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 10px', justifyContent: 'space-between' }}>
                <Space>
                    <Tooltip title="跳到开始"><Button type="text" icon={<FastBackwardOutlined />} size="small" style={{ color: '#ccc' }} /></Tooltip>
                    <Tooltip title="上一帧"><Button type="text" icon={<StepBackwardOutlined />} size="small" style={{ color: '#ccc' }} /></Tooltip>
                    <Button
                        type="text"
                        icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: '18px', color: '#faad14' }} /> : <PlayCircleOutlined style={{ fontSize: '18px', color: '#52c41a' }} />}
                        onClick={() => setPlaying(!isPlaying)}
                    />
                    <Tooltip title="下一帧"><Button type="text" icon={<StepForwardOutlined />} size="small" style={{ color: '#ccc' }} /></Tooltip>
                    <Tooltip title="跳到结束"><Button type="text" icon={<FastForwardOutlined />} size="small" style={{ color: '#ccc' }} /></Tooltip>
                </Space>
                <Space>
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
                    <span style={{ color: '#aaa', fontSize: '11px', marginLeft: 10 }}>
                        帧: {displayFrame}
                    </span>
                </Space>
            </div>
            {/* 时间轴画布 */}
            <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <canvas ref={canvasRef} style={{ display: 'block', cursor: 'pointer' }} onWheel={handleWheel} />
            </div>
        </div>
    )
}

export default TimelinePanel
