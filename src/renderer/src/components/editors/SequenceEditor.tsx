import React, { useState, useEffect } from 'react'
import { Table, Button, Input, Space, Modal, message, InputNumber, Tooltip, Checkbox } from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'

interface SequenceEditorProps {
    model?: any
    onUpdate?: () => void
}

const SequenceEditor: React.FC<SequenceEditorProps> = () => {
    const storeSequences = useModelStore(state => state.sequences)
    const setStoreSequences = useModelStore(state => state.setSequences)
    const currentSequence = useModelStore(state => state.currentSequence)
    const setSequence = useModelStore(state => state.setSequence)
    const setPlaying = useModelStore(state => state.setPlaying)

    const [sequences, setSequences] = useState<any[]>([])
    const [hasChanges, setHasChanges] = useState(false)

    useEffect(() => {
        if (storeSequences) {
            setSequences(JSON.parse(JSON.stringify(storeSequences)))
            setHasChanges(false)
        } else {
            setSequences([])
            setHasChanges(false)
        }
    }, [storeSequences])

    const handleChange = (index: number, field: string, value: any) => {
        const newSequences = [...sequences]
        newSequences[index][field] = value
        setSequences(newSequences)
        setHasChanges(true)
    }

    const handleAddSequence = () => {
        setSequences([...sequences, {
            Name: '新序列',
            Interval: [0, 1000],
            NonLooping: 0,
            Rarity: 0,
            MoveSpeed: 0,
            BoundsRadius: 0
        }])
        setHasChanges(true)
    }

    const handleRemoveSequence = (index: number) => {
        Modal.confirm({
            title: '确认删除',
            content: '确定要删除这个序列吗？',
            onOk: () => {
                const newSequences = sequences.filter((_, i) => i !== index)
                setSequences(newSequences)
                setHasChanges(true)
            }
        })
    }

    const handleApply = () => {
        setStoreSequences(JSON.parse(JSON.stringify(sequences)))
        setHasChanges(false)
        message.success('序列已更新')
    }

    // Handle row click to select and play animation
    const handleRowClick = (index: number) => {
        const seq = storeSequences[index]
        // Check if sequence has valid Interval
        if (seq && seq.Interval && seq.Interval.length >= 2) {
            setSequence(index)
            setPlaying(true)
        }
    }

    const columns = [
        {
            title: '名称',
            dataIndex: 'Name',
            key: 'Name',
            width: 150,
            render: (text: string, _record: any, index: number) => (
                <Input
                    value={text}
                    onChange={(e) => handleChange(index, 'Name', e.target.value)}
                    bordered={false}
                    style={{ backgroundColor: '#333', color: '#fff' }}
                    onClick={(e) => e.stopPropagation()}
                />
            )
        },
        {
            title: '开始',
            dataIndex: ['Interval', 0],
            key: 'Start',
            width: 100,
            render: (_text: number, record: any, index: number) => (
                <InputNumber
                    value={record.Interval?.[0] ?? 0}
                    onChange={(val) => {
                        const newInterval = [...(record.Interval || [0, 1000])]
                        newInterval[0] = val
                        handleChange(index, 'Interval', newInterval)
                    }}
                    style={{ width: '100%', backgroundColor: '#333', color: '#fff', border: 'none' }}
                    onClick={(e) => e.stopPropagation()}
                />
            )
        },
        {
            title: '结束',
            dataIndex: ['Interval', 1],
            key: 'End',
            width: 100,
            render: (_text: number, record: any, index: number) => (
                <InputNumber
                    value={record.Interval?.[1] ?? 1000}
                    onChange={(val) => {
                        const newInterval = [...(record.Interval || [0, 1000])]
                        newInterval[1] = val
                        handleChange(index, 'Interval', newInterval)
                    }}
                    style={{ width: '100%', backgroundColor: '#333', color: '#fff', border: 'none' }}
                    onClick={(e) => e.stopPropagation()}
                />
            )
        },
        {
            title: '不循环',
            dataIndex: 'NonLooping',
            key: 'NonLooping',
            width: 80,
            render: (val: number, _record: any, index: number) => (
                <Checkbox
                    checked={!!val}
                    onChange={(e) => handleChange(index, 'NonLooping', e.target.checked ? 1 : 0)}
                    onClick={(e) => e.stopPropagation()}
                />
            )
        },
        {
            title: '操作',
            key: 'action',
            width: 60,
            render: (_: any, __: any, index: number) => (
                <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => { e.stopPropagation(); handleRemoveSequence(index) }}
                />
            )
        }
    ]

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                    <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleApply}
                        disabled={!hasChanges}
                    >
                        应用更改
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={handleAddSequence}>
                        添加序列
                    </Button>
                </Space>
                <Tooltip title="重置">
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => {
                            if (storeSequences) {
                                setSequences(JSON.parse(JSON.stringify(storeSequences)))
                                setHasChanges(false)
                            }
                        }}
                    />
                </Tooltip>
            </div>

            <Table
                dataSource={sequences.map((s, i) => ({ ...s, key: i }))}
                columns={columns}
                pagination={false}
                size="small"
                scroll={{ y: 'calc(100vh - 200px)' }}
                rowClassName={(_, index) => index === currentSequence ? 'selected-row' : 'editable-row'}
                onRow={(_, index) => ({
                    onClick: () => index !== undefined && handleRowClick(index),
                    style: { cursor: 'pointer' }
                })}
                style={{ flex: 1, overflow: 'hidden' }}
            />
            <style>{`
                .ant-table { background: transparent; }
                .ant-table-thead > tr > th { background: #333 !important; color: #eee !important; border-bottom: 1px solid #444; }
                .ant-table-tbody > tr > td { border-bottom: 1px solid #444; color: #eee; }
                .ant-table-tbody > tr:hover > td { background: #333 !important; }
                .ant-table-tbody > tr.selected-row > td { background: #1890ff !important; }
                .ant-table-tbody > tr.selected-row:hover > td { background: #40a9ff !important; }
                .ant-input-number-input { color: #eee; }
                .ant-empty-description { color: #888; }
            `}</style>
        </div>
    )
}

export default SequenceEditor
