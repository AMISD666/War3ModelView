/**
 * 节点编辑对话框组件
 * 用于编辑节点的基本属性、位置、变换和标志位
 */

import React, { useEffect, useState } from 'react'
import { Form, Input, Select, Checkbox, Button } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { listen } from '@tauri-apps/api/event'
import { windowManager } from '../../utils/WindowManager'
import type { ModelNode } from '../../types/node'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'
import { validateNodeName } from '../../utils/nodeUtils'


interface NodeDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: ModelNode | null
    standaloneEmit?: (command: string, payload?: any) => void
    standaloneModelData?: { GlobalSequences?: any[]; Sequences?: any[] } | null
    standaloneAllNodes?: ModelNode[]
}

const NodeDialog: React.FC<NodeDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
    standaloneAllNodes,
}) => {
    const [form] = Form.useForm()
    const { getNodeById, updateNode, getAllNodes, modelData: storeModelData } = useModelStore()
    const modelData = isStandalone ? standaloneModelData : storeModelData

    // 获取当前编辑的节点
    const currentNode =
        nodeId !== null
            ? (isStandalone ? (standaloneNode ?? null) : getNodeById(nodeId))
            : null
    const allNodes = isStandalone ? (standaloneAllNodes ?? []) : getAllNodes()

    const applyNodeToStore = React.useCallback(
        (next: ModelNode, history?: { name: string; undoNode: any; redoNode: any }) => {
            if (nodeId === null) return
            if (isStandalone && standaloneEmit) {
                standaloneEmit('APPLY_NODE_UPDATE', { objectId: nodeId, node: next, history })
                return
            }
            if (history) {
                useHistoryStore.getState().push({
                    name: history.name,
                    undo: () => updateNode(nodeId, history.undoNode),
                    redo: () => updateNode(nodeId, history.redoNode),
                })
            }
            updateNode(nodeId, next)
        },
        [isStandalone, standaloneEmit, nodeId, updateNode]
    )
    // Extract global sequence durations (handle both object {Duration} and raw number formats)
    const globalSequences: number[] = (modelData?.GlobalSequences || []).map((gs: any) =>
        typeof gs === 'number' ? gs : (gs.Duration ?? 0)
    )

    // Transform animation data state
    const [translationAnim, setTranslationAnim] = useState<any>(null)
    const [rotationAnim, setRotationAnim] = useState<any>(null)
    const [scalingAnim, setScalingAnim] = useState<any>(null)

    // Keyframe editor state
    const [currentEditingProp, setCurrentEditingProp] = useState<string>('')

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)

    // 仅在打开或切换 nodeId 时灌入表单，避免 store 更新导致失焦与数值被刷掉
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            return
        }
        if (nodeId === null) return
        if (formHydratedForNodeIdRef.current === nodeId) return
        const node = isStandalone ? standaloneNode : useModelStore.getState().getNodeById(nodeId)
        if (!node) return
        formHydratedForNodeIdRef.current = nodeId
        const currentNode = node
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
    }, [visible, nodeId, isStandalone, standaloneNode, form])

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
                PivotPoint: [Number(values.pivotX), Number(values.pivotY), Number(values.pivotZ)],
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
                const oldNode = currentNode
                const newNode = updatedNode

                applyNodeToStore(updatedNode, {
                    name: `Edit Node "${values.name}"`,
                    undoNode: oldNode,
                    redoNode: newNode,
                })
            }
            onClose()
        } catch (error) {
            console.error('表单验证失败:', error)
        }
    }

    // Keyframe editor handlers
    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'NodeDialog') {
                if (currentEditingProp === 'Translation') setTranslationAnim(payload.data)
                else if (currentEditingProp === 'Rotation') setRotationAnim(payload.data)
                else if (currentEditingProp === 'Scaling') setScalingAnim(payload.data)
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [currentEditingProp]);

    const handleOpenKeyframeEditor = (propName: string, title: string, vectorSize: number) => {
        setCurrentEditingProp(propName)

        // Get current animation data
        let data = null
        if (propName === 'Translation') data = translationAnim
        else if (propName === 'Rotation') data = rotationAnim
        else if (propName === 'Scaling') data = scalingAnim

        const payload = {
            callerId: 'NodeDialog',
            initialData: data,
            title: `编辑: ${title}`,
            vectorSize,
            fieldName: propName,
            sequences: modelData?.Sequences || [],
            globalSequences: globalSequences
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
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

    const lookupNode = (id: number): ModelNode | undefined => {
        if (isStandalone && standaloneAllNodes && standaloneAllNodes.length > 0) {
            return standaloneAllNodes.find((n) => n.ObjectId === id)
        }
        return getNodeById(id)
    }

    const gb: React.CSSProperties = {
        border: '1px solid #3a3a3a',
        borderRadius: 4,
        padding: '8px 10px',
        backgroundColor: '#252525',
        minWidth: 0,
        boxSizing: 'border-box',
    }
    const gbTitle: React.CSSProperties = {
        fontSize: 11,
        color: '#9a9a9a',
        marginBottom: 6,
        fontWeight: 600,
    }

    const pivotRow = (axis: string, field: 'pivotX' | 'pivotY' | 'pivotZ') => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ width: 14, flexShrink: 0, color: '#aaa', fontSize: 12 }}>{axis}</span>
            <Form.Item name={field} noStyle>
                <InputNumber style={{ width: '100%', minWidth: 0 }} step={0.1} precision={4} />
            </Form.Item>
        </div>
    )

    const transformRow = (
        label: string,
        anim: boolean,
        prop: 'Translation' | 'Rotation' | 'Scaling',
        title: string,
        vec: number
    ) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
            <span style={{ width: 28, flexShrink: 0, fontSize: 11, color: '#bbb' }}>{label}</span>
            <Checkbox
                checked={anim}
                onChange={(e) => handleDynamicToggle(prop, e.target.checked)}
                style={{ color: '#ccc', fontSize: 11 }}
            >
                动态
            </Checkbox>
            <Button
                size="small"
                onClick={() => handleOpenKeyframeEditor(prop, title, vec)}
                disabled={!anim}
                style={{ flex: 1, minWidth: 0, padding: '0 4px', fontSize: 11 }}
            >
                关键帧
            </Button>
        </div>
    )

    const nodeFormInner = (
            <Form
                className="node-dialog-form-compact node-dialog-form-grid2"
                form={form}
                layout="vertical"
                size="small"
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
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
                {/* 图2 第1行：名字 + 父/ID */}
                <div style={gb}>
                    <div style={gbTitle}>名字</div>
                    <Form.Item
                        name="name"
                        rules={[{ required: true, message: '请输入节点名称' }]}
                        style={{ marginBottom: 8 }}
                    >
                        <Input placeholder="节点名称" maxLength={80} size="small" />
                    </Form.Item>
                    {/* flex 子项需 minWidth:0 + basis 0，否则 Select 抢不到剩余宽度；ID 用定宽壳避免 InputNumber 被撑满一行 */}
                    <div
                        className="node-dialog-parent-id-row"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            flexWrap: 'nowrap',
                            width: '100%',
                        }}
                    >
                        <span style={{ flexShrink: 0, fontSize: 12, color: '#888', width: 26 }}>父节点</span>
                        <div style={{ flex: '1 1 0%', minWidth: 0, width: 0 }}>
                            <Form.Item name="parent" noStyle style={{ marginBottom: 0, width: '100%' }}>
                                <Select
                                    options={parentOptions}
                                    showSearch
                                    placeholder="父节点"
                                    size="small"
                                    style={{ width: '100%', minWidth: 0 }}
                                    filterOption={(input, option) =>
                                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                    }
                                />
                            </Form.Item>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: 12, color: '#888', width: 16 }}>ID</span>
                        <div
                            style={{
                                flex: '0 0 50px',
                                width: 60,
                                minWidth: 60,
                                maxWidth: 60,
                                overflow: 'hidden',
                            }}
                        >
                            <Form.Item name="objectId" noStyle style={{ marginBottom: 0, width: '100%' }}>
                                <InputNumber
                                    disabled
                                    size="small"
                                    controls={false}
                                    style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        fontVariantNumeric: 'tabular-nums',
                                        paddingInline: 4,
                                    }}
                                />
                            </Form.Item>
                        </div>
                    </div>
                </div>

                {/* 图2 第2行：左轴心 | 右变换 */}
                <div
                    style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'stretch',
                        minHeight: 0,
                    }}
                >
                    <div style={{ ...gb, flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ ...gbTitle, marginBottom: 0 }}>轴心点</span>
                            <Button
                                type="link"
                                size="small"
                                style={{ padding: 0, height: 'auto', fontSize: 11 }}
                                onClick={() => {
                                    const parentId = form.getFieldValue('parent');
                                    if (parentId === -1 || parentId === undefined) {
                                        form.setFieldsValue({ pivotX: 0, pivotY: 0, pivotZ: 0 });
                                    } else {
                                        const parentNode = lookupNode(parentId);
                                        if (parentNode && parentNode.PivotPoint) {
                                            form.setFieldsValue({
                                                pivotX: parentNode.PivotPoint[0] || 0,
                                                pivotY: parentNode.PivotPoint[1] || 0,
                                                pivotZ: parentNode.PivotPoint[2] || 0
                                            });
                                        }
                                    }
                                }}
                            >
                                复制父轴心
                            </Button>
                        </div>
                        {pivotRow('X', 'pivotX')}
                        {pivotRow('Y', 'pivotY')}
                        {pivotRow('Z', 'pivotZ')}
                    </div>
                    <div style={{ ...gb, flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
                        <div style={gbTitle}>变换</div>
                        {transformRow('位移', !!translationAnim, 'Translation', '位移动画 (Translation)', 3)}
                        {transformRow('旋转', !!rotationAnim, 'Rotation', '旋转动画 (Rotation)', 4)}
                        {transformRow('缩放', !!scalingAnim, 'Scaling', '缩放动画 (Scaling)', 3)}
                    </div>
                </div>

                {/* 图2 第3行：左标记列表 | 右确定/取消 */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', minHeight: 0 }}>
                    <div style={{ ...gb, flex: 1, marginBottom: 0, minWidth: 0 }}>
                        <div style={gbTitle}>标记</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                <Form.Item name="dontInheritTranslation" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>不继承位移</Checkbox>
                                </Form.Item>
                                <Form.Item name="dontInheritRotation" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>不继承旋转</Checkbox>
                                </Form.Item>
                                <Form.Item name="dontInheritScaling" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>不继承缩放</Checkbox>
                                </Form.Item>
                                <Form.Item name="cameraAnchored" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>相机锚定</Checkbox>
                                </Form.Item>
                            </div>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                <Form.Item name="billboarded" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>广告板</Checkbox>
                                </Form.Item>
                                <Form.Item name="billboardedLockX" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>广告板锁定 X 轴</Checkbox>
                                </Form.Item>
                                <Form.Item name="billboardedLockY" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>广告板锁定 Y 轴</Checkbox>
                                </Form.Item>
                                <Form.Item name="billboardedLockZ" valuePropName="checked" noStyle>
                                    <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>广告板锁定 Z 轴</Checkbox>
                                </Form.Item>
                            </div>
                        </div>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-end',
                            gap: 8,
                            flexShrink: 0,
                            width: 70,
                            paddingBottom: 0,
                        }}
                    >
                        <Button type="primary" size="small" block onClick={() => void handleSave()}>
                            保存
                        </Button>
                        <Button size="small" block onClick={onClose}>
                            取消
                        </Button>
                    </div>
                </div>
            </Form>
    )

    if (isStandalone) {
        return (
            <NodeEditorStandaloneShell dense>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {nodeFormInner}
                </div>
            </NodeEditorStandaloneShell>
        )
    }

    return (
        <DraggableModal
            title={`编辑节点: ${currentNode?.Name || ''}`}
            open={visible}
            onCancel={onClose}
            footer={null}
            width={500}
            wrapClassName="dark-theme-modal"
            maskClosable={false}
            styles={{ body: { padding: '12px 14px' } }}
        >
            {nodeFormInner}
        </DraggableModal>
    )
}

export default NodeDialog


