import React, { useState, useEffect } from 'react'
import { Table, Button, Input, Space, Modal, message, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import TextureDetail from './texture/TextureDetail'

interface TextureEditorProps {
    model: any
    modelPath?: string
    onUpdate: () => void
}

const TextureEditor: React.FC<TextureEditorProps> = ({ model, modelPath, onUpdate }) => {
    const [textures, setTextures] = useState<any[]>([])
    const [hasChanges, setHasChanges] = useState(false)
    const [selectedTextureIndex, setSelectedTextureIndex] = useState<number>(-1)
    const [isModalOpen, setIsModalOpen] = useState(false)

    useEffect(() => {
        if (model && model.Textures) {
            setTextures(JSON.parse(JSON.stringify(model.Textures)))
            setHasChanges(false)
        } else {
            setTextures([])
            setHasChanges(false)
        }
    }, [model])

    const handlePathChange = (index: number, newPath: string) => {
        const newTextures = [...textures]
        newTextures[index].Image = newPath
        setTextures(newTextures)
        setHasChanges(true)
    }

    const handleUpdateTexture = (updatedTexture: any) => {
        const newTextures = [...textures]
        newTextures[selectedTextureIndex] = updatedTexture
        setTextures(newTextures)
        setHasChanges(true)
    }

    const handleAddTexture = () => {
        setTextures([...textures, { Image: 'Textures\\white.blp', ReplaceableId: 0, Flags: 0 }])
        setHasChanges(true)
    }

    const handleRemoveTexture = (index: number) => {
        Modal.confirm({
            title: '确认删除',
            content: '确定要删除这个纹理吗？',
            onOk: () => {
                const newTextures = textures.filter((_, i) => i !== index)
                setTextures(newTextures)
                setHasChanges(true)
            }
        })
    }

    const handleApply = () => {
        if (model) {
            model.Textures = JSON.parse(JSON.stringify(textures))
            setHasChanges(false)
            onUpdate()
            message.success('纹理已更新')
        }
    }

    const columns = [
        {
            title: 'ID',
            dataIndex: 'index',
            key: 'index',
            width: 50,
            render: (_: any, __: any, index: number) => index
        },
        {
            title: '路径',
            dataIndex: 'Image',
            key: 'Image',
            render: (text: string, _record: any, index: number) => (
                <Input
                    value={text}
                    onChange={(e) => handlePathChange(index, e.target.value)}
                    bordered={false}
                    style={{ backgroundColor: '#333', color: '#fff' }}
                />
            )
        },
        {
            title: '操作',
            key: 'action',
            width: 80,
            render: (_: any, __: any, index: number) => (
                <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveTexture(index)
                    }}
                />
            )
        }
    ]

    if (!model) return <div style={{ padding: 20, color: '#aaa' }}>未加载模型</div>

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
                    <Button icon={<PlusOutlined />} onClick={handleAddTexture}>
                        添加纹理
                    </Button>
                </Space>
                <Tooltip title="重置">
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => {
                            if (model && model.Textures) {
                                setTextures(JSON.parse(JSON.stringify(model.Textures)))
                                setHasChanges(false)
                            }
                        }}
                    />
                </Tooltip>
            </div>

            <Table
                dataSource={textures.map((t, i) => ({ ...t, key: i }))}
                columns={columns}
                pagination={false}
                size="small"
                scroll={{ y: 'calc(100vh - 200px)' }}
                rowClassName={() => 'editable-row'}
                style={{ flex: 1, overflow: 'hidden' }}
                onRow={(_, index) => ({
                    onDoubleClick: () => {
                        if (index !== undefined) {
                            setSelectedTextureIndex(index)
                            setIsModalOpen(true)
                        }
                    }
                })}
            />

            <Modal
                title={`贴图 [${model.Name || 'Model'}]`}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                footer={null}
                width={800}
                centered
                destroyOnClose
            >
                {selectedTextureIndex !== -1 && textures[selectedTextureIndex] && (
                    <TextureDetail
                        texture={textures[selectedTextureIndex]}
                        modelPath={modelPath}
                        onUpdate={handleUpdateTexture}
                        onClose={() => setIsModalOpen(false)}
                    />
                )}
            </Modal>

            <style>{`
                .ant-table { background: transparent; }
                .ant-table-thead > tr > th { background: #333 !important; color: #eee !important; border-bottom: 1px solid #444; }
                .ant-table-tbody > tr > td { border-bottom: 1px solid #444; color: #eee; }
                .ant-table-tbody > tr:hover > td { background: #333 !important; }
                .ant-empty-description { color: #888; }
                .editable-row { cursor: pointer; }
            `}</style>
        </div>
    )
}

export default TextureEditor
