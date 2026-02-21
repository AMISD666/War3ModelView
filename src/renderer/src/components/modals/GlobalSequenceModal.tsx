import React, { useState, useEffect } from 'react'
import { List, Button, Typography, message } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

const { Text } = Typography

interface GlobalSequenceModalProps {
    visible: boolean
    onClose: () => void
}

const GlobalSequenceModal: React.FC<GlobalSequenceModalProps> = ({ visible, onClose }) => {
    const modelData = useModelStore(state => state.modelData)
    const setModelData = useModelStore(state => state.setModelData)
    const modelPath = useModelStore(state => state.modelPath)
    const [localSequences, setLocalSequences] = useState<number[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)

    // Initialize local state when modal opens
    useEffect(() => {
        if (visible && modelData) {
            const sequences = (modelData as any).GlobalSequences || []
            setLocalSequences([...sequences])
            setSelectedIndex(sequences.length > 0 ? 0 : -1)
        }
    }, [visible, modelData])

    const handleOk = () => {
        if (setModelData && modelData) {
            const updatedModelData = { ...modelData, GlobalSequences: localSequences }
            setModelData(updatedModelData as any, modelPath)
        }
        message.success('全局序列已保存')
        onClose()
    }

    const handleCancel = () => {
        onClose()
    }

    const handleAddSequence = () => {
        const newSequences = [...localSequences, 1000] // Default duration: 1000ms
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

    return (
        <DraggableModal
            title="全局序列管理器"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            width={700}
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
            <div style={{ display: 'flex', height: '350px', border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
                {/* List (Left) */}
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
                                    padding: '8px 12px',
                                    backgroundColor: selectedIndex === index ? '#5a9cff' : 'transparent',
                                    color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                    transition: 'background 0.2s',
                                    borderBottom: '1px solid #3a3a3a'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <span>GlobalSeq {index}</span>
                                    <span style={{ fontSize: '11px', opacity: 0.7 }}>{duration}ms</span>
                                    <Button
                                        type="text"
                                        danger
                                        size="small"
                                        icon={<DeleteOutlined />}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDeleteSequence(index)
                                        }}
                                        style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f' }}
                                    />
                                </div>
                            </List.Item>
                        )}
                    />
                </div>

                {/* Details (Right) */}
                <div style={{ flex: 1, padding: '24px', overflowY: 'auto', backgroundColor: '#252525' }}>
                    {selectedDuration !== null ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div>
                                <Text style={{ display: 'block', marginBottom: '12px', color: '#e8e8e8', fontSize: '14px' }}>
                                    全局序列 ID: {selectedIndex}
                                </Text>
                            </div>
                            <div>
                                <Text style={{ display: 'block', marginBottom: '8px', color: '#b0b0b0' }}>
                                    持续时间 (Duration in ms):
                                </Text>
                                <InputNumber
                                    value={selectedDuration}
                                    onChange={handleDurationChange}
                                    min={0}
                                    style={{ width: '150px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                />
                            </div>
                            <div style={{ padding: '16px', backgroundColor: '#333333', borderRadius: '4px', border: '1px solid #4a4a4a' }}>
                                <Text style={{ color: '#808080', fontSize: '12px' }}>
                                    全局序列
                                </Text>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                            请从左侧列表选择一个全局序列
                        </div>
                    )}
                </div>
            </div>
        </DraggableModal>
    )
}

export default GlobalSequenceModal

