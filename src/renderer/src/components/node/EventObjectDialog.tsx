import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useState } from 'react'
import { Button, Form, Select, Space } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { GlobalSequenceSelect } from '../common/GlobalSequenceSelect'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'
import { useModelStore } from '../../store/modelStore'
import type { EventObjectNode } from '../../types/node'
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc'
import { nodeEditorCommandHandler } from '../../application/commands'

interface EventObjectDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: EventObjectNode | null
    standaloneEmit?: NodeEditorCommandSender
    standaloneModelData?: { Sequences?: any[] } | null
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
}

const EventObjectDialog: React.FC<EventObjectDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
}) => {
    const [form] = Form.useForm()
    const { getNodeById, modelData: storeModelData } = useModelStore()
    const modelData = isStandalone ? standaloneModelData : storeModelData
    const [eventFrames, setEventFrames] = useState<number[]>([])
    const [newFrame, setNewFrame] = useState<number>(0)
    const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
    const globalSequenceId = Form.useWatch('GlobalSequenceId', form)
    const currentNode = nodeId !== null ? (isStandalone ? (standaloneNode as EventObjectNode | null) : (getNodeById(nodeId) as EventObjectNode)) : null
    const sequences = modelData?.Sequences || []

    const getCurrentSourceNode = React.useCallback((): EventObjectNode | null => {
        if (nodeId === null) return null
        if (isStandalone) {
            return (standaloneNode as EventObjectNode | null) ?? null
        }
        return (useModelStore.getState().getNodeById(nodeId) as EventObjectNode | undefined) ?? null
    }, [isStandalone, nodeId, standaloneNode])

    const applyNodeToStore = React.useCallback(
        (next: EventObjectNode) => {
            if (nodeId === null) return
            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next })
                return
            }
            nodeEditorCommandHandler.applyNodeUpdate({ objectId: nodeId, node: next })
        },
        [isStandalone, nodeId, standaloneEmit]
    )

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            return
        }
        if (nodeId === null || formHydratedForNodeIdRef.current === nodeId) return
        const sourceNode: EventObjectNode | null = isStandalone
            ? (standaloneNode as EventObjectNode | null)
            : ((useModelStore.getState().getNodeById(nodeId) as EventObjectNode | undefined) ?? null)
        if (!sourceNode) {
            formHydratedForNodeIdRef.current = nodeId
            setEventFrames([])
            setNewFrame(0)
            setSelectedFrameIndex(null)
            form.setFieldsValue({ GlobalSequenceId: -1 })
            return
        }
        formHydratedForNodeIdRef.current = nodeId
        const track = sourceNode.EventTrack
        let frames: number[] = []
        if (track instanceof Uint32Array) frames = Array.from(track)
        else if (Array.isArray(track)) frames = track
        setEventFrames(frames)
        setNewFrame(0)
        setSelectedFrameIndex(null)
        form.setFieldsValue({ GlobalSequenceId: sourceNode.GlobalSequenceId ?? -1 })
    }, [visible, nodeId, isStandalone, standaloneNode, form])

    const handleAddFrame = () => {
        if (!eventFrames.includes(newFrame)) setEventFrames([...eventFrames, newFrame].sort((a, b) => a - b))
    }
    const handleRemoveFrame = () => {
        if (selectedFrameIndex !== null && selectedFrameIndex >= 0) {
            const next = [...eventFrames]
            next.splice(selectedFrameIndex, 1)
            setEventFrames(next)
            setSelectedFrameIndex(null)
        }
    }
    const handleOk = async () => {
        try {
            const values = await form.validateFields()
            const sourceNode = getCurrentSourceNode()
            if (!sourceNode || nodeId === null) return
            applyNodeToStore({
                ...sourceNode,
                EventTrack: eventFrames as any,
                GlobalSequenceId: values.GlobalSequenceId >= 0 ? values.GlobalSequenceId : undefined,
            })
            onClose()
        } catch (e) {
            console.error('Validation failed', e)
        }
    }
    const getSequenceForFrame = (frame: number): string => {
        for (const seq of sequences) {
            if (seq.Interval && frame >= seq.Interval[0] && frame <= seq.Interval[1]) return seq.Name
        }
        return ''
    }

    const eventFormInner = (
        <Form form={form} layout="vertical">
            <fieldset style={{ ...fieldsetStyle, minHeight: 140 }}>
                <legend style={legendStyle}>{uiText.eventObjectDialog.track}</legend>
                <div style={{ border: '1px solid #484848', backgroundColor: '#2b2b2b', height: 80, marginBottom: 8, overflow: 'auto' }}>
                    {eventFrames.length > 0 ? eventFrames.map((frame, index) => (
                        <div
                            key={index}
                            onClick={() => setSelectedFrameIndex(index)}
                            style={{ padding: '2px 8px', cursor: 'pointer', backgroundColor: selectedFrameIndex === index ? '#444' : 'transparent', color: selectedFrameIndex === index ? '#fff' : '#ccc', fontSize: 12 }}
                        >
                            {uiText.eventObjectDialog.framePrefix}{frame} {getSequenceForFrame(frame) && `[${getSequenceForFrame(frame)}]`}
                        </div>
                    )) : <div style={{ padding: 8, color: '#666', textAlign: 'center', fontSize: 12 }}>{uiText.eventObjectDialog.noFrames}</div>}
                </div>
                <Space size="small">
                    <InputNumber value={newFrame} onChange={(v) => setNewFrame(v || 0)} min={0} size="small" style={{ width: 100, ...inputStyle }} placeholder={uiText.eventObjectDialog.framePlaceholder} />
                    <Button size="small" icon={<PlusOutlined />} onClick={handleAddFrame}>{uiText.eventObjectDialog.add}</Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={handleRemoveFrame} disabled={selectedFrameIndex === null}>{uiText.eventObjectDialog.remove}</Button>
                </Space>
            </fieldset>
            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>{uiText.eventObjectDialog.eventData}</legend>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ width: 50, color: '#888' }}>{uiText.eventObjectDialog.type}</span>
                    <Select style={{ flex: 1 }} size="small" disabled placeholder={uiText.eventObjectDialog.todoPlaceholder} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ width: 50, color: '#888' }}>{uiText.eventObjectDialog.data}</span>
                    <Select style={{ flex: 1 }} size="small" disabled placeholder={uiText.eventObjectDialog.todoPlaceholder} />
                </div>
                <div style={{ marginLeft: 50, padding: '4px 8px', backgroundColor: '#2b2b2b', border: '1px solid #484848', marginBottom: 8 }}>
                    <span style={{ color: '#666', fontSize: 12 }}>{currentNode?.Name?.substring(0, 4) || ''}</span>
                </div>
                <div style={{ color: '#666', fontSize: 11 }}>{uiText.eventObjectDialog.identifierPlaceholder}</div>
            </fieldset>
            <fieldset style={{ ...fieldsetStyle, marginBottom: 16 }}>
                <legend style={legendStyle}>{uiText.eventObjectDialog.other}</legend>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ width: 100, color: '#888' }}>{uiText.eventObjectDialog.globalSequenceId}</span>
                    <Form.Item name="GlobalSequenceId" noStyle>
                        <GlobalSequenceSelect
                            value={typeof globalSequenceId === 'number' ? globalSequenceId : -1}
                            onChange={(value) => form.setFieldValue('GlobalSequenceId', value ?? -1)}
                            isStandalone={isStandalone}
                            style={{ flex: 1 }}
                        />
                    </Form.Item>
                </div>
            </fieldset>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={handleOk} style={{ minWidth: 70 }}>{uiText.eventObjectDialog.confirm}</Button>
                <Button onClick={onClose} style={{ minWidth: 70 }}>{uiText.eventObjectDialog.cancel}</Button>
            </div>
        </Form>
    )

    if (isStandalone) return <NodeEditorStandaloneShell>{eventFormInner}</NodeEditorStandaloneShell>

    return (
        <DraggableModal
            title={uiText.eventObjectDialog.title}
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={450}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            {eventFormInner}
        </DraggableModal>
    )
}

export default EventObjectDialog
