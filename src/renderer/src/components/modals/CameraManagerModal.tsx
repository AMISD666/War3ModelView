import React, { useState } from 'react';
import { Button, Card, Space, InputNumber, Row, Col, Input, Checkbox, Tooltip } from 'antd';
import { EyeOutlined, CameraOutlined } from '@ant-design/icons';
import { MasterDetailLayout } from '../MasterDetailLayout';
import { useModelStore } from '../../store/modelStore';
import { DraggableModal } from '../DraggableModal';

import KeyframeEditor from '../editors/KeyframeEditor';
import { CameraNode, NodeType } from '../../types/node';



interface CameraManagerModalProps {
    visible: boolean;
    onClose: () => void;
    onAddFromView?: () => void;
    onViewCamera?: (camera: CameraNode) => void;
}

const CameraManagerModal: React.FC<CameraManagerModalProps> = ({ visible, onClose, onAddFromView, onViewCamera }) => {
    const { modelData, updateNodes, nodes, addNode, deleteNode } = useModelStore();
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Editor State
    const [editorVisible, setEditorVisible] = useState(false);
    const [editingBlock, setEditingBlock] = useState<{ index: number, field: string } | null>(null);

    // Filter cameras from nodes
    const cameras = nodes.filter(n => n.type === NodeType.CAMERA) as CameraNode[];
    const globalSequences = (modelData?.GlobalSequences || []) as unknown as number[];

    const handleAdd = () => {
        const newCamera: Partial<CameraNode> & { Name: string, type: NodeType } = {
            Name: `Camera ${cameras.length + 1}`,
            type: NodeType.CAMERA,
            FieldOfView: 0.7853, // Approx 45 degrees
            NearClip: 16,
            FarClip: 5000,
            Translation: { // Position
                InterpolationType: 0,
                GlobalSeqId: null,
                Keys: [{ Frame: 0, Vector: [0, 0, 0] }]
            },
            TargetTranslation: { // Target Position
                InterpolationType: 0,
                GlobalSeqId: null,
                Keys: [{ Frame: 0, Vector: [100, 0, 0] }]
            }
        };
        addNode(newCamera);
    };

    const handleDelete = (index: number) => {
        if (index >= 0 && index < cameras.length) {
            const node = cameras[index];
            deleteNode(node.ObjectId);
            if (selectedIndex >= index) setSelectedIndex(Math.max(-1, selectedIndex - 1));
        }
    };

    const updateCamera = (index: number, updates: Partial<CameraNode>) => {
        const camera = cameras[index];
        if (camera) {
            updateNodes([{ objectId: camera.ObjectId, data: updates }]);
        }
    };

    const toggleBlock = (index: number, key: keyof CameraNode, checked: boolean) => {
        const currentCam = cameras[index];
        if (checked) {
            updateCamera(index, { [key]: (currentCam as any)[key] || { InterpolationType: 0, GlobalSeqId: null, Keys: [{ Frame: 0, Vector: [0, 0, 0] }] } });
        } else {
            updateCamera(index, { [key]: undefined } as any);
        }
    };

    const openEditor = (index: number, field: string, _label: string) => {
        setEditingBlock({ index, field });
        setEditorVisible(true);
    };

    const handleEditorSave = (result: any) => {
        if (editingBlock) {
            const { index, field } = editingBlock;
            updateCamera(index, { [field]: result });
            setEditorVisible(false);
            setEditingBlock(null);
        }
    };

    const renderListItem = (item: any, index: number, isSelected: boolean) => (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: isSelected ? '#fff' : '#b0b0b0'
        }}>
            <span>{item.Name || `Camera ${index}`}</span>
        </div>
    );

    const renderDetail = (item: any, index: number) => {
        const cam = item as CameraNode;
        // Use static values from first key if available for display
        const getPos = (block: any) => {
            if (block && block.Keys && block.Keys.length > 0) {
                const v = block.Keys[0].Vector;
                return v || [0, 0, 0];
            }
            return [0, 0, 0];
        };

        const pos = getPos(cam.Translation);
        const target = getPos(cam.TargetTranslation);

        const VectorInputs = ({ value, onChange, label }: { value: number[], onChange: (val: number[]) => void, label: string }) => (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ color: '#ccc', marginBottom: 4 }}>{label}</div>
                {['X', 'Y', 'Z'].map((axis, i) => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ color: '#888', width: 20 }}>{axis}: </span>
                        <InputNumber
                            size="small"
                            style={{ flex: 1, background: '#222', borderColor: '#444', color: '#fff' }}
                            value={value[i]}
                            onChange={(v) => {
                                const newVal = [...value];
                                newVal[i] = v || 0;
                                onChange(newVal);
                            }}
                        />
                    </div>
                ))}
            </div>
        );

        const updateStaticPos = (key: 'Translation' | 'TargetTranslation', newVal: number[]) => {
            const block = (cam as any)[key];
            const newBlock = block ? { ...block } : { InterpolationType: 0, GlobalSeqId: null, Keys: [{ Frame: 0, Vector: newVal }] };
            if (newBlock.Keys && newBlock.Keys.length > 0) {
                newBlock.Keys[0].Vector = newVal;
            } else {
                newBlock.Keys = [{ Frame: 0, Vector: newVal }];
            }
            updateCamera(index, { [key]: newBlock });
        };


        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Name */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, border: '1px solid #484848', padding: 8 }}>
                    <span style={{ color: '#ccc', marginRight: 8 }}>Name:</span>
                    <Input
                        value={cam.Name}
                        onChange={(e) => updateCamera(index, { Name: e.target.value })}
                        style={{ background: '#222', borderColor: '#444', color: '#fff' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 16 }}>
                    {/* Position */}
                    <Card size="small" title="镜头位置" style={{ background: '#333', borderColor: '#444', flex: 1 }} headStyle={{ color: '#ddd' }}>
                        <VectorInputs value={pos} onChange={(v) => updateStaticPos('Translation', v)} label="" />
                        <div style={{ marginTop: 8 }}>
                            <Checkbox
                                checked={!!cam.Translation && (cam.Translation.Keys?.length > 1 || cam.Translation.GlobalSeqId !== null)}
                                onChange={(e) => toggleBlock(index, 'Translation', e.target.checked)}
                                style={{ color: '#ccc' }}>动态移动</Checkbox>
                            <Button size="small" style={{ width: '100%', marginTop: 4 }} onClick={() => openEditor(index, 'Translation', '编辑位置')}>移动</Button>
                        </div>
                    </Card>

                    {/* Target */}
                    <Card size="small" title="焦点位置" style={{ background: '#333', borderColor: '#444', flex: 1 }} headStyle={{ color: '#ddd' }}>
                        <VectorInputs value={target} onChange={(v) => updateStaticPos('TargetTranslation', v)} label="" />
                        <div style={{ marginTop: 8 }}>
                            <Checkbox
                                checked={!!cam.TargetTranslation}
                                onChange={(e) => toggleBlock(index, 'TargetTranslation', e.target.checked)}
                                style={{ color: '#ccc' }}>动态移动</Checkbox>
                            <Button size="small" style={{ width: '100%', marginTop: 4 }} onClick={() => openEditor(index, 'TargetTranslation', '编辑目标')}>移动</Button>
                        </div>
                    </Card>
                </div>

                {/* Other */}
                <Card size="small" title="其他" style={{ background: '#333', borderColor: '#444' }} headStyle={{ color: '#ddd' }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <div style={{ color: '#aaa', marginBottom: 4 }}>视野范围:</div>
                            <InputNumber
                                style={{ width: '100%', background: '#222', borderColor: '#444', color: '#fff' }}
                                value={cam.FieldOfView}
                                onChange={(v) => updateCamera(index, { FieldOfView: v || 0 })}
                            />
                        </Col>
                        <Col span={12}>
                            <div style={{ color: '#aaa', marginBottom: 4 }}>近景距离:</div>
                            <InputNumber
                                style={{ width: '100%', background: '#222', borderColor: '#444', color: '#fff' }}
                                value={cam.NearClip}
                                onChange={(v) => updateCamera(index, { NearClip: v || 0 })}
                            />
                        </Col>
                    </Row>
                    <Row gutter={16} style={{ marginTop: 8 }}>
                        <Col span={12}>
                            <div style={{ color: '#aaa', marginBottom: 4 }}>远景距离:</div>
                            <InputNumber
                                style={{ width: '100%', background: '#222', borderColor: '#444', color: '#fff' }}
                                value={cam.FarClip}
                                onChange={(v) => updateCamera(index, { FarClip: v || 0 })}
                            />
                        </Col>
                    </Row>
                    <div style={{ marginTop: 12 }}>
                        <Checkbox
                            checked={!!cam.Rotation}
                            onChange={(e) => toggleBlock(index, 'Rotation', e.target.checked)}
                            style={{ color: '#ccc' }}>动画旋转</Checkbox>
                        <Button size="small" style={{ marginLeft: 8 }} onClick={() => openEditor(index, 'Rotation', '编辑旋转')}>旋转</Button>
                    </div>
                </Card>
            </div>
        );
    };

    const getCurrentEditorData = () => {
        if (!editingBlock || selectedIndex < 0) return null;
        const cam = cameras[editingBlock.index];
        if (!cam) return null;
        return (cam as any)[editingBlock.field];
    };

    const extraButtons = (
        <Space size={4}>
            <Tooltip title="从当前视角新建">
                <Button
                    type="text"
                    size="small"
                    icon={<CameraOutlined />}
                    onClick={onAddFromView}
                    style={{ color: '#1677ff' }}
                />
            </Tooltip>
            <Tooltip title="查看选中相机 (View)">
                <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    disabled={selectedIndex < 0}
                    onClick={() => {
                        if (selectedIndex >= 0 && onViewCamera) {
                            onViewCamera(cameras[selectedIndex]);
                        }
                    }}
                    style={{ color: '#52c41a' }}
                />
            </Tooltip>
        </Space>
    );

    return (
        <>
            <DraggableModal
                title="相机管理器 (Camera Manager)"
                open={visible}
                onCancel={onClose}
                width={700}
                footer={null}
                wrapClassName="dark-theme-modal"
            >
                <div
                    style={{ height: 550, background: '#222', border: '1px solid #444' }}
                >
                    <MasterDetailLayout
                        items={cameras}
                        selectedIndex={selectedIndex}
                        onSelect={setSelectedIndex}
                        renderListItem={renderListItem}
                        renderDetail={renderDetail}
                        onAdd={handleAdd}
                        onDelete={handleDelete}
                        listTitle="相机列表"
                        detailTitle="相机属性"
                        listWidth={200}
                        extraButtons={extraButtons}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button type="primary" onClick={onClose} style={{ marginRight: 8 }}>确定</Button>
                    <Button onClick={onClose}>取消</Button>
                </div>
            </DraggableModal>

            {editorVisible && (
                <KeyframeEditor
                    visible={editorVisible}
                    onCancel={() => setEditorVisible(false)}
                    onOk={handleEditorSave}
                    initialData={getCurrentEditorData()}
                    title={`编辑 ${editingBlock?.field}`}
                    vectorSize={3}
                    globalSequences={globalSequences}
                />
            )}
        </>
    );
};

export default CameraManagerModal;
