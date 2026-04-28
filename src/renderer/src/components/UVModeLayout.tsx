import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import UVEditor from './editors/UVEditor'
import TextureGeosetSelector from './editors/TextureGeosetSelector'
import { useModelStore } from '../store/modelStore'
import { useUvEditorStore } from '../store/uvEditorStore'
import { useMaterialPreviewProjectedModelData } from '../application/preview'

const uniqueIds = (ids: number[]) => (
    Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id >= 0)))
)

const uniqueSortedIds = (ids: number[]) => (
    uniqueIds(ids).sort((left, right) => left - right)
)

interface UVModeOverlayProps {
    modelPath: string | null
    isActive: boolean
}

/**
 * UV Mode Overlay with 3-pane layout:
 * [Left: Texture/Geoset Selector] [Center: UV Canvas] [Right: 3D Viewer (optional)]
 */
const UVModeLayout: React.FC<UVModeOverlayProps & { children: React.ReactNode }> = ({
    modelPath,
    isActive,
    children
}) => {
    // Layout State
    const [showModelView, setShowModelView] = useState(true)
    const [selectorWidth, setSelectorWidth] = useState(220) // Left panel (Selector)
    const [canvasRatio, setCanvasRatio] = useState(0.6) // Ratio of remaining space for canvas

    // Selection State
    const [selectedTextureId, setSelectedTextureId] = useState<number | null>(null)
    const [visibleGeosetIds, setVisibleGeosetIds] = useState<number[]>([])

    // Dragging State
    const [isDraggingSelectorSplitter, setIsDraggingSelectorSplitter] = useState(false)
    const [isDraggingCanvasSplitter, setIsDraggingCanvasSplitter] = useState(false)

    const containerRef = useRef<HTMLDivElement>(null)
    const lastHandledViewerSelectionRevisionRef = useRef<number | null>(null)
    const effectiveModelData = useMaterialPreviewProjectedModelData()
    const selectedGeosetIndex = useModelStore(state => state.selectedGeosetIndex)
    const setSelectedGeosetIndex = useModelStore(state => state.setSelectedGeosetIndex)
    const viewerSelectionSync = useUvEditorStore(state => state.viewerSelectionSync)

    // Build bidirectional texture/geoset relations across every material layer.
    const textureRelations = useMemo(() => {
        const geosetToTextureIds = new Map<number, number[]>()
        const textureToGeosetIds = new Map<number, number[]>()
        if (!effectiveModelData || !effectiveModelData.Geosets || !effectiveModelData.Materials || !effectiveModelData.Textures) {
            return { geosetToTextureIds, textureToGeosetIds }
        }

        effectiveModelData.Geosets.forEach((geoset: any, geosetIndex: number) => {
            if (geoset.MaterialID === -1 || !effectiveModelData.Materials || geoset.MaterialID >= effectiveModelData.Materials.length) return
            const material = effectiveModelData.Materials[geoset.MaterialID]
            const textureIds = new Set<number>()

            material?.Layers?.forEach((layer: any) => {
                const textureId = Number(layer?.TextureID)
                if (Number.isInteger(textureId) && textureId >= 0 && textureId < effectiveModelData.Textures!.length) {
                    textureIds.add(textureId)
                }
            })

            const orderedTextureIds = uniqueIds(Array.from(textureIds))
            if (orderedTextureIds.length === 0) return

            geosetToTextureIds.set(geosetIndex, orderedTextureIds)
            orderedTextureIds.forEach((textureId) => {
                const existing = textureToGeosetIds.get(textureId) || []
                textureToGeosetIds.set(textureId, uniqueSortedIds([...existing, geosetIndex]))
            })
        })

        return { geosetToTextureIds, textureToGeosetIds }
    }, [effectiveModelData])

    const getGeosetsForTexture = useCallback((textureId: number) => (
        textureRelations.textureToGeosetIds.get(textureId) || []
    ), [textureRelations])

    const getSelectedGeosetsForTexture = useCallback((geosetIds: number[], textureId: number) => (
        uniqueSortedIds(geosetIds.filter((geosetId) => (
            textureRelations.geosetToTextureIds.get(geosetId)?.includes(textureId) ?? false
        )))
    ), [textureRelations])

    const chooseTextureForGeosets = useCallback((geosetIds: number[]) => {
        const textureHitCounts = new Map<number, number>()

        geosetIds.forEach((geosetIndex) => {
            const textureIds = textureRelations.geosetToTextureIds.get(geosetIndex) || []
            textureIds.forEach((textureId) => {
                textureHitCounts.set(textureId, (textureHitCounts.get(textureId) ?? 0) + 1)
            })
        })

        let preferredTextureId: number | null = null
        let preferredHitCount = 0

        textureHitCounts.forEach((hitCount, textureId) => {
            if (hitCount > preferredHitCount) {
                preferredTextureId = textureId
                preferredHitCount = hitCount
            }
        })

        return preferredTextureId
    }, [textureRelations])

    // Sync Ctrl+click geoset picking from 3D view to UV texture/geoset selection
    useEffect(() => {
        if (!isActive || selectedGeosetIndex === null) return

        const relatedTextureIds = textureRelations.geosetToTextureIds.get(selectedGeosetIndex) || []
        if (relatedTextureIds.length > 0) {
            const currentTextureStillApplies = selectedTextureId !== null && relatedTextureIds.includes(selectedTextureId)
            const nextTextureId = currentTextureStillApplies ? selectedTextureId : relatedTextureIds[0]

            if (!currentTextureStillApplies) {
                setSelectedTextureId(nextTextureId)
                setVisibleGeosetIds([selectedGeosetIndex])
            } else {
                setVisibleGeosetIds((previous) => uniqueSortedIds([...previous, selectedGeosetIndex]))
            }
        }

        // Clear the selection after processing to allow repeated picks
        setSelectedGeosetIndex(null)
    }, [isActive, selectedGeosetIndex, selectedTextureId, textureRelations, setSelectedGeosetIndex])

    useEffect(() => {
        if (!isActive || !viewerSelectionSync) return
        if (lastHandledViewerSelectionRevisionRef.current === viewerSelectionSync.revision) return
        lastHandledViewerSelectionRevisionRef.current = viewerSelectionSync.revision

        const { geosetIndices } = viewerSelectionSync
        if (geosetIndices.length === 0) {
            return
        }

        if (selectedTextureId !== null) {
            const currentTextureGeosets = getSelectedGeosetsForTexture(geosetIndices, selectedTextureId)
            if (currentTextureGeosets.length > 0) {
                setVisibleGeosetIds(currentTextureGeosets)
                return
            }
        }

        const preferredTextureId = chooseTextureForGeosets(geosetIndices)

        if (preferredTextureId === null) {
            setVisibleGeosetIds(uniqueSortedIds(geosetIndices))
            return
        }

        const filteredGeosets = getSelectedGeosetsForTexture(geosetIndices, preferredTextureId)
        setSelectedTextureId(preferredTextureId)
        setVisibleGeosetIds(filteredGeosets.length > 0 ? filteredGeosets : geosetIndices)
    }, [isActive, viewerSelectionSync, selectedTextureId, chooseTextureForGeosets, getSelectedGeosetsForTexture])

    // Handlers for Selection
    const handleSelectTexture = useCallback((id: number) => {
        setSelectedTextureId(id)
        setVisibleGeosetIds(getGeosetsForTexture(id))
    }, [getGeosetsForTexture])

    const handleToggleGeoset = useCallback((id: number, visible: boolean) => {
        setVisibleGeosetIds(prev => {
            if (visible) {
                return uniqueSortedIds([...prev, id])
            } else {
                return prev.filter(gid => gid !== id)
            }
        })
    }, [])

    // Layout Resizing Handlers
    const handleMouseDownSelectorSplitter = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsDraggingSelectorSplitter(true)
    }, [])

    const handleMouseDownCanvasSplitter = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsDraggingCanvasSplitter(true)
    }, [])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()

        if (isDraggingSelectorSplitter) {
            const newWidth = e.clientX - rect.left
            setSelectorWidth(Math.max(150, Math.min(400, newWidth)))
        }

        if (isDraggingCanvasSplitter && showModelView) {
            // Calculate ratio within the space remaining after selector
            const availableWidth = rect.width - selectorWidth
            const canvasWidth = e.clientX - rect.left - selectorWidth
            const newRatio = canvasWidth / availableWidth
            setCanvasRatio(Math.max(0.3, Math.min(0.9, newRatio)))
        }
    }, [isDraggingSelectorSplitter, isDraggingCanvasSplitter, selectorWidth, showModelView])

    const handleMouseUp = useCallback(() => {
        setIsDraggingSelectorSplitter(false)
        setIsDraggingCanvasSplitter(false)
    }, [])

    useEffect(() => {
        if (isDraggingSelectorSplitter || isDraggingCanvasSplitter) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDraggingSelectorSplitter, isDraggingCanvasSplitter, handleMouseMove, handleMouseUp])

    const toggleModelView = useCallback(() => {
        setShowModelView(prev => !prev)
    }, [])

    // Calculated widths
    const canvasWidth = showModelView
        ? `calc((100% - ${selectorWidth}px) * ${canvasRatio})`
        : `calc(100% - ${selectorWidth}px)`

    const viewerLeft = showModelView
        ? `calc(${selectorWidth}px + (100% - ${selectorWidth}px) * ${canvasRatio})`
        : '100%' // Hidden

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
            {/* 3D Viewer (Rightmost, or hidden) */}
            <div style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: isActive ? viewerLeft : 0,
                right: 0,
                visibility: isActive && !showModelView ? 'hidden' : 'visible',
                paddingLeft: isActive && showModelView ? '6px' : 0,
                transition: 'all 0.1s linear'
            }}>
                {children}
            </div>

            {/* UV Mode Components */}
            {isActive && (
                <>
                    {/* Left Pane: Texture/Geoset Selector */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: `${selectorWidth}px`,
                        height: '100%',
                        backgroundColor: '#222',
                        borderRight: '1px solid #444',
                        zIndex: 15
                    }}>
                        <TextureGeosetSelector
                            modelData={effectiveModelData}
                            selectedTextureId={selectedTextureId}
                            onSelectTexture={handleSelectTexture}
                            visibleGeosetIds={visibleGeosetIds}
                            onToggleGeosetVisibility={handleToggleGeoset}
                        />
                    </div>

                    {/* Selector Splitter */}
                    <div
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: `${selectorWidth - 3}px`,
                            width: '6px',
                            height: '100%',
                            backgroundColor: isDraggingSelectorSplitter ? '#1890ff' : 'transparent',
                            cursor: 'col-resize',
                            zIndex: 20
                        }}
                        onMouseDown={handleMouseDownSelectorSplitter}
                    >
                        <div style={{ width: '1px', height: '100%', backgroundColor: '#444', marginLeft: '2px' }} />
                    </div>

                    {/* Center Pane: UV Canvas */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: `${selectorWidth}px`,
                        width: canvasWidth,
                        height: '100%',
                        zIndex: 10,
                        backgroundColor: '#1a1a1a'
                    }}>
                        <UVEditor
                            modelPath={modelPath}
                            showModelView={showModelView}
                            onToggleModelView={toggleModelView}
                            visibleGeosetIds={visibleGeosetIds}
                            selectedTextureId={selectedTextureId}
                        />
                    </div>

                    {/* Canvas/Viewer Splitter (only when viewer is shown) */}
                    {showModelView && (
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: `calc(${selectorWidth}px + ${canvasWidth} - 3px)`,
                                width: '6px',
                                height: '100%',
                                backgroundColor: isDraggingCanvasSplitter ? '#1890ff' : 'transparent',
                                cursor: 'col-resize',
                                zIndex: 20
                            }}
                            onMouseDown={handleMouseDownCanvasSplitter}
                        >
                            <div style={{ width: '1px', height: '100%', backgroundColor: '#444', marginLeft: '2px' }} />
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

export default UVModeLayout
