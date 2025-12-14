/**
 * 节点编辑对话框组件
 * 用于编辑节点的基本属性、位置、变换和标志位
 */

import React, { useEffect, useState } from 'react'
import { Form, Input, InputNumber, Select, Checkbox, Row, Col, Card, Button, message } from 'antd'
import { DraggableModal } from '../DraggableModal'
import KeyframeEditor from '../editors/KeyframeEditor'
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
    const { getNodeById, updateNode, getAllNodes, modelData } = useModelStore()

    // 获取当前编辑的节点
    const currentNode = nodeId !== null ? getNodeById(nodeId) : null
    const allNodes = getAllNodes()
    // Extract global sequence durations (handle both object {Duration} and raw number formats)
    const globalSequences: number[] = (modelData?.GlobalSequences || []).map((gs: any) =>
        typeof gs === 'number' ? gs : (gs.Duration ?? 0)
    )

    // Transform animation data state
    const [translationAnim, setTranslationAnim] = useState<any>(null)
    const [rotationAnim, setRotationAnim] = useState<any>(null)
    const [scalingAnim, setScalingAnim] = useState<any>(null)

    // Keyframe editor state
    const [keyframeEditorVisible, setKeyframeEditorVisible] = useState(false)
    const [keyframeEditorTitle, setKeyframeEditorTitle] = useState('')
    const [keyframeEditorData, setKeyframeEditorData] = useState<any>(null)
    const [keyframeEditorVectorSize, setKeyframeEditorVectorSize] = useState(3)
    const [currentEditingProp, setCurrentEditingProp] = useState<string>('')

    // 当节点改变时，更新表单值
    useEffect(() => {
        if (currentNode) {
            form.setFieldsValue({
                name: currentNode.Name,
                parent: currentNode.Parent,
                objectId: currentNode.ObjectId,
                // Direct 1:1 PivotPoint mapping - no swap
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
            // Load transform animation data
            setTranslationAnim(currentNode.Translation || null)
            setRotationAnim(currentNode.Rotation || null)
            setScalingAnim(currentNode.Scaling || null)
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
            // Direct 1:1 PivotPoint mapping
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
                CameraAnchored: values.cameraAnchored,
                // Include transform animations
                Translation: translationAnim || undefined,
                Rotation: rotationAnim || undefined,
                Scaling: scalingAnim || undefined
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

    // Keyframe editor handlers
    const handleOpenKeyframeEditor = (propName: string, title: string, vectorSize: number) => {
        setCurrentEditingProp(propName)
        setKeyframeEditorTitle(title)
        setKeyframeEditorVectorSize(vectorSize)

        // Get current animation data
        let data = null
        if (propName === 'Translation') data = translationAnim
        else if (propName === 'Rotation') data = rotationAnim
        else if (propName === 'Scaling') data = scalingAnim

        setKeyframeEditorData(data)
        setKeyframeEditorVisible(true)
    }

    const handleKeyframeSave = (animVector: any) => {
        if (currentEditingProp === 'Translation') setTranslationAnim(animVector)
        else if (currentEditingProp === 'Rotation') setRotationAnim(animVector)
        else if (currentEditingProp === 'Scaling') setScalingAnim(animVector)
        setKeyframeEditorVisible(false)
    }

    const handleDynamicToggle = (propName: string, checked: boolean) => {
        if (checked) {
            // Create default animation with single keyframe
            const defaultAnim = {
                Keys: [{ Frame: 0, Vector: propName === 'Rotation' ? [0, 0, 0, 1] : [0, 0, 0] }],
                LineType: 1,
                GlobalSeqId: null
            }
            if (propName === 'Translation') setTranslationAnim(defaultAnim)
            else if (propName === 'Rotation') setRotationAnim(defaultAnim)
            else if (propName === 'Scaling') setScalingAnim({ ...defaultAnim, Keys: [{ Frame: 0, Vector: [1, 1, 1] }] })
        } else {
            if (propName === 'Translation') setTranslationAnim(null)
            else if (propName === 'Rotation') setRotationAnim(null)
            else if (propName === 'Scaling') setScalingAnim(null)
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
        <DraggableModal
            title={`编辑节点: ${currentNode?.Name || ''}`}
            open={visible}
            onOk={handleSave}
            onCancel={onClose}
            width={600}
            okText="保存"
            cancelText="取消"
            wrapClassName="dark-theme-modal"
            maskClosable={false}
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
                {/* Basic Info */}
                <Card size="small" title="基础信息" style={{ marginBottom: 16 }}>
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
                            <Form.Item label="Object ID" name="objectId">
                                <InputNumber disabled style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Card>

                {/* Pivot Point */}
                <Card size="small" title="轴心点 (Pivot Point)" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <Form.Item name="pivotX" label="X" style={{ flex: 1, marginBottom: 0 }}>
                            <InputNumber style={{ width: '100%' }} step={0.1} precision={4} />
                        </Form.Item>
                        <Form.Item name="pivotY" label="Y" style={{ flex: 1, marginBottom: 0 }}>
                            <InputNumber style={{ width: '100%' }} step={0.1} precision={4} />
                        </Form.Item>
                        <Form.Item name="pivotZ" label="Z" style={{ flex: 1, marginBottom: 0 }}>
                            <InputNumber style={{ width: '100%' }} step={0.1} precision={4} />
                        </Form.Item>
                    </div>
                </Card>

                {/* Transform Animations */}
                <Card size="small" title="变换 (Transform)" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                        {/* Translation */}
                        <div style={{ flex: 1, border: '1px solid #484848', padding: '8px', borderRadius: 4, backgroundColor: '#2b2b2b' }}>
                            <div style={{ marginBottom: 6, fontSize: 12, color: '#ccc' }}>位移 (Translation)</div>
                            <Checkbox
                                checked={!!translationAnim}
                                onChange={(e) => handleDynamicToggle('Translation', e.target.checked)}
                                style={{ color: '#ccc', fontSize: 12, marginBottom: 6 }}
                            >
                                动态化
                            </Checkbox>
                            <Button
                                block
                                size="small"
                                onClick={() => handleOpenKeyframeEditor('Translation', '位移动画 (Translation)', 3)}
                                disabled={!translationAnim}
                                style={{ backgroundColor: '#444', color: translationAnim ? '#fff' : '#888', borderColor: '#555' }}
                            >
                                编辑关键帧
                            </Button>
                        </div>

                        {/* Rotation */}
                        <div style={{ flex: 1, border: '1px solid #484848', padding: '8px', borderRadius: 4, backgroundColor: '#2b2b2b' }}>
                            <div style={{ marginBottom: 6, fontSize: 12, color: '#ccc' }}>旋转 (Rotation)</div>
                            <Checkbox
                                checked={!!rotationAnim}
                                onChange={(e) => handleDynamicToggle('Rotation', e.target.checked)}
                                style={{ color: '#ccc', fontSize: 12, marginBottom: 6 }}
                            >
                                动态化
                            </Checkbox>
                            <Button
                                block
                                size="small"
                                onClick={() => handleOpenKeyframeEditor('Rotation', '旋转动画 (Rotation)', 4)}
                                disabled={!rotationAnim}
                                style={{ backgroundColor: '#444', color: rotationAnim ? '#fff' : '#888', borderColor: '#555' }}
                            >
                                编辑关键帧
                            </Button>
                        </div>

                        {/* Scaling */}
                        <div style={{ flex: 1, border: '1px solid #484848', padding: '8px', borderRadius: 4, backgroundColor: '#2b2b2b' }}>
                            <div style={{ marginBottom: 6, fontSize: 12, color: '#ccc' }}>缩放 (Scaling)</div>
                            <Checkbox
                                checked={!!scalingAnim}
                                onChange={(e) => handleDynamicToggle('Scaling', e.target.checked)}
                                style={{ color: '#ccc', fontSize: 12, marginBottom: 6 }}
                            >
                                动态化
                            </Checkbox>
                            <Button
                                block
                                size="small"
                                onClick={() => handleOpenKeyframeEditor('Scaling', '缩放动画 (Scaling)', 3)}
                                disabled={!scalingAnim}
                                style={{ backgroundColor: '#444', color: scalingAnim ? '#fff' : '#888', borderColor: '#555' }}
                            >
                                编辑关键帧
                            </Button>
                        </div>
                    </div>
                </Card>

                {/* Flags */}
                <Row gutter={16}>
                    <Col span={12}>
                        <Card size="small" title="继承设置 (DontInherit)">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <Form.Item name="dontInheritTranslation" valuePropName="checked" noStyle><Checkbox>位移 (Translation)</Checkbox></Form.Item>
                                <Form.Item name="dontInheritRotation" valuePropName="checked" noStyle><Checkbox>旋转 (Rotation)</Checkbox></Form.Item>
                                <Form.Item name="dontInheritScaling" valuePropName="checked" noStyle><Checkbox>缩放 (Scaling)</Checkbox></Form.Item>
                            </div>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card size="small" title="广告板 & 其他">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <Form.Item name="billboarded" valuePropName="checked" noStyle>
                                    <Checkbox>启用广告板</Checkbox>
                                </Form.Item>
                                <Form.Item name="cameraAnchored" valuePropName="checked" noStyle><Checkbox>相机锚定</Checkbox></Form.Item>
                                <div style={{ borderTop: '1px solid #444', margin: '4px 0' }}></div>
                                <Form.Item name="billboardedLockX" valuePropName="checked" noStyle><Checkbox>锁定 X 轴</Checkbox></Form.Item>
                                <Form.Item name="billboardedLockY" valuePropName="checked" noStyle><Checkbox>锁定 Y 轴</Checkbox></Form.Item>
                                <Form.Item name="billboardedLockZ" valuePropName="checked" noStyle><Checkbox>锁定 Z 轴</Checkbox></Form.Item>
                            </div>
                        </Card>
                    </Col>
                </Row>
            </Form>

            {/* Keyframe Editor Modal */}
            <KeyframeEditor
                visible={keyframeEditorVisible}
                onCancel={() => setKeyframeEditorVisible(false)}
                onOk={handleKeyframeSave}
                initialData={keyframeEditorData}
                title={keyframeEditorTitle}
                vectorSize={keyframeEditorVectorSize}
                globalSequences={globalSequences}
            />
        </DraggableModal>
    )
}

export default NodeDialog

