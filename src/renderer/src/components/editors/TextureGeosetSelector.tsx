import React, { useMemo } from 'react'
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
    // Group geosets by texture
    const textureMap = useMemo(() => {
        if (!modelData || !modelData.Geosets || !modelData.Materials) return new Map<number, number[]>()

        const map = new Map<number, number[]>() // TextureID -> GeosetID[]

        modelData.Geosets.forEach((geoset, geosetIndex) => {
            if (geoset.MaterialID === -1 || !modelData.Materials || geoset.MaterialID >= modelData.Materials.length) return

            const material = modelData.Materials[geoset.MaterialID]
            // Check all layers for textures
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

    // Get list of textures that are actually used by geosets
    const usedTextures = useMemo(() => {
        if (!modelData || !modelData.Textures) return []
        return modelData.Textures.map((tex, index) => ({ tex, index }))
            .filter(({ index }) => textureMap.has(index))
    }, [modelData, textureMap])

    const currentGeosets = useMemo(() => {
        if (selectedTextureId === null) return []
        return textureMap.get(selectedTextureId) || []
    }, [selectedTextureId, textureMap])

    if (!modelData) return <div style={{ color: '#fff', padding: 10 }}>No model loaded</div>

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: '#fff' }}>
            {/* Texture List (Level 1) */}
            <div style={{ flex: 1, borderBottom: '1px solid #444', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', background: '#333', borderBottom: '1px solid #444', fontWeight: 'bold' }}>
                    贴图列表 (Textures)
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {usedTextures.map(({ tex, index }) => (
                        <div
                            key={index}
                            onClick={() => onSelectTexture(index)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                backgroundColor: selectedTextureId === index ? '#1a3a5a' : 'transparent',
                                color: selectedTextureId === index ? '#fff' : '#ccc',
                                borderBottom: '1px solid #333',
                                borderLeft: selectedTextureId === index ? '4px solid #1890ff' : '4px solid transparent'
                            }}
                        >
                            <div style={{ fontSize: '12px', wordBreak: 'break-all' }}>
                                {tex.Image || `Texture ${index}`}
                            </div>
                        </div>
                    ))}
                    {usedTextures.length === 0 && (
                        <div style={{ padding: 12, color: '#666', fontStyle: 'italic' }}>
                            没有使用纹理的几何体
                        </div>
                    )}
                </div>
            </div>

            {/* Geoset List (Level 2) */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', background: '#333', borderBottom: '1px solid #444', borderTop: '1px solid #444', fontWeight: 'bold' }}>
                    几何体 (Geosets)
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {selectedTextureId === null ? (
                        <div style={{ padding: 12, color: '#666' }}>请先选择贴图</div>
                    ) : (
                        currentGeosets.map(geosetId => (
                            <div
                                key={geosetId}
                                onClick={() => onToggleGeosetVisibility(geosetId, !visibleGeosetIds.includes(geosetId))}
                                style={{
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    backgroundColor: visibleGeosetIds.includes(geosetId) ? '#1a3a5a' : 'transparent',
                                    color: visibleGeosetIds.includes(geosetId) ? '#fff' : '#ccc',
                                    borderBottom: '1px solid #333',
                                    display: 'flex',
                                    alignItems: 'center',
                                    borderLeft: visibleGeosetIds.includes(geosetId) ? '4px solid #1890ff' : '4px solid transparent'
                                }}
                            >
                                <Checkbox
                                    checked={visibleGeosetIds.includes(geosetId)}
                                    style={{ marginRight: 8, pointerEvents: 'none' }} // Click handled by parent div
                                />
                                <span>Geoset {geosetId}</span>
                            </div>
                        ))
                    )}
                    {selectedTextureId !== null && currentGeosets.length === 0 && (
                        <div style={{ padding: 12, color: '#666' }}>该贴图没有关联的几何体</div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default TextureGeosetSelector
