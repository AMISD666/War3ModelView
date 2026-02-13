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
                        Add
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
                                        removeSequenceAtIndex(index)
                                    }}
                                    style={{ color: '#ff4d4f' }}
                                />
                            </div>
                        </List.Item>
                    )}
                />
            </div>

            <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {selectedSequence ? (
                    <>
                        <Card
                            title={<span style={{ color: '#b0b0b0' }}>Basic</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>Name:</Text>
                                    <Input
                                        value={selectedSequence.Name}
                                        onChange={(e) => updateLocalSequence(selectedIndex, { Name: e.target.value })}
                                        style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <div style={{ flex: 1 }}>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>Start:</Text>
                                        <InputNumber
                                            value={selectedSequence.Interval[0]}
                                            onChange={(v) => handleIntervalChange(selectedIndex, 0, v)}
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>End:</Text>
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
                                    NonLooping
                                </Checkbox>
                            </div>
                        </Card>

                        <Card
                            title={<span style={{ color: '#b0b0b0' }}>Advanced</span>}
                            size="small"
                            bordered={false}
                            style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                            headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <div style={{ flex: 1 }}>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>Rarity:</Text>
                                        <InputNumber
                                            value={selectedSequence.Rarity}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { Rarity: v })}
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>MoveSpeed:</Text>
                                        <InputNumber
                                            value={selectedSequence.MoveSpeed}
                                            onChange={(v) => updateLocalSequence(selectedIndex, { MoveSpeed: v })}
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>BoundsRadius:</Text>
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
                        Select a sequence from the list
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
            title="Sequence Editor"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={950}
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
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Checkbox checked={pruneKeyframes} onChange={(e) => setPruneKeyframes(e.target.checked)} style={{ color: '#aaa' }}>
                        Prune Keyframes on Delete
                    </Checkbox>
                    <div>
                        <Button onClick={onClose}>Cancel</Button>
                        <Button type="primary" onClick={handleOk} style={{ marginLeft: 8 }}>Confirm</Button>
                    </div>
                </div>
            }
        >
            {renderEditorContent()}
        </DraggableModal>
    )
}

export default SequenceEditorModal
