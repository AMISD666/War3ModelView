import React, { useEffect } from 'react'
import { ConfigProvider, Form, Input, Select, theme, TreeSelect } from 'antd'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useUIStore } from '../../store/uiStore'
import { NodeType } from '../../types/node'
import { isNodeManagerType } from '../../utils/nodeUtils'
import { buildTreeData } from '../../utils/treeUtils'

const { Option } = Select

export const CreateNodeDialog: React.FC = () => {
    const { showCreateNodeDialog, setCreateNodeDialogVisible } = useUIStore()
    const { nodes, addNode } = useModelStore()
    const { selectedNodeIds } = useSelectionStore()
    const [form] = Form.useForm()

    const nodeManagerNodes = React.useMemo(() => nodes.filter((n) => isNodeManagerType(n.type)), [nodes])
    const treeData = React.useMemo(() => buildTreeData(nodeManagerNodes), [nodeManagerNodes])

    useEffect(() => {
        if (showCreateNodeDialog) {
            form.resetFields()
            form.setFieldsValue({
                name: uiText.createNodeDialog.defaultName,
                type: NodeType.BONE,
                parent: selectedNodeIds.length > 0 ? selectedNodeIds[0] : undefined,
            })
        }
    }, [showCreateNodeDialog, form, selectedNodeIds])

    const handleOk = () => {
        form.validateFields().then((values) => {
            addNode({
                Name: values.name,
                type: values.type,
                Parent: values.parent ?? -1,
            })
            setCreateNodeDialogVisible(false)
        })
    }

    const handleCancel = () => {
        setCreateNodeDialogVisible(false)
    }

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorBgContainer: '#1e1e1e',
                    colorBgElevated: '#2d2d2d',
                    colorText: '#eee',
                    colorTextSecondary: '#aaa',
                    colorBorder: '#444',
                    colorPrimary: '#007acc',
                },
            }}
        >
            <DraggableModal title={uiText.createNodeDialog.title} open={showCreateNodeDialog} onOk={handleOk} onCancel={handleCancel} destroyOnClose>
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="name"
                        label={uiText.createNodeDialog.nameLabel}
                        rules={[{ required: true, message: uiText.createNodeDialog.nameRequired }]}
                    >
                        <Input placeholder={uiText.createNodeDialog.namePlaceholder} />
                    </Form.Item>

                    <Form.Item
                        name="type"
                        label={uiText.createNodeDialog.typeLabel}
                        rules={[{ required: true, message: uiText.createNodeDialog.typeRequired }]}
                    >
                        <Select>
                            <Option value={NodeType.BONE}>{uiText.createNodeDialog.typeOptions.bone}</Option>
                            <Option value={NodeType.HELPER}>{uiText.createNodeDialog.typeOptions.helper}</Option>
                            <Option value={NodeType.ATTACHMENT}>{uiText.createNodeDialog.typeOptions.attachment}</Option>
                            <Option value={NodeType.LIGHT}>{uiText.createNodeDialog.typeOptions.light}</Option>
                            <Option value={NodeType.PARTICLE_EMITTER}>{uiText.createNodeDialog.typeOptions.particleEmitter1}</Option>
                            <Option value={NodeType.PARTICLE_EMITTER_2}>{uiText.createNodeDialog.typeOptions.particleEmitter2}</Option>
                            <Option value={NodeType.RIBBON_EMITTER}>{uiText.createNodeDialog.typeOptions.ribbonEmitter}</Option>
                            <Option value={NodeType.EVENT_OBJECT}>{uiText.createNodeDialog.typeOptions.eventObject}</Option>
                            <Option value={NodeType.COLLISION_SHAPE}>{uiText.createNodeDialog.typeOptions.collisionShape}</Option>
                        </Select>
                    </Form.Item>

                    <Form.Item name="parent" label={uiText.createNodeDialog.parentLabel}>
                        <TreeSelect
                            style={{ width: '100%' }}
                            dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
                            treeData={treeData}
                            placeholder={uiText.createNodeDialog.parentPlaceholder}
                            treeDefaultExpandAll
                            allowClear
                        />
                    </Form.Item>
                </Form>
            </DraggableModal>
        </ConfigProvider>
    )
}
