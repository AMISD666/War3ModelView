import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, TreeSelect } from 'antd';
import { useModelStore } from '../../store/modelStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useUIStore } from '../../store/uiStore';
import { NodeType } from '../../types/node';
import { buildTreeData } from '../../utils/treeUtils';

const { Option } = Select;

export const CreateNodeDialog: React.FC = () => {
    const { showCreateNodeDialog, setCreateNodeDialogVisible } = useUIStore();
    const { nodes, addNode } = useModelStore();
    const { selectedNodeIds } = useSelectionStore();
    const [form] = Form.useForm();

    // 构建父节点选择树
    const treeData = React.useMemo(() => buildTreeData(nodes), [nodes]);

    // 重置表单
    useEffect(() => {
        if (showCreateNodeDialog) {
            form.resetFields();
            // 默认选中 Bone 类型
            form.setFieldsValue({
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
        <Modal
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
                        <Option value={NodeType.HELPER}>Helper (辅助点)</Option>
                        <Option value={NodeType.ATTACHMENT}>Attachment (挂载点)</Option>
                        <Option value={NodeType.LIGHT}>Light (灯光)</Option>
                        <Option value={NodeType.PARTICLE_EMITTER}>ParticleEmitter (粒子发射器)</Option>
                        <Option value={NodeType.PARTICLE_EMITTER_2}>ParticleEmitter2 (粒子发射器2)</Option>
                        <Option value={NodeType.RIBBON_EMITTER}>RibbonEmitter (条带发射器)</Option>
                        <Option value={NodeType.EVENT_OBJECT}>EventObject (事件对象)</Option>
                        <Option value={NodeType.COLLISION_SHAPE}>CollisionShape (碰撞体)</Option>
                        <Option value={NodeType.CAMERA}>Camera (摄像机)</Option>
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
        </Modal>
    );
};
