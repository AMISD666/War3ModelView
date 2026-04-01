import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useState } from 'react';
import { Form, Button, Select, Space } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { GlobalSequenceSelect } from '../common/GlobalSequenceSelect';
import { DraggableModal } from '../DraggableModal';
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell';
import { useModelStore } from '../../store/modelStore';
import type { EventObjectNode } from '../../types/node';



interface EventObjectDialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
    isStandalone?: boolean;
    standaloneNode?: EventObjectNode | null;
    standaloneEmit?: (command: string, payload?: any) => void;
    standaloneModelData?: { Sequences?: any[] } | null;
}

// Fieldset style matching the reference
const fieldsetStyle: React.CSSProperties = {
    border: '1px solid #484848',
    padding: '8px 12px',
    marginBottom: 12,
    backgroundColor: 'transparent',
    borderRadius: 0
};

const legendStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#ccc',
    padding: '0 6px',
    width: 'auto',
    marginLeft: 4,
    marginBottom: 0
};

const inputStyle: React.CSSProperties = {
    backgroundColor: '#2b2b2b',
    borderColor: '#484848',
    color: '#fff'
};

const EventObjectDialog: React.FC<EventObjectDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
}) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData: storeModelData } = useModelStore();
    const modelData = isStandalone ? standaloneModelData : storeModelData;
    const [eventFrames, setEventFrames] = useState<number[]>([]);
    const [newFrame, setNewFrame] = useState<number>(0);
    const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

    const currentNode = nodeId !== null ? getNodeById(nodeId) as EventObjectNode : null;

    // Get sequences for reference
    const sequences = modelData?.Sequences || [];

    const formHydratedForNodeIdRef = React.useRef<number | null>(null);

    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null;
            return;
        }
        if (nodeId === null) return;
        if (formHydratedForNodeIdRef.current === nodeId) return;

        const sourceNode: EventObjectNode | null = isStandalone
            ? (standaloneNode as EventObjectNode | null)
            : ((useModelStore.getState().getNodeById(nodeId) as EventObjectNode | undefined) ?? null);

        if (!sourceNode) {
            formHydratedForNodeIdRef.current = nodeId;
            setEventFrames([]);
            setNewFrame(0);
            setSelectedFrameIndex(null);
            form.setFieldsValue({ GlobalSequenceId: -1 });
            return;
        }

        formHydratedForNodeIdRef.current = nodeId;

        const currentNode = sourceNode;

        const track = currentNode.EventTrack;
        let frames: number[] = [];
        if (track) {
            if (track instanceof Uint32Array) {
                frames = Array.from(track);
            } else if (Array.isArray(track)) {
                frames = track;
            }
        }
        setEventFrames(frames);
        setNewFrame(0);
        setSelectedFrameIndex(null);

        form.setFieldsValue({
            GlobalSequenceId: currentNode.GlobalSequenceId ?? -1,
        });
    }, [visible, nodeId, isStandalone, standaloneNode, form]);

    const handleAddFrame = () => {
        if (!eventFrames.includes(newFrame)) {
            setEventFrames([...eventFrames, newFrame].sort((a, b) => a - b));
        }
    };

    const handleRemoveFrame = () => {
        if (selectedFrameIndex !== null && selectedFrameIndex >= 0) {
            const newFrames = [...eventFrames];
            newFrames.splice(selectedFrameIndex, 1);
            setEventFrames(newFrames);
            setSelectedFrameIndex(null);
        }
    };

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!currentNode || nodeId === null) return;

            const updatedNode: EventObjectNode = {
                ...currentNode,
                EventTrack: eventFrames as any,
                GlobalSequenceId: values.GlobalSequenceId >= 0 ? values.GlobalSequenceId : undefined,
            };

            applyNodeToStore(updatedNode);
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    // Helper to find which sequence a frame belongs to
    const getSequenceForFrame = (frame: number): string => {
        for (const seq of sequences) {
            if (seq.Interval && frame >= seq.Interval[0] && frame <= seq.Interval[1]) {
                return seq.Name;
            }
        }
        return '';
    };


    const eventFormInner = (
            <Form form={form} layout="vertical">
                {/* 事件跟踪 Section */}
                <fieldset style={{ ...fieldsetStyle, minHeight: 140 }}>
                    <legend style={legendStyle}>事件跟踪</legend>
                    <div style={{
                        border: '1px solid #484848',
                        backgroundColor: '#2b2b2b',
                        height: 80,
                        marginBottom: 8,
                        overflow: 'auto'
                    }}>
                        {eventFrames.length > 0 ? (
                            eventFrames.map((frame, index) => (
                                <div
                                    key={index}
                                    onClick={() => setSelectedFrameIndex(index)}
                                    style={{
                                        padding: '2px 8px',
                                        cursor: 'pointer',
                                        backgroundColor: selectedFrameIndex === index ? '#444' : 'transparent',
                                        color: selectedFrameIndex === index ? '#fff' : '#ccc',
                                        fontSize: 12
                                    }}
                                >
                                    帧 {frame} {getSequenceForFrame(frame) && `[${getSequenceForFrame(frame)}]`}
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: 8, color: '#666', textAlign: 'center', fontSize: 12 }}>
                                暂无事件帧
                            </div>
                        )}
                    </div>
                    <Space size="small">
                        <InputNumber
                            value={newFrame}
                            onChange={(v) => setNewFrame(v || 0)}
                            min={0}
                            size="small"
                            style={{ width: 100, ...inputStyle }}
                            placeholder="帧号"
                        />
                        <Button size="small" icon={<PlusOutlined />} onClick={handleAddFrame}>
                            添加
                        </Button>
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={handleRemoveFrame}
                            disabled={selectedFrameIndex === null}
                        >
                            删除
                        </Button>
                    </Space>
                </fieldset>

                {/* 事件数据 Section */}
                <fieldset style={fieldsetStyle}>
                    <legend style={legendStyle}>事件数据</legend>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ width: 50, color: '#888' }}>类型:</span>
                        <Select
                            style={{ flex: 1 }}
                            size="small"
                            disabled
                            placeholder="(后续完善)"
                        >
                            {/* 后续完善 */}
                        </Select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ width: 50, color: '#888' }}>数据:</span>
                        <Select
                            style={{ flex: 1 }}
                            size="small"
                            disabled
                            placeholder="(后续完善)"
                        >
                            {/* 后续完善 */}
                        </Select>
                    </div>
                    <div style={{ marginLeft: 50, padding: '4px 8px', backgroundColor: '#2b2b2b', border: '1px solid #484848', marginBottom: 8 }}>
                        <span style={{ color: '#666', fontSize: 12 }}>{currentNode?.Name?.substring(0, 4) || ''}</span>
                    </div>
                    <div style={{ color: '#666', fontSize: 11 }}>
                        标识符: (仅仅是个记号) 。
                    </div>
                </fieldset>

                {/* 其他 Section */}
                <fieldset style={{ ...fieldsetStyle, marginBottom: 16 }}>
                    <legend style={legendStyle}>其他</legend>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 100, color: '#888' }}>全局顺序 ID:</span>
                        <Form.Item name="GlobalSequenceId" noStyle>
                            <GlobalSequenceSelect
                                style={{ flex: 1 }}
                            />
                        </Form.Item>
                    </div>
                </fieldset>

                {/* Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={handleOk} style={{ minWidth: 70 }}>确 定</Button>
                    <Button onClick={onClose} style={{ minWidth: 70 }}>取 消</Button>
                </div>
            </Form>
    );

    if (isStandalone) {
        return <NodeEditorStandaloneShell>{eventFormInner}</NodeEditorStandaloneShell>;
    }

    return (
        <DraggableModal
            title="事件物体"
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
    );
};

export default EventObjectDialog;

