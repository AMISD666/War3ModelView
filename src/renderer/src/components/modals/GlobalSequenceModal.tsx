import React, { useState, useEffect, useRef } from 'react'
import { List, Button, InputNumber, Typography, message, Card } from 'antd'
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', padding: '4px' }}>
                    {localSequences.map((duration, index) => (
                        <div
                            key={index}
                            onClick={() => setSelectedIndex(index)}
                            style={{
                                cursor: 'pointer',
                                padding: '4px 4px',
                                backgroundColor: selectedIndex === index ? '#1677ff' : '#2a2a2a',
                                color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                border: '1px solid #3a3a3a',
                                borderRadius: '2px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                minHeight: '24px',
                                fontSize: '11px',
                                overflow: 'hidden'
                            }}
                        >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>GSeq {index}</span>
                            <DeleteOutlined
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteSequence(index)
                                }}
                                style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f', fontSize: '10px' }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, padding: '8px', overflowY: 'auto', backgroundColor: '#252525' }}>
                {selectedDuration !== null ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Card
                            title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>时长设置</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            styles={{ header: { padding: '4px 8px', minHeight: '32px', borderBottom: '1px solid #4a4a4a' }, body: { padding: '8px' } }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Text style={{ color: '#b0b0b0', fontSize: '12px' }}>时长 (ms):</Text>
                                <InputNumber
                                    size="small"
                                    value={selectedDuration}
                                    onChange={handleDurationChange}
                                    min={0}
                                    style={{ width: '80px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
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
            <div style={{ height: '100vh', padding: 8, backgroundColor: '#1f1f1f', overflow: 'hidden' }}>
                {renderEditorContent('calc(100vh - 16px)')}
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
