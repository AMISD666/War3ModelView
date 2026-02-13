import React, { useEffect } from 'react'
import SequenceManager from './SequenceManager'
import TimelinePanel from './Timeline/TimelinePanel'
import BoneParameterPanel from './BoneParameterPanel'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'

interface AnimationModeLayoutProps {
    isActive: boolean
    children: React.ReactNode
}

const AnimationModeLayout: React.FC<AnimationModeLayoutProps> = ({
    isActive,
    children
}) => {
    const animationSubMode = useSelectionStore((state) => state.animationSubMode)
    const isBindingMode = animationSubMode === 'binding'
    const setPlaying = useModelStore((state) => state.setPlaying)

    useEffect(() => {
        if (isActive && !isBindingMode) {
            setPlaying(false)
        }
    }, [isActive, isBindingMode, setPlaying])

    const LEFT_PANEL_WIDTH = 250
    const BOTTOM_PANEL_HEIGHT = 180

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
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: viewerLeft,
                    right: 0,
                    bottom: viewerBottom
                }}
            >
                {children}
            </div>

            <div style={{ display: isActive ? 'contents' : 'none' }}>
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: LEFT_PANEL_WIDTH,
                        bottom: 0,
                        backgroundColor: '#2b2b2b',
                        borderRight: '1px solid #444',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%'
                        }}
                    >
                        {!isBindingMode && (
                            <div style={{ flex: 0.75, overflow: 'auto', borderBottom: '1px solid #444' }}>
                                <SequenceManager />
                            </div>
                        )}
                        <div style={{ flex: isBindingMode ? 1 : 1.75, overflow: 'auto' }}>
                            <BoneParameterPanel />
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        position: 'absolute',
                        left: LEFT_PANEL_WIDTH,
                        right: 0,
                        bottom: 0,
                        height: BOTTOM_PANEL_HEIGHT,
                        display: isBindingMode ? 'none' : 'flex',
                        backgroundColor: '#1e1e1e',
                        borderTop: '1px solid #444'
                    }}
                >
                    <div style={{ flex: 1, height: '100%' }}>
                        <TimelinePanel isActive={isActive && !isBindingMode} />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AnimationModeLayout
