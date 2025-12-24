import React, { useState, useEffect } from 'react'
import { List, Checkbox, Button, InputNumber, Select, ColorPicker, Card, Typography, message } from 'antd'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import KeyframeEditor from '../editors/KeyframeEditor'

const { Text } = Typography
const { Option } = Select

interface GeosetAnimationModalProps {
    visible: boolean
    onClose: () => void
}

const GeosetAnimationModal: React.FC<GeosetAnimationModalProps> = ({ visible, onClose }) => {
    const { modelData, updateGeosetAnim, setGeosetAnims } = useModelStore()
    const [localAnims, setLocalAnims] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [geosets, setGeosets] = useState<any[]>([])

    // Keyframe Editor State
    const [isKeyframeEditorOpen, setIsKeyframeEditorOpen] = useState(false)
    const [editingField, setEditingField] = useState<string | null>(null)
    const [editingVectorSize, setEditingVectorSize] = useState(1)

    // Initialize local state when modal opens
    useEffect(() => {
        if (visible && modelData) {
            // Deep clone GeosetAnims, converting Float32Array to regular arrays
            const clonedAnims = (modelData.GeosetAnims || []).map((anim: any) => {
                const cloned: any = { ...anim }
                // Convert Color Float32Array to regular array
                if (anim.Color instanceof Float32Array || ArrayBuffer.isView(anim.Color)) {
                    cloned.Color = Array.from(anim.Color as ArrayLike<number>)
                } else if (Array.isArray(anim.Color)) {
                    cloned.Color = [...anim.Color]
                } else if (anim.Color && typeof anim.Color === 'object') {
                    // Might be AnimVector (animated color)
                    cloned.Color = JSON.parse(JSON.stringify(anim.Color))
                }
                // Clone Alpha if it's an AnimVector
                if (anim.Alpha && typeof anim.Alpha === 'object' && 'Keys' in anim.Alpha) {
                    cloned.Alpha = JSON.parse(JSON.stringify(anim.Alpha))
                } else if (typeof anim.Alpha === 'string') {
                    cloned.Alpha = parseFloat(anim.Alpha)
                }
                return cloned
            })
            setLocalAnims(clonedAnims)
            setGeosets(modelData.Geosets || [])
            setSelectedIndex(modelData.GeosetAnims && modelData.GeosetAnims.length > 0 ? 0 : -1)
        }
    }, [visible, modelData])

    // Subscribe to Ctrl+Click geoset picking - auto-select matching geoset animation
    useEffect(() => {
        if (!visible) return
        let lastPickedIndex: number | null = null
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && localAnims.length > 0) {
                    // Find geoset animation that matches this geoset
                    const matchingIndex = localAnims.findIndex((anim: any) => anim.GeosetId === pickedGeosetIndex)
                    if (matchingIndex !== -1) {
                        setSelectedIndex(matchingIndex)
                        console.log('[GeosetAnimationEditor] Auto-selected animation', matchingIndex, 'for geoset', pickedGeosetIndex)
                    }
                }
            }
        })
        return unsubscribe
    }, [visible, localAnims])

    const handleOk = () => {
        const oldAnims = modelData?.GeosetAnims || [];
        useHistoryStore.getState().push({
            name: 'Edit Geoset Animations',
            undo: () => setGeosetAnims ? setGeosetAnims(oldAnims) : null,
            redo: () => setGeosetAnims ? setGeosetAnims(localAnims) : null
        });

        if (setGeosetAnims) {
            setGeosetAnims(localAnims)
        } else {
            localAnims.forEach((anim, index) => {
                updateGeosetAnim(index, anim)
            })
        }
        message.success('多边形动画已保存')
        onClose()
    }

    const handleCancel = () => {
        onClose()
    }

    const updateLocalAnim = (index: number, updates: any) => {
        const newAnims = [...localAnims]
        newAnims[index] = { ...newAnims[index], ...updates }
        setLocalAnims(newAnims)
    }

    const selectedAnim = selectedIndex >= 0 ? localAnims[selectedIndex] : null

    const handleColorChange = (color: any) => {
        if (selectedIndex < 0) return
        const rgb = color.toRgb()
        const newColor = [rgb.r / 255, rgb.g / 255, rgb.b / 255]
        updateLocalAnim(selectedIndex, { Color: newColor })
    }

    const handleAlphaChange = (val: number | null) => {
        if (selectedIndex < 0 || val === null) return
        updateLocalAnim(selectedIndex, { Alpha: Number(val) })
    }

    const handleGeosetChange = (val: number) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { GeosetId: val })
    }

    const handleUseColorChange = (e: any) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { UseColor: e.target.checked })
    }

    const handleDropShadowChange = (e: any) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { DropShadow: e.target.checked })
    }

    const handleDeleteAnim = (index: number) => {
        const newAnims = localAnims.filter((_, i) => i !== index)
        setLocalAnims(newAnims)
        if (selectedIndex === index) {
            setSelectedIndex(-1)
        } else if (selectedIndex > index) {
            setSelectedIndex(selectedIndex - 1)
        }
    }

    const isDynamic = (prop: any) => {
        return prop && typeof prop === 'object' && !Array.isArray(prop) && !(prop instanceof Float32Array) && 'Keys' in prop
    }

    const getColor = (anim: any) => {
        if (!anim || !anim.Color) return '#ffffff'
        const colorData = anim.Color
        if (colorData && colorData.length >= 3) {
            const arr = Array.isArray(colorData) ? colorData : Array.from(colorData as ArrayLike<number>)
            const r = arr[0] || 0
            const g = arr[1] || 0
            const b = arr[2] || 0
            return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
        }
        return '#ffffff'
    }

    const getAlpha = (anim: any) => {
        if (!anim) return 1
        if (typeof anim.Alpha === 'number') return anim.Alpha
        return 1
    }

    // Animation toggle handlers
    const handleColorAnimToggle = (checked: boolean) => {
        if (selectedIndex < 0) return
        const anim = localAnims[selectedIndex]

        if (checked) {
            // Convert static color to AnimVector
            const currentColor = anim.Color || [1, 1, 1]
            let colorArr = Array.isArray(currentColor) ? currentColor : [1, 1, 1]
            const animVector = {
                Keys: [{ Frame: 0, Vector: colorArr }],
                LineType: 1,
                GlobalSeqId: null
            }
            updateLocalAnim(selectedIndex, { Color: animVector })
        } else {
            // Convert AnimVector to static color
            const currentColor = anim.Color
            let staticColor = [1, 1, 1]
            if (currentColor && currentColor.Keys && currentColor.Keys.length > 0) {
                staticColor = currentColor.Keys[0].Vector || [1, 1, 1]
            }
            updateLocalAnim(selectedIndex, { Color: staticColor })
        }
    }

    const handleAlphaAnimToggle = (checked: boolean) => {
        if (selectedIndex < 0) return
        const anim = localAnims[selectedIndex]

        if (checked) {
            // Convert static alpha to AnimVector
            const currentAlpha = typeof anim.Alpha === 'number' ? anim.Alpha : 1
            const animVector = {
                Keys: [{ Frame: 0, Vector: [currentAlpha] }],
                LineType: 1,
                GlobalSeqId: null
            }
            updateLocalAnim(selectedIndex, { Alpha: animVector })
        } else {
            // Convert AnimVector to static alpha
            const currentAlpha = anim.Alpha
            let staticAlpha = 1
            if (currentAlpha && currentAlpha.Keys && currentAlpha.Keys.length > 0) {
                staticAlpha = currentAlpha.Keys[0].Vector[0] || 1
            }
            updateLocalAnim(selectedIndex, { Alpha: staticAlpha })
        }
    }

    // Open keyframe editor
    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)
        setIsKeyframeEditorOpen(true)
    }

    const handleKeyframeSave = (animVector: any) => {
        if (editingField && selectedIndex >= 0) {
            updateLocalAnim(selectedIndex, { [editingField]: animVector })
        }
        setIsKeyframeEditorOpen(false)
    }

    const globalSequences = (modelData as any)?.GlobalSequences || []

    return (
        <>
            <DraggableModal
                title="多边形动画管理器"
                open={visible}
                onOk={handleOk}
                onCancel={handleCancel}
                width={900}
                okText="确定"
                cancelText="取消"
                maskClosable={false}
                wrapClassName="dark-theme-modal"
                styles={{
                    content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                    header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                    body: { backgroundColor: '#2d2d2d' },
                    footer: { borderTop: '1px solid #4a4a4a' }
                }}
            >
                <div style={{ display: 'flex', height: '450px', border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
                    {/* List (Left) */}
                    <div style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                        <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                block
                                onClick={() => {
                                    const newAnim = { GeosetId: 0, Alpha: 1, Color: [1, 1, 1], Flags: 0 }
                                    setLocalAnims([...localAnims, newAnim])
                                    setSelectedIndex(localAnims.length)
                                }}
                                style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                            >
                                添加
                            </Button>
                        </div>
                        <List
                            dataSource={localAnims}
                            renderItem={(_item, index) => (
                                <List.Item
                                    onClick={() => setSelectedIndex(index)}
                                    style={{
                                        cursor: 'pointer',
                                        padding: '8px 12px',
                                        backgroundColor: selectedIndex === index ? '#5a9cff' : 'transparent',
                                        color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                        transition: 'background 0.2s',
                                        borderBottom: '1px solid #3a3a3a'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                        <span>GeosetAnim {index}</span>
                                        <Button
                                            type="text"
                                            danger
                                            size="small"
                                            icon={<DeleteOutlined />}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleDeleteAnim(index)
                                            }}
                                            style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f' }}
                                        />
                                    </div>
                                </List.Item>
                            )}
                        />
                    </div>

                    {/* Details (Right) */}
                    <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525' }}>
                        {selectedAnim ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    {/* Color Section */}
                                    <Card
                                        title={<span style={{ color: '#e8e8e8' }}>颜色</span>}
                                        size="small"
                                        bordered={false}
                                        style={{ flex: 1, background: '#333333', border: '1px solid #4a4a4a' }}
                                        styles={{ header: { borderBottom: '1px solid #4a4a4a', color: '#e8e8e8' } }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                            <Checkbox
                                                checked={isDynamic(selectedAnim.Color)}
                                                onChange={(e) => handleColorAnimToggle(e.target.checked)}
                                                style={{ color: '#e8e8e8' }}
                                            >
                                                <span style={{ color: '#e8e8e8' }}>动态化</span>
                                            </Checkbox>
                                            {isDynamic(selectedAnim.Color) && (
                                                <Button
                                                    type="link"
                                                    icon={<EditOutlined />}
                                                    onClick={() => openKeyframeEditor('Color', 3)}
                                                    style={{ color: '#5a9cff' }}
                                                >
                                                    编辑关键帧
                                                </Button>
                                            )}
                                        </div>
                                        {!isDynamic(selectedAnim.Color) && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ color: '#b0b0b0', fontSize: '12px' }}>颜色:</span>
                                                <ColorPicker
                                                    value={getColor(selectedAnim)}
                                                    onChange={handleColorChange}
                                                />
                                            </div>
                                        )}
                                    </Card>

                                    {/* Alpha Section */}
                                    <Card
                                        title={<span style={{ color: '#e8e8e8' }}>透明度</span>}
                                        size="small"
                                        bordered={false}
                                        style={{ flex: 1, background: '#333333', border: '1px solid #4a4a4a' }}
                                        styles={{ header: { borderBottom: '1px solid #4a4a4a', color: '#e8e8e8' } }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                            <Checkbox
                                                checked={isDynamic(selectedAnim.Alpha)}
                                                onChange={(e) => handleAlphaAnimToggle(e.target.checked)}
                                                style={{ color: '#e8e8e8' }}
                                            >
                                                <span style={{ color: '#e8e8e8' }}>动态化</span>
                                            </Checkbox>
                                            {isDynamic(selectedAnim.Alpha) && (
                                                <Button
                                                    type="link"
                                                    icon={<EditOutlined />}
                                                    onClick={() => openKeyframeEditor('Alpha', 1)}
                                                    style={{ color: '#5a9cff' }}
                                                >
                                                    编辑关键帧
                                                </Button>
                                            )}
                                        </div>
                                        {!isDynamic(selectedAnim.Alpha) && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ color: '#b0b0b0', fontSize: '12px' }}>透明度:</span>
                                                <InputNumber
                                                    value={getAlpha(selectedAnim)}
                                                    onChange={handleAlphaChange}
                                                    step={0.1}
                                                    min={0}
                                                    max={1}
                                                    style={{ width: '80px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                                />
                                            </div>
                                        )}
                                    </Card>
                                </div>

                                {/* Other Section */}
                                <Card
                                    title={<span style={{ color: '#e8e8e8' }}>其他设置</span>}
                                    size="small"
                                    bordered={false}
                                    style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                    styles={{ header: { borderBottom: '1px solid #4a4a4a', color: '#e8e8e8' } }}
                                >
                                    <div style={{ marginBottom: '16px' }}>
                                        <Text style={{ display: 'block', marginBottom: '8px', color: '#b0b0b0' }}>多边形 ID:</Text>
                                        <Select
                                            style={{ width: '100%' }}
                                            value={selectedAnim.GeosetId}
                                            onChange={handleGeosetChange}
                                            popupClassName="dark-theme-select-dropdown"
                                        >
                                            {geosets.map((_, idx) => (
                                                <Option key={idx} value={idx}>
                                                    Geoset {idx}
                                                </Option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <Checkbox
                                            checked={selectedAnim.UseColor === undefined ? true : selectedAnim.UseColor}
                                            onChange={handleUseColorChange}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            <span style={{ color: '#e8e8e8' }}>使用颜色 (Use Color)</span>
                                        </Checkbox>
                                        <Checkbox
                                            checked={selectedAnim.DropShadow}
                                            onChange={handleDropShadowChange}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            <span style={{ color: '#e8e8e8' }}>阴影效果 (Drop Shadow)</span>
                                        </Checkbox>
                                    </div>
                                </Card>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                                请从左侧列表选择一个多边形动画
                            </div>
                        )}
                    </div>
                </div>
            </DraggableModal>

            {/* Keyframe Editor */}
            <KeyframeEditor
                visible={isKeyframeEditorOpen}
                onCancel={() => setIsKeyframeEditorOpen(false)}
                onOk={handleKeyframeSave}
                initialData={editingField && selectedAnim ? selectedAnim[editingField] : null}
                title={editingField === 'Color' ? '颜色关键帧编辑器' : '透明度关键帧编辑器'}
                vectorSize={editingVectorSize}
                globalSequences={globalSequences}
            />
        </>
    )
}

export default GeosetAnimationModal
