import React, { useEffect, useMemo, useRef, useState } from 'react'
import SequenceManager from './SequenceManager'
import GlobalSequenceManager from './GlobalSequenceManager'
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
        if (!isActive || isBindingMode || animationSubMode !== 'keyframe') return
        const rafId = window.requestAnimationFrame(() => {
            window.dispatchEvent(new Event('timeline-fit-current-sequence'))
        })
        return () => window.cancelAnimationFrame(rafId)
    }, [isActive, isBindingMode, animationSubMode])

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
    const DEFAULT_SEQUENCE_PANEL_HEIGHT = clamp(Math.round(viewport.height * 0.34), 150, 230)
    const DEFAULT_GLOBAL_SEQUENCE_PANEL_HEIGHT = clamp(Math.round(viewport.height * 0.24), 120, 180)
    const RIGHT_PANEL_WIDTH = clamp(Math.round(viewport.width * 0.2), 280, 360)
    const SPLITTER_HEIGHT = 6
    const MIN_SEQUENCE_PANEL_HEIGHT = 120
    const MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT = 100
    const MIN_NODE_PANEL_HEIGHT = 160
    const [sequencePanelHeight, setSequencePanelHeight] = useState(DEFAULT_SEQUENCE_PANEL_HEIGHT)
    const [globalSequencePanelHeight, setGlobalSequencePanelHeight] = useState(DEFAULT_GLOBAL_SEQUENCE_PANEL_HEIGHT)
    const dragStateRef = useRef<null | {
        type: 'sequence' | 'global'
        startY: number
        startSequenceHeight: number
        startGlobalHeight: number
    }>(null)

    useEffect(() => {
        setSequencePanelHeight((current) => clamp(current || DEFAULT_SEQUENCE_PANEL_HEIGHT, MIN_SEQUENCE_PANEL_HEIGHT, Math.max(MIN_SEQUENCE_PANEL_HEIGHT, viewport.height - MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT - MIN_NODE_PANEL_HEIGHT - SPLITTER_HEIGHT * 2)))
        setGlobalSequencePanelHeight((current) => clamp(current || DEFAULT_GLOBAL_SEQUENCE_PANEL_HEIGHT, MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT, Math.max(MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT, viewport.height - MIN_SEQUENCE_PANEL_HEIGHT - MIN_NODE_PANEL_HEIGHT - SPLITTER_HEIGHT * 2)))
    }, [viewport.height])

    const maxSequencePanelHeight = useMemo(() => (
        Math.max(MIN_SEQUENCE_PANEL_HEIGHT, viewport.height - globalSequencePanelHeight - MIN_NODE_PANEL_HEIGHT - SPLITTER_HEIGHT * 2)
    ), [viewport.height, globalSequencePanelHeight])
    const maxGlobalSequencePanelHeight = useMemo(() => (
        Math.max(MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT, viewport.height - sequencePanelHeight - MIN_NODE_PANEL_HEIGHT - SPLITTER_HEIGHT * 2)
    ), [viewport.height, sequencePanelHeight])

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            const dragState = dragStateRef.current
            if (!dragState) return
            const deltaY = event.clientY - dragState.startY
            if (dragState.type === 'sequence') {
                const nextSequenceHeight = clamp(dragState.startSequenceHeight + deltaY, MIN_SEQUENCE_PANEL_HEIGHT, maxSequencePanelHeight)
                setSequencePanelHeight(nextSequenceHeight)
                const nextGlobalMax = Math.max(MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT, viewport.height - nextSequenceHeight - MIN_NODE_PANEL_HEIGHT - SPLITTER_HEIGHT * 2)
                setGlobalSequencePanelHeight((current) => clamp(current, MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT, nextGlobalMax))
            } else {
                const nextGlobalHeight = clamp(dragState.startGlobalHeight + deltaY, MIN_GLOBAL_SEQUENCE_PANEL_HEIGHT, maxGlobalSequencePanelHeight)
                setGlobalSequencePanelHeight(nextGlobalHeight)
            }
        }

        const handleMouseUp = () => {
            dragStateRef.current = null
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [maxGlobalSequencePanelHeight, maxSequencePanelHeight, viewport.height])

    const startResize = (type: 'sequence' | 'global') => (event: React.MouseEvent) => {
        event.preventDefault()
        dragStateRef.current = {
            type,
            startY: event.clientY,
            startSequenceHeight: sequencePanelHeight,
            startGlobalHeight: globalSequencePanelHeight
        }
    }

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
                            <div style={{ flex: `0 0 ${sequencePanelHeight}px`, overflowY: 'auto', overflowX: 'hidden', borderBottom: '1px solid #444' }}>
                                <SequenceManager />
                            </div>
                        )}
                        {!isBindingMode && (
                            <div
                                onMouseDown={startResize('sequence')}
                                style={{
                                    flex: `0 0 ${SPLITTER_HEIGHT}px`,
                                    cursor: 'row-resize',
                                    backgroundColor: '#252525',
                                    borderTop: '1px solid #3a3a3a',
                                    borderBottom: '1px solid #3a3a3a'
                                }}
                            />
                        )}
                        {!isBindingMode && (
                            <div style={{ flex: `0 0 ${globalSequencePanelHeight}px`, overflowY: 'auto', overflowX: 'hidden', borderBottom: '1px solid #444' }}>
                                <GlobalSequenceManager />
                            </div>
                        )}
                        {!isBindingMode && (
                            <div
                                onMouseDown={startResize('global')}
                                style={{
                                    flex: `0 0 ${SPLITTER_HEIGHT}px`,
                                    cursor: 'row-resize',
                                    backgroundColor: '#252525',
                                    borderTop: '1px solid #3a3a3a',
                                    borderBottom: '1px solid #3a3a3a'
                                }}
                            />
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
