import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import UVEditor from './editors/UVEditor'
import TextureGeosetSelector from './editors/TextureGeosetSelector'
import { useModelStore, mergeMaterialManagerPreview } from '../store/modelStore'

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
    const modelData = useModelStore(state => state.modelData)
    const materialManagerPreview = useModelStore(state => state.materialManagerPreview)
    const effectiveModelData = useMemo(
        () => mergeMaterialManagerPreview(modelData, materialManagerPreview),
        [modelData, materialManagerPreview]
    )
    const selectedGeosetIndex = useModelStore(state => state.selectedGeosetIndex)
    const setSelectedGeosetIndex = useModelStore(state => state.setSelectedGeosetIndex)

    // Build geosetId -> textureId mapping for quick lookup
    const geosetToTextureMap = useMemo(() => {
        const map = new Map<number, number>()
        if (!effectiveModelData || !effectiveModelData.Geosets || !effectiveModelData.Materials) return map

        effectiveModelData.Geosets.forEach((geoset: any, geosetIndex: number) => {
            if (geoset.MaterialID === -1 || !effectiveModelData.Materials || geoset.MaterialID >= effectiveModelData.Materials.length) return
            const material = effectiveModelData.Materials[geoset.MaterialID]
            // Use first valid texture from material layers
            material?.Layers?.forEach((layer: any) => {
                if (!map.has(geosetIndex) && typeof layer.TextureID === 'number' && layer.TextureID >= 0) {
                    map.set(geosetIndex, layer.TextureID)
                }
            })
        })
        return map
    }, [effectiveModelData])

    // Sync Ctrl+click geoset picking from 3D view to UV texture/geoset selection
    useEffect(() => {
        if (!isActive || selectedGeosetIndex === null) return

        // Find texture for this geoset
        const textureId = geosetToTextureMap.get(selectedGeosetIndex)
        if (textureId !== undefined) {
            // Auto-select the texture
            setSelectedTextureId(textureId)
            // Replace visible list with just this geoset (different geosets may use different textures)
            setVisibleGeosetIds([selectedGeosetIndex])
        }

        // Clear the selection after processing to allow repeated picks
        setSelectedGeosetIndex(null)
    }, [isActive, selectedGeosetIndex, geosetToTextureMap, setSelectedGeosetIndex])

    // Handlers for Selection
    const handleSelectTexture = useCallback((id: number) => {
        setSelectedTextureId(id)
        const matchedGeosets = Array.from(geosetToTextureMap.entries())
            .filter(([, textureId]) => textureId === id)
            .map(([geosetId]) => geosetId)
        setVisibleGeosetIds(matchedGeosets)
    }, [geosetToTextureMap])

    const handleToggleGeoset = useCallback((id: number, visible: boolean) => {
        setVisibleGeosetIds(prev => {
            if (visible) {
                return [...prev, id]
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


