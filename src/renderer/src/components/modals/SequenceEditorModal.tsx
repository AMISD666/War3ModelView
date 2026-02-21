import React, { useState, useEffect, useRef } from 'react'
import { List, Button, Input, Checkbox, Card, Typography, message } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'
import { pruneModelKeyframes } from '../../utils/modelUtils'

const { Text } = Typography

interface SequenceEditorModalProps {
    visible: boolean
    onClose: () => void
}

const SequenceEditorModal: React.FC<SequenceEditorModalProps> = ({ visible, onClose }) => {
    const {
        sequences: storeSequences,
        setSequences: setStoreSequences,
        currentSequence,
        setSequence,
        setPlaying
    } = useModelStore()
    const [localSequences, setLocalSequences] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [pruneKeyframes, setPruneKeyframes] = useState(true)
    const [deletedIntervals, setDeletedIntervals] = useState<[number, number][]>([])
    const listRef = useRef<HTMLDivElement>(null)
    const initializedRef = useRef(false)

    // Helper to scroll to selected item
    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 45 // Approximate height of list item
            listRef.current.scrollTop = index * itemHeight
        }
    }

    const getNextInterval = (sequences: any[]) => {
        const maxEnd = sequences.reduce((max, seq) => {
            const end = Array.isArray(seq.Interval) ? seq.Interval[1] : seq.Interval?.[1]
            return Math.max(max, typeof end === 'number' ? end : 0)
        }, 0)
        const start = maxEnd + 1000
        return [start, start + 2333]
    }

    // Deep clone that properly handles TypedArrays (converts to plain arrays)
    const deepCloneSequences = (sequences: any[]): any[] => {
        return sequences.map(seq => {
            const cloned: any = {}
            for (const key in seq) {
                const value = seq[key]
                if (ArrayBuffer.isView(value)) {
                    // Convert TypedArray to plain array
                    cloned[key] = Array.from(value as any)
                } else if (Array.isArray(value)) {
                    cloned[key] = [...value]
                } else if (value && typeof value === 'object') {
                    cloned[key] = { ...value }
                } else {
                    cloned[key] = value
                }
            }
            return cloned
        })
    }

    // Initialize local state and sync with currentSequence
    useEffect(() => {
        if (!visible) {
            initializedRef.current = false
            setLocalSequences([])
            setSelectedIndex(-1)
            setDeletedIntervals([])
            return
        }
        if (visible && storeSequences && !initializedRef.current) {
            setLocalSequences(deepCloneSequences(storeSequences))
            // Sync with currentSequence from store on first open only.
            if (currentSequence >= 0 && currentSequence < storeSequences.length) {
                setSelectedIndex(currentSequence)
                setTimeout(() => scrollToItem(currentSequence), 0)
            } else {
                setSelectedIndex(storeSequences.length > 0 ? 0 : -1)
            }
            initializedRef.current = true
        }
    }, [visible, storeSequences, currentSequence])

    // Handle selecting a sequence - sync with store and play
    const handleSelectSequence = (index: number) => {
        setSelectedIndex(index)
        // Also update store and play animation
        const seq = storeSequences[index]
        if (seq && seq.Interval && seq.Interval.length >= 2) {
            setSequence(index)
            window.dispatchEvent(new Event('timeline-fit-current-sequence'))
            setPlaying(true)
        }
    }

    const handleOk = () => {
        const { modelData } = useModelStore.getState();
        if (pruneKeyframes && deletedIntervals.length > 0 && modelData) {
            deletedIntervals.forEach(([start, end]) => {
                pruneModelKeyframes(modelData, start, end);
            });
            console.log(`[SequenceEditorModal] Pruned ${deletedIntervals.length} animation ranges`);
        }
        setStoreSequences(localSequences)
        message.success(pruneKeyframes && deletedIntervals.length > 0 ? '序列及关键帧已保存' : '序列已保存')
        onClose()
    }

    const updateLocalSequence = (index: number, updates: any) => {
        const newSequences = [...localSequences]
        newSequences[index] = { ...newSequences[index], ...updates }
        setLocalSequences(newSequences)
    }

    const handleIntervalChange = (index: number, subIndex: number, value: number | null) => {
        const newSequences = [...localSequences]
        const newInterval = [...newSequences[index].Interval]
        newInterval[subIndex] = value || 0
        newSequences[index].Interval = newInterval
        setLocalSequences(newSequences)
    }

    const selectedSequence = selectedIndex >= 0 ? localSequences[selectedIndex] : null

    return (
        <DraggableModal
            title="序列编辑器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={950}
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
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Checkbox
                        checked={pruneKeyframes}
                        onChange={(e) => setPruneKeyframes(e.target.checked)}
                        style={{ color: '#aaa' }}
                    >
                        动画关键帧
                    </Checkbox>
                    <div>
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" onClick={handleOk} style={{ marginLeft: 8 }}>确定</Button>
                    </div>
                </div>
            }
        >
            <div style={{ display: 'flex', height: '500px', border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
                {/* List (Left) */}
                <div ref={listRef} style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            block
                            onClick={() => {
                                const [start, end] = getNextInterval(localSequences)
                                const newSequence = {
                                    Name: 'NewSequence',
                                    Interval: [start, end],
                                    NonLooping: 0,
                                    Rarity: 0,
                                    MoveSpeed: 0,
                                    BoundsRadius: 0
                                }
                                setLocalSequences([...localSequences, newSequence])
                                setSelectedIndex(localSequences.length)
                                setTimeout(() => scrollToItem(localSequences.length), 0)
                            }}
                            style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                        >
                            添加
                        </Button>
                    </div>
                    <List
                        dataSource={localSequences}
                        renderItem={(item, index) => (
                            <List.Item
                                onClick={() => handleSelectSequence(index)}
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                                        {item.Name || `Sequence ${index}`}
                                    </div>
                                    <DeleteOutlined
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            const seq = localSequences[index];
                                            if (seq && seq.Interval) {
                                                setDeletedIntervals(prev => [...prev, [seq.Interval[0], seq.Interval[1]]]);
                                            }
                                            const newSequences = localSequences.filter((_, i) => i !== index)
                                            setLocalSequences(newSequences)
                                            if (selectedIndex === index) setSelectedIndex(-1)
                                            else if (selectedIndex > index) setSelectedIndex(selectedIndex - 1)
                                        }}
                                        style={{ color: '#ff4d4f' }}
                                    />
                                </div>
                            </List.Item>
                        )}
                    />
                </div>

                {/* Details (Right) */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedSequence ? (
                        <>
                            <Card
                                title={<span style={{ color: '#b0b0b0' }}>基本信息</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>名称:</Text>
                                        <Input
                                            value={selectedSequence.Name}
                                            onChange={(e) => updateLocalSequence(selectedIndex, { Name: e.target.value })}
                                            style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>开始帧:</Text>
                                            <InputNumber
                                                value={selectedSequence.Interval[0]}
                                                onChange={(v) => handleIntervalChange(selectedIndex, 0, v)}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>结束帧:</Text>
                                            <InputNumber
                                                value={selectedSequence.Interval[1]}
                                                onChange={(v) => handleIntervalChange(selectedIndex, 1, v)}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                        </div>
                                    </div>
                                    <Checkbox
                                        checked={!!selectedSequence.NonLooping}
                                        onChange={(e) => updateLocalSequence(selectedIndex, { NonLooping: e.target.checked ? 1 : 0 })}
                                        style={{ color: '#e8e8e8' }}
                                    >
                                        不循环 (NonLooping)
                                    </Checkbox>
                                </div>
                            </Card>

                            <Card
                                title={<span style={{ color: '#b0b0b0' }}>高级属性</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>稀有度 (Rarity):</Text>
                                            <InputNumber
                                                value={selectedSequence.Rarity}
                                                onChange={(v) => updateLocalSequence(selectedIndex, { Rarity: v })}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>移动速度 (MoveSpeed):</Text>
                                            <InputNumber
                                                value={selectedSequence.MoveSpeed}
                                                onChange={(v) => updateLocalSequence(selectedIndex, { MoveSpeed: v })}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>边界半径 (BoundsRadius):</Text>
                                        <InputNumber
                                            value={selectedSequence.BoundsRadius}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { BoundsRadius: v })}
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                </div>
                            </Card>
                        </>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                            请从左侧列表选择一个序列
                        </div>
                    )}
                </div>
            </div>
        </DraggableModal>
    )
}

export default SequenceEditorModal

