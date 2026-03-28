import React, { useEffect, useState } from 'react'
import SequenceManager from './SequenceManager'
import TimelinePanel from './Timeline/TimelinePanel'
import BoneParameterPanel from './BoneParameterPanel'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import TextureAnimGizmoPanel from './TextureAnimGizmoPanel'
import ParticleAnimKeyframePanel from './ParticleAnimKeyframePanel'
import GeosetAnimPanel from './GeosetAnimPanel'
import MaterialAnimPanel from './MaterialAnimPanel'

interface AnimationModeLayoutProps {
    isActive: boolean
    children: React.ReactNode
    rightPanelAddon?: React.ReactNode
}

const AnimationModeLayout: React.FC<AnimationModeLayoutProps> = ({
    isActive,
    children,
    rightPanelAddon
}) => {
    const animationSubMode = useSelectionStore((state) => state.animationSubMode)
    const isBindingMode = animationSubMode === 'binding'
    const setPlaying = useModelStore((state) => state.setPlaying)
    const [viewport, setViewport] = useState(() => ({
        width: typeof window !== 'undefined' ? window.innerWidth : 1280,
        height: typeof window !== 'undefined' ? window.innerHeight : 720
    }))

    useEffect(() => {
        if (isActive && !isBindingMode) {
            setPlaying(false)
        }
    }, [isActive, isBindingMode, setPlaying])

    useEffect(() => {
        const updateViewport = () => {
            setViewport({
                width: window.innerWidth,
                height: window.innerHeight
            })
        }
        window.addEventListener('resize', updateViewport)
        return () => window.removeEventListener('resize', updateViewport)
    }, [])

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    const LEFT_PANEL_WIDTH = clamp(Math.round(viewport.width * 0.18), 160, 260)
    const BOTTOM_PANEL_HEIGHT = clamp(Math.round(viewport.height * 0.2), 130, 180)
    const SEQUENCE_PANEL_HEIGHT = clamp(Math.round(viewport.height * 0.55), 170, 250)
    const RIGHT_PANEL_WIDTH = clamp(Math.round(viewport.width * 0.2), 280, 360)

    const actualBottomHeight = isBindingMode ? 0 : BOTTOM_PANEL_HEIGHT
    const showKeyframePanels = isActive && !isBindingMode && animationSubMode === 'keyframe'
    const rightAddonWidth = rightPanelAddon ? 200 : 0
    const actualRightWidth = (showKeyframePanels ? RIGHT_PANEL_WIDTH : 0) + rightAddonWidth

    const viewerLeft = isActive ? LEFT_PANEL_WIDTH : 0
    const viewerRight = actualRightWidth
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
                    right: viewerRight,
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
                            <div style={{ flex: `0 0 ${SEQUENCE_PANEL_HEIGHT}px`, overflowY: 'auto', overflowX: 'hidden', borderBottom: '1px solid #444' }}>
                                <SequenceManager />
                            </div>
                        )}
                        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                            <BoneParameterPanel />
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        position: 'absolute',
                        left: LEFT_PANEL_WIDTH,
                        right: showKeyframePanels ? RIGHT_PANEL_WIDTH : 0,
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

            {/* Left extra column for GeosetVisibilityPanel */}
            {!!rightPanelAddon && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: showKeyframePanels ? RIGHT_PANEL_WIDTH : 0,
                        width: rightAddonWidth,
                        bottom: viewerBottom,
                        backgroundColor: '#2b2b2b',
                        borderLeft: '1px solid #444',
                        display: 'flex',
                        flexDirection: 'column',
                        zIndex: 9
                    }}
                >
                    {rightPanelAddon}
                </div>
            )}

            {/* Main right column for Keyframes */}
            {showKeyframePanels && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        width: RIGHT_PANEL_WIDTH,
                        bottom: 0,
                        backgroundColor: '#2b2b2b',
                        borderLeft: '1px solid #444',
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '8px 6px',
                        gap: 8,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        zIndex: 10,
                        alignItems: 'stretch'
                    }}
                >
                    <>
                        <TextureAnimGizmoPanel />
                        <ParticleAnimKeyframePanel />
                        <GeosetAnimPanel />
                        <MaterialAnimPanel />
                    </>
                </div>
            )}
        </div>
    )
}

export default AnimationModeLayout
