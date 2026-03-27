import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useState } from 'react';
import { Form, Select, Button, Row, Col, Checkbox } from 'antd';
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker';
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

    // Helper to convert array/Float32Array [r, g, b] (0-1) to Antd Color
    const toAntdColor = (rgb?: number[] | Float32Array) => {
        if (!rgb || rgb.length < 3) {
            console.log('[RibbonEmitterDialog] toAntdColor: No valid rgb, defaulting to white');
            return 'rgb(255, 255, 255)';
        }
        // Convert to array if Float32Array
        const arr = Array.from(rgb);
        console.log('[RibbonEmitterDialog] toAntdColor: Input rgb values:', arr);
        // Values should be 0-1 range from MDX parsing
        const r = Math.round(arr[0] * 255);
        const g = Math.round(arr[1] * 255);
        const b = Math.round(arr[2] * 255);
        console.log('[RibbonEmitterDialog] toAntdColor: Output rgb:', r, g, b);
        return `rgb(${r}, ${g}, ${b})`;
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

    // Helper: Check if value is AnimVector object
    const isAnimVector = (val: any): boolean =>
        val !== null && val !== undefined && typeof val === 'object' && ('Keys' in val || Array.isArray(val?.Keys));

    // Helper: Get static value or default for AnimVector
    const getStaticOrDefault = (val: any, defaultVal: number): number => {
        if (isAnimVector(val)) return defaultVal;
        return typeof val === 'number' ? val : defaultVal;
    };

    useEffect(() => {
        if (visible && currentNode) {
            // Detect AnimVector properties and set dynamic flags
            const newDynamicProps: Record<string, boolean> = {
                Alpha: isAnimVector(currentNode.Alpha),
                Visibility: isAnimVector((currentNode as any).Visibility),
                HeightAbove: isAnimVector(currentNode.HeightAbove),
                HeightBelow: isAnimVector(currentNode.HeightBelow),
                TextureSlot: isAnimVector(currentNode.TextureSlot),
                Color: isAnimVector(currentNode.Color),
            };
            setDynamicProps(newDynamicProps);

            form.setFieldsValue({
                HeightAbove: getStaticOrDefault(currentNode.HeightAbove, 0),
                HeightBelow: getStaticOrDefault(currentNode.HeightBelow, 0),
                Alpha: getStaticOrDefault(currentNode.Alpha, 1),
                Visibility: getStaticOrDefault((currentNode as any).Visibility, 1),
                TextureSlot: getStaticOrDefault(currentNode.TextureSlot, 0),
                Color: toAntdColor(Array.isArray(currentNode.Color) ? currentNode.Color : undefined),
                MaterialID: currentNode.MaterialID ?? -1,
                EmissionRate: currentNode.EmissionRate ?? 0,
                LifeSpan: currentNode.LifeSpan ?? 0,
                Rows: currentNode.Rows ?? 1,
                Columns: currentNode.Columns ?? 1,
                Gravity: currentNode.Gravity ?? 0,
            });
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

            const currentAny = currentNode as any;
            const toFiniteNumber = (val: any, fallback: number): number =>
                (typeof val === 'number' && Number.isFinite(val)) ? val : fallback;
            const preserveAnimOrUseStatic = (prop: string, formVal: any, fallback: number): any => {
                // This dialog currently has no curve editor for dynamic fields.
                // If a field is marked dynamic and already stores an AnimVector, keep it unchanged.
                if (dynamicProps[prop] && isAnimVector(currentAny[prop])) {
                    return currentAny[prop];
                }
                return toFiniteNumber(formVal, fallback);
            };

            const rows = Math.max(1, Math.round(
                toFiniteNumber(values.Rows, toFiniteNumber(currentAny.Rows, 1))
            ));
            const columns = Math.max(1, Math.round(
                toFiniteNumber(values.Columns, toFiniteNumber(currentAny.Columns, 1))
            ));
            const materialIdRaw = toFiniteNumber(values.MaterialID, toFiniteNumber(currentAny.MaterialID, 0));

            const updatedNode: RibbonEmitterNode = {
                ...currentNode,
                HeightAbove: preserveAnimOrUseStatic('HeightAbove', values.HeightAbove, getStaticOrDefault(currentAny.HeightAbove, 0)),
                HeightBelow: preserveAnimOrUseStatic('HeightBelow', values.HeightBelow, getStaticOrDefault(currentAny.HeightBelow, 0)),
                Alpha: preserveAnimOrUseStatic('Alpha', values.Alpha, getStaticOrDefault(currentAny.Alpha, 1)),
                Visibility: preserveAnimOrUseStatic('Visibility', values.Visibility, getStaticOrDefault(currentAny.Visibility, 1)),
                Color: (dynamicProps.Color && isAnimVector(currentAny.Color)) ? currentAny.Color : fromAntdColor(values.Color),
                TextureSlot: preserveAnimOrUseStatic('TextureSlot', values.TextureSlot, getStaticOrDefault(currentAny.TextureSlot, 0)),
                EmissionRate: toFiniteNumber(values.EmissionRate, toFiniteNumber(currentAny.EmissionRate, 10)),
                MaterialID: materialIdRaw >= 0 ? materialIdRaw : undefined,
                LifeSpan: toFiniteNumber(values.LifeSpan, toFiniteNumber(currentAny.LifeSpan, 1)),
                Rows: rows,
                Columns: columns,
                Gravity: toFiniteNumber(values.Gravity, toFiniteNumber(currentAny.Gravity, 0)),
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
                                    <InputNumber style={{ ...inputStyle, flex: 1 }} size="small" min={0} step={0.01} precision={2} />
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
