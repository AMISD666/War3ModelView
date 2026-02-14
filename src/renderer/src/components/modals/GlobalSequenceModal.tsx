import React, { useState, useEffect, useRef } from 'react'
import { List, Button, InputNumber, Typography, message } from 'antd'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

const { Text } = Typography

interface GlobalSequenceModalProps {
    visible: boolean
    onClose: () => void
    asWindow?: boolean
}

const GlobalSequenceModal: React.FC<GlobalSequenceModalProps> = ({ visible, onClose, asWindow = false }) => {
    const modelData = useModelStore((state) => state.modelData)
    const setModelData = useModelStore((state) => state.setModelData)
    const modelPath = useModelStore((state) => state.modelPath)
    const [localSequences, setLocalSequences] = useState<number[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const suppressNextLiveApplyRef = useRef(false)
    const lastAppliedSignatureRef = useRef('')

    const getSignature = (sequences: number[]) => {
        try {
            return JSON.stringify(sequences)
        } catch {
            return `${sequences.length}`
        }
    }

    useEffect(() => {
        if (visible && modelData) {
            const sequences = (modelData as any).GlobalSequences || []
            suppressNextLiveApplyRef.current = true
            lastAppliedSignatureRef.current = getSignature(sequences)
            setLocalSequences([...sequences])
            setSelectedIndex(sequences.length > 0 ? 0 : -1)
        }
    }, [visible, modelData])

    useEffect(() => {
        if (!visible || !asWindow || !modelData) return
        if (suppressNextLiveApplyRef.current) {
            suppressNextLiveApplyRef.current = false
            return
        }

        const signature = getSignature(localSequences)
        if (signature === lastAppliedSignatureRef.current) return
        lastAppliedSignatureRef.current = signature

        const updatedModelData = { ...modelData, GlobalSequences: localSequences }
        setModelData(updatedModelData as any, modelPath)
    }, [visible, asWindow, localSequences, modelData, setModelData, modelPath])

    const handleOk = () => {
        if (setModelData && modelData) {
            const updatedModelData = { ...modelData, GlobalSequences: localSequences }
            setModelData(updatedModelData as any, modelPath)
        }
        message.success('Global sequences saved')
        onClose()
    }

    const handleAddSequence = () => {
        const newSequences = [...localSequences, 1000]
        setLocalSequences(newSequences)
        setSelectedIndex(newSequences.length - 1)
    }

    const handleDeleteSequence = (index: number) => {
        const newSequences = localSequences.filter((_, i) => i !== index)
        setLocalSequences(newSequences)
        if (selectedIndex === index) {
            setSelectedIndex(-1)
        } else if (selectedIndex > index) {
            setSelectedIndex(selectedIndex - 1)
        }
    }

    const handleDurationChange = (val: number | null) => {
        if (selectedIndex < 0 || val === null) return
        const newSequences = [...localSequences]
        newSequences[selectedIndex] = val
        setLocalSequences(newSequences)
    }

    const selectedDuration = selectedIndex >= 0 ? localSequences[selectedIndex] : null

    const renderEditorContent = (contentHeight: string | number = '350px') => (
        <div style={{ display: 'flex', height: contentHeight, border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
            <div style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        block
                        onClick={handleAddSequence}
                        style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                    >
                        添加
                    </Button>
                </div>
                <List
                    dataSource={localSequences}
                    renderItem={(duration, index) => (
                        <List.Item
                            onClick={() => setSelectedIndex(index)}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 12px',
                                backgroundColor: selectedIndex === index ? '#1677ff' : 'transparent',
                                color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                borderBottom: '1px solid #3a3a3a',
                                minHeight: '36px'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ fontSize: '11px', opacity: 0.5, minWidth: '30px' }}>ID: {index}</span>
                                    <span style={{ fontSize: '13px' }}>{duration}ms</span>
                                </div>
                                <Button
                                    type="text"
                                    danger
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteSequence(index)
                                    }}
                                    style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f', fontSize: '12px' }}
                                />
                            </div>
                        </List.Item>
                    )}
                />
            </div>

            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', backgroundColor: '#252525' }}>
                {selectedDuration !== null ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <Card
                            title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>时长设置</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            styles={{ header: { padding: '4px 12px', minHeight: 0, borderBottom: '1px solid #4a4a4a' }, body: { padding: '12px' } }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <Text style={{ color: '#b0b0b0', fontSize: '12px' }}>时长 (ms):</Text>
                                <InputNumber
                                    size="small"
                                    value={selectedDuration}
                                    onChange={handleDurationChange}
                                    min={0}
                                    style={{ width: '120px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                />
                            </div>
                            <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px', border: '1px solid #444' }}>
                                <Text style={{ color: '#888', fontSize: '11px' }}>
                                    ID {selectedIndex}: 控制同步属性的共享动画定时器。
                                </Text>
                            </div>
                        </Card>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                        请从列表中选择一个全局序列
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
            title="全局序列管理器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={700}
            okText="保存"
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
            {renderEditorContent()}
        </DraggableModal>
    )
}

export default GlobalSequenceModal
