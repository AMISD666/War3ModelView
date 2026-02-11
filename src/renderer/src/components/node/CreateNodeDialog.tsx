import React, { useEffect } from 'react';
import { Form, Input, Select, TreeSelect, ConfigProvider, theme } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useUIStore } from '../../store/uiStore';
import { NodeType } from '../../types/node';
import { buildTreeData } from '../../utils/treeUtils';
import { isNodeManagerType } from '../../utils/nodeUtils';

const { Option } = Select;

export const CreateNodeDialog: React.FC = () => {
    const { showCreateNodeDialog, setCreateNodeDialogVisible } = useUIStore();
    const { nodes, addNode } = useModelStore();
    const { selectedNodeIds } = useSelectionStore();
    const [form] = Form.useForm();

    // 构建父节点选择树（节点管理器同样的节点集合）
    const nodeManagerNodes = React.useMemo(() => nodes.filter(n => isNodeManagerType(n.type)), [nodes]);
    const treeData = React.useMemo(() => buildTreeData(nodeManagerNodes), [nodeManagerNodes]);

    // 重置表单
    useEffect(() => {
        if (showCreateNodeDialog) {
            form.resetFields();
            // 默认选中 Bone 类型，默认名称为 default
            form.setFieldsValue({
                name: 'default',
                type: NodeType.BONE,
                // Auto-select parent from selected node
                parent: selectedNodeIds.length > 0 ? selectedNodeIds[0] : undefined
            });
        }
    }, [showCreateNodeDialog, form, selectedNodeIds]);

    const handleOk = () => {
        form.validateFields().then((values) => {
            addNode({
                Name: values.name,
                type: values.type,
                Parent: values.parent ?? -1,
            });
            setCreateNodeDialogVisible(false);
        });
    };

    const handleCancel = () => {
        setCreateNodeDialogVisible(false);
    };

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
                }
            }}
        >
            <DraggableModal
                title="创建新节点"
                open={showCreateNodeDialog}
                onOk={handleOk}
                onCancel={handleCancel}
                destroyOnClose
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="name"
                        label="节点名称"
                        rules={[{ required: true, message: '请输入节点名称' }]}
                    >
                        <Input placeholder="例如: NewBone" />
                    </Form.Item>

                    <Form.Item
                        name="type"
                        label="节点类型"
                        rules={[{ required: true, message: '请选择节点类型' }]}
                    >
                        <Select>
                            <Option value={NodeType.BONE}>Bone (骨骼)</Option>
                            <Option value={NodeType.HELPER}>Helper (帮助体)</Option>
                            <Option value={NodeType.ATTACHMENT}>Attachment (附着体)</Option>
                            <Option value={NodeType.LIGHT}>Light (光照)</Option>
                            <Option value={NodeType.PARTICLE_EMITTER}>ParticleEmitter1（I型粒子发射器）</Option>
                            <Option value={NodeType.PARTICLE_EMITTER_2}>ParticleEmitter2 (2型粒子发射器)</Option>
                            <Option value={NodeType.RIBBON_EMITTER}>RibbonEmitter (丝带发射器)</Option>
                            <Option value={NodeType.EVENT_OBJECT}>EventObject (事件物体)</Option>
                            <Option value={NodeType.COLLISION_SHAPE}>CollisionShape (点击球)</Option>
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="parent"
                        label="父节点"
                    >
                        <TreeSelect
                            style={{ width: '100%' }}
                            dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
                            treeData={treeData}
                            placeholder="选择父节点 (留空为根节点)"
                            treeDefaultExpandAll
                            allowClear
                        />
                    </Form.Item>
                </Form>
            </DraggableModal>
        </ConfigProvider>
    );
};
