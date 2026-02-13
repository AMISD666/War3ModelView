import React, { useState, useEffect, useRef } from 'react'
import { List, Button, InputNumber, Select, Card, Typography, message } from 'antd'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography

interface GeosetEditorModalProps {
    visible: boolean
    onClose: () => void
    asWindow?: boolean
}

const GeosetEditorModal: React.FC<GeosetEditorModalProps> = ({ visible, onClose, asWindow = false }) => {
    const { modelData, setGeosets } = useModelStore()
    const [localGeosets, setLocalGeosets] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [_hasChanges, setHasChanges] = useState(false)
    const listRef = useRef<HTMLDivElement>(null)
    const suppressNextLiveApplyRef = useRef(false)
    const lastAppliedSignatureRef = useRef('')

    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 50
            listRef.current.scrollTop = index * itemHeight
        }
    }

    const getSignature = (geosets: any[]) => {
        try {
            return JSON.stringify(geosets)
        } catch {
            return `${geosets.length}`
        }
    }

    useEffect(() => {
        if (visible && modelData && modelData.Geosets) {
            const cloned = JSON.parse(JSON.stringify(modelData.Geosets))
            suppressNextLiveApplyRef.current = true
            lastAppliedSignatureRef.current = getSignature(cloned)
            setLocalGeosets(cloned)

            const { selectedGeosetIndex } = useModelStore.getState()
            if (selectedGeosetIndex !== null && selectedGeosetIndex >= 0 && selectedGeosetIndex < modelData.Geosets.length) {
                setSelectedIndex(selectedGeosetIndex)
            } else {
                setSelectedIndex(modelData.Geosets.length > 0 ? 0 : -1)
            }
            setHasChanges(false)
        }
    }, [visible, modelData])

    useEffect(() => {
        if (!visible || !asWindow || !setGeosets) return
        if (suppressNextLiveApplyRef.current) {
            suppressNextLiveApplyRef.current = false
            return
        }

        const signature = getSignature(localGeosets)
        if (signature === lastAppliedSignatureRef.current) return
        lastAppliedSignatureRef.current = signature
        setGeosets(localGeosets)
    }, [asWindow, visible, localGeosets, setGeosets])

    useEffect(() => {
        if (!visible) return

        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        if (initialPickedIndex !== null && initialPickedIndex >= 0 && initialPickedIndex < localGeosets.length) {
            setSelectedIndex(initialPickedIndex)
            scrollToItem(initialPickedIndex)
        }

        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && pickedGeosetIndex >= 0 && pickedGeosetIndex < localGeosets.length) {
                    setSelectedIndex(pickedGeosetIndex)
                    scrollToItem(pickedGeosetIndex)
                }
            }
        })
        return unsubscribe
    }, [visible, localGeosets.length])

    const handleOk = () => {
        if (setGeosets) {
            setGeosets(localGeosets)
            message.success('Geoset changes saved')
            setHasChanges(false)
        }
        onClose()
    }

    const updateLocalGeoset = (index: number, updates: any) => {
        const newGeosets = [...localGeosets]
        newGeosets[index] = { ...newGeosets[index], ...updates }
        setLocalGeosets(newGeosets)
        setHasChanges(true)
    }

    const selectedGeoset = selectedIndex >= 0 ? localGeosets[selectedIndex] : null

    const renderEditorContent = (contentHeight: string | number = '400px') => (
        <div style={{ display: 'flex', height: contentHeight, border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
            <div ref={listRef} style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a', color: '#b0b0b0', fontSize: '12px' }}>
                    Geoset List
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

            <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525' }}>
                {selectedGeoset ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <Card
                            title={<span style={{ color: '#b0b0b0' }}>Geoset Properties</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>Material ID:</Text>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={selectedGeoset.MaterialID}
                                        onChange={(v) => {
                                            const materialCount = (modelData as any)?.Materials?.length || 0
                                            const raw = typeof v === 'number' ? v : Number(v)
                                            const safe = Number.isFinite(raw) ? Math.floor(raw) : 0
                                            const clamped = materialCount > 0 ? Math.min(Math.max(0, safe), materialCount - 1) : 0
                                            updateLocalGeoset(selectedIndex, { MaterialID: clamped })
                                        }}
                                        popupClassName="dark-theme-select-dropdown"
                                        options={(modelData as any)?.Materials?.map((_m: any, i: number) => ({
                                            value: i,
                                            label: `Material ${i}`
                                        })) || []}
                                    />
                                </div>
                                <div>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>Selection Group:</Text>
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
                                        const cloned = JSON.parse(JSON.stringify(modelData.Geosets))
                                        suppressNextLiveApplyRef.current = true
                                        lastAppliedSignatureRef.current = getSignature(cloned)
                                        setLocalGeosets(cloned)
                                        setHasChanges(false)
                                        message.info('Changes reset')
                                    }
                                }}
                            >
                                Reset
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                        Select a geoset from the list
                    </div>
                )}
            </div>
        </div>
    )

    if (asWindow) {
        if (!visible) return null
        return (
            <div style={{ height: '100vh', padding: 12, backgroundColor: '#1f1f1f', overflow: 'hidden' }}>
                {renderEditorContent('calc(100vh - 24px)')}
            </div>
        )
    }

    return (
        <DraggableModal
            title="Geoset Editor"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={850}
            okText="Confirm"
            cancelText="Cancel"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d' },
                footer: { borderTop: '1px solid #4a4a4a' }
            }}
        >
            {renderEditorContent()}
        </DraggableModal>
    )
}

export default GeosetEditorModal
