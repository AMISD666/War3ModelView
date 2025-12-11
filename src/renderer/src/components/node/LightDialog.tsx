import React, { useEffect, useState } from 'react';
import { Form, InputNumber, Select, Button, Row, Col, Checkbox, ColorPicker } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import type { LightNode } from '../../types/node';
import type { Color } from 'antd/es/color-picker';

const { Option } = Select;

interface LightDialogProps {
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

const LightDialog: React.FC<LightDialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode } = useModelStore();

    const currentNode = nodeId !== null ? getNodeById(nodeId) as LightNode : null;

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

    useEffect(() => {
        if (visible && currentNode) {
            let lightTypeValue = currentNode.LightType;
            if (typeof lightTypeValue === 'number') {
                const typeNames = ['Omnidirectional', 'Directional', 'Ambient'];
                lightTypeValue = typeNames[lightTypeValue] as any;
            }

            form.setFieldsValue({
                LightType: lightTypeValue ?? 'Omnidirectional',
                AttenuationStart: currentNode.AttenuationStart ?? 0,
                AttenuationEnd: currentNode.AttenuationEnd ?? 500,
                Intensity: currentNode.Intensity ?? 1,
                AmbientIntensity: currentNode.AmbientIntensity ?? 0,
                Visibility: currentNode.Visibility ?? 1,
                Color: toAntdColor(currentNode.Color),
                AmbientColor: toAntdColor(currentNode.AmbientColor),
            });
            setDynamicProps({});
        } else if (visible) {
            form.setFieldsValue({
                LightType: 'Omnidirectional',
                AttenuationStart: 0,
                AttenuationEnd: 500,
                Intensity: 1,
                AmbientIntensity: 0,
                Visibility: 1,
                Color: 'rgb(255, 255, 255)',
                AmbientColor: 'rgb(255, 255, 255)',
            });
            setDynamicProps({});
        }
    }, [currentNode, visible, form]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!currentNode || nodeId === null) return;

            // Convert LightType string to number for consistency
            let lightTypeVal = 0;
            if (values.LightType === 'Directional') lightTypeVal = 1;
            else if (values.LightType === 'Ambient') lightTypeVal = 2;
            else lightTypeVal = 0; // Omnidirectional

            const updatedNode: LightNode = {
                ...currentNode,
                LightType: lightTypeVal,
                AttenuationStart: values.AttenuationStart,
                AttenuationEnd: values.AttenuationEnd,
                Intensity: values.Intensity,
                AmbientIntensity: values.AmbientIntensity,
                Color: fromAntdColor(values.Color),
                AmbientColor: fromAntdColor(values.AmbientColor),
            };

            updateNode(nodeId, updatedNode);
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    return (
        <DraggableModal
            title="光照"
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
                {/* Row 1: 颜色 | 环境色 | 衰减开始 */}
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
                            label="环境色"

                            isDynamic={!!dynamicProps['AmbientColor']}
                            onDynamicChange={(c) => toggleDynamic('AmbientColor', c)}
                            buttonLabel="颜色"
                        >
                            <Form.Item name="AmbientColor" noStyle>
                                <ColorPicker
                                    size="small"
                                    showText
                                    format="rgb"
                                    disabled={dynamicProps['AmbientColor']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="衰减开始"

                            isDynamic={!!dynamicProps['AttenuationStart']}
                            onDynamicChange={(c) => toggleDynamic('AttenuationStart', c)}
                            buttonLabel="衰减"
                        >
                            <Form.Item name="AttenuationStart" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    disabled={dynamicProps['AttenuationStart']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                </Row>

                {/* Row 2: 光照强度 | 阴影强度 | 衰减结束 */}
                <Row gutter={8}>
                    <Col span={8}>
                        <DynamicField
                            label="光照强度"

                            isDynamic={!!dynamicProps['Intensity']}
                            onDynamicChange={(c) => toggleDynamic('Intensity', c)}
                            buttonLabel="光照强度"
                        >
                            <Form.Item name="Intensity" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    step={0.1}
                                    disabled={dynamicProps['Intensity']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="阴影强度"

                            isDynamic={!!dynamicProps['AmbientIntensity']}
                            onDynamicChange={(c) => toggleDynamic('AmbientIntensity', c)}
                            buttonLabel="光照强度"
                        >
                            <Form.Item name="AmbientIntensity" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    step={0.1}
                                    disabled={dynamicProps['AmbientIntensity']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                    <Col span={8}>
                        <DynamicField
                            label="衰减结束"

                            isDynamic={!!dynamicProps['AttenuationEnd']}
                            onDynamicChange={(c) => toggleDynamic('AttenuationEnd', c)}
                            buttonLabel="衰减"
                        >
                            <Form.Item name="AttenuationEnd" noStyle>
                                <InputNumber
                                    style={inputStyle}
                                    size="small"
                                    min={0}
                                    disabled={dynamicProps['AttenuationEnd']}
                                />
                            </Form.Item>
                        </DynamicField>
                    </Col>
                </Row>

                {/* Row 3: 可见度 | 其他 */}
                <Row gutter={8}>
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
                    <Col span={16}>
                        <fieldset style={{ ...fieldsetStyle, display: 'flex', flexDirection: 'column' }}>
                            <legend style={legendStyle}>其他</legend>
                            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                <span style={{ marginRight: 12, color: '#888' }}>类型:</span>
                                <Form.Item name="LightType" noStyle>
                                    <Select style={{ flex: 1 }} size="small">
                                        <Option value="Omnidirectional">全方向光 (Omnidirectional)</Option>
                                        <Option value="Directional">方向光 (Directional)</Option>
                                        <Option value="Ambient">环境光 (Ambient)</Option>
                                    </Select>
                                </Form.Item>
                            </div>
                        </fieldset>
                    </Col>
                </Row>

                {/* Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <Button onClick={handleOk} style={{ minWidth: 70 }}>确 定</Button>
                    <Button onClick={onClose} style={{ minWidth: 70 }}>取 消</Button>
                </div>
            </Form>
        </DraggableModal>
    );
};

export default LightDialog;
