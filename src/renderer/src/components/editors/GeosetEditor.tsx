import React, { useState, useEffect } from 'react'
import { Table, Button, Space, message, Select, Tooltip, InputNumber } from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'

interface GeosetEditorProps {
    model?: any
    onUpdate?: () => void
}

const GeosetEditor: React.FC<GeosetEditorProps> = () => {
    const modelData = useModelStore(state => state.modelData)
    const setGeosets = useModelStore(state => state.setGeosets)

    const [geosets, setLocalGeosets] = useState<any[]>([])
    const [hasChanges, setHasChanges] = useState(false)

    useEffect(() => {
        if (modelData && modelData.Geosets) {
            setLocalGeosets(JSON.parse(JSON.stringify(modelData.Geosets)))
            setHasChanges(false)
        } else {
            setLocalGeosets([])
            setHasChanges(false)
        }
    }, [modelData])

    const handleChange = (index: number, field: string, value: any) => {
        const newGeosets = [...geosets]
        newGeosets[index][field] = value
        setLocalGeosets(newGeosets)
        setHasChanges(true)
    }

    const handleApply = () => {
        setGeosets(JSON.parse(JSON.stringify(geosets)))
        setHasChanges(false)
        message.success('多边形设置已更新')
    }

    const columns = [
        {
            title: 'ID',
            key: 'index',
            width: 50,
            render: (_: any, __: any, index: number) => index
        },
        {
            title: '材质 ID',
            dataIndex: 'MaterialID',
            key: 'MaterialID',
            width: 120,
            render: (val: number, _record: any, index: number) => (
                <Select
                    value={val}
                    onChange={(v) => handleChange(index, 'MaterialID', v)}
                    style={{ width: '100%' }}
                    options={(modelData as any)?.Materials?.map((_m: any, i: number) => ({
                        value: i,
                        label: `材质 ${i}`
                    })) || []}
                />
            )
        },
        {
            title: '选择组',
            dataIndex: 'SelectionGroup',
            key: 'SelectionGroup',
            width: 100,
            render: (val: number, _record: any, index: number) => (
                <InputNumber
                    value={val}
                    onChange={(v) => handleChange(index, 'SelectionGroup', v)}
                    style={{ width: '100%', backgroundColor: '#333', color: '#fff', border: 'none' }}
                />
            )
        },
        {
            title: '统计',
            key: 'stats',
            render: (_: any, record: any) => (
                <span style={{ fontSize: '10px', color: '#888' }}>
                    {record.Vertices ? record.Vertices.length / 3 : 0}v / {record.Faces ? record.Faces.length / 3 : 0}f
                </span>
            )
        }
    ]

    if (!modelData) return <div style={{ padding: 20, color: '#aaa' }}>未加载模型</div>

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
                </Space>
                <Tooltip title="重置">
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => {
                            if (modelData && modelData.Geosets) {
                                setLocalGeosets(JSON.parse(JSON.stringify(modelData.Geosets)))
                                setHasChanges(false)
                            }
                        }}
                    />
                </Tooltip>
            </div>

            <Table
                dataSource={geosets.map((g, i) => ({ ...g, key: i }))}
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
                .ant-select-selector { background-color: #333 !important; color: #eee !important; border-color: #555 !important; }
                .ant-select-arrow { color: #aaa; }
                .ant-input-number-input { color: #eee; }
                .ant-empty-description { color: #888; }
            `}</style>
        </div>
    )
}

export default GeosetEditor
