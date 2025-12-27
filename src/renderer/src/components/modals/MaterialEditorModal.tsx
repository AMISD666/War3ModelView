import React, { useState, useEffect } from 'react'
import { Button, List, Card, Checkbox, InputNumber, Select, Typography, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { DraggableModal } from '../DraggableModal'
import KeyframeEditor from '../editors/KeyframeEditor'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'

const { Text } = Typography

/**
 * Convert Shading bitmask to individual boolean properties for UI display
 * LayerShading: Unshaded=1, SphereEnvMap=2, TwoSided=16, Unfogged=32, NoDepthTest=64, NoDepthSet=128
 */
function normalizeMaterialsForUI(materials: any[]): any[] {
    return materials.map(material => ({
        ...material,
        Layers: (material.Layers || []).map((layer: any) => {
            const shading = layer.Shading || 0;
            return {
                ...layer,
                // Set boolean properties from Shading bitmask (if not already set)
                Unshaded: layer.Unshaded !== undefined ? layer.Unshaded : (shading & 1) !== 0,
                SphereEnvMap: layer.SphereEnvMap !== undefined ? layer.SphereEnvMap : (shading & 2) !== 0,
                TwoSided: layer.TwoSided !== undefined ? layer.TwoSided : (shading & 16) !== 0,
                Unfogged: layer.Unfogged !== undefined ? layer.Unfogged : (shading & 32) !== 0,
                NoDepthTest: layer.NoDepthTest !== undefined ? layer.NoDepthTest : (shading & 64) !== 0,
                NoDepthSet: layer.NoDepthSet !== undefined ? layer.NoDepthSet : (shading & 128) !== 0,
            };
        })
    }));
}

/**
 * Convert boolean properties back to Shading bitmask for saving
 */
function denormalizeMaterialsForSave(materials: any[]): any[] {
    return materials.map(material => ({
        ...material,
        Layers: (material.Layers || []).map((layer: any) => {
            // Rebuild Shading bitmask from boolean flags
            let shading = 0;
            if (layer.Unshaded) shading |= 1;
            if (layer.SphereEnvMap) shading |= 2;
            if (layer.TwoSided) shading |= 16;
            if (layer.Unfogged) shading |= 32;
            if (layer.NoDepthTest) shading |= 64;
            if (layer.NoDepthSet) shading |= 128;

            // Create clean layer without UI-only boolean properties
            const { Unshaded, SphereEnvMap, TwoSided, Unfogged, NoDepthTest, NoDepthSet, ...cleanLayer } = layer;

            return {
                ...cleanLayer,
                Shading: shading,
                // Ensure CoordId is set (default to 0)
                CoordId: layer.CoordId ?? 0,
            };
        })
    }));
}

interface MaterialEditorModalProps {
    visible: boolean
    onClose: () => void
}

const MaterialEditorModal: React.FC<MaterialEditorModalProps> = ({ visible, onClose }) => {
    const { modelData, setMaterials } = useModelStore()
    const [localMaterials, setLocalMaterials] = useState<any[]>([])
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1)
    const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(-1)

    // Keyframe Editor State
    const [isKeyframeEditorOpen, setIsKeyframeEditorOpen] = useState(false)
    const [editingField, setEditingField] = useState<string | null>(null)
    const [editingVectorSize, setEditingVectorSize] = useState(1)

    const isInitialized = React.useRef(false)

    // Initialize local state
    useEffect(() => {
        if (visible) {
            if (!isInitialized.current && modelData && modelData.Materials) {
                console.log('[MaterialEditorModal] Initializing local materials from store. Count:', modelData.Materials.length)
                // Convert Shading bitmask to boolean properties for UI display
                const normalized = normalizeMaterialsForUI(JSON.parse(JSON.stringify(modelData.Materials)));
                setLocalMaterials(normalized)
                setSelectedMaterialIndex(modelData.Materials.length > 0 ? 0 : -1)
                setSelectedLayerIndex(-1)
                isInitialized.current = true
            }
        } else {
            setLocalMaterials([])
            setSelectedMaterialIndex(-1)
            setSelectedLayerIndex(-1)
            isInitialized.current = false
        }
    }, [visible, modelData])

    // Subscribe to Ctrl+Click geoset picking - auto-select material
    useEffect(() => {
        if (!visible || !modelData) return
        let lastPickedIndex: number | null = null
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && modelData.Geosets && modelData.Geosets[pickedGeosetIndex]) {
                    const materialId = modelData.Geosets[pickedGeosetIndex].MaterialID
                    if (materialId !== undefined && materialId >= 0 && materialId < localMaterials.length) {
                        setSelectedMaterialIndex(materialId)
                        setSelectedLayerIndex(-1)
                        console.log('[MaterialEditor] Auto-selected material', materialId, 'for geoset', pickedGeosetIndex)
                    }
                }
            }
        })
        return unsubscribe
    }, [visible, modelData, localMaterials.length])

    const handleOk = () => {
        // Convert boolean flags back to Shading bitmask before saving
        const materialsForSave = denormalizeMaterialsForSave(localMaterials);
        const oldMaterials = modelData?.Materials || [];
        useHistoryStore.getState().push({
            name: 'Edit Materials',
            undo: () => setMaterials(oldMaterials),
            redo: () => setMaterials(materialsForSave)
        });
        setMaterials(materialsForSave)
        message.success('材质已保存')
        onClose()
    }

    const updateLocalMaterial = (index: number, updates: any) => {
        const newMaterials = [...localMaterials]
        newMaterials[index] = { ...newMaterials[index], ...updates }
        setLocalMaterials(newMaterials)
    }

    const updateLocalLayer = (matIndex: number, layerIndex: number, updates: any) => {
        const newMaterials = [...localMaterials]
        const newLayers = [...newMaterials[matIndex].Layers]
        newLayers[layerIndex] = { ...newLayers[layerIndex], ...updates }
        newMaterials[matIndex].Layers = newLayers
        setLocalMaterials(newMaterials)
    }

    // Material Actions
    const handleAddMaterial = () => {
        // Include a default layer with TextureID 0 so the geoset renders correctly
        const defaultLayer = {
            FilterMode: 0,
            TextureID: 0,
            Alpha: 1,
            Unshaded: true, // Prevent lighting issues hiding the model
            Unfogged: false,
            TwoSided: true, // Prevent backface culling hiding the model
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newMaterial = { PriorityPlane: 0, RenderMode: 0, Layers: [defaultLayer] }
        setLocalMaterials([...localMaterials, newMaterial])
        setSelectedMaterialIndex(localMaterials.length)
        setSelectedLayerIndex(0) // Auto-select the default layer
    }

    const handleDeleteMaterial = (index: number) => {
        const newMaterials = localMaterials.filter((_, i) => i !== index)
        setLocalMaterials(newMaterials)

        // Update geoset MaterialID references - only for geosets that referenced the deleted material
        // Set them to use material 0 (the first remaining material)
        if (modelData?.Geosets) {
            const updatedGeosets = modelData.Geosets.map((geoset: any) => {
                const matId = geoset.MaterialID;
                if (matId === index) {
                    // Geoset was referencing the deleted material, set to 0
                    return { ...geoset, MaterialID: 0 };
                } else if (matId > index) {
                    // Geoset was referencing a material after the deleted one
                    // We need to decrement to keep the reference valid
                    return { ...geoset, MaterialID: matId - 1 };
                }
                return geoset;
            });
            // Sync BOTH materials and geosets to the store together to prevent mismatch
            // This ensures the renderer sees consistent data
            setMaterials(newMaterials);
            useModelStore.getState().setGeosets(updatedGeosets);
        }

        if (selectedMaterialIndex === index) {
            setSelectedMaterialIndex(-1)
            setSelectedLayerIndex(-1)
        } else if (selectedMaterialIndex > index) {
            setSelectedMaterialIndex(selectedMaterialIndex - 1)
        }
    }

    // Layer Actions
    const handleAddLayer = () => {
        if (selectedMaterialIndex < 0) return
        const newLayer = {
            FilterMode: 0,
            TextureID: 0,  // Default to first texture (index 0) instead of -1 (invalid)
            Alpha: 1,
            Unshaded: true,
            Unfogged: false,
            TwoSided: true,
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newMaterials = [...localMaterials]
        newMaterials[selectedMaterialIndex].Layers = [...(newMaterials[selectedMaterialIndex].Layers || []), newLayer]
        setLocalMaterials(newMaterials)
        setSelectedLayerIndex(newMaterials[selectedMaterialIndex].Layers.length - 1)
    }

    const handleDeleteLayer = (index: number) => {
        if (selectedMaterialIndex < 0) return
        const newMaterials = [...localMaterials]
        newMaterials[selectedMaterialIndex].Layers = newMaterials[selectedMaterialIndex].Layers.filter((_: any, i: number) => i !== index)
        setLocalMaterials(newMaterials)
        if (selectedLayerIndex === index) setSelectedLayerIndex(-1)
        else if (selectedLayerIndex > index) setSelectedLayerIndex(selectedLayerIndex - 1)
    }

    // Keyframe Logic
    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)
        setIsKeyframeEditorOpen(true)
    }

    const handleKeyframeSave = (animVector: any) => {
        if (editingField && selectedMaterialIndex >= 0 && selectedLayerIndex >= 0) {
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [editingField]: animVector })
        }
        setIsKeyframeEditorOpen(false)
    }

    const handleAnimToggle = (field: string, checked: boolean, vectorSize: number = 1) => {
        if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return
        const layer = localMaterials[selectedMaterialIndex].Layers[selectedLayerIndex]

        if (checked) {
            const currentVal = layer[field]
            // For TextureID, default to 0 (first texture); for Alpha, default to 1
            const defaultVal = field === 'TextureID' ? 0 : 1
            const initialVal = typeof currentVal === 'number' ? currentVal : defaultVal
            const animVector = {
                Keys: [{ Frame: 0, Vector: vectorSize === 1 ? [initialVal] : new Array(vectorSize).fill(0) }],
                LineType: 0,
                GlobalSeqId: null
            }
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [field]: animVector })
        } else {
            const currentVal = layer[field]
            // For TextureID, default to 0; for Alpha, default to 1
            let staticVal = field === 'TextureID' ? 0 : 1
            if (currentVal && currentVal.Keys && currentVal.Keys.length > 0) {
                staticVal = currentVal.Keys[0].Vector[0]
            }
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [field]: staticVal })
        }
    }

    const selectedMaterial = selectedMaterialIndex >= 0 ? localMaterials[selectedMaterialIndex] : null
    const selectedLayer = selectedMaterial && selectedLayerIndex >= 0 && selectedMaterial.Layers ? selectedMaterial.Layers[selectedLayerIndex] : null

    const filterModeOptions = [
        { value: 0, label: 'None' },
        { value: 1, label: 'Transparent' },
        { value: 2, label: 'Blend' },
        { value: 3, label: 'Additive' },
        { value: 4, label: 'Add Alpha' },
        { value: 5, label: 'Modulate' },
        { value: 6, label: 'Modulate 2X' },
    ]

    // Helper to get texture options (mock or from store if available, for now using just indices)
    // The previous code used 'textureOptions' but it was not defined in the snippet I saw.
    // I will assume it creates options based on likely available logic or just numbers.
    // Ideally we should get textures from modelData.Textures, but let's stick to simple indices if unknown.
    // Wait, in previous ViewFile output, textureOptions was NOT defined. It was a lint error "找不到名称“textureOptions”".
    // I need to define it.
    const textureCount = (modelData as any)?.Textures?.length || 0
    const textureOptions = Array.from({ length: textureCount }, (_, i) => {
        const path = (modelData as any)?.Textures?.[i]?.Image || '';
        // Extract just the filename for cleaner display
        const filename = path.replace(/\\/g, '/').split('/').pop() || path;

        return {
            value: i,
            label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', marginRight: 8 }} title={path}>
                        {filename}
                    </span>
                    <span style={{ fontWeight: 'bold', minWidth: 24, textAlign: 'right', color: '#888', fontSize: '0.9em' }}>#{i}</span>
                </div>
            )
        };
    })
    if (textureOptions.length === 0) {
        textureOptions.push({ value: -1, label: <span>No Textures</span> })
    }

    return (
        <DraggableModal
            title="材质编辑器 (Material Editor)"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            okText="保存"
            cancelText="取消"
            width={850}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: 0, backgroundColor: '#252525' } }}
        >
            <div style={{ display: 'flex', height: '600px', border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
                {/* Lists (Left) */}
                <div style={{ width: '250px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #4a4a4a' }}>
                    {/* Top: Materials */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #4a4a4a', backgroundColor: '#333333', overflow: 'hidden' }}>
                        <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: '#e8e8e8', fontWeight: 'bold' }}>材质 (Materials)</Text>
                            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAddMaterial} style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }} />
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            <List
                                dataSource={localMaterials}
                                renderItem={(_item: any, index: number) => (
                                    <List.Item
                                        onClick={() => {
                                            setSelectedMaterialIndex(index)
                                            setSelectedLayerIndex(-1)
                                        }}
                                        style={{
                                            cursor: 'pointer',
                                            padding: '4px 12px',
                                            backgroundColor: selectedMaterialIndex === index ? '#5a9cff' : 'transparent',
                                            color: selectedMaterialIndex === index ? '#fff' : '#b0b0b0',
                                            borderBottom: '1px solid #3a3a3a'
                                        }}
                                        className="hover:bg-[#454545]"
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                            <span>Material {index}</span>
                                            {selectedMaterialIndex === index && (
                                                <DeleteOutlined onClick={(e) => { e.stopPropagation(); handleDeleteMaterial(index) }} style={{ color: '#fff' }} />
                                            )}
                                        </div>
                                    </List.Item>
                                )}
                            />
                        </div>
                    </div>

                    {/* Bottom: Layers */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#2d2d2d', overflow: 'hidden' }}>
                        <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: '#e8e8e8', fontWeight: 'bold' }}>图层 (Layers)</Text>
                            <Button
                                type="primary"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={handleAddLayer}
                                disabled={selectedMaterialIndex < 0}
                                style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                            />
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            {selectedMaterial ? (
                                <List
                                    dataSource={selectedMaterial.Layers || []}
                                    renderItem={(_item: any, index: number) => (
                                        <List.Item
                                            onClick={() => setSelectedLayerIndex(index)}
                                            style={{
                                                cursor: 'pointer',
                                                padding: '4px 12px',
                                                backgroundColor: selectedLayerIndex === index ? '#5a9cff' : 'transparent',
                                                color: selectedLayerIndex === index ? '#fff' : '#b0b0b0',
                                                borderBottom: '1px solid #3a3a3a'
                                            }}
                                            className="hover:bg-[#454545]"
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                <span>Layer {index}</span>
                                                {selectedLayerIndex === index && (
                                                    <DeleteOutlined onClick={(e) => { e.stopPropagation(); handleDeleteLayer(index) }} style={{ color: '#fff' }} />
                                                )}
                                            </div>
                                        </List.Item>
                                    )}
                                />
                            ) : (
                                <div style={{ padding: '16px', color: '#666', textAlign: 'center' }}>
                                    请先选择材质
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Details (Right) */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedLayer ? (
                        // Layer Details
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <Button size="small" onClick={() => setSelectedLayerIndex(-1)}>返回材质设置</Button>
                                <Text style={{ color: '#b0b0b0' }}>正在编辑: Layer {selectedLayerIndex}</Text>
                            </div>

                            <Card title={<span style={{ color: '#b0b0b0' }}>图层属性</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a' }} headStyle={{ borderBottom: '1px solid #4a4a4a' }}>
                                {/* Row 1: Texture ID (Full Width) */}
                                <div style={{ marginBottom: 16 }}>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>贴图 ID:</Text>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <Checkbox
                                            checked={selectedLayer.TextureID && typeof selectedLayer.TextureID !== 'number'}
                                            onChange={(e) => handleAnimToggle('TextureID', e.target.checked)}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            动态
                                        </Checkbox>
                                        {selectedLayer.TextureID && typeof selectedLayer.TextureID !== 'number' ? (
                                            <Button size="small" onClick={() => openKeyframeEditor('TextureID', 1)}>编辑动画</Button>
                                        ) : (
                                            <Select
                                                size="small"
                                                style={{ flex: 1 }}
                                                value={typeof selectedLayer.TextureID === 'number' ? selectedLayer.TextureID : 0}
                                                onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: v })}
                                                options={textureOptions}
                                                popupClassName="dark-theme-select-dropdown"
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Row 2: Alpha, Filter Mode, TVertexAnim */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>透明度 (Alpha):</Text>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <Checkbox
                                                checked={selectedLayer.Alpha && typeof selectedLayer.Alpha !== 'number'}
                                                onChange={(e) => handleAnimToggle('Alpha', e.target.checked)}
                                                style={{ color: '#e8e8e8' }}
                                            >
                                                动态
                                            </Checkbox>
                                            {selectedLayer.Alpha && typeof selectedLayer.Alpha !== 'number' ? (
                                                <Button size="small" onClick={() => openKeyframeEditor('Alpha', 1)}>编辑动画</Button>
                                            ) : (
                                                <InputNumber
                                                    size="small"
                                                    value={selectedLayer.Alpha || 1}
                                                    onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Alpha: v })}
                                                    step={0.01} min={0} max={1}
                                                    precision={2}
                                                    style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>过滤模式:</Text>
                                        <Select
                                            size="small"
                                            style={{ width: '100%' }}
                                            value={selectedLayer.FilterMode}
                                            onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { FilterMode: v })}
                                            options={filterModeOptions}
                                            popupClassName="dark-theme-select-dropdown"
                                        />
                                    </div>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>纹理动画 (TVertexAnim):</Text>
                                        <Select
                                            size="small"
                                            style={{ width: '100%' }}
                                            value={selectedLayer.TVertexAnimId === null || selectedLayer.TVertexAnimId === undefined ? -1 : selectedLayer.TVertexAnimId}
                                            onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TVertexAnimId: v === -1 ? null : v })}
                                            options={[
                                                { value: -1, label: 'None' },
                                                ...((modelData as any)?.TextureAnims?.map((_: any, i: number) => ({
                                                    value: i,
                                                    label: `Anim ${i}`
                                                })) || [])
                                            ]}
                                            popupClassName="dark-theme-select-dropdown"
                                        />
                                    </div>
                                </div>
                            </Card>

                            <Card title={<span style={{ color: '#b0b0b0' }}>标记 (Flags)</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a' }} headStyle={{ borderBottom: '1px solid #4a4a4a' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <Checkbox checked={selectedLayer.Unshaded} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Unshaded: e.target.checked })} style={{ color: '#e8e8e8' }}>无阴影 (Unshaded)</Checkbox>
                                    <Checkbox checked={selectedLayer.Unfogged} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Unfogged: e.target.checked })} style={{ color: '#e8e8e8' }}>无迷雾 (Unfogged)</Checkbox>
                                    <Checkbox checked={selectedLayer.TwoSided} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TwoSided: e.target.checked })} style={{ color: '#e8e8e8' }}>双面的 (Two Sided)</Checkbox>
                                    <Checkbox checked={selectedLayer.SphereEnvMap} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { SphereEnvMap: e.target.checked })} style={{ color: '#e8e8e8' }}>球面环境贴图</Checkbox>
                                    <Checkbox checked={selectedLayer.NoDepthTest} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { NoDepthTest: e.target.checked })} style={{ color: '#e8e8e8' }}>无深度测试</Checkbox>
                                    <Checkbox checked={selectedLayer.NoDepthSet} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { NoDepthSet: e.target.checked })} style={{ color: '#e8e8e8' }}>无深度设置</Checkbox>
                                </div>
                            </Card>
                        </>
                    ) : selectedMaterial ? (
                        // Material Details
                        <>
                            <Text style={{ color: '#b0b0b0', marginBottom: '8px' }}>正在编辑: Material {selectedMaterialIndex}</Text>
                            <Card title={<span style={{ color: '#b0b0b0' }}>材质设置</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a' }} headStyle={{ borderBottom: '1px solid #4a4a4a' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div>
                                        <Text style={{ marginRight: '8px', color: '#b0b0b0' }}>优先平面 (Priority Plane):</Text>
                                        <InputNumber
                                            size="small"
                                            value={selectedMaterial.PriorityPlane || 0}
                                            onChange={(v) => updateLocalMaterial(selectedMaterialIndex, { PriorityPlane: v })}
                                            style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                    <Checkbox checked={selectedMaterial.ConstantColor} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { ConstantColor: e.target.checked })} style={{ color: '#e8e8e8' }}>固定颜色 (Constant Color)</Checkbox>
                                    <Checkbox checked={selectedMaterial.SortPrimsFarZ} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { SortPrimsFarZ: e.target.checked })} style={{ color: '#e8e8e8' }}>沿Z轴远向排列</Checkbox>
                                    <Checkbox checked={selectedMaterial.FullResolution} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { FullResolution: e.target.checked })} style={{ color: '#e8e8e8' }}>最大分辨率 (Full Resolution)</Checkbox>
                                </div>
                            </Card>
                            <div style={{ marginTop: '20px', color: '#808080', textAlign: 'center' }}>
                                请在左侧选择一个图层以编辑详细属性
                            </div>
                        </>
                    ) : (
                        <div style={{ marginTop: '20px', color: '#808080', textAlign: 'center' }}>
                            请在左侧选择一个材质
                        </div>
                    )}
                </div>
            </div>

            {isKeyframeEditorOpen && editingField && (
                <KeyframeEditor
                    visible={isKeyframeEditorOpen}
                    onCancel={() => setIsKeyframeEditorOpen(false)}
                    onOk={handleKeyframeSave}
                    initialData={selectedLayer ? selectedLayer[editingField] : null}
                    title={`编辑 ${editingField}`}
                    vectorSize={editingVectorSize}
                    globalSequences={(modelData as any)?.GlobalSequences || []}
                    fieldName={editingField || ''}
                />
            )}
        </DraggableModal>
    )
}

export default MaterialEditorModal
