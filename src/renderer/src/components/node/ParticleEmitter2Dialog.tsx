import React, { useEffect } from 'react';
import { Modal, Form, InputNumber, Checkbox, Select, Row, Col, Card, ColorPicker } from 'antd';
import type { Color } from 'antd/es/color-picker';
import type { ParticleEmitter2Node } from '../../types/node';
import { useModelStore } from '../../store/modelStore';

interface ParticleEmitter2DialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
}

const ParticleEmitter2Dialog: React.FC<ParticleEmitter2DialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData } = useModelStore();

    const currentNode = nodeId !== null ? getNodeById(nodeId) as ParticleEmitter2Node : null;

    // Helper to convert array [r, g, b] (0-1) to Antd Color
    const toAntdColor = (rgb?: [number, number, number]) => {
        if (!rgb) return 'rgb(255, 255, 255)';
        return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
    };

    // Helper to convert Antd Color to array [r, g, b] (0-1)
    const fromAntdColor = (color: Color | string): [number, number, number] => {
        let r = 1, g = 1, b = 1;
        if (typeof color === 'string') {
            // Simple parse if string (fallback)
            return [1, 1, 1];
        } else {
            const rgb = color.toRgb();
            r = rgb.r / 255;
            g = rgb.g / 255;
            b = rgb.b / 255;
        }
        return [r, g, b];
    };

    // Load data into form with DEFAULTS
    useEffect(() => {
        if (visible) {
            // Defaults as requested
            const defaults = {
                Visibility: 1,
                EmissionRate: 0,
                Speed: 0,
                Variation: 0,
                Latitude: 0,
                Width: 0,
                Length: 0,
                Gravity: 0,

                TextureID: -1,
                FilterMode: 'None',
                Rows: 1,
                Columns: 1,
                PriorityPlane: 0,
                ReplaceableId: 0,

                // Segments (White, Alpha 255, Scale 1)
                Seg1Color: 'rgb(255, 255, 255)', Seg1Alpha: 255, Seg1Scaling: 1,
                Seg2Color: 'rgb(255, 255, 255)', Seg2Alpha: 255, Seg2Scaling: 1,
                Seg3Color: 'rgb(255, 255, 255)', Seg3Alpha: 255, Seg3Scaling: 1,

                // Lifecycle
                HeadLifeSpan: 0, HeadDecay: 0,
                TailLifeSpan: 0, TailDecay: 0,
                TailLength: 0,
                Time: 0.5,
                LifeSpan: 1,

                // Flags
                Unshaded: true,
                Unfogged: false,
                SortPrimsFarZ: true,
                LineEmitter: false,
                ModelSpace: false,
                XYQuad: false,
                Squirt: false,
                Head: true,
                Tail: false,
            };

            if (currentNode) {
                form.setFieldsValue({
                    ...defaults,
                    ...currentNode,
                    // Override complex types
                    Seg1Color: toAntdColor(currentNode.SegmentColor?.[0]),
                    Seg1Alpha: currentNode.SegmentAlpha?.[0] ?? defaults.Seg1Alpha,
                    Seg1Scaling: currentNode.SegmentScaling?.[0] ?? defaults.Seg1Scaling,

                    Seg2Color: toAntdColor(currentNode.SegmentColor?.[1]),
                    Seg2Alpha: currentNode.SegmentAlpha?.[1] ?? defaults.Seg2Alpha,
                    Seg2Scaling: currentNode.SegmentScaling?.[1] ?? defaults.Seg2Scaling,

                    Seg3Color: toAntdColor(currentNode.SegmentColor?.[2]),
                    Seg3Alpha: currentNode.SegmentAlpha?.[2] ?? defaults.Seg3Alpha,
                    Seg3Scaling: currentNode.SegmentScaling?.[2] ?? defaults.Seg3Scaling,
                });
            } else {
                form.setFieldsValue(defaults);
            }
        }
    }, [currentNode, visible, form]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!currentNode || nodeId === null) return;

            const updatedNode: ParticleEmitter2Node = {
                ...currentNode,
                EmissionRate: values.EmissionRate,
                Speed: values.Speed,
                Variation: values.Variation,
                Latitude: values.Latitude,
                Width: values.Width,
                Length: values.Length,
                Gravity: values.Gravity,

                TextureID: values.TextureID,
                FilterMode: values.FilterMode,
                Rows: values.Rows,
                Columns: values.Columns,
                PriorityPlane: values.PriorityPlane,
                ReplaceableId: values.ReplaceableId,

                SegmentColor: [
                    fromAntdColor(values.Seg1Color),
                    fromAntdColor(values.Seg2Color),
                    fromAntdColor(values.Seg3Color),
                ],
                SegmentAlpha: [values.Seg1Alpha, values.Seg2Alpha, values.Seg3Alpha],
                SegmentScaling: [values.Seg1Scaling, values.Seg2Scaling, values.Seg3Scaling],

                HeadLifeSpan: values.HeadLifeSpan,
                HeadDecay: values.HeadDecay,
                TailLifeSpan: values.TailLifeSpan,
                TailDecay: values.TailDecay,
                TailLength: values.TailLength,
                Time: values.Time,
                LifeSpan: values.LifeSpan,

                Unshaded: values.Unshaded,
                Unfogged: values.Unfogged,
                SortPrimsFarZ: values.SortPrimsFarZ,
                LineEmitter: values.LineEmitter,
                ModelSpace: values.ModelSpace,
                XYQuad: values.XYQuad,
                Squirt: values.Squirt,
                Head: values.Head,
                Tail: values.Tail,
            };

            updateNode(nodeId, updatedNode);
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    // Helper for Numeric Input
    const NumericField = ({ label, name, min = undefined, max = undefined, precision = undefined }: { label: string, name: string, min?: number, max?: number, precision?: number }) => (
        <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 12 }}>{label}</span>
                <Checkbox disabled style={{ fontSize: 12 }}>动态</Checkbox>
            </div>
            <Form.Item name={name} noStyle>
                <InputNumber style={{ width: '100%' }} min={min} max={max} precision={precision} size="small" />
            </Form.Item>
        </div>
    );

    // Helper for Segment Section
    const SegmentSection = ({ title, prefix }: { title: string, prefix: string }) => (
        <div style={{ border: '1px solid #444', padding: 8, borderRadius: 4, height: '100%' }}>
            <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 12, textAlign: 'center' }}>{title}</div>
            <div style={{ marginBottom: 4, fontSize: 12 }}>颜色:</div>
            <Form.Item name={`${prefix}Color`} style={{ marginBottom: 8 }}>
                <ColorPicker showText size="small" style={{ width: '100%' }} />
            </Form.Item>
            <div style={{ marginBottom: 4, fontSize: 12 }}>透明度:</div>
            <Form.Item name={`${prefix}Alpha`} style={{ marginBottom: 8 }}>
                <InputNumber min={0} max={255} style={{ width: '100%' }} size="small" />
            </Form.Item>
            <div style={{ marginBottom: 4, fontSize: 12 }}>缩放:</div>
            <Form.Item name={`${prefix}Scaling`} style={{ marginBottom: 0 }}>
                <InputNumber step={0.1} style={{ width: '100%' }} size="small" />
            </Form.Item>
        </div>
    );

    // Texture Options
    const textureOptions = modelData?.Textures?.map((tex: any, index: number) => ({
        label: `[${index}] ${tex.Image}`,
        value: index
    })) || [];
    textureOptions.unshift({ label: '(None)', value: -1 });

    return (
        <Modal
            title="粒子发射器属性"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={750}
            style={{ top: 20 }}
            maskClosable={false}
            bodyStyle={{ padding: '12px 24px' }}
        >
            <Form form={form} layout="vertical">
                {/* Top: Basic Properties */}
                <Row gutter={12}>
                    <Col span={6}><NumericField label="可见度" name="Visibility" min={0} max={1} /></Col>
                    <Col span={6}><NumericField label="放射速率" name="EmissionRate" /></Col>
                    <Col span={6}><NumericField label="速度" name="Speed" /></Col>
                    <Col span={6}><NumericField label="变化" name="Variation" precision={3} /></Col>
                    <Col span={6}><NumericField label="纬度" name="Latitude" /></Col>
                    <Col span={6}><NumericField label="重力" name="Gravity" /></Col>
                    <Col span={6}><NumericField label="宽度" name="Width" /></Col>
                    <Col span={6}><NumericField label="长度" name="Length" /></Col>
                </Row>

                {/* Middle: Segments */}
                <Row gutter={12} style={{ marginTop: 8 }}>
                    <Col span={8}><SegmentSection title="第一部分" prefix="Seg1" /></Col>
                    <Col span={8}><SegmentSection title="第二部分" prefix="Seg2" /></Col>
                    <Col span={8}><SegmentSection title="第三部分" prefix="Seg3" /></Col>
                </Row>

                {/* Bottom: Lifecycle & Rendering */}
                <Row gutter={12} style={{ marginTop: 16 }}>
                    {/* Lifecycle */}
                    <Col span={12}>
                        <Card size="small" title="生命周期" bodyStyle={{ padding: 8 }}>
                            <Row gutter={8} align="middle" style={{ marginBottom: 8 }}>
                                <Col span={4} style={{ textAlign: 'right' }}>头部:</Col>
                                <Col span={10}><Form.Item name="HeadLifeSpan" noStyle><InputNumber addonBefore="开始" size="small" style={{ width: '100%' }} /></Form.Item></Col>
                                <Col span={10}><Form.Item name="HeadDecay" noStyle><InputNumber addonBefore="结束" size="small" style={{ width: '100%' }} /></Form.Item></Col>
                            </Row>
                            <Row gutter={8} align="middle" style={{ marginBottom: 8 }}>
                                <Col span={4} style={{ textAlign: 'right' }}>尾部:</Col>
                                <Col span={10}><Form.Item name="TailLifeSpan" noStyle><InputNumber addonBefore="开始" size="small" style={{ width: '100%' }} /></Form.Item></Col>
                                <Col span={10}><Form.Item name="TailDecay" noStyle><InputNumber addonBefore="结束" size="small" style={{ width: '100%' }} /></Form.Item></Col>
                            </Row>
                            <Row gutter={8} align="middle">
                                <Col span={4} style={{ textAlign: 'right' }}>重复:</Col>
                                <Col span={10}><InputNumber disabled value={1} size="small" style={{ width: '100%' }} /></Col>
                            </Row>
                        </Card>
                    </Col>

                    {/* Rendering */}
                    <Col span={12}>
                        <Card size="small" title="渲染" bodyStyle={{ padding: 8 }}>
                            {/* Row 1: Texture */}
                            <Row gutter={8} style={{ marginBottom: 8 }}>
                                <Col span={24}>
                                    <div style={{ fontSize: 12, marginBottom: 2 }}>贴图 ID:</div>
                                    <Form.Item name="TextureID" noStyle>
                                        <Select options={textureOptions} size="small" style={{ width: '100%' }} />
                                    </Form.Item>
                                </Col>
                            </Row>
                            {/* Row 2: Filter Mode */}
                            <Row gutter={8} style={{ marginBottom: 8 }}>
                                <Col span={24}>
                                    <div style={{ fontSize: 12, marginBottom: 2 }}>过滤模式:</div>
                                    <Form.Item name="FilterMode" noStyle>
                                        <Select options={[
                                            { label: 'None', value: 'None' },
                                            { label: 'Blend', value: 'Blend' },
                                            { label: 'Additive', value: 'Additive' },
                                            { label: 'Modulate', value: 'Modulate' },
                                            { label: 'Modulate2x', value: 'Modulate2x' },
                                            { label: 'AlphaKey', value: 'AlphaKey' },
                                        ]} size="small" style={{ width: '100%' }} />
                                    </Form.Item>
                                </Col>
                            </Row>
                            {/* Row 3: Others */}
                            <Row gutter={8}>
                                <Col span={6}><div style={{ fontSize: 12 }}>行数:</div><Form.Item name="Rows" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item></Col>
                                <Col span={6}><div style={{ fontSize: 12 }}>列数:</div><Form.Item name="Columns" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item></Col>
                                <Col span={6}><div style={{ fontSize: 12 }}>优先平面:</div><Form.Item name="PriorityPlane" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item></Col>
                                <Col span={6}><div style={{ fontSize: 12 }}>可替换ID:</div><Form.Item name="ReplaceableId" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item></Col>
                            </Row>
                        </Card>
                    </Col>
                </Row>

                {/* Flags & Misc */}
                <Row gutter={12} style={{ marginTop: 16 }}>
                    <Col span={16}>
                        <Card size="small" title="标记" bodyStyle={{ padding: 8 }}>
                            <Row gutter={16}>
                                <Col span={12}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Form.Item name="Unshaded" valuePropName="checked" noStyle><Checkbox>无阴影</Checkbox></Form.Item>
                                        <Form.Item name="Unfogged" valuePropName="checked" noStyle><Checkbox>无雾化</Checkbox></Form.Item>
                                        <Form.Item name="SortPrimsFarZ" valuePropName="checked" noStyle><Checkbox>透明度</Checkbox></Form.Item>
                                        <Form.Item name="LineEmitter" valuePropName="checked" noStyle><Checkbox>线发射器</Checkbox></Form.Item>
                                        <Form.Item name="Squirt" valuePropName="checked" noStyle><Checkbox>喷射</Checkbox></Form.Item>
                                    </div>
                                </Col>
                                <Col span={12}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Form.Item name="ModelSpace" valuePropName="checked" noStyle><Checkbox>模型空间</Checkbox></Form.Item>
                                        <Form.Item name="XYQuad" valuePropName="checked" noStyle><Checkbox>XY 象限</Checkbox></Form.Item>
                                        <Form.Item name="Head" valuePropName="checked" noStyle><Checkbox>头部</Checkbox></Form.Item>
                                        <Form.Item name="Tail" valuePropName="checked" noStyle><Checkbox>尾部</Checkbox></Form.Item>
                                    </div>
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                    <Col span={8}>
                        <Card size="small" title="其他" bodyStyle={{ padding: 8 }}>
                            <Row gutter={8}>
                                <Col span={12}>
                                    <div style={{ fontSize: 12 }}>时间:</div>
                                    <Form.Item name="Time" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item>
                                </Col>
                                <Col span={12}>
                                    <div style={{ fontSize: 12 }}>生命周期:</div>
                                    <Form.Item name="LifeSpan" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item>
                                </Col>
                                <Col span={12} style={{ marginTop: 8 }}>
                                    <div style={{ fontSize: 12 }}>尾部长度:</div>
                                    <Form.Item name="TailLength" noStyle><InputNumber size="small" style={{ width: '100%' }} /></Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                </Row>
            </Form>
        </Modal>
    );
};

export default ParticleEmitter2Dialog;
