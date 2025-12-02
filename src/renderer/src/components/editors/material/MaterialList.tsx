import React from 'react'
import { Table, Tag } from 'antd'

interface MaterialListProps {
    materials: any[]
    onSelect: (index: number) => void
}

const MaterialList: React.FC<MaterialListProps> = ({ materials, onSelect }) => {
    const columns = [
        {
            title: 'ID',
            key: 'index',
            width: 60,
            render: (_: any, __: any, index: number) => index
        },
        {
            title: '优先级平面 (Priority Plane)',
            dataIndex: 'PriorityPlane',
            key: 'PriorityPlane',
            width: 150,
        },
        {
            title: '渲染模式 (Render Mode)',
            key: 'RenderMode',
            render: (_: any, record: any) => (
                <Tag>{record.ConstantColor ? '恒定颜色 (Constant)' : '标准 (Standard)'}</Tag>
            )
        },
        {
            title: '图层数 (Layers)',
            key: 'Layers',
            render: (_: any, record: any) => record.Layers ? record.Layers.length : 0
        }
    ]

    return (
        <Table
            dataSource={materials.map((m, i) => ({ ...m, key: i }))}
            columns={columns}
            pagination={false}
            size="small"
            onRow={(_, index) => ({
                onDoubleClick: () => {
                    if (index !== undefined) onSelect(index)
                }
            })}
            rowClassName={() => 'editable-row'}
            style={{ cursor: 'pointer' }}
        />
    )
}

export default MaterialList
