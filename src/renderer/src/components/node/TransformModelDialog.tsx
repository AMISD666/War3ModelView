import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useState, useEffect } from 'react';
import { Form, Checkbox, ConfigProvider, theme, Row, Col, Divider } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import { useUIStore } from '../../store/uiStore';

export const TransformModelDialog: React.FC = () => {
    const { showTransformModelDialog, setTransformModelDialogVisible } = useUIStore();
    const { transformModel } = useModelStore();
    const [form] = Form.useForm();
    const [syncScale, setSyncScale] = useState(true);

    useEffect(() => {
        if (showTransformModelDialog) {
            form.resetFields();
            form.setFieldsValue({
                tx: 0, ty: 0, tz: 0,
                rx: 0, ry: 0, rz: 0,
                sx: 1, sy: 1, sz: 1
            });
            setSyncScale(true);
        }
    }, [showTransformModelDialog, form]);

    const handleOk = () => {
        form.validateFields().then((values) => {
            // Only transform if there is actually a change to avoid unnecessary math/reload
            const hasTranslation = values.tx !== 0 || values.ty !== 0 || values.tz !== 0;
            const hasRotation = values.rx !== 0 || values.ry !== 0 || values.rz !== 0;
            const hasScale = values.sx !== 1 || values.sy !== 1 || values.sz !== 1;

            if (hasTranslation || hasRotation || hasScale) {
                transformModel({
                    translation: hasTranslation ? [values.tx, values.ty, values.tz] : undefined,
                    rotation: hasRotation ? [values.rx, values.ry, values.rz] : undefined,
                    scale: hasScale ? [values.sx, values.sy, values.sz] : undefined
                });
            }
            setTransformModelDialogVisible(false);
        });
    };

    const handleCancel = () => {
        setTransformModelDialogVisible(false);
    };

    const handleScaleChange = (value: number | string | null) => {
        const numVal = typeof value === 'string' ? parseFloat(value) : value;
        if (syncScale && numVal !== null && !isNaN(numVal)) {
            form.setFieldsValue({
                sx: numVal,
                sy: numVal,
                sz: numVal
            });
        }
    };

    const labelStyle = (color: string) => ({
        color: color,
        fontWeight: 'bold',
        fontSize: 12,
        width: 14,
        marginRight: 4,
        display: 'inline-block',
        textAlign: 'center' as const
    });

    const itemStyle = { marginBottom: 8 };

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorBgContainer: '#252526',
                    colorBgElevated: '#2d2d2d',
                    colorText: '#cccccc',
                    colorTextSecondary: '#888888',
                    colorBorder: '#3e3e42',
                    colorPrimary: '#007acc',
                    borderRadius: 4,
                },
                components: {
                    Form: {
                        itemMarginBottom: 8,
                    },
                    InputNumber: {
                        colorBgContainer: '#3c3c3c',
                    }
                }
            }}
        >
            <DraggableModal
                title="修改模型位置/旋转/大小"
                open={showTransformModelDialog}
                onOk={handleOk}
                onCancel={handleCancel}
                destroyOnClose
                width={380}
                bodyStyle={{ padding: '20px 24px 10px 24px' }}
            >
                <Form form={form} layout="horizontal" labelCol={{ span: 0 }} wrapperCol={{ span: 24 }}>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: 8 }}>平移 (Translation)</span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #444, transparent)' }} />
                        </div>
                        <Row gutter={12}>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#ff4d4f')}>X</span>
                                    <Form.Item name="tx" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#52c41a')}>Y</span>
                                    <Form.Item name="ty" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#108ee9')}>Z</span>
                                    <Form.Item name="tz" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                        </Row>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: 8 }}>旋转 (Rotation)</span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #444, transparent)' }} />
                        </div>
                        <Row gutter={12}>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#ff4d4f')}>X</span>
                                    <Form.Item name="rx" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#52c41a')}>Y</span>
                                    <Form.Item name="ry" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#108ee9')}>Z</span>
                                    <Form.Item name="rz" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                        </Row>
                    </div>

                    <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: 8 }}>缩放 (Scale)</span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #444, transparent)' }} />
                        </div>
                        <Row gutter={12}>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#ff4d4f')}>X</span>
                                    <Form.Item name="sx" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber
                                            controls={false}
                                            precision={2}
                                            style={{ width: '100%' }}
                                            onChange={(val) => handleScaleChange(val)}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#52c41a')}>Y</span>
                                    <Form.Item name="sy" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber
                                            controls={false}
                                            precision={2}
                                            style={{ width: '100%' }}
                                            onChange={(val) => handleScaleChange(val)}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#108ee9')}>Z</span>
                                    <Form.Item name="sz" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber
                                            controls={false}
                                            precision={2}
                                            style={{ width: '100%' }}
                                            onChange={(val) => handleScaleChange(val)}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                        </Row>
                        <Form.Item style={{ marginTop: 12, marginBottom: 4 }}>
                            <Checkbox
                                checked={syncScale}
                                onChange={(e) => setSyncScale(e.target.checked)}
                                style={{ fontSize: 12, color: '#aaa' }}
                            >
                                同步缩放比例
                            </Checkbox>
                        </Form.Item>
                    </div>
                </Form>
            </DraggableModal>
        </ConfigProvider>
    );
};

