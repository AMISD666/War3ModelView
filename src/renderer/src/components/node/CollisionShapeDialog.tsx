import React, { useEffect } from 'react';
import { Form, InputNumber, Radio, Button, Row, Col } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import type { CollisionShapeNode } from '../../types/node';

interface CollisionShapeDialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
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
    color: '#fff',
    width: '100%'
};

const CollisionShapeDialog: React.FC<CollisionShapeDialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode } = useModelStore();

    const currentNode = nodeId !== null ? getNodeById(nodeId) as CollisionShapeNode : null;

    useEffect(() => {
        if (visible && currentNode) {
            // Handle Vertices which can be Float32Array(3) for sphere or Float32Array(6) for box
            // or fallback to Vertex1/Vertex2
            let vertex1: [number, number, number] = [0, 0, 0];
            let vertex2: [number, number, number] = [0, 0, 0];

            if (currentNode.Vertices) {
                const v = currentNode.Vertices;
                if (v instanceof Float32Array || (typeof v[0] === 'number' && v.length >= 3)) {
                    // Flat array: [x, y, z] or [x1, y1, z1, x2, y2, z2]
                    const flat = v as unknown as number[];
                    vertex1 = [flat[0], flat[1], flat[2]];
                    if (flat.length >= 6) {
                        vertex2 = [flat[3], flat[4], flat[5]];
                    }
                } else if (Array.isArray(v[0])) {
                    // Array of arrays: [[x,y,z], [x,y,z]]
                    const arr = v as [number, number, number][];
                    vertex1 = arr[0] || [0, 0, 0];
                    vertex2 = arr[1] || [0, 0, 0];
                }
            } else {
                // Fallback to Vertex1/Vertex2
                vertex1 = currentNode.Vertex1 || [0, 0, 0];
                vertex2 = currentNode.Vertex2 || [0, 0, 0];
            }

            // Round to 2 decimal places for display
            const round2 = (n: number) => Math.round(n * 100) / 100;

            // Prioritize Shape number (0=Box, 2=Sphere), fallback to ShapeType string
            let initialShapeType = currentNode.ShapeType ?? 'Box';
            if (currentNode.Shape !== undefined) {
                if (currentNode.Shape === 2) initialShapeType = 'Sphere';
                else if (currentNode.Shape === 0) initialShapeType = 'Box';
            }

            form.setFieldsValue({
                ShapeType: initialShapeType,
                BoundsRadius: round2(currentNode.BoundsRadius ?? 60),
                V1X: round2(vertex1[0] ?? 0),
                V1Y: round2(vertex1[1] ?? 0),
                V1Z: round2(vertex1[2] ?? 0),
                V2X: round2(vertex2[0] ?? 0),
                V2Y: round2(vertex2[1] ?? 0),
                V2Z: round2(vertex2[2] ?? 0),
            });
        } else if (visible) {
            form.setFieldsValue({
                ShapeType: 'Box',
                BoundsRadius: 60,
                V1X: -50, V1Y: -50, V1Z: 0,
                V2X: 50, V2Y: 50, V2Z: 100,
            });
        }
    }, [currentNode, visible, form]);

    const shapeType = Form.useWatch('ShapeType', form);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!currentNode || nodeId === null) return;

            const v1: [number, number, number] = [values.V1X, values.V1Y, values.V1Z];
            const v2: [number, number, number] = [values.V2X, values.V2Y, values.V2Z];
            const isBox = values.ShapeType === 'Box';

            const updatedNode: CollisionShapeNode = {
                ...currentNode,
                ShapeType: values.ShapeType,
                Shape: isBox ? 0 : 2,
                Vertex1: v1,
                Vertex2: isBox ? v2 : undefined,
                Vertices: isBox ? [v1, v2] : [v1],
                BoundsRadius: !isBox ? values.BoundsRadius : undefined,
            };

            updateNode(nodeId, updatedNode);
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    return (
        <DraggableModal
            title="碰撞形状"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={380}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            <Form form={form} layout="vertical">
                {/* 类型 Section */}
                <fieldset style={fieldsetStyle}>
                    <legend style={legendStyle}>类型</legend>
                    <Form.Item name="ShapeType" noStyle>
                        <Radio.Group>
                            <Radio value="Box" style={{ color: '#ccc' }}>立方体</Radio>
                            <Radio value="Sphere" style={{ color: '#ccc', marginLeft: 24 }}>球体</Radio>
                        </Radio.Group>
                    </Form.Item>
                </fieldset>

                {/* 顶点 Section */}
                <Row gutter={16}>
                    <Col span={12}>
                        <fieldset style={fieldsetStyle}>
                            <legend style={legendStyle}>顶点 1 {shapeType === 'Sphere' ? '(球体为球心)' : ''}</legend>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ width: 24, color: '#888' }}>X:</span>
                                <Form.Item name="V1X" noStyle>
                                    <InputNumber style={inputStyle} size="small" />
                                </Form.Item>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ width: 24, color: '#888' }}>Y:</span>
                                <Form.Item name="V1Y" noStyle>
                                    <InputNumber style={inputStyle} size="small" />
                                </Form.Item>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <span style={{ width: 24, color: '#888' }}>Z:</span>
                                <Form.Item name="V1Z" noStyle>
                                    <InputNumber style={inputStyle} size="small" />
                                </Form.Item>
                            </div>
                        </fieldset>
                    </Col>
                    <Col span={12}>
                        <fieldset style={{ ...fieldsetStyle, opacity: shapeType === 'Sphere' ? 0.5 : 1 }}>
                            <legend style={legendStyle}>顶点 2</legend>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ width: 24, color: '#888' }}>X:</span>
                                <Form.Item name="V2X" noStyle>
                                    <InputNumber style={inputStyle} size="small" disabled={shapeType === 'Sphere'} />
                                </Form.Item>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ width: 24, color: '#888' }}>Y:</span>
                                <Form.Item name="V2Y" noStyle>
                                    <InputNumber style={inputStyle} size="small" disabled={shapeType === 'Sphere'} />
                                </Form.Item>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <span style={{ width: 24, color: '#888' }}>Z:</span>
                                <Form.Item name="V2Z" noStyle>
                                    <InputNumber style={inputStyle} size="small" disabled={shapeType === 'Sphere'} />
                                </Form.Item>
                            </div>
                        </fieldset>
                    </Col>
                </Row>

                {/* 其他 Section */}
                <fieldset style={{ ...fieldsetStyle, marginBottom: 16 }}>
                    <legend style={legendStyle}>其他</legend>
                    <div style={{ display: 'flex', alignItems: 'center', opacity: shapeType === 'Box' ? 0.5 : 1 }}>
                        <span style={{ width: 70, color: '#888' }}>球体半径:</span>
                        <Form.Item name="BoundsRadius" noStyle>
                            <InputNumber
                                style={{ ...inputStyle, width: 100 }}
                                size="small"
                                disabled={shapeType === 'Box'}
                                min={0}
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
        </DraggableModal>
    );
};

export default CollisionShapeDialog;
