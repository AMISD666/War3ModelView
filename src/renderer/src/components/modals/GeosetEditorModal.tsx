import React, { useState, useEffect } from 'react'
import { List, Button, InputNumber, Select, Card, Typography, message } from 'antd'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography


interface GeosetEditorModalProps {
    visible: boolean
    onClose: () => void
}

const GeosetEditorModal: React.FC<GeosetEditorModalProps> = ({ visible, onClose }) => {
    const { modelData, setGeosets } = useModelStore()
    const [localGeosets, setLocalGeosets] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [_hasChanges, setHasChanges] = useState(false)

    // Initialize local state when modal opens
    useEffect(() => {
        if (visible && modelData && modelData.Geosets) {
            setLocalGeosets(JSON.parse(JSON.stringify(modelData.Geosets)))
            // Use persistent selection from store if available, otherwise default to first
            const { selectedGeosetIndex } = useModelStore.getState()
            if (selectedGeosetIndex !== null && selectedGeosetIndex >= 0 && selectedGeosetIndex < modelData.Geosets.length) {
                setSelectedIndex(selectedGeosetIndex)
            } else {
                setSelectedIndex(modelData.Geosets.length > 0 ? 0 : -1)
            }
            setHasChanges(false)
        }
    }, [visible, modelData])

    // Subscribe to Ctrl+Click geoset picking - auto-select geoset
    useEffect(() => {
        if (!visible) return

        // Read initial value immediately when modal opens
        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        if (initialPickedIndex !== null && initialPickedIndex >= 0 && initialPickedIndex < localGeosets.length) {
            setSelectedIndex(initialPickedIndex)
            console.log('[GeosetEditor] Initial auto-selected geoset', initialPickedIndex)
        }

        // Subscribe to future changes
        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && pickedGeosetIndex >= 0 && pickedGeosetIndex < localGeosets.length) {
                    setSelectedIndex(pickedGeosetIndex)
                    console.log('[GeosetEditor] Auto-selected geoset', pickedGeosetIndex)
                }
            }
        })
        return unsubscribe
    }, [visible, localGeosets.length])

    const handleOk = () => {
        if (setGeosets) {
            setGeosets(localGeosets)
            message.success('多边形设置已保存')
            setHasChanges(false)
        }
        onClose()
    }

    const handleCancel = () => {
        onClose()
    }

    const updateLocalGeoset = (index: number, updates: any) => {
        const newGeosets = [...localGeosets]
        newGeosets[index] = { ...newGeosets[index], ...updates }
        setLocalGeosets(newGeosets)
        setHasChanges(true)
    }

    const selectedGeoset = selectedIndex >= 0 ? localGeosets[selectedIndex] : null

    return (
        <DraggableModal
            title="多边形编辑器 (Geoset Editor)"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            width={850}
            okText="确定"
            cancelText="取消"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: {
                    backgroundColor: '#333333',
                    border: '1px solid #4a4a4a',
                },
                header: {
                    backgroundColor: '#333333',
                    borderBottom: '1px solid #4a4a4a',
                },
                body: {
                    backgroundColor: '#2d2d2d',
                },
                footer: {
                    borderTop: '1px solid #4a4a4a',
                }
            }}
        >
            <div style={{ display: 'flex', height: '400px', border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
                {/* List (Left) */}
                <div style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a', color: '#b0b0b0', fontSize: '12px' }}>
                        多边形列表
                    </div>
                    <List
                        dataSource={localGeosets}
                        renderItem={(item, index) => (
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
                                className="hover:bg-[#454545]"
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                                    <span style={{ fontWeight: 'bold' }}>Geoset {index}</span>
                                    <span style={{ fontSize: '10px', opacity: 0.7 }}>
                                        {item.Vertices ? item.Vertices.length / 3 : 0}v / {item.Faces ? item.Faces.length / 3 : 0}f
                                    </span>
                                </div>
                            </List.Item>
                        )}
                    />
                </div>

                {/* Details (Right) */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525' }}>
                    {selectedGeoset ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card
                                title={<span style={{ color: '#b0b0b0' }}>多边形属性</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>材质 ID (Material ID):</Text>
                                        <Select
                                            style={{ width: '100%' }}
                                            value={selectedGeoset.MaterialID}
                                            onChange={(v) => updateLocalGeoset(selectedIndex, { MaterialID: v })}
                                            popupClassName="dark-theme-select-dropdown"
                                            options={(modelData as any)?.Materials?.map((_m: any, i: number) => ({
                                                value: i,
                                                label: `Material ${i}`
                                            })) || []}
                                        />
                                    </div>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>选择组 (Selection Group):</Text>
                                        <InputNumber
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            value={selectedGeoset.SelectionGroup}
                                            onChange={(v) => updateLocalGeoset(selectedIndex, { SelectionGroup: v })}
                                        />
                                    </div>
                                </div>
                            </Card>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={() => {
                                        if (modelData && modelData.Geosets) {
                                            setLocalGeosets(JSON.parse(JSON.stringify(modelData.Geosets)))
                                            setHasChanges(false)
                                            message.info('已重置更改')
                                        }
                                    }}
                                >
                                    重置
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                            请从左侧列表选择一个多边形
                        </div>
                    )}
                </div>
            </div>
        </DraggableModal>
    )
}

export default GeosetEditorModal
