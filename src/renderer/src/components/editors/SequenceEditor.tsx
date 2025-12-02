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
                    value={record.Interval[0]}
                    onChange={(val) => {
                        const newInterval = [...record.Interval]
                        newInterval[0] = val
                        handleChange(index, 'Interval', newInterval)
                    }}
                    style={{ width: '100%', backgroundColor: '#333', color: '#fff', border: 'none' }}
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
                    value={record.Interval[1]}
                    onChange={(val) => {
                        const newInterval = [...record.Interval]
                        newInterval[1] = val
                        handleChange(index, 'Interval', newInterval)
                    }}
                    style={{ width: '100%', backgroundColor: '#333', color: '#fff', border: 'none' }}
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
                    onClick={() => handleRemoveSequence(index)}
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
                rowClassName={() => 'editable-row'}
                style={{ flex: 1, overflow: 'hidden' }}
            />
            <style>{`
                .ant-table { background: transparent; }
                .ant-table-thead > tr > th { background: #333 !important; color: #eee !important; border-bottom: 1px solid #444; }
                .ant-table-tbody > tr > td { border-bottom: 1px solid #444; color: #eee; }
                .ant-table-tbody > tr:hover > td { background: #333 !important; }
                .ant-input-number-input { color: #eee; }
                .ant-empty-description { color: #888; }
            `}</style>
        </div>
    )
}

export default SequenceEditor
