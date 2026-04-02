import React, { useState } from 'react'
import { Checkbox, Menu, Dropdown } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { showMessage } from '../../../store/messageStore'
import { MATERIAL_FILTER_MODE_LABELS } from '../../../constants/filterModes'

interface MaterialDetailProps {
    material: any
    _index: number
    onUpdate: (updatedMaterial: any) => void
    onSelectLayer: (layerIndex: number) => void
    _onBack: () => void
}

const MaterialDetail: React.FC<MaterialDetailProps> = ({ material, onUpdate, onSelectLayer }) => {
    const [draggedLayerIndex, setDraggedLayerIndex] = useState<number | null>(null)

    const handleSettingChange = (field: string, value: any) => {
        const updated = { ...material, [field]: value }
        onUpdate(updated)
    }

    const handleLayerReorder = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return
        const newLayers = [...material.Layers]
        const [movedLayer] = newLayers.splice(fromIndex, 1)
        newLayers.splice(toIndex, 0, movedLayer)
        handleSettingChange('Layers', newLayers)
    }

    const handleAddLayer = () => {
        const newLayer = {
            FilterMode: 0,
            TextureID: 0,  // Default to first texture (index 0) instead of -1 (invalid)
            Alpha: 1,
            // Default flags
            Unshaded: false,
            Unfogged: false,
            TwoSided: false,
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newLayers = [...(material.Layers || []), newLayer]
        handleSettingChange('Layers', newLayers)
        showMessage('success', '操作成功', '图层已添加')
    }

    const handleDeleteLayer = (layerIndex: number) => {
        const newLayers = [...material.Layers]
        newLayers.splice(layerIndex, 1)
        handleSettingChange('Layers', newLayers)
        showMessage('success', '操作成功', '图层已删除')
    }

    const getContextMenu = (layerIndex: number) => (
        <Menu>
            <Menu.Item key="add" icon={<PlusOutlined />} onClick={handleAddLayer}>
                新建图层
            </Menu.Item>
            <Menu.Item key="delete" icon={<DeleteOutlined />} danger onClick={() => handleDeleteLayer(layerIndex)}>
                删除图层
            </Menu.Item>
        </Menu>
    )

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Layer List */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0 10px 10px 10px' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#ccc' }}>图层 (Layers)</h4>
                <div style={{ border: '1px solid #444', borderRadius: 4, backgroundColor: '#1e1e1e', minHeight: 200, maxHeight: 300, overflowY: 'auto' }}>
                    {material.Layers && material.Layers.map((layer: any, i: number) => (
                        <Dropdown key={i} overlay={getContextMenu(i)} trigger={['contextMenu']}>
                            <div
                                draggable
                                onDragStart={(e) => {
                                    setDraggedLayerIndex(i)
                                    e.dataTransfer.effectAllowed = 'move'
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                }}
                                onDrop={(e) => {
                                    e.preventDefault()
                                    if (draggedLayerIndex !== null) {
                                        handleLayerReorder(draggedLayerIndex, i)
                                        setDraggedLayerIndex(null)
                                    }
                                }}
                                onDoubleClick={() => onSelectLayer(i)}
                                style={{
                                    padding: '8px',
                                    borderBottom: '1px solid #333',
                                    cursor: 'pointer',
                                    backgroundColor: '#252525',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                                className="layer-item"
                            >
                                <span>Layer {i}</span>
                                <span style={{ color: '#666', fontSize: 12 }}>
                                    {MATERIAL_FILTER_MODE_LABELS[layer.FilterMode] || 'Unknown'}
                                </span>
                            </div>
                        </Dropdown>
                    ))}
                    {(!material.Layers || material.Layers.length === 0) && (
                        <div style={{ padding: 20, textAlign: 'center', color: '#666' }} onContextMenu={(e) => {
                            e.preventDefault();
                            handleAddLayer();
                        }}>
                            无图层 (右键添加)
                        </div>
                    )}
                </div>
                <div style={{ marginTop: 5, fontSize: 12, color: '#888' }}>
                    注意：位于列表顶端的材质图层将首先被渲染！
                </div>
            </div>

            {/* Settings Panel */}
            <div style={{ padding: '10px', borderTop: '1px solid #303030', backgroundColor: '#1f1f1f' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#ccc' }}>其他设置</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ marginRight: 8, color: '#aaa' }}>优先平面:</span>
                        <InputNumber
                            size="small"
                            value={material.PriorityPlane || 0}
                            onChange={(v) => handleSettingChange('PriorityPlane', v)}
                        />
                    </div>
                    <div>
                        <Checkbox
                            checked={material.ConstantColor}
                            onChange={(e) => handleSettingChange('ConstantColor', e.target.checked)}
                        >
                            固定颜色 (Constant Color)
                        </Checkbox>
                    </div>
                    <div>
                        <Checkbox
                            checked={material.SortPrimsFarZ}
                            onChange={(e) => handleSettingChange('SortPrimsFarZ', e.target.checked)}
                        >
                            沿Z轴远向排列原始多边形组
                        </Checkbox>
                    </div>
                    <div>
                        <Checkbox
                            checked={material.FullResolution}
                            onChange={(e) => handleSettingChange('FullResolution', e.target.checked)}
                        >
                            最大分辨率 (Full Resolution)
                        </Checkbox>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default MaterialDetail
