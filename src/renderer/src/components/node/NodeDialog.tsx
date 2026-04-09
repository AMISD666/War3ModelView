import React, { useCallback, useEffect, useState } from 'react'
import { Form, Input, Select, Checkbox, Button } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import AppErrorBoundary from '../common/AppErrorBoundary'
import { listen } from '@tauri-apps/api/event'
import { windowManager } from '../../utils/WindowManager'
import type { ModelNode } from '../../types/node'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'
import { validateNodeName } from '../../utils/nodeUtils'
import { uiText } from '../../constants/uiText'
import { useNodeEditorPreview } from '../../hooks/useNodeEditorPreview'
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc'

interface NodeDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: ModelNode | null
    standaloneEmit?: NodeEditorCommandSender
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
    const { getNodeById, updateNode, getAllNodes, modelData: storeModelData, setNodeEditorPreview, clearNodeEditorPreview } = useModelStore()
    const modelData = isStandalone ? standaloneModelData : storeModelData

    const currentNode = nodeId !== null ? (isStandalone ? standaloneNode ?? null : getNodeById(nodeId)) : null
    const allNodes = isStandalone ? standaloneAllNodes ?? [] : getAllNodes()

    const applyCommittedNode = React.useCallback(
        (next: ModelNode, history?: { name: string; undoNode: any; redoNode: any }) => {
            if (nodeId === null) return

            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next, history })
                return
            }

            clearNodeEditorPreview()

            if (history) {
                useHistoryStore.getState().push({
                    name: history.name,
                    undo: () => updateNode(nodeId, history.undoNode),
                    redo: () => updateNode(nodeId, history.redoNode),
                })
            }

            updateNode(nodeId, next)
        },
        [clearNodeEditorPreview, isStandalone, standaloneEmit, nodeId, updateNode]
    )
    const clearPreviewNode = React.useCallback(() => {
        if (isStandalone && standaloneEmit) {
            standaloneEmit(NODE_EDITOR_COMMANDS.clearNodePreview, { objectId: nodeId })
            return
        }
        clearNodeEditorPreview()
    }, [clearNodeEditorPreview, isStandalone, nodeId, standaloneEmit])

    const globalSequences: number[] = (modelData?.GlobalSequences || []).map((gs: any) =>
        typeof gs === 'number' ? gs : (gs.Duration ?? 0)
    )

    const [translationAnim, setTranslationAnim] = useState<any>(null)
    const [rotationAnim, setRotationAnim] = useState<any>(null)
    const [scalingAnim, setScalingAnim] = useState<any>(null)
    const [currentEditingProp, setCurrentEditingProp] = useState<string>('')
    const currentEditingPropRef = React.useRef<string>('')

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            clearPreviewNode()
            return
        }
        if (nodeId === null) return
        if (formHydratedForNodeIdRef.current === nodeId) return

        const node = isStandalone ? standaloneNode : useModelStore.getState().getNodeById(nodeId)
        if (!node) return

        formHydratedForNodeIdRef.current = nodeId

        form.setFieldsValue({
            name: node.Name,
            parent: node.Parent,
            objectId: node.ObjectId,
            pivotX: node.PivotPoint?.[0] || 0,
            pivotY: node.PivotPoint?.[1] || 0,
            pivotZ: node.PivotPoint?.[2] || 0,
            dontInheritTranslation: node.DontInherit?.Translation || false,
            dontInheritRotation: node.DontInherit?.Rotation || false,
            dontInheritScaling: node.DontInherit?.Scaling || false,
            billboarded: node.Billboarded || false,
            billboardedLockX: node.BillboardedLockX || false,
            billboardedLockY: node.BillboardedLockY || false,
            billboardedLockZ: node.BillboardedLockZ || false,
            cameraAnchored: node.CameraAnchored || false,
        })

        setTranslationAnim(node.Translation || null)
        setRotationAnim(node.Rotation || null)
        setScalingAnim(node.Scaling || null)
    }, [clearPreviewNode, visible, nodeId, isStandalone, standaloneNode, form])

    const buildUpdatedNodeFromValues = useCallback((values: any, overrides?: {
        translationAnim?: any
        rotationAnim?: any
        scalingAnim?: any
    }): ModelNode | null => {
        if (!currentNode) return null

        return {
            ...currentNode,
            Name: values.name,
            Parent: values.parent,
            PivotPoint: [Number(values.pivotX), Number(values.pivotY), Number(values.pivotZ)],
            DontInherit: {
                Translation: values.dontInheritTranslation,
                Rotation: values.dontInheritRotation,
                Scaling: values.dontInheritScaling,
            },
            Billboarded: values.billboarded,
            BillboardedLockX: values.billboardedLockX,
            BillboardedLockY: values.billboardedLockY,
            BillboardedLockZ: values.billboardedLockZ,
            CameraAnchored: values.cameraAnchored,
            Translation: overrides?.translationAnim !== undefined ? (overrides.translationAnim || undefined) : (translationAnim || undefined),
            Rotation: overrides?.rotationAnim !== undefined ? (overrides.rotationAnim || undefined) : (rotationAnim || undefined),
            Scaling: overrides?.scalingAnim !== undefined ? (overrides.scalingAnim || undefined) : (scalingAnim || undefined),
        }
    }, [currentNode, rotationAnim, scalingAnim, translationAnim])

    const { schedulePreview } = useNodeEditorPreview<ModelNode>({
        visible,
        nodeId,
        currentNodeObjectId: currentNode?.ObjectId ?? null,
        isStandalone,
        standaloneEmit,
        setStorePreview: ({ objectId, node }) => setNodeEditorPreview({ objectId, node }),
        clearStorePreview: clearNodeEditorPreview,
        buildPreviewNode: () => buildUpdatedNodeFromValues(form.getFieldsValue()),
    })

    const handleCancel = useCallback(() => {
        clearPreviewNode()
        onClose()
    }, [clearPreviewNode, onClose])

    const handleSave = async () => {
        try {
            const values = await form.validateFields()
            if (nodeId === null || !currentNode) return

            const nameValidation = validateNodeName(values.name)
            if (!nameValidation.valid) {
                form.setFields([{ name: 'name', errors: [nameValidation.error!] }])
                return
            }

            const updatedNode = buildUpdatedNodeFromValues(values)
            if (!updatedNode) return

            applyCommittedNode(updatedNode, {
                name: `Edit Node "${values.name}"`,
                undoNode: currentNode,
                redoNode: updatedNode,
            })
            onClose()
        } catch (error) {
            console.error('NodeDialog form validation failed:', error)
        }
    }

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any
            if (payload && payload.callerId === 'NodeDialog') {
                const targetProp = payload.fieldName || currentEditingPropRef.current
                if (targetProp === 'Translation') setTranslationAnim(payload.data)
                else if (targetProp === 'Rotation') setRotationAnim(payload.data)
                else if (targetProp === 'Scaling') setScalingAnim(payload.data)

                if (isStandalone && nodeId !== null) {
                    const values = form.getFieldsValue()
                    const nextNode = buildUpdatedNodeFromValues(values, {
                        translationAnim: targetProp === 'Translation' ? payload.data : undefined,
                        rotationAnim: targetProp === 'Rotation' ? payload.data : undefined,
                        scalingAnim: targetProp === 'Scaling' ? payload.data : undefined,
                    })
                    if (nextNode && standaloneEmit) {
                        standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: nextNode })
                    }
                }

                currentEditingPropRef.current = ''
                setCurrentEditingProp('')
                schedulePreview()
            }
        })

        return () => {
            unlisten.then((f) => f())
        }
    }, [buildUpdatedNodeFromValues, form, isStandalone, nodeId, schedulePreview, standaloneEmit])

    const handleOpenKeyframeEditor = (propName: string, title: string, vectorSize: number) => {
        currentEditingPropRef.current = propName
        setCurrentEditingProp(propName)

        let data = null
        if (propName === 'Translation') data = translationAnim
        else if (propName === 'Rotation') data = rotationAnim
        else if (propName === 'Scaling') data = scalingAnim

        const payload = {
            callerId: 'NodeDialog',
            initialData: data,
            title: `${uiText.nodeDialog.editNode}: ${title}`,
            vectorSize,
            fieldName: propName,
            sequences: modelData?.Sequences || [],
            globalSequences,
        }

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName)
        payload.targetWindowId = windowId

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload)
    }

    const handleDynamicToggle = (propName: string, checked: boolean) => {
        if (checked) {
            const defaultAnim = {
                Keys: [{ Frame: 0, Vector: propName === 'Rotation' ? [0, 0, 0, 1] : [0, 0, 0] }],
                LineType: 1,
                GlobalSeqId: null,
            }

            if (propName === 'Translation') setTranslationAnim(defaultAnim)
            else if (propName === 'Rotation') setRotationAnim(defaultAnim)
            else if (propName === 'Scaling') {
                setScalingAnim({ ...defaultAnim, Keys: [{ Frame: 0, Vector: [1, 1, 1] }] })
            }
        } else {
            if (propName === 'Translation') setTranslationAnim(null)
            else if (propName === 'Rotation') setRotationAnim(null)
            else if (propName === 'Scaling') setScalingAnim(null)
        }
        schedulePreview()
    }

    const parentOptions = allNodes
        .filter((node) => node.ObjectId !== nodeId)
        .map((node) => ({
            label: `${node.Name} (ID: ${node.ObjectId})`,
            value: node.ObjectId,
        }))

    parentOptions.unshift({ label: uiText.nodeDialog.noParent, value: -1 })

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
            <span style={{ width: 14, flexShrink: 0, color: '#aaa', fontSize: 12 }}>
                {axis}
            </span>
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
            <Checkbox checked={anim} onChange={(e) => handleDynamicToggle(prop, e.target.checked)} style={{ color: '#ccc', fontSize: 11 }}>
                {uiText.nodeDialog.dynamic}
            </Checkbox>
            <Button
                size="small"
                onClick={() => handleOpenKeyframeEditor(prop, title, vec)}
                disabled={!anim}
                style={{ flex: 1, minWidth: 0, padding: '0 4px', fontSize: 11 }}
            >
                {uiText.nodeDialog.keyframes}
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
            onValuesChange={() => {
                schedulePreview()
            }}
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
                cameraAnchored: false,
            }}
        >
            <div style={gb}>
                <div style={gbTitle}>{uiText.nodeDialog.nameGroup}</div>
                <Form.Item name="name" rules={[{ required: true, message: uiText.nodeDialog.nameRequired }]} style={{ marginBottom: 8 }}>
                    <Input placeholder={uiText.nodeDialog.namePlaceholder} maxLength={80} size="small" />
                </Form.Item>
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
                    <span style={{ flexShrink: 0, fontSize: 12, color: '#888', width: 26 }}>{uiText.nodeDialog.parentLabel}</span>
                    <div style={{ flex: '1 1 0%', minWidth: 0, width: 0 }}>
                        <Form.Item name="parent" noStyle style={{ marginBottom: 0, width: '100%' }}>
                            <Select
                                options={parentOptions}
                                showSearch
                                placeholder={uiText.nodeDialog.parentPlaceholder}
                                size="small"
                                style={{ width: '100%', minWidth: 0 }}
                                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
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

            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', minHeight: 0 }}>
                <div style={{ ...gb, flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ ...gbTitle, marginBottom: 0 }}>{uiText.nodeDialog.pivotGroup}</span>
                        <Button
                            type="link"
                            size="small"
                            style={{ padding: 0, height: 'auto', fontSize: 11 }}
                            onClick={() => {
                                const parentId = form.getFieldValue('parent')
                                if (parentId === -1 || parentId === undefined) {
                                    form.setFieldsValue({ pivotX: 0, pivotY: 0, pivotZ: 0 })
                                    return
                                }

                                const parentNode = lookupNode(parentId)
                                if (parentNode && parentNode.PivotPoint) {
                                    form.setFieldsValue({
                                        pivotX: parentNode.PivotPoint[0] || 0,
                                        pivotY: parentNode.PivotPoint[1] || 0,
                                        pivotZ: parentNode.PivotPoint[2] || 0,
                                    })
                                }
                            }}
                        >
                            {uiText.nodeDialog.copyParentPivot}
                        </Button>
                    </div>
                    {pivotRow('X', 'pivotX')}
                    {pivotRow('Y', 'pivotY')}
                    {pivotRow('Z', 'pivotZ')}
                </div>

                <div style={{ ...gb, flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
                    <div style={gbTitle}>{uiText.nodeDialog.transformGroup}</div>
                    {transformRow(uiText.nodeDialog.translate, !!translationAnim, 'Translation', uiText.nodeDialog.translate, 3)}
                    {transformRow(uiText.nodeDialog.rotate, !!rotationAnim, 'Rotation', uiText.nodeDialog.rotate, 4)}
                    {transformRow(uiText.nodeDialog.scale, !!scalingAnim, 'Scaling', uiText.nodeDialog.scale, 3)}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', minHeight: 0 }}>
                <div style={{ ...gb, flex: 1, marginBottom: 0, minWidth: 0 }}>
                    <div style={gbTitle}>{uiText.nodeDialog.flagsGroup}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <Form.Item name="dontInheritTranslation" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.dontInheritTranslation}</Checkbox>
                            </Form.Item>
                            <Form.Item name="dontInheritRotation" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.dontInheritRotation}</Checkbox>
                            </Form.Item>
                            <Form.Item name="dontInheritScaling" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.dontInheritScaling}</Checkbox>
                            </Form.Item>
                            <Form.Item name="cameraAnchored" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.cameraAnchored}</Checkbox>
                            </Form.Item>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <Form.Item name="billboarded" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.billboarded}</Checkbox>
                            </Form.Item>
                            <Form.Item name="billboardedLockX" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.billboardedLockX}</Checkbox>
                            </Form.Item>
                            <Form.Item name="billboardedLockY" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.billboardedLockY}</Checkbox>
                            </Form.Item>
                            <Form.Item name="billboardedLockZ" valuePropName="checked" noStyle>
                                <Checkbox style={{ fontSize: 11, lineHeight: 1.4 }}>{uiText.nodeDialog.billboardedLockZ}</Checkbox>
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
                        {uiText.nodeDialog.save}
                    </Button>
                    <Button size="small" block onClick={handleCancel}>
                        {uiText.nodeDialog.cancel}
                    </Button>
                </div>
            </div>
        </Form>
    )

    if (isStandalone) {
        return (
            <NodeEditorStandaloneShell dense>
                <AppErrorBoundary scope="Node Dialog" compact>
                    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                        {nodeFormInner}
                    </div>
                </AppErrorBoundary>
            </NodeEditorStandaloneShell>
        )
    }

    return (
        <DraggableModal
            title={`${uiText.nodeDialog.titlePrefix}${currentNode?.Name || ''}`}
            open={visible}
            onCancel={handleCancel}
            footer={null}
            width={500}
            wrapClassName="dark-theme-modal"
            maskClosable={false}
            styles={{ body: { padding: '12px 14px' } }}
        >
            <AppErrorBoundary scope="Node Dialog" compact>
                {nodeFormInner}
            </AppErrorBoundary>
        </DraggableModal>
    )
}

export default NodeDialog
