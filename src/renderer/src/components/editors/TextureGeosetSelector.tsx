import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { ModelData } from '../../types/model'
import { Checkbox } from 'antd'

interface TextureGeosetSelectorProps {
    modelData: ModelData | null
    selectedTextureId: number | null
    onSelectTexture: (textureId: number) => void
    visibleGeosetIds: number[]
    onToggleGeosetVisibility: (geosetId: number, visible: boolean) => void
}

const TextureGeosetSelector: React.FC<TextureGeosetSelectorProps> = ({
    modelData,
    selectedTextureId,
    onSelectTexture,
    visibleGeosetIds,
    onToggleGeosetVisibility
}) => {
    // Splitter state: ratio of texture list vs geoset list
    const [textureRatio, setTextureRatio] = useState(0.45)
    const [isDragging, setIsDragging] = useState(false)
    const containerRef = React.useRef<HTMLDivElement>(null)

    // Group geosets by texture
    const textureMap = useMemo(() => {
        if (!modelData || !modelData.Geosets || !modelData.Materials) return new Map<number, number[]>()

        const map = new Map<number, number[]>()

        modelData.Geosets.forEach((geoset, geosetIndex) => {
            if (geoset.MaterialID === -1 || !modelData.Materials || geoset.MaterialID >= modelData.Materials.length) return

            const material = modelData.Materials[geoset.MaterialID]
            material?.Layers?.forEach(layer => {
                if (typeof layer.TextureID === 'number' && layer.TextureID >= 0 && modelData.Textures && layer.TextureID < modelData.Textures.length) {
                    const texId = layer.TextureID
                    if (!map.has(texId)) {
                        map.set(texId, [])
                    }
                    if (!map.get(texId)?.includes(geosetIndex)) {
                        map.get(texId)?.push(geosetIndex)
                    }
                }
            })
        })

        return map
    }, [modelData])

    const usedTextures = useMemo(() => {
        if (!modelData || !modelData.Textures) return []
        return modelData.Textures.map((tex, index) => ({ tex, index }))
            .filter(({ index }) => textureMap.has(index))
    }, [modelData, textureMap])

    const currentGeosets = useMemo(() => {
        if (selectedTextureId === null) return []
        return textureMap.get(selectedTextureId) || []
    }, [selectedTextureId, textureMap])

    // Splitter drag handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const newRatio = (e.clientY - rect.top) / rect.height
        setTextureRatio(Math.max(0.2, Math.min(0.8, newRatio)))
    }, [isDragging])

    const handleMouseUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging, handleMouseMove, handleMouseUp])

    if (!modelData) return <div style={{ color: '#fff', padding: 10 }}>No model loaded</div>

    return (
        <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', color: '#fff' }}>
            {/* Texture List */}
            <div style={{ height: `calc(${textureRatio * 100}% - 3px)`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 10px', background: '#333', borderBottom: '1px solid #444', fontWeight: 'bold', fontSize: '12px' }}>
                    贴图列表
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {usedTextures.map(({ tex, index }) => (
                        <div
                            key={index}
                            onClick={() => onSelectTexture(index)}
                            style={{
                                padding: '6px 10px',
                                cursor: 'pointer',
                                backgroundColor: selectedTextureId === index ? '#1a3a5a' : 'transparent',
                                color: selectedTextureId === index ? '#fff' : '#ccc',
                                borderBottom: '1px solid #333',
                                borderLeft: selectedTextureId === index ? '3px solid #1890ff' : '3px solid transparent',
                                fontSize: '13px'
                            }}
                        >
                            {tex.Image || `Texture ${index}`}
                        </div>
                    ))}
                    {usedTextures.length === 0 && (
                        <div style={{ padding: 10, color: '#666', fontStyle: 'italic', fontSize: '11px' }}>
                            没有使用纹理的几何体
                        </div>
                    )}
                </div>
            </div>

            {/* Splitter */}
            <div
                onMouseDown={handleMouseDown}
                style={{
                    height: '6px',
                    backgroundColor: isDragging ? '#1890ff' : '#333',
                    cursor: 'row-resize',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                }}
            >
                <div style={{ width: '30px', height: '2px', backgroundColor: '#666', borderRadius: '1px' }} />
            </div>

            {/* Geoset List - 2 columns */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 10px', background: '#333', borderBottom: '1px solid #444', fontWeight: 'bold', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>几何体</span>
                    {selectedTextureId !== null && currentGeosets.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                                onClick={() => {
                                    // Select all geosets for this texture
                                    currentGeosets.forEach(geosetId => {
                                        if (!visibleGeosetIds.includes(geosetId)) {
                                            onToggleGeosetVisibility(geosetId, true)
                                        }
                                    })
                                }}
                                style={{
                                    background: '#555',
                                    border: 'none',
                                    color: '#ccc',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontSize: '10px',
                                    cursor: 'pointer'
                                }}
                            >
                                全选
                            </button>
                            <button
                                onClick={() => {
                                    // Deselect all geosets for this texture
                                    currentGeosets.forEach(geosetId => {
                                        if (visibleGeosetIds.includes(geosetId)) {
                                            onToggleGeosetVisibility(geosetId, false)
                                        }
                                    })
                                }}
                                style={{
                                    background: '#444',
                                    border: 'none',
                                    color: '#999',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontSize: '10px',
                                    cursor: 'pointer'
                                }}
                            >
                                清空
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                    {selectedTextureId === null ? (
                        <div style={{ padding: 10, color: '#666', fontSize: '11px' }}>请先选择贴图</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                            {currentGeosets.map(geosetId => (
                                <div
                                    key={geosetId}
                                    onClick={() => onToggleGeosetVisibility(geosetId, !visibleGeosetIds.includes(geosetId))}
                                    style={{
                                        padding: '4px 6px',
                                        cursor: 'pointer',
                                        backgroundColor: visibleGeosetIds.includes(geosetId) ? '#1a3a5a' : '#2a2a2a',
                                        color: visibleGeosetIds.includes(geosetId) ? '#fff' : '#888',
                                        borderRadius: '3px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        fontSize: '11px',
                                        border: visibleGeosetIds.includes(geosetId) ? '1px solid #1890ff' : '1px solid #444'
                                    }}
                                >
                                    <Checkbox
                                        checked={visibleGeosetIds.includes(geosetId)}
                                        style={{ marginRight: 4, pointerEvents: 'none' }}
                                    />
                                    <span>{geosetId}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {selectedTextureId !== null && currentGeosets.length === 0 && (
                        <div style={{ padding: 10, color: '#666', fontSize: '11px' }}>该贴图没有关联的几何体</div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default TextureGeosetSelector
