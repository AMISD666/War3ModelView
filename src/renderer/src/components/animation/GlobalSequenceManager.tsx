import { appMessage, appModal } from '../../store/messageStore'
import React, { useEffect, useState } from 'react'
import { Button, Form, Modal } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'

const GlobalSequenceManager: React.FC = () => {
    const globalSequences = useModelStore((state) => (((state.modelData as any)?.GlobalSequences as number[]) || []))
    const updateGlobalSequences = useModelStore((state) => state.updateGlobalSequences)
    const setPlaying = useModelStore((state) => state.setPlaying)
    const {
        timelineGlobalSequenceFilter,
        setTimelineGlobalSequenceFilter
    } = useSelectionStore()
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [form] = Form.useForm()
    const { push } = useHistoryStore()

    useEffect(() => {
        if (timelineGlobalSequenceFilter === null) {
            setTimelineGlobalSequenceFilter(-1)
        }
    }, [timelineGlobalSequenceFilter, setTimelineGlobalSequenceFilter])

    const fitTimeline = () => {
        window.dispatchEvent(new Event('timeline-fit-current-sequence'))
    }

    const applyGlobalSequences = (nextGlobalSequences: number[], nextFilter: number | -1) => {
        updateGlobalSequences(nextGlobalSequences)
        setTimelineGlobalSequenceFilter(nextFilter)
        fitTimeline()
    }

    const handleSelect = (index: number) => {
        setTimelineGlobalSequenceFilter(index)
        setPlaying(false)
        fitTimeline()
    }

    const handleAdd = () => {
        setEditingIndex(null)
        form.resetFields()
        form.setFieldsValue({ Duration: 1000 })
        setIsModalVisible(true)
    }

    const handleEdit = (index: number, e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingIndex(index)
        form.setFieldsValue({ Duration: Number(globalSequences[index] ?? 0) })
        setIsModalVisible(true)
    }

    const handleDelete = (index: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const oldGlobalSequences = [...globalSequences]
        const newGlobalSequences = globalSequences.filter((_, seqIndex) => seqIndex !== index)
        const currentFilter = timelineGlobalSequenceFilter ?? -1
        const nextFilter = currentFilter === index ? -1 : (currentFilter > index ? currentFilter - 1 : currentFilter)

        appModal.confirm({
            title: '删除确认',
            content: `确定要删除全局序列 ${index} 吗？`,
            okText: '删除',
            cancelText: '取消',
            okButtonProps: { danger: true },
            onOk() {
                push({
                    name: `Delete Global Sequence ${index}`,
                    undo: () => applyGlobalSequences(oldGlobalSequences, currentFilter),
                    redo: () => applyGlobalSequences(newGlobalSequences, nextFilter)
                })
                applyGlobalSequences(newGlobalSequences, nextFilter)
                appMessage.success('全局序列已删除')
            }
        })
    }

    const handleModalOk = () => {
        form.validateFields().then((values) => {
            const duration = typeof values.Duration === 'number' ? values.Duration : 0
            const oldGlobalSequences = [...globalSequences]
            const newGlobalSequences = [...globalSequences]
            const currentFilter = timelineGlobalSequenceFilter ?? -1
            let nextFilter: number | -1 = currentFilter

            if (editingIndex !== null) {
                newGlobalSequences[editingIndex] = duration
                if (currentFilter === editingIndex) nextFilter = editingIndex
                push({
                    name: `Edit Global Sequence ${editingIndex}`,
                    undo: () => applyGlobalSequences(oldGlobalSequences, currentFilter),
                    redo: () => applyGlobalSequences(newGlobalSequences, nextFilter)
                })
                appMessage.success('全局序列范围已更新')
            } else {
                newGlobalSequences.push(duration)
                nextFilter = newGlobalSequences.length - 1
                push({
                    name: `Add Global Sequence ${nextFilter}`,
                    undo: () => applyGlobalSequences(oldGlobalSequences, currentFilter),
                    redo: () => applyGlobalSequences(newGlobalSequences, nextFilter)
                })
                appMessage.success('全局序列已添加')
            }

            applyGlobalSequences(newGlobalSequences, nextFilter)
            setIsModalVisible(false)
        })
    }

    const buttonBaseStyle: React.CSSProperties = {
        minHeight: 28,
        padding: '3px 6px',
        cursor: 'pointer',
        border: '1px solid #444',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 4
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#2b2b2b', color: '#eee' }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '12px' }}>全局序列</span>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAdd}>
                    添加
                </Button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
                    {globalSequences.length === 0 ? (
                        <div style={{ gridColumn: '1 / -1', padding: 12, textAlign: 'center', color: '#666', fontSize: '12px' }}>
                            暂无全局序列
                        </div>
                    ) : (
                        globalSequences.map((duration: number, index: number) => {
                            const isCurrent = timelineGlobalSequenceFilter === index
                            return (
                                <div
                                    key={index}
                                    onClick={() => handleSelect(index)}
                                    style={{
                                        ...buttonBaseStyle,
                                        backgroundColor: isCurrent ? '#4a90e2' : '#303030',
                                        color: isCurrent ? '#fff' : '#ddd'
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                                        <span style={{ fontSize: '12px', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(index)}>
                                            {index}
                                        </span>
                                        <span style={{ fontSize: '10px', color: isCurrent ? 'rgba(255,255,255,0.88)' : '#888' }}>
                                            0 - {duration}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<EditOutlined />}
                                            onClick={(e) => handleEdit(index, e)}
                                            style={{ color: isCurrent ? '#fff' : '#aaa', width: 18, minWidth: 18, height: 18, padding: 0 }}
                                        />
                                        <Button
                                            type="text"
                                            size="small"
                                            danger
                                            icon={<DeleteOutlined />}
                                            onClick={(e) => handleDelete(index, e)}
                                            style={{ width: 18, minWidth: 18, height: 18, padding: 0 }}
                                        />
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            <DraggableModal
                title={editingIndex !== null ? '编辑全局序列' : '新建全局序列'}
                open={isModalVisible}
                onOk={handleModalOk}
                onCancel={() => setIsModalVisible(false)}
                okText="保存"
                cancelText="取消"
                width={300}
            >
                <Form form={form} layout="vertical" size="small">
                    <Form.Item name="Duration" label="范围" rules={[{ required: true, message: '请输入全局序列范围' }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                </Form>
            </DraggableModal>
        </div>
    )
}

export default GlobalSequenceManager
