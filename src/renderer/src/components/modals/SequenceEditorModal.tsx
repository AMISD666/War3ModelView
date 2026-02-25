import React, { useState, useEffect, useRef } from 'react'
import { List, Button, Input, Checkbox, Card, Typography, message } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal';
import { PlusOutlined, DeleteOutlined, CloseOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'
import { pruneModelKeyframes } from '../../utils/modelUtils'
import { useRpcClient } from '../../hooks/useRpc'

const { Text } = Typography

interface SequenceEditorModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

const SequenceEditorModal: React.FC<SequenceEditorModalProps> = ({ visible, onClose, isStandalone }) => {
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
    const { state: rpcState, emitCommand } = useRpcClient<any>('sequenceManager', {
        sequences: []
    })

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
    // Also handles IPC-serialized TypedArrays that come as {"0":x, "1":y} objects
    const deepCloneSequences = (sequences: any[]): any[] => {
        return sequences.map(seq => {
            const cloned: any = {}
            for (const key in seq) {
                const value = seq[key]
                if (ArrayBuffer.isView(value)) {
                    // Convert TypedArray (e.g., Uint32Array) to plain array
                    cloned[key] = Array.from(value as any)
                } else if (Array.isArray(value)) {
                    cloned[key] = [...value]
                } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                    // IPC serializes Uint32Array as {"0":x, "1":y} - detect and convert
                    const keys = Object.keys(value)
                    const isNumericKeyed = keys.length > 0 && keys.every(k => !isNaN(Number(k)))
                    if (isNumericKeyed) {
                        cloned[key] = keys.sort((a, b) => Number(a) - Number(b)).map(k => value[k])
                    } else {
                        cloned[key] = { ...value }
                    }
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

        if (isStandalone) {
            // Standalone mode: only initialize ONCE from RPC when real data arrives
            // Never re-initialize after that - would wipe user's in-progress edits
            if (!initializedRef.current && rpcState.sequences && rpcState.sequences.length > 0) {
                const cloned = deepCloneSequences(rpcState.sequences)
                setLocalSequences(cloned)
                setSelectedIndex(0)
                initializedRef.current = true
            }
        } else {
            // Modal mode: sync from store on first open
            if (visible && storeSequences && !initializedRef.current) {
                setLocalSequences(deepCloneSequences(storeSequences))
                if (currentSequence >= 0 && currentSequence < storeSequences.length) {
                    setSelectedIndex(currentSequence)
                    setTimeout(() => scrollToItem(currentSequence), 0)
                } else {
                    setSelectedIndex(storeSequences.length > 0 ? 0 : -1)
                }
                initializedRef.current = true
            }
        }
    }, [visible, storeSequences, currentSequence, isStandalone, rpcState.sequences])

    // Handle selecting a sequence - sync with store and play
    const handleSelectSequence = (index: number) => {
        setSelectedIndex(index)
        if (!isStandalone) {
            // Also update store and play animation
            const seq = storeSequences[index]
            if (seq && seq.Interval && seq.Interval.length >= 2) {
                setSequence(index)
                window.dispatchEvent(new Event('timeline-fit-current-sequence'))
                setPlaying(true)
            }
        }
    }

    const handleOk = () => {
        if (isStandalone) {
            if (deletedIntervals.length > 0) {
                emitCommand('PRUNE_KEYFRAMES', deletedIntervals)
                setDeletedIntervals([])
            }
            emitCommand('SAVE_SEQUENCES', localSequences)
            message.success('序列已保存')
            onClose()
        } else {
            const { modelData } = useModelStore.getState();
            if (deletedIntervals.length > 0 && modelData) {
                deletedIntervals.forEach(([start, end]) => {
                    pruneModelKeyframes(modelData, start, end);
                });
            }
            setStoreSequences(localSequences)
            message.success(deletedIntervals.length > 0 ? '序列及关键帧已保存' : '序列已保存')
            onClose()
        }
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

    const innerContent = (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#252525' }}>
            {isStandalone && (
                <div data-tauri-drag-region className="titlebar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e1e1e', borderBottom: '1px solid #4a4a4a', padding: '4px 12px' }}>
                    <div data-tauri-drag-region style={{ flex: 1, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                        <span style={{ color: '#e8e8e8', fontSize: '11px', fontWeight: 'bold' }}>动画管理器</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <CloseOutlined
                            onClick={handleOk}
                            style={{ color: '#aaa', cursor: 'pointer', fontSize: '12px', padding: '4px' }}
                            className="hover:text-white"
                        />
                    </div>
                </div>
            )}
            <div style={{ display: 'flex', flex: 1, border: isStandalone ? 'none' : '1px solid #4a4a4a', overflow: 'hidden' }}>
                {/* List (Left) */}
                <div ref={listRef} style={{ width: '180px', minWidth: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #4a4a4a' }}>
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', fontSize: '11px' }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }} title={item.Name || `Sequence ${index}`}>
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
                <div style={{ flex: 1, padding: '8px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedSequence ? (
                        <>
                            <Card
                                title={<span style={{ color: '#b0b0b0', fontSize: '12px' }}>基本信息</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                headStyle={{ borderBottom: '1px solid #4a4a4a', padding: '0 8px', minHeight: '28px' }}
                                bodyStyle={{ padding: '8px' }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '11px' }}>名称:</Text>
                                        <Input
                                            size="small"
                                            value={selectedSequence.Name}
                                            onChange={(e) => updateLocalSequence(selectedIndex, { Name: e.target.value })}
                                            style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '11px' }}>开始帧:</Text>
                                            <InputNumber
                                                size="small"
                                                value={selectedSequence.Interval[0]}
                                                onChange={(v) => handleIntervalChange(selectedIndex, 0, v)}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '11px' }}>结束帧:</Text>
                                            <InputNumber
                                                size="small"
                                                value={selectedSequence.Interval[1]}
                                                onChange={(v) => handleIntervalChange(selectedIndex, 1, v)}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                            />
                                        </div>
                                    </div>
                                    <Checkbox
                                        checked={!!selectedSequence.NonLooping}
                                        onChange={(e) => updateLocalSequence(selectedIndex, { NonLooping: e.target.checked ? 1 : 0 })}
                                        style={{ color: '#e8e8e8', fontSize: '11px' }}
                                    >
                                        不循环 (NonLooping)
                                    </Checkbox>
                                </div>
                            </Card>

                            <Card
                                title={<span style={{ color: '#b0b0b0', fontSize: '12px' }}>高级属性</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                headStyle={{ borderBottom: '1px solid #4a4a4a', padding: '0 8px', minHeight: '28px' }}
                                bodyStyle={{ padding: '8px' }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '11px' }}>稀有度 (Rarity):</Text>
                                            <InputNumber
                                                size="small"
                                                value={selectedSequence.Rarity}
                                                onChange={(v) => updateLocalSequence(selectedIndex, { Rarity: v })}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '11px' }}>移动速度 (MoveSpeed):</Text>
                                            <InputNumber
                                                size="small"
                                                value={selectedSequence.MoveSpeed}
                                                onChange={(v) => updateLocalSequence(selectedIndex, { MoveSpeed: v })}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '11px' }}>边界半径 (BoundsRadius):</Text>
                                        <InputNumber
                                            size="small"
                                            value={selectedSequence.BoundsRadius}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { BoundsRadius: v })}
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                        />
                                    </div>
                                </div>
                            </Card>
                        </>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080', fontSize: '12px' }}>
                            请从左侧列表选择一个序列
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    if (isStandalone) {
        return (
            <div style={{ height: '100vh', width: '100vw', backgroundColor: '#252525' }}>
                {innerContent}
            </div>
        )
    }

    return (
        <DraggableModal
            title="序列编辑器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={600}
            okText="确定"
            cancelText="取消"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d', padding: 0, height: '400px' },
                footer: { borderTop: '1px solid #4a4a4a' }
            }}
            footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <div>
                        <Button onClick={onClose} size="small">取消</Button>
                        <Button type="primary" size="small" onClick={handleOk} style={{ marginLeft: 8 }}>确定</Button>
                    </div>
                </div>
            }
        >
            {innerContent}
        </DraggableModal>
    )
}

export default SequenceEditorModal

