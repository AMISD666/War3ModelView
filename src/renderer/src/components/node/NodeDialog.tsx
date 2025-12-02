/**
 * 节点编辑对话框组件
 * 用于编辑节点的基本属性、位置和标志位
 */

import React, { useEffect } from 'react'
import { Modal, Form, Input, InputNumber, Select, Checkbox, Space, Row, Col } from 'antd'
import type { ModelNode } from '../../types/node'
import { useModelStore } from '../../store/modelStore'
import { validateNodeName } from '../../utils/nodeUtils'

interface NodeDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
}

const NodeDialog: React.FC<NodeDialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm()
    const { getNodeById, updateNode, getAllNodes } = useModelStore()

    // 获取当前编辑的节点
    const currentNode = nodeId !== null ? getNodeById(nodeId) : null
    const allNodes = getAllNodes()

    // 当节点改变时，更新表单值
    useEffect(() => {
        if (currentNode) {
            form.setFieldsValue({
                name: currentNode.Name,
                parent: currentNode.Parent,
                objectId: currentNode.ObjectId,
                pivotX: currentNode.PivotPoint?.[0] || 0,
                pivotY: currentNode.PivotPoint?.[1] || 0,
                pivotZ: currentNode.PivotPoint?.[2] || 0,
                dontInheritTranslation: currentNode.DontInherit?.Translation || false,
                dontInheritRotation: currentNode.DontInherit?.Rotation || false,
                dontInheritScaling: currentNode.DontInherit?.Scaling || false,
                billboarded: currentNode.Billboarded || false,
                billboardedLockX: currentNode.BillboardedLockX || false,
                billboardedLockY: currentNode.BillboardedLockY || false,
                billboardedLockZ: currentNode.BillboardedLockZ || false,
                cameraAnchored: currentNode.CameraAnchored || false
            })
        }
    }, [currentNode, form])

    // 处理保存
    const handleSave = async () => {
        try {
            const values = await form.validateFields()

            if (nodeId === null || !currentNode) return

            // 验证节点名称
            const nameValidation = validateNodeName(values.name)
            if (!nameValidation.valid) {
                form.setFields([{ name: 'name', errors: [nameValidation.error!] }])
                return
            }

            // 构建更新后的节点数据
            const updatedNode: ModelNode = {
                ...currentNode,
                Name: values.name,
                Parent: values.parent,
                PivotPoint: [values.pivotX, values.pivotY, values.pivotZ],
                DontInherit: {
                    Translation: values.dontInheritTranslation,
                    Rotation: values.dontInheritRotation,
                    Scaling: values.dontInheritScaling
                },
                Billboarded: values.billboarded,
                BillboardedLockX: values.billboardedLockX,
                BillboardedLockY: values.billboardedLockY,
                BillboardedLockZ: values.billboardedLockZ,
                CameraAnchored: values.cameraAnchored
            }

            // 更新节点
            if (nodeId !== null) {
                updateNode(nodeId, updatedNode)
            }
            onClose()
        } catch (error) {
            console.error('表单验证失败:', error)
        }
    }

    // 父节点选项（排除自己和自己的子节点）
    const parentOptions = allNodes
        .filter(node => node.ObjectId !== nodeId) // 不能是自己
        .map(node => ({
            label: `${node.Name} (ID: ${node.ObjectId})`,
            value: node.ObjectId
        }))

    // 添加"无父节点"选项
    parentOptions.unshift({ label: '无父节点', value: -1 })

    return (
        <Modal
            title={`编辑节点: ${currentNode?.Name || ''}`}
            open={visible}
            onOk={handleSave}
            onCancel={onClose}
            width={700}
            okText="保存"
            cancelText="取消"
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    parent: -1,
                    pivotX: 0,
                    pivotY: 0,
                    pivotZ: 0,
                    dontInheritTranslation: false,
                    dontInheritRotation: false,
                    dontInheritScaling: false,
                    billboarded: false,
                    billboardedLockX: false,
                    billboardedLockY: false,
                    billboardedLockZ: false,
                    cameraAnchored: false
                }}
            >
                {/* 基础属性 */}
                <Form.Item
                    label="节点名称"
                    name="name"
                    rules={[{ required: true, message: '请输入节点名称' }]}
                >
                    <Input placeholder="输入节点名称" maxLength={80} />
                </Form.Item>

                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item label="父节点" name="parent">
                            <Select
                                options={parentOptions}
                                showSearch
                                placeholder="选择父节点"
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item label="对象ID" name="objectId">
                            <InputNumber disabled style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>

                {/* 轴心点位置 */}
                <Form.Item label="轴心点 (PivotPoint)">
                    <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="pivotX" noStyle>
                            <InputNumber placeholder="X" style={{ width: '33.33%' }} step={0.1} />
                        </Form.Item>
                        <Form.Item name="pivotY" noStyle>
                            <InputNumber placeholder="Y" style={{ width: '33.33%' }} step={0.1} />
                        </Form.Item>
                        <Form.Item name="pivotZ" noStyle>
                            <InputNumber placeholder="Z" style={{ width: '33.33%' }} step={0.1} />
                        </Form.Item>
                    </Space.Compact>
                </Form.Item>

                {/* 继承标志 */}
                <Form.Item label="不继承属性 (DontInherit)">
                    <Space direction="vertical">
                        <Form.Item name="dontInheritTranslation" valuePropName="checked" noStyle>
                            <Checkbox>不继承位移 (Translation)</Checkbox>
                        </Form.Item>
                        <Form.Item name="dontInheritRotation" valuePropName="checked" noStyle>
                            <Checkbox>不继承旋转 (Rotation)</Checkbox>
                        </Form.Item>
                        <Form.Item name="dontInheritScaling" valuePropName="checked" noStyle>
                            <Checkbox>不继承缩放 (Scaling)</Checkbox>
                        </Form.Item>
                    </Space>
                </Form.Item>

                {/* 广告板标志 */}
                <Form.Item label="广告板设置 (Billboarded)">
                    <Space direction="vertical">
                        <Form.Item name="billboarded" valuePropName="checked" noStyle>
                            <Checkbox>启用广告板</Checkbox>
                        </Form.Item>
                        <Form.Item name="billboardedLockX" valuePropName="checked" noStyle>
                            <Checkbox>锁定 X 轴</Checkbox>
                        </Form.Item>
                        <Form.Item name="billboardedLockY" valuePropName="checked" noStyle>
                            <Checkbox>锁定 Y 轴</Checkbox>
                        </Form.Item>
                        <Form.Item name="billboardedLockZ" valuePropName="checked" noStyle>
                            <Checkbox>锁定 Z 轴</Checkbox>
                        </Form.Item>
                    </Space>
                </Form.Item>

                {/* 相机锚定 */}
                <Form.Item name="cameraAnchored" valuePropName="checked">
                    <Checkbox>相机锚定 (Camera Anchored)</Checkbox>
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default NodeDialog
