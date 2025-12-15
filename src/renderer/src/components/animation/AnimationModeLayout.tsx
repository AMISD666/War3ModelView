import React, { useState, useRef, useCallback, useEffect } from 'react'
import SequenceManager from './SequenceManager'
import TimelinePanel from './Timeline/TimelinePanel'
import KeyframeInspector from './KeyframeInspector'
import BoneParameterPanel from './BoneParameterPanel'
import { useSelectionStore } from '../../store/selectionStore'

interface AnimationModeLayoutProps {
    isActive: boolean
    children: React.ReactNode
}

/**
 * 动画模式布局:
 * - 关键帧模式: 左侧序列管理+关键帧检查器, 中间3D视图, 底部时间轴
 * - 绑定模式: 左侧骨骼参数面板+绑定骨骼面板, 中间3D视图(静止), 无时间轴
 */
const AnimationModeLayout: React.FC<AnimationModeLayoutProps> = ({
    isActive,
    children
}) => {
    const animationSubMode = useSelectionStore(state => state.animationSubMode)
    const isBindingMode = animationSubMode === 'binding'

    // 布局状态 - 左侧面板固定宽度
    const LEFT_PANEL_WIDTH = 250
    const [bottomPanelHeight, setBottomPanelHeight] = useState(180)

    // 拖拽状态 - 仅底部面板
    const [isResizingBottom, setIsResizingBottom] = useState(false)

    const containerRef = useRef<HTMLDivElement>(null)

    const handleMouseDownBottom = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizingBottom(true)
    }, [])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!containerRef.current || !isResizingBottom) return
        const rect = containerRef.current.getBoundingClientRect()
        const newHeight = rect.bottom - e.clientY
        setBottomPanelHeight(Math.max(80, Math.min(rect.height * 0.5, newHeight)))
    }, [isResizingBottom])

    const handleMouseUp = useCallback(() => {
        setIsResizingBottom(false)
    }, [])

    useEffect(() => {
        if (isResizingBottom) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizingBottom, handleMouseMove, handleMouseUp])

    // 绑定模式下不显示时间轴
    const actualBottomHeight = isBindingMode ? 0 : bottomPanelHeight
    const viewerLeft = isActive ? LEFT_PANEL_WIDTH : 0
    const viewerBottom = isActive ? actualBottomHeight + (isBindingMode ? 0 : 4) : 0

    return (
        <div
            ref={containerRef}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* 3D视图 - 始终挂载 */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: viewerLeft,
                right: 0,
                bottom: viewerBottom,
                transition: 'all 0.1s linear'
            }}>
                {children}
            </div>

            {/* 动画模式UI组件 */}
            {isActive && (
                <>
                    {/* 左侧面板 - 固定宽度 */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: LEFT_PANEL_WIDTH,
                        bottom: actualBottomHeight + (isBindingMode ? 0 : 4),
                        backgroundColor: '#2b2b2b',
                        borderRight: '1px solid #444',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}>
                        {isBindingMode ? (
                            /* 绑定模式: 骨骼参数面板 */
                            <BoneParameterPanel />
                        ) : (
                            /* 关键帧模式: 序列管理 + 关键帧检查器 */
                            <>
                                <div style={{ flex: 1, overflow: 'auto' }}>
                                    <SequenceManager />
                                </div>
                                <div style={{ height: 1, backgroundColor: '#444' }} />
                                <div style={{ flex: 1, overflow: 'auto' }}>
                                    <KeyframeInspector />
                                </div>
                            </>
                        )}
                    </div>

                    {/* 底部时间轴 - 仅关键帧模式显示 */}
                    {!isBindingMode && (
                        <>
                            <div
                                onMouseDown={handleMouseDownBottom}
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    right: 0,
                                    bottom: bottomPanelHeight,
                                    height: 4,
                                    cursor: 'row-resize',
                                    backgroundColor: isResizingBottom ? '#1890ff' : '#333',
                                    zIndex: 10
                                }}
                            />
                            <div style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: bottomPanelHeight,
                                backgroundColor: '#1e1e1e',
                                borderTop: '1px solid #444'
                            }}>
                                <TimelinePanel />
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    )
}

export default AnimationModeLayout
