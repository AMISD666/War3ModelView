import React, { useEffect } from 'react'
import SequenceManager from './SequenceManager'
import TimelinePanel from './Timeline/TimelinePanel'
import KeyframeInspector from './KeyframeInspector'
import BoneParameterPanel from './BoneParameterPanel'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'

interface AnimationModeLayoutProps {
    isActive: boolean
    children: React.ReactNode
}

/**
 * 动画模式布局:
 * - 关键帧模式: 左侧序列管理+关键帧检查器, 中间3D视图, 底部时间轴
 * - 绑定模式: 左侧骨骼参数面板+绑定骨骼面板, 中间3D视图(静止), 无时间轴
 * 
 * 性能优化: 所有子组件始终挂载，使用 display:none 控制可见性，避免卸载/重新挂载导致的性能问题
 */
const AnimationModeLayout: React.FC<AnimationModeLayoutProps> = ({
    isActive,
    children
}) => {
    const animationSubMode = useSelectionStore(state => state.animationSubMode)
    const isBindingMode = animationSubMode === 'binding'
    const setPlaying = useModelStore(state => state.setPlaying)

    // 当进入关键帧模式时，自动暂停动画
    useEffect(() => {
        if (isActive && !isBindingMode) {
            setPlaying(false)
        }
    }, [isActive, isBindingMode, setPlaying])

    // 固定布局尺寸 - 移除拖动调整功能以避免频繁重渲染
    const LEFT_PANEL_WIDTH = 250
    const BOTTOM_PANEL_HEIGHT = 180

    // 根据模式计算布局
    const actualBottomHeight = isBindingMode ? 0 : BOTTOM_PANEL_HEIGHT
    const viewerLeft = isActive ? LEFT_PANEL_WIDTH : 0
    const viewerBottom = isActive ? actualBottomHeight + (isBindingMode ? 0 : 4) : 0

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* 3D视图 - 始终挂载，移除 transition 避免与 WebGL 冲突 */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: viewerLeft,
                right: 0,
                bottom: viewerBottom
                // 注意：移除了 transition: 'all 0.1s linear' 以避免与 WebGL 渲染冲突
            }}>
                {children}
            </div>

            {/* 动画模式UI组件 - 使用 display 控制可见性，避免卸载/重新挂载 */}
            <div style={{ display: isActive ? 'contents' : 'none' }}>
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
                    {/* 绑定模式: 骨骼参数面板 - 始终挂载，用 display 控制 */}
                    <div style={{
                        display: isBindingMode ? 'flex' : 'none',
                        flexDirection: 'column',
                        height: '100%'
                    }}>
                        <BoneParameterPanel />
                    </div>

                    {/* 关键帧模式: 序列管理 + 关键帧检查器 - 始终挂载，用 display 控制 */}
                    <div style={{
                        display: isBindingMode ? 'none' : 'flex',
                        flexDirection: 'column',
                        height: '100%'
                    }}>
                        <div style={{ flex: 1, overflow: 'auto' }}>
                            <SequenceManager />
                        </div>
                        <div style={{ height: 1, backgroundColor: '#444' }} />
                        <div style={{ flex: 1, overflow: 'auto' }}>
                            <KeyframeInspector />
                        </div>
                    </div>
                </div>

                {/* 底部时间轴 - 始终挂载，用 display 控制可见性，固定高度（移除拖动调整功能） */}
                <div style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: BOTTOM_PANEL_HEIGHT,
                    display: isBindingMode ? 'none' : 'flex',
                    backgroundColor: '#1e1e1e',
                    borderTop: '1px solid #444'
                }}>
                    {/* 左侧预留面板 */}
                    <div style={{
                        width: LEFT_PANEL_WIDTH,
                        height: '100%',
                        backgroundColor: '#2b2b2b',
                        borderRight: '1px solid #444',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#666',
                        fontSize: '11px'
                    }}>
                        {/* 预留区域 */}
                    </div>
                    {/* 时间轴主体 */}
                    <div style={{ flex: 1, height: '100%' }}>
                        <TimelinePanel isActive={isActive && !isBindingMode} />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AnimationModeLayout
