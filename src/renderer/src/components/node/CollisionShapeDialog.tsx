import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useCallback, useEffect } from 'react'
import { Button, Col, Form, Radio, Row } from 'antd'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'
import { useModelStore } from '../../store/modelStore'
import type { CollisionShapeNode } from '../../types/node'
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc'

interface CollisionShapeDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: CollisionShapeNode | null
    standaloneEmit?: NodeEditorCommandSender
}

const fieldsetStyle: React.CSSProperties = {
    border: '1px solid #484848',
    padding: '8px 12px',
    marginBottom: 12,
    backgroundColor: 'transparent',
    borderRadius: 0,
}

const legendStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#ccc',
    padding: '0 6px',
    width: 'auto',
    marginLeft: 4,
    marginBottom: 0,
}

const inputStyle: React.CSSProperties = {
    backgroundColor: '#2b2b2b',
    borderColor: '#484848',
    color: '#fff',
    width: '100%',
}

const CollisionShapeDialog: React.FC<CollisionShapeDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
}) => {
    const [form] = Form.useForm()
    const { getNodeById, updateNode } = useModelStore()

    const currentNode =
        nodeId !== null ? (isStandalone ? (standaloneNode as CollisionShapeNode | null) : (getNodeById(nodeId) as CollisionShapeNode)) : null

    const applyNodeToStore = useCallback(
        (next: CollisionShapeNode) => {
            if (nodeId === null) return
            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next })
                return
            }
            updateNode(nodeId, next)
        },
        [isStandalone, nodeId, standaloneEmit, updateNode]
    )

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            return
        }
        if (nodeId === null || formHydratedForNodeIdRef.current === nodeId) return

        const sourceNode: CollisionShapeNode | null = isStandalone
            ? (standaloneNode as CollisionShapeNode | null)
            : ((useModelStore.getState().getNodeById(nodeId) as CollisionShapeNode | undefined) ?? null)

        if (!sourceNode) {
            formHydratedForNodeIdRef.current = nodeId
            form.setFieldsValue({ ShapeType: 'Box', BoundsRadius: 60, V1X: -50, V1Y: -50, V1Z: 0, V2X: 50, V2Y: 50, V2Z: 100 })
            return
        }

        formHydratedForNodeIdRef.current = nodeId
        let vertex1: [number, number, number] = [0, 0, 0]
        let vertex2: [number, number, number] = [0, 0, 0]
        if (sourceNode.Vertices) {
            const v = sourceNode.Vertices
            if (v instanceof Float32Array || (typeof v[0] === 'number' && v.length >= 3)) {
                const flat = v as unknown as number[]
                vertex1 = [flat[0], flat[1], flat[2]]
                if (flat.length >= 6) vertex2 = [flat[3], flat[4], flat[5]]
            } else if (Array.isArray(v[0])) {
                const arr = v as [number, number, number][]
                vertex1 = arr[0] || [0, 0, 0]
                vertex2 = arr[1] || [0, 0, 0]
            }
        } else {
            vertex1 = sourceNode.Vertex1 || [0, 0, 0]
            vertex2 = sourceNode.Vertex2 || [0, 0, 0]
        }
        const round2 = (n: number) => Math.round(n * 100) / 100
        let initialShapeType = sourceNode.ShapeType ?? 'Box'
        if (sourceNode.Shape !== undefined) initialShapeType = sourceNode.Shape === 2 ? 'Sphere' : 'Box'
        form.setFieldsValue({
            ShapeType: initialShapeType,
            BoundsRadius: round2(sourceNode.BoundsRadius ?? 60),
            V1X: round2(vertex1[0] ?? 0),
            V1Y: round2(vertex1[1] ?? 0),
            V1Z: round2(vertex1[2] ?? 0),
            V2X: round2(vertex2[0] ?? 0),
            V2Y: round2(vertex2[1] ?? 0),
            V2Z: round2(vertex2[2] ?? 0),
        })
    }, [visible, nodeId, isStandalone, standaloneNode, form])

    const shapeType = Form.useWatch('ShapeType', form)

    const handleOk = async () => {
        try {
            const values = await form.validateFields()
            if (!currentNode || nodeId === null) return
            const v1: [number, number, number] = [values.V1X, values.V1Y, values.V1Z]
            const v2: [number, number, number] = [values.V2X, values.V2Y, values.V2Z]
            const isBox = values.ShapeType === 'Box'
            applyNodeToStore({
                ...currentNode,
                ShapeType: values.ShapeType,
                Shape: isBox ? 0 : 2,
                Vertex1: v1,
                Vertex2: isBox ? v2 : undefined,
                Vertices: isBox ? [v1, v2] : [v1],
                BoundsRadius: !isBox ? values.BoundsRadius : undefined,
            })
            onClose()
        } catch (e) {
            console.error('Validation failed', e)
        }
    }

    const formInner = (
        <Form form={form} layout="vertical">
            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>{uiText.collisionShapeDialog.type}</legend>
                <Form.Item name="ShapeType" noStyle>
                    <Radio.Group>
                        <Radio value="Box" style={{ color: '#ccc' }}>{uiText.collisionShapeDialog.box}</Radio>
                        <Radio value="Sphere" style={{ color: '#ccc', marginLeft: 24 }}>{uiText.collisionShapeDialog.sphere}</Radio>
                    </Radio.Group>
                </Form.Item>
            </fieldset>
            <Row gutter={16}>
                <Col span={12}>
                    <fieldset style={fieldsetStyle}>
                        <legend style={legendStyle}>
                            {uiText.collisionShapeDialog.vertex1} {shapeType === 'Sphere' ? uiText.collisionShapeDialog.sphereCenterHint : ''}
                        </legend>
                        {(['V1X', 'V1Y', 'V1Z'] as const).map((name, index) => (
                            <div key={name} style={{ display: 'flex', alignItems: 'center', marginBottom: index < 2 ? 6 : 0 }}>
                                <span style={{ width: 24, color: '#888' }}>{['X', 'Y', 'Z'][index]}:</span>
                                <Form.Item name={name} noStyle><InputNumber style={inputStyle} size="small" /></Form.Item>
                            </div>
                        ))}
                    </fieldset>
                </Col>
                <Col span={12}>
                    <fieldset style={{ ...fieldsetStyle, opacity: shapeType === 'Sphere' ? 0.5 : 1 }}>
                        <legend style={legendStyle}>{uiText.collisionShapeDialog.vertex2}</legend>
                        {(['V2X', 'V2Y', 'V2Z'] as const).map((name, index) => (
                            <div key={name} style={{ display: 'flex', alignItems: 'center', marginBottom: index < 2 ? 6 : 0 }}>
                                <span style={{ width: 24, color: '#888' }}>{['X', 'Y', 'Z'][index]}:</span>
                                <Form.Item name={name} noStyle><InputNumber style={inputStyle} size="small" disabled={shapeType === 'Sphere'} /></Form.Item>
                            </div>
                        ))}
                    </fieldset>
                </Col>
            </Row>
            <fieldset style={{ ...fieldsetStyle, marginBottom: 16 }}>
                <legend style={legendStyle}>{uiText.collisionShapeDialog.other}</legend>
                <div style={{ display: 'flex', alignItems: 'center', opacity: shapeType === 'Box' ? 0.5 : 1 }}>
                    <span style={{ width: 70, color: '#888' }}>{uiText.collisionShapeDialog.sphereRadius}</span>
                    <Form.Item name="BoundsRadius" noStyle>
                        <InputNumber style={{ ...inputStyle, width: 100 }} size="small" disabled={shapeType === 'Box'} min={0} />
                    </Form.Item>
                </div>
            </fieldset>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={handleOk} style={{ minWidth: 70 }}>{uiText.collisionShapeDialog.confirm}</Button>
                <Button onClick={onClose} style={{ minWidth: 70 }}>{uiText.collisionShapeDialog.cancel}</Button>
            </div>
        </Form>
    )

    if (isStandalone) return <NodeEditorStandaloneShell>{formInner}</NodeEditorStandaloneShell>

    return (
        <DraggableModal
            title={uiText.collisionShapeDialog.title}
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={380}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            {formInner}
        </DraggableModal>
    )
}

export default CollisionShapeDialog
