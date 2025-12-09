import React, { useEffect, useState } from 'react';
import { Form, InputNumber, Select, Button, Row, Col, Checkbox, ColorPicker } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import type { RibbonEmitterNode } from '../../types/node';
import type { Color } from 'antd/es/color-picker';



interface RibbonEmitterDialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
}

// Fieldset style matching the reference
const fieldsetStyle: React.CSSProperties = {
    border: '1px solid #484848',
    padding: '8px 12px',
    marginBottom: 8,
    backgroundColor: 'transparent',
    borderRadius: 0,
    height: '100%'
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

// Dynamic field component with checkbox
const DynamicField = ({
    label,
    isDynamic,
    onDynamicChange,
    children,
    buttonLabel
}: {
    label: string;
    isDynamic: boolean;
    onDynamicChange: (checked: boolean) => void;
    children: React.ReactNode;
    buttonLabel?: string;
}) => (
    <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{label}</legend>
        <div style={{ marginBottom: 6 }}>
            <Checkbox
                checked={isDynamic}
                onChange={(e) => onDynamicChange(e.target.checked)}
                style={{ color: '#888', fontSize: 12 }}
            >
                动态化
            </Checkbox>
        </div>
        <Button
            size="small"
            disabled={!isDynamic}
            style={{
                width: '100%',
                marginBottom: 6,
                backgroundColor: '#333',
                borderColor: '#484848',
                color: isDynamic ? '#fff' : '#666'
            }}
        >
            {buttonLabel || label}
        </Button>
        {children}
    </fieldset>
);

const RibbonEmitterDialog: React.FC<RibbonEmitterDialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData } = useModelStore();

    const currentNode = nodeId !== null ? getNodeById(nodeId) as RibbonEmitterNode : null;

    // Dynamic states for each property
    const [dynamicProps, setDynamicProps] = useState<Record<string, boolean>>({});

    const toggleDynamic = (prop: string, checked: boolean) => {
        setDynamicProps(prev => ({ ...prev, [prop]: checked }));
    };

    // Helper to convert array [r, g, b] (0-1) to Antd Color
    const toAntdColor = (rgb?: [number, number, number]) => {
        if (!rgb) return 'rgb(255, 255, 255)';
        return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
    };

    // Helper to convert Antd Color to array [r, g, b] (0-1)
    const fromAntdColor = (color: Color | string): [number, number, number] => {
        let r = 1, g = 1, b = 1;
        if (typeof color === 'string') {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                r = parseInt(match[1]) / 255;
                g = parseInt(match[2]) / 255;
                b = parseInt(match[3]) / 255;
            }
        } else if (color && typeof color === 'object') {
            const rgb = color.toRgb();
            r = rgb.r / 255;
            g = rgb.g / 255;
            b = rgb.b / 255;
        }
        return [r, g, b];
    };

    // Material options
    const materialOptions = [
        { label: '(None)', value: -1 },
        ...(modelData?.Materials?.map((_mat: any, index: number) => ({
            label: `材质 ${index}`,
            value: index
        })) || [])
    ];

    useEffect(() => {
        if (visible && currentNode) {
            form.setFieldsValue({
                HeightAbove: currentNode.HeightAbove ?? 0,
                HeightBelow: currentNode.HeightBelow ?? 0,
                Alpha: currentNode.Alpha ?? 1,
                Visibility: 1,
                TextureSlot: currentNode.TextureSlot ?? 0,
                Color: toAntdColor(currentNode.Color),
                MaterialID: currentNode.MaterialID ?? -1,
                EmissionRate: currentNode.EmissionRate ?? 0,
                LifeSpan: currentNode.LifeSpan ?? 0,
                Rows: currentNode.Rows ?? 1,
                Columns: currentNode.Columns ?? 1,
                Gravity: currentNode.Gravity ?? 0,
            });
            setDynamicProps({});
        } else if (visible) {
            form.setFieldsValue({
                HeightAbove: 0,
                HeightBelow: 0,
                Alpha: 1,
                Visibility: 1,
                TextureSlot: 0,
                Color: 'rgb(255, 255, 255)',
                MaterialID: -1,
                EmissionRate: 0,
                LifeSpan: 0,
                Rows: 1,
                Columns: 1,
                Gravity: 0,
            });
            setDynamicProps({});
        }
    }, [currentNode, visible, form]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!currentNode || nodeId === null) return;

            const updatedNode: RibbonEmitterNode = {
                ...currentNode,
                HeightAbove: values.HeightAbove,
                HeightBelow: values.HeightBelow,
                Alpha: values.Alpha,
                Color: fromAntdColor(values.Color),
                TextureSlot: values.TextureSlot,
                EmissionRate: values.EmissionRate,
                MaterialID: values.MaterialID >= 0 ? values.MaterialID : undefined,
                LifeSpan: values.LifeSpan,
                Rows: values.Rows,
                Columns: values.Columns,
                Gravity: values.Gravity,
            };

            updateNode(nodeId, updatedNode);
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    return (
        <DraggableModal
            title="丝带发射器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={550}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            <Form form={form} layout="vertical">
                {/* Row 1: 颜色 | 透明度 | 可见度 */}
                <Row gutter={8}>
                    <Col span={8}>
                        <DynamicField
                            label="颜色"
                            isDynamic={!!dynamicProps['Color']}
                            onDynamicChange={(c) => toggleDynamic('Color', c)}
                            buttonLabel="颜色"
                        >
                            <Form.Item name="Color" noStyle>
                                <ColorPicker
                                    size="small"
                                    showText
                                    format="rgb"
                                    disabled={dynamicProps['Color']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="透明度"

                            isDynamic={!!dynamicProps['Alpha']}
                            onDynamicChange={(c) => toggleDynamic('Alpha', c)}
                            buttonLabel="透明度"
                        >
                            <Form.Item name="Alpha" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    disabled={dynamicProps['Alpha']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="可见度"

                            isDynamic={!!dynamicProps['Visibility']}
                            onDynamicChange={(c) => toggleDynamic('Visibility', c)}
                            buttonLabel="可见度"
                        >
                            <Form.Item name="Visibility" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    disabled={dynamicProps['Visibility']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                </Row>

                {/* Row 2: 上部高度 | 下部高度 | 贴图位置 */}
                <Row gutter={8}>
                    <Col span={8}>
                        <DynamicField
                            label="上部高度"

                            isDynamic={!!dynamicProps['HeightAbove']}
                            onDynamicChange={(c) => toggleDynamic('HeightAbove', c)}
                            buttonLabel="高度"
                        >
                            <Form.Item name="HeightAbove" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    disabled={dynamicProps['HeightAbove']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="下部高度"

                            isDynamic={!!dynamicProps['HeightBelow']}
                            onDynamicChange={(c) => toggleDynamic('HeightBelow', c)}
                            buttonLabel="高度"
                        >
                            <Form.Item name="HeightBelow" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    disabled={dynamicProps['HeightBelow']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="贴图位置"

                            isDynamic={!!dynamicProps['TextureSlot']}
                            onDynamicChange={(c) => toggleDynamic('TextureSlot', c)}
                            buttonLabel="位置"
                        >
                            <Form.Item name="TextureSlot" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    disabled={dynamicProps['TextureSlot']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                </Row>

                {/* 其他 Section */}
                <fieldset style={{ ...fieldsetStyle, marginBottom: 16 }}>
                    <legend style={legendStyle}>其他</legend>

                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ width: 80, color: '#888' }}>材质 ID:</span>
                        <Form.Item name="MaterialID" noStyle>
                            <Select
                                options={materialOptions}
                                style={{ flex: 1 }}
                                size="small"
                            />
                        </Form.Item>
                    </div>

                    <Row gutter={16} style={{ marginBottom: 4 }}>
                        <Col span={12}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <span style={{ flex: 1, color: '#666', fontSize: 11 }}>行数(单个贴图内图像行数):</span>
                                <Form.Item name="Rows" noStyle>
                                    <InputNumber style={{ ...inputStyle, width: 60 }} size="small" min={1} />
                                </Form.Item>
                            </div>
                        </Col>
                        <Col span={12}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <span style={{ flex: 1, color: '#666', fontSize: 11 }}>列数(单个贴图内图像列数):</span>
                                <Form.Item name="Columns" noStyle>
                                    <InputNumber style={{ ...inputStyle, width: 60 }} size="small" min={1} />
                                </Form.Item>
                            </div>
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col span={12}>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                                <span style={{ width: 70, color: '#888' }}>放射速率:</span>
                                <Form.Item name="EmissionRate" noStyle>
                                    <InputNumber style={{ ...inputStyle, flex: 1 }} size="small" min={0} />
                                </Form.Item>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                                <span style={{ width: 70, color: '#888' }}>持续时间:</span>
                                <Form.Item name="LifeSpan" noStyle>
                                    <InputNumber style={{ ...inputStyle, flex: 1 }} size="small" min={0} step={0.1} />
                                </Form.Item>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <span style={{ width: 70, color: '#888' }}>重力:</span>
                                <Form.Item name="Gravity" noStyle>
                                    <InputNumber style={{ ...inputStyle, flex: 1 }} size="small" />
                                </Form.Item>
                            </div>
                        </Col>
                        <Col span={12} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <Button onClick={handleOk} style={{ minWidth: 70 }}>确 定</Button>
                                <Button onClick={onClose} style={{ minWidth: 70 }}>取 消</Button>
                            </div>
                        </Col>
                    </Row>
                </fieldset>
            </Form>
        </DraggableModal>
    );
};

export default RibbonEmitterDialog;
