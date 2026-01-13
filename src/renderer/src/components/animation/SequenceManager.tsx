import React, { useState } from 'react'
import { Button, Input, Form, InputNumber, Checkbox, message, Modal } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { DraggableModal } from '../DraggableModal'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'

/**
 * 序列管理器 - 简化版，与主界面风格一致
 */
const SequenceManager: React.FC = () => {
    const sequences = useModelStore(state => state.sequences)
    const currentSequence = useModelStore(state => state.currentSequence)
    const setSequence = useModelStore(state => state.setSequence)
    const setSequences = useModelStore(state => state.setSequences)
    const setPlaying = useModelStore(state => state.setPlaying)

    const { animationSubMode } = useSelectionStore()

    const [isModalVisible, setIsModalVisible] = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [form] = Form.useForm()

    const { push } = useHistoryStore() // Use History Store

    const handleSelect = (index: number) => {
        setSequence(index)

        // Only auto-play if NOT in keyframe/binding mode
        // User Request: "Keyframe mode ... do not auto play"
        const isEditingMode = animationSubMode === 'keyframe' || animationSubMode === 'binding'
        setPlaying(!isEditingMode)
    }

    const getNextInterval = () => {
        const maxEnd = (sequences || []).reduce((max, seq) => {
            const end = Array.isArray(seq.Interval) ? seq.Interval[1] : seq.Interval?.[1];
            return Math.max(max, typeof end === 'number' ? end : 0);
        }, 0);
        const start = maxEnd + 1000;
        return [start, start + 2333];
    };

    const handleAdd = () => {
        setEditingIndex(null)
        form.resetFields()
        const [newStart, newEnd] = getNextInterval()
        form.setFieldsValue({
            Name: 'Stand',
            Start: newStart,
            End: newEnd,
            Rarity: 0,
            MoveSpeed: 0,
            NonLooping: false
        })
        setIsModalVisible(true)
    }

    const handleEdit = (index: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const seq = sequences[index]
        setEditingIndex(index)
        form.setFieldsValue({
            Name: seq.Name,
            Start: seq.Interval[0],
            End: seq.Interval[1],
            Rarity: seq.Rarity || 0,
            MoveSpeed: seq.MoveSpeed || 0,
            NonLooping: !!seq.NonLooping
        })
        setIsModalVisible(true)
    }

    const [pruneKeyframes, setPruneKeyframes] = useState(true)

    const handleDelete = (index: number, e: React.MouseEvent) => {
        e.stopPropagation()

        Modal.confirm({
            title: '删除确认',
            content: `确定要删除序列 "${sequences[index].Name}" 吗？${pruneKeyframes ? ' (将同时删除该范围内的关键帧)' : ''}`,
            okText: '删除',
            cancelText: '取消',
            okButtonProps: { danger: true },
            onOk() {
                const seq = sequences[index];
                const oldSequences = [...sequences];

                // History for Undo
                push({
                    name: `Delete Sequence "${seq.Name}"`,
                    undo: () => setSequences(oldSequences),
                    redo: () => removeSequence(index, pruneKeyframes)
                });

                removeSequence(index, pruneKeyframes);
                message.success(pruneKeyframes ? '序列及相关关键帧已删除' : '序列已删除');
            }
        })
    }

    const handleModalOk = () => {
        form.validateFields().then(values => {
            // Ensure Interval values are valid numbers (InputNumber can return null)
            const startValue = typeof values.Start === 'number' ? values.Start : 0;
            const endValue = typeof values.End === 'number' ? values.End : 0;

            const newSeq = {
                Name: values.Name,
                Interval: [startValue, endValue],
                Rarity: values.Rarity || 0,
                MoveSpeed: values.MoveSpeed || 0,
                NonLooping: values.NonLooping ? 1 : 0,
                BoundsRadius: 60
            }

            const oldSequences = [...(sequences || [])]
            const newSequences = [...(sequences || [])]

            if (editingIndex !== null) {
                // Edit
                newSequences[editingIndex] = { ...newSequences[editingIndex], ...newSeq }

                push({
                    name: `Edit Sequence "${newSeq.Name}"`,
                    undo: () => setSequences(oldSequences),
                    redo: () => setSequences(newSequences)
                })

                message.success('序列已更新')
            } else {
                // Add
                newSequences.push(newSeq)

                push({
                    name: `Add Sequence "${newSeq.Name}"`,
                    undo: () => setSequences(oldSequences),
                    redo: () => setSequences(newSequences)
                })

                message.success('序列已添加')
            }
            setSequences(newSequences)
            setIsModalVisible(false)
        })
    }

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#2b2b2b',
            color: '#eee'
        }}>
            {/* 标题栏 */}
            <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid #444',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <span style={{ fontWeight: 'bold' }}>序列管理</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Checkbox
                        checked={pruneKeyframes}
                        onChange={(e) => setPruneKeyframes(e.target.checked)}
                        style={{ color: '#aaa', fontSize: '11px' }}
                    >
                        动画关键帧
                    </Checkbox>
                    <Button
                        type="primary"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={handleAdd}
                    >
                        添加
                    </Button>
                </div>
            </div>

            {/* 序列列表 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* 全部动画按钮 */}
                <div
                    onClick={() => {
                        setSequence(-1)
                        setPlaying(false)
                    }}
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        backgroundColor: currentSequence === -1 ? '#4a90e2' : '#333',
                        color: currentSequence === -1 ? 'white' : '#eee',
                        borderBottom: '1px solid #444',
                        fontWeight: 'bold'
                    }}
                >
                    全部动画
                </div>
                {(!sequences || sequences.length === 0) ? (
                    <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>
                        暂无序列
                    </div>
                ) : (
                    sequences.map((seq: any, index: number) => (
                        <div
                            key={index}
                            onClick={() => handleSelect(index)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                backgroundColor: currentSequence === index ? '#4a90e2' : 'transparent',
                                color: currentSequence === index ? 'white' : '#eee',
                                borderBottom: '1px solid #444',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px' }}>{seq.Name}</div>
                                <div style={{ fontSize: '10px', color: currentSequence === index ? '#ccc' : '#888' }}>
                                    {seq.Interval[0]} - {seq.Interval[1]} ({seq.Interval[1] - seq.Interval[0]}ms)
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={(e) => handleEdit(index, e)}
                                    style={{ color: currentSequence === index ? '#fff' : '#888' }}
                                />
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={(e) => handleDelete(index, e)}
                                />
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* 编辑/添加弹窗 */}
            <DraggableModal
                title={editingIndex !== null ? "编辑序列" : "新建序列"}
                open={isModalVisible}
                onOk={handleModalOk}
                onCancel={() => setIsModalVisible(false)}
                okText="保存"
                cancelText="取消"
                width={350}
            >
                <Form form={form} layout="vertical" size="small">
                    <Form.Item name="Name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                        <Input />
                    </Form.Item>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <Form.Item name="Start" label="起始帧" rules={[{ required: true }]} style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="End" label="结束帧" rules={[{ required: true }]} style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <Form.Item name="Rarity" label="稀有度" style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="MoveSpeed" label="移动速度" style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                    </div>
                    <Form.Item name="NonLooping" valuePropName="checked">
                        <Checkbox>不循环</Checkbox>
                    </Form.Item>
                </Form>
            </DraggableModal>
        </div>
    )
}

export default SequenceManager
