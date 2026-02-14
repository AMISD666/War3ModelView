import React, { useState, useEffect, useRef } from 'react'
import { List, Button, Input, Checkbox, InputNumber, Card, Typography, message } from 'antd'
import { DraggableModal } from '../DraggableModal'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'
import { pruneModelKeyframes } from '../../utils/modelUtils'

const { Text } = Typography

interface SequenceEditorModalProps {
    visible: boolean
    onClose: () => void
    asWindow?: boolean
}

const SequenceEditorModal: React.FC<SequenceEditorModalProps> = ({ visible, onClose, asWindow = false }) => {
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
    const suppressNextLiveApplyRef = useRef(false)
    const lastAppliedSignatureRef = useRef('')

    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 45
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

    const deepCloneSequences = (sequences: any[]): any[] => {
        return sequences.map((seq) => {
            const cloned: any = {}
            for (const key in seq) {
                const value = seq[key]
                if (ArrayBuffer.isView(value)) {
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

    const getSignature = (sequences: any[]) => {
        try {
            return JSON.stringify(sequences)
        } catch {
            return `${sequences.length}`
        }
    }

    useEffect(() => {
        if (!visible) {
            initializedRef.current = false
            setLocalSequences([])
            setSelectedIndex(-1)
            setDeletedIntervals([])
            return
        }

        if (visible && storeSequences && !initializedRef.current) {
            const cloned = deepCloneSequences(storeSequences)
            suppressNextLiveApplyRef.current = true
            lastAppliedSignatureRef.current = getSignature(cloned)
            setLocalSequences(cloned)

            if (currentSequence >= 0 && currentSequence < storeSequences.length) {
                setSelectedIndex(currentSequence)
                setTimeout(() => scrollToItem(currentSequence), 0)
            } else {
                setSelectedIndex(storeSequences.length > 0 ? 0 : -1)
            }
            initializedRef.current = true
        }
    }, [visible, storeSequences, currentSequence])

    useEffect(() => {
        if (!visible || !asWindow) return
        if (suppressNextLiveApplyRef.current) {
            suppressNextLiveApplyRef.current = false
            return
        }

        const signature = getSignature(localSequences)
        if (signature === lastAppliedSignatureRef.current) return
        lastAppliedSignatureRef.current = signature
        setStoreSequences(localSequences)
    }, [visible, asWindow, localSequences, setStoreSequences])

    const handleSelectSequence = (index: number) => {
        setSelectedIndex(index)
        const seq = storeSequences[index]
        if (seq && seq.Interval && seq.Interval.length >= 2) {
            setSequence(index)
            setPlaying(true)
        }
    }

    const handleOk = () => {
        const { modelData } = useModelStore.getState()
        if (pruneKeyframes && deletedIntervals.length > 0 && modelData) {
            deletedIntervals.forEach(([start, end]) => {
                pruneModelKeyframes(modelData, start, end)
            })
        }
        setStoreSequences(localSequences)
        message.success(pruneKeyframes && deletedIntervals.length > 0 ? 'Sequences and keyframes saved' : 'Sequences saved')
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

    const removeSequenceAtIndex = (index: number) => {
        const seq = localSequences[index]
        if (seq && seq.Interval) {
            setDeletedIntervals((prev) => [...prev, [seq.Interval[0], seq.Interval[1]]])
            if (asWindow && pruneKeyframes) {
                const { modelData } = useModelStore.getState()
                if (modelData) {
                    pruneModelKeyframes(modelData, seq.Interval[0], seq.Interval[1])
                }
            }
        }

        const newSequences = localSequences.filter((_, i) => i !== index)
        setLocalSequences(newSequences)
        if (selectedIndex === index) setSelectedIndex(-1)
        else if (selectedIndex > index) setSelectedIndex(selectedIndex - 1)
    }

    const renderEditorContent = (contentHeight: string | number = '500px') => (
        <div style={{ display: 'flex', height: contentHeight, border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', padding: '4px' }}>
                    {localSequences.map((item, index) => (
                        <div
                            key={index}
                            onClick={() => handleSelectSequence(index)}
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
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{item.Name || `Seq ${index}`}</span>
                            <DeleteOutlined
                                onClick={(e) => {
                                    e.stopPropagation()
                                    removeSequenceAtIndex(index)
                                }}
                                style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f', fontSize: '10px' }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, padding: '12px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {selectedSequence ? (
                    <>
                        <Card
                            title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>序列设置</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            styles={{ header: { padding: '4px 8px', minHeight: '32px', borderBottom: '1px solid #4a4a4a' }, body: { padding: '8px' } }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Text style={{ minWidth: '60px', color: '#b0b0b0', fontSize: '12px' }}>名称:</Text>
                                    <Input
                                        size="small"
                                        value={selectedSequence.Name}
                                        onChange={(e) => updateLocalSequence(selectedIndex, { Name: e.target.value })}
                                        style={{ flex: 1, backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Text style={{ minWidth: '60px', color: '#b0b0b0', fontSize: '12px' }}>区间:</Text>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <InputNumber
                                            size="small"
                                            value={selectedSequence.Interval[0]}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { Interval: [v || 0, selectedSequence.Interval[1]] })}
                                            style={{ width: '60px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                        <span style={{ color: '#888' }}>-</span>
                                        <InputNumber
                                            size="small"
                                            value={selectedSequence.Interval[1]}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { Interval: [selectedSequence.Interval[0], v || 0] })}
                                            style={{ width: '60px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                    <Checkbox
                                        checked={!!selectedSequence.NonLooping}
                                        onChange={(e) => updateLocalSequence(selectedIndex, { NonLooping: e.target.checked ? 1 : 0 })}
                                        style={{ color: '#e8e8e8', fontSize: '12px' }}
                                    >
                                        非循环
                                    </Checkbox>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Text style={{ color: '#b0b0b0', fontSize: '11px' }}>稀有度:</Text>
                                        <InputNumber
                                            size="small"
                                            value={selectedSequence.Rarity}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { Rarity: v })}
                                            style={{ width: '60px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>边界与物理</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            styles={{ header: { padding: '4px 12px', minHeight: 0, borderBottom: '1px solid #4a4a4a' }, body: { padding: '12px' } }}
                        >
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0', fontSize: '11px' }}>移动速度:</Text>
                                    <InputNumber
                                        size="small"
                                        value={selectedSequence.MoveSpeed}
                                        onChange={(v) => updateLocalSequence(selectedIndex, { MoveSpeed: v })}
                                        style={{ width: '60px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0', fontSize: '11px' }}>包围半径:</Text>
                                    <InputNumber
                                        size="small"
                                        value={selectedSequence.BoundsRadius}
                                        onChange={(v) => updateLocalSequence(selectedIndex, { BoundsRadius: v })}
                                        style={{ width: '60px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                    />
                                </div>
                            </div>
                        </Card>
                    </>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                        请从列表中选择一个序列
                    </div>
                )}
            </div>
        </div >
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
            title="序列编辑器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={950}
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
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Checkbox checked={pruneKeyframes} onChange={(e) => setPruneKeyframes(e.target.checked)} style={{ color: '#aaa' }}>
                        删除时裁剪关键帧
                    </Checkbox>
                    <div>
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" onClick={handleOk} style={{ marginLeft: 8 }}>保存</Button>
                    </div>
                </div>
            }
        >
            {renderEditorContent()}
        </DraggableModal>
    )
}

export default SequenceEditorModal
