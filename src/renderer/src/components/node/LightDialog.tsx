import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useState } from 'react';
import { Form, Select, Button, Row, Col, Checkbox, ColorPicker } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import { useHistoryStore } from '../../store/historyStore';
import { emit, listen } from '@tauri-apps/api/event';
import { windowManager } from '../../utils/windowManager';
import type { LightNode } from '../../types/node';
import type { Color } from 'antd/es/color-picker';

const { Option } = Select;

interface LightDialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
}

// Property mapping for animations (propName -> animKey on node)
const PROP_TO_ANIM_KEY: Record<string, string> = {
    Color: 'ColorAnim',
    AmbientColor: 'AmbientColorAnim',
    Intensity: 'IntensityAnim',
    AmbientIntensity: 'AmbientIntensityAnim',
    AttenuationStart: 'AttenuationStartAnim',
    AttenuationEnd: 'AttenuationEndAnim',
    Visibility: 'VisibilityAnim'
};

// Helper to check if a value is an AnimVector (animated)
const isAnimVector = (val: any): boolean => {
    return val && typeof val === 'object' && Array.isArray(val.Keys);
};

// Extract static value from AnimVector or return as-is
const getStaticValue = (val: any, defaultVal: any = 0): any => {
    if (isAnimVector(val)) {
        // Use first keyframe value
        const firstKey = val.Keys?.[0];
        if (firstKey) {
            const vec = firstKey.Vector ?? firstKey.Value;
            if (Array.isArray(vec)) {
                return vec.length === 1 ? vec[0] : vec;
            }
            return vec ?? defaultVal;
        }
        return defaultVal;
    }
    return val ?? defaultVal;
};

const LightDialog: React.FC<LightDialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData } = useModelStore();

    const currentNode = nodeId !== null ? getNodeById(nodeId) as LightNode : null;

    // Animation State (same pattern as ParticleEmitter2Dialog)
    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({});
    const [currentEditingProp, setCurrentEditingProp] = useState<string | null>(null);

    // Helper to convert array [r, g, b] (0-1) to Antd Color
    const toAntdColor = (rgb?: [number, number, number] | any) => {
        // Handle AnimVector
        if (isAnimVector(rgb)) {
            const firstKey = rgb.Keys?.[0];
            const vec = firstKey?.Vector ?? firstKey?.Value;
            if (Array.isArray(vec) && vec.length >= 3) {
                return `rgb(${Math.round(vec[0] * 255)}, ${Math.round(vec[1] * 255)}, ${Math.round(vec[2] * 255)})`;
            }
            return 'rgb(255, 255, 255)';
        }
        if (!rgb) return 'rgb(255, 255, 255)';
        if (Array.isArray(rgb) && rgb.length >= 3) {
            return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
        }
        return 'rgb(255, 255, 255)';
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
        if (visible) {
            const defaults = {
                LightType: 'Omnidirectional',
                AttenuationStart: 0,
                AttenuationEnd: 500,
                Intensity: 1,
                AmbientIntensity: 0,
                Visibility: 1,
                Color: 'rgb(255, 255, 255)',
                AmbientColor: 'rgb(255, 255, 255)',
            };

            const newAnimDataMap: Record<string, any> = {};

            if (currentNode) {
                let lightTypeValue = currentNode.LightType;
                if (typeof lightTypeValue === 'number') {
                    const typeNames = ['Omnidirectional', 'Directional', 'Ambient'];
                    lightTypeValue = typeNames[lightTypeValue] as any;
                }

                // Check for animated properties and load them
                Object.entries(PROP_TO_ANIM_KEY).forEach(([propName, animKey]) => {
                    const value = (currentNode as any)[propName];
                    if (isAnimVector(value)) {
                        newAnimDataMap[propName] = value;
                    }
                    // Also check the anim key itself (if stored separately)
                    const animValue = (currentNode as any)[animKey];
                    if (isAnimVector(animValue)) {
                        newAnimDataMap[propName] = animValue;
                    }
                });

                form.setFieldsValue({
                    LightType: lightTypeValue ?? defaults.LightType,
                    // Use static value extraction for form fields
                    AttenuationStart: getStaticValue(currentNode.AttenuationStart, defaults.AttenuationStart),
                    AttenuationEnd: getStaticValue(currentNode.AttenuationEnd, defaults.AttenuationEnd),
                    Intensity: getStaticValue(currentNode.Intensity, defaults.Intensity),
                    AmbientIntensity: getStaticValue(currentNode.AmbientIntensity, defaults.AmbientIntensity),
                    Visibility: getStaticValue((currentNode as any).Visibility, defaults.Visibility),
                    Color: toAntdColor(currentNode.Color),
                    AmbientColor: toAntdColor(currentNode.AmbientColor),
                });
            } else {
                form.setFieldsValue(defaults);
            }

            setAnimDataMap(newAnimDataMap);
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

            // Build updated node with static or animated values
            const updatedNode: any = {
                ...currentNode,
                LightType: lightTypeVal,
            };

            // Handle each property - use animated data if available, otherwise static
            const propConfigs: Array<{ prop: string, isColor: boolean, formField: string }> = [
                { prop: 'AttenuationStart', isColor: false, formField: 'AttenuationStart' },
                { prop: 'AttenuationEnd', isColor: false, formField: 'AttenuationEnd' },
                { prop: 'Intensity', isColor: false, formField: 'Intensity' },
                { prop: 'AmbientIntensity', isColor: false, formField: 'AmbientIntensity' },
                { prop: 'Color', isColor: true, formField: 'Color' },
                { prop: 'AmbientColor', isColor: true, formField: 'AmbientColor' },
                { prop: 'Visibility', isColor: false, formField: 'Visibility' },
            ];

            propConfigs.forEach(({ prop, isColor, formField }) => {
                const animKey = PROP_TO_ANIM_KEY[prop];
                if (animDataMap[prop]) {
                    // Animated - store both the property and the anim key
                    updatedNode[prop] = animDataMap[prop];
                    if (animKey) {
                        updatedNode[animKey] = animDataMap[prop];
                    }
                } else {
                    // Static
                    if (isColor) {
                        updatedNode[prop] = fromAntdColor(values[formField]);
                    } else {
                        updatedNode[prop] = Number(values[formField]);
                    }
                    // Remove anim key if it was previously animated
                    if (animKey) {
                        delete updatedNode[animKey];
                    }
                }
            });

            // History
            useHistoryStore.getState().push({
                name: `Edit Light`,
                undo: () => updateNode(nodeId, currentNode),
                redo: () => updateNode(nodeId, updatedNode)
            });

            updateNode(nodeId, updatedNode);
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'LightDialog') {
                if (currentEditingProp) {
                    setAnimDataMap(prev => ({
                        ...prev,
                        [currentEditingProp]: payload.data
                    }));
                    setCurrentEditingProp(null);
                }
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [currentEditingProp]);

    const handleOpenKeyframeEditor = (propName: string, title: string, vectorSize: number = 1) => {
        setCurrentEditingProp(propName);

        const payload = {
            callerId: 'LightDialog',
            initialData: animDataMap[propName] || null,
            title: `编辑: ${title}`,
            vectorSize,
            fieldName: propName,
            globalSequences: (modelData?.GlobalSequences || [])
                .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
                .filter((v: any) => typeof v === 'number'),
            sequences: modelData?.Sequences || []
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        emit('IPC_KEYFRAME_INIT', payload);
        windowManager.openToolWindow(windowId, payload.title, 600, 480);
    };

    const handleDynamicChange = (propName: string, checked: boolean) => {
        if (checked) {
            // Initialize empty animation if none exists
            if (!animDataMap[propName]) {
                setAnimDataMap(prev => ({
                    ...prev,
                    [propName]: { Keys: [], LineType: 1, GlobalSeqId: null }
                }));
            }
        } else {
            // Remove animation
            setAnimDataMap(prev => {
                const copy = { ...prev };
                delete copy[propName];
                return copy;
            });
        }
    };

    // Common styles
    const boxStyle: React.CSSProperties = {
        border: '1px solid #484848',
        padding: '12px 6px 6px 6px',
        position: 'relative',
        marginTop: 8,
        backgroundColor: '#2b2b2b',
        borderRadius: 2,
    };

    const labelStyle: React.CSSProperties = {
        position: 'absolute',
        top: -9,
        left: 8,
        backgroundColor: '#1f1f1f',
        padding: '0 4px',
        fontSize: 12,
        color: '#ccc'
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        backgroundColor: '#333',
        borderColor: '#444',
        color: '#fff'
    };

    // Boxed Numeric Field (matches ParticleEmitter2Dialog style)
    const BoxedNumericField = ({ label, name, min, max, precision, width }:
        { label: string, name: string, min?: number, max?: number, precision?: number, width?: number | string }) => {
        const isDynamic = !!animDataMap[name];

        return (
            <div style={{ ...boxStyle, width }}>
                <span style={labelStyle}>{label}</span>

                <div style={{ marginBottom: 6 }}>
                    <Checkbox
                        checked={isDynamic}
                        onChange={(e) => handleDynamicChange(name, e.target.checked)}
                        style={{ color: '#ccc', fontSize: 12 }}
                    >
                        动态化
                    </Checkbox>
                </div>

                <Button
                    block
                    size="small"
                    onClick={() => handleOpenKeyframeEditor(name, label, 1)}
                    disabled={!isDynamic}
                    style={{
                        marginBottom: 6,
                        backgroundColor: '#444',
                        color: isDynamic ? '#fff' : '#888',
                        borderColor: '#555',
                        height: 28
                    }}
                >
                    {label}
                </Button>

                <Form.Item name={name} noStyle>
                    <InputNumber
                        style={inputStyle}
                        min={min}
                        max={max}
                        precision={precision}
                        disabled={isDynamic}
                        size="small"
                        placeholder="0"
                    />
                </Form.Item>
            </div>
        );
    };

    // Boxed Color Field
    const BoxedColorField = ({ label, name }:
        { label: string, name: string }) => {
        const isDynamic = !!animDataMap[name];

        return (
            <div style={boxStyle}>
                <span style={labelStyle}>{label}</span>

                <div style={{ marginBottom: 6 }}>
                    <Checkbox
                        checked={isDynamic}
                        onChange={(e) => handleDynamicChange(name, e.target.checked)}
                        style={{ color: '#ccc', fontSize: 12 }}
                    >
                        动态化
                    </Checkbox>
                </div>

                <Button
                    block
                    size="small"
                    onClick={() => handleOpenKeyframeEditor(name, label, 3)}
                    disabled={!isDynamic}
                    style={{
                        marginBottom: 6,
                        backgroundColor: '#444',
                        color: isDynamic ? '#fff' : '#888',
                        borderColor: '#555',
                        height: 28
                    }}
                >
                    {label}
                </Button>

                <Form.Item name={name} noStyle>
                    <ColorPicker
                        size="small"
                        showText
                        format="rgb"
                        disabled={isDynamic}
                    />
                </Form.Item>
            </div>
        );
    };

    return (
        <DraggableModal
            title="光照"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={700}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            <Form form={form} layout="vertical">
                {/* Row 1: 颜色 | 环境色 | 衰减开始 */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                        <BoxedColorField label="颜色" name="Color" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <BoxedColorField label="环境色" name="AmbientColor" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <BoxedNumericField label="衰减开始" name="AttenuationStart" min={0} />
                    </div>
                </div>

                {/* Row 2: 光照强度 | 环境强度 | 衰减结束 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1 }}>
                        <BoxedNumericField label="光照强度" name="Intensity" min={0} precision={2} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <BoxedNumericField label="环境强度" name="AmbientIntensity" min={0} precision={2} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <BoxedNumericField label="衰减结束" name="AttenuationEnd" min={0} />
                    </div>
                </div>

                {/* Row 3: 可见度 | 类型选择 | 按钮 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1 }}>
                        <BoxedNumericField label="可见度" name="Visibility" min={0} max={1} precision={1} />
                    </div>
                    <div style={{ flex: 2 }}>
                        <div style={boxStyle}>
                            <span style={labelStyle}>其他</span>
                            <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                                <span style={{ marginRight: 12, color: '#888' }}>类型:</span>
                                <Form.Item name="LightType" noStyle>
                                    <Select style={{ flex: 1 }} size="small">
                                        <Option value="Omnidirectional">全方向光 (Omnidirectional)</Option>
                                        <Option value="Directional">方向光 (Directional)</Option>
                                        <Option value="Ambient">环境光 (Ambient)</Option>
                                    </Select>
                                </Form.Item>
                            </div>

                            {/* Buttons */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                                <Button onClick={handleOk} type="primary" size="small" style={{ minWidth: 70 }}>确定</Button>
                                <Button onClick={onClose} size="small" style={{ minWidth: 70 }}>取消</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Form>
        </DraggableModal>
    );
};

export default LightDialog;

