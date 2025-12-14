import React, { useEffect, useState } from 'react';
import { Form, InputNumber, Checkbox, Select, ColorPicker, Button } from 'antd';

import { DraggableModal } from '../DraggableModal';
import KeyframeEditor from '../editors/KeyframeEditor';
import type { Color } from 'antd/es/color-picker';
import type { ParticleEmitter2Node } from '../../types/node';
import { useModelStore } from '../../store/modelStore';

interface ParticleEmitter2DialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
}

// Property mapping for animations
const PROP_TO_ANIM_KEY: Record<string, string> = {
    EmissionRate: 'EmissionRateAnim',
    Speed: 'SpeedAnim',
    Variation: 'VariationAnim',
    Latitude: 'LatitudeAnim',
    Width: 'WidthAnim',
    Length: 'LengthAnim',
    Gravity: 'GravityAnim',
    Visibility: 'VisibilityAnim'
};

const ParticleEmitter2Dialog: React.FC<ParticleEmitter2DialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData } = useModelStore();

    const currentNode = nodeId !== null ? getNodeById(nodeId) as ParticleEmitter2Node : null;

    // Animation State
    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({});
    const [keyframeEditorVisible, setKeyframeEditorVisible] = useState(false);
    const [currentEditingProp, setCurrentEditingProp] = useState<string | null>(null);

    // Helper to convert array [r, g, b] (0-1) to Antd Color
    const toAntdColor = (rgb?: [number, number, number]) => {
        if (!rgb) return 'rgb(255, 255, 255)';
        return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
    };

    // Helper to convert Antd Color to array [r, g, b] (0-1)
    const fromAntdColor = (color: Color | string): [number, number, number] => {
        let r = 1, g = 1, b = 1;
        if (typeof color === 'string') {
            console.log('[ParticleDialog] Parsing color string:', color);
            // Parse "rgb(255, 255, 255)"
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                r = parseInt(match[1]) / 255;
                g = parseInt(match[2]) / 255;
                b = parseInt(match[3]) / 255;
            } else {
                // Fallback or other formats
                console.warn('[ParticleDialog] Could not parse color string, defaulting to white:', color);
            }
        } else if (color && typeof color === 'object') {
            // Antd Color object
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
                FilterMode: 0, // 0=None, 1=Transparent, 2=Blend, 3=Additive, 4=AddAlpha, 5=Modulate, 6=Modulate2x
                Rows: 1,
                Columns: 1,
                PriorityPlane: 0,
                ReplaceableId: 0,

                // Segments (White, Alpha 255, Scale 1)
                Seg1Color: 'rgb(255, 255, 255)', Seg1Alpha: 255, Seg1Scaling: 1,
                Seg2Color: 'rgb(255, 255, 255)', Seg2Alpha: 255, Seg2Scaling: 1,
                Seg3Color: 'rgb(255, 255, 255)', Seg3Alpha: 255, Seg3Scaling: 1,

                // Lifecycle - using Start/End/Repeat format
                HeadLifeSpanStart: 0, HeadLifeSpanEnd: 0, HeadLifeSpanRepeat: 1,
                HeadDecayStart: 0, HeadDecayEnd: 0, HeadDecayRepeat: 1,
                TailLifeSpanStart: 0, TailLifeSpanEnd: 0, TailLifeSpanRepeat: 1,
                TailDecayStart: 0, TailDecayEnd: 0, TailDecayRepeat: 1,
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

            const newAnimDataMap: Record<string, any> = {};

            if (currentNode) {
                // Helper to parse interval array [start, end, repeat] or object format {"0":..,"1":..,"2":..}
                // Object format occurs after save due to zustand/spread operations converting arrays
                const parseInterval = (value: any): [number, number, number] => {
                    if (Array.isArray(value)) {
                        return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 1];
                    }
                    // Handle object format {"0": n, "1": n, "2": n} from array-to-object conversion
                    if (value && typeof value === 'object' && '0' in value) {
                        return [value['0'] ?? 0, value['1'] ?? 0, value['2'] ?? 1];
                    }
                    // Old format: single number treated as start, end=0, repeat=1
                    return [typeof value === 'number' ? value : 0, 0, 1];
                };

                console.log('[ParticleDialog] Loading UV anims:', JSON.stringify({
                    LifeSpanUVAnim: currentNode.LifeSpanUVAnim,
                    DecayUVAnim: currentNode.DecayUVAnim,
                    TailUVAnim: currentNode.TailUVAnim,
                    TailDecayUVAnim: currentNode.TailDecayUVAnim
                }));

                const headLifeSpan = parseInterval(currentNode.LifeSpanUVAnim);
                const headDecay = parseInterval(currentNode.DecayUVAnim);
                const tailLifeSpan = parseInterval(currentNode.TailUVAnim);
                const tailDecay = parseInterval(currentNode.TailDecayUVAnim);

                console.log('[ParticleDialog] Parsed UV anims:', JSON.stringify({ headLifeSpan, headDecay, tailLifeSpan, tailDecay }));

                form.setFieldsValue({
                    ...defaults,
                    ...currentNode,
                    // Ensure Visibility always has a value (currentNode may have undefined)
                    Visibility: currentNode.Visibility ?? defaults.Visibility,
                    // Override complex types
                    Seg1Color: toAntdColor(currentNode.SegmentColor?.[0]),
                    Seg1Alpha: currentNode.Alpha?.[0] ?? defaults.Seg1Alpha,
                    Seg1Scaling: currentNode.ParticleScaling?.[0] ?? defaults.Seg1Scaling,

                    Seg2Color: toAntdColor(currentNode.SegmentColor?.[1]),
                    Seg2Alpha: currentNode.Alpha?.[1] ?? defaults.Seg2Alpha,
                    Seg2Scaling: currentNode.ParticleScaling?.[1] ?? defaults.Seg2Scaling,

                    Seg3Color: toAntdColor(currentNode.SegmentColor?.[2]),
                    Seg3Alpha: currentNode.Alpha?.[2] ?? defaults.Seg3Alpha,
                    Seg3Scaling: currentNode.ParticleScaling?.[2] ?? defaults.Seg3Scaling,

                    // HeadLifeSpan/Decay/TailLifeSpan/Decay parsed from arrays
                    HeadLifeSpanStart: headLifeSpan[0],
                    HeadLifeSpanEnd: headLifeSpan[1],
                    HeadLifeSpanRepeat: headLifeSpan[2],
                    HeadDecayStart: headDecay[0],
                    HeadDecayEnd: headDecay[1],
                    HeadDecayRepeat: headDecay[2],
                    TailLifeSpanStart: tailLifeSpan[0],
                    TailLifeSpanEnd: tailLifeSpan[1],
                    TailLifeSpanRepeat: tailLifeSpan[2],
                    TailDecayStart: tailDecay[0],
                    TailDecayEnd: tailDecay[1],
                    TailDecayRepeat: tailDecay[2],
                });

                // Load existing animation data
                Object.entries(PROP_TO_ANIM_KEY).forEach(([propName, animKey]) => {
                    const animData = (currentNode as any)[animKey];
                    if (animData) {
                        newAnimDataMap[propName] = animData;
                    }
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

            const updatedNode: ParticleEmitter2Node = {
                ...currentNode,
                EmissionRate: Number(values.EmissionRate),
                Speed: Number(values.Speed),
                Variation: Number(values.Variation),
                Latitude: Number(values.Latitude),
                Width: Number(values.Width),
                Length: Number(values.Length),
                Gravity: Number(values.Gravity),

                TextureID: Number(values.TextureID),
                FilterMode: values.FilterMode,
                Rows: Number(values.Rows),
                Columns: Number(values.Columns),
                PriorityPlane: Number(values.PriorityPlane),
                ReplaceableId: Number(values.ReplaceableId),

                SegmentColor: [
                    fromAntdColor(values.Seg1Color),
                    fromAntdColor(values.Seg2Color),
                    fromAntdColor(values.Seg3Color),
                ],
                Alpha: [Number(values.Seg1Alpha), Number(values.Seg2Alpha), Number(values.Seg3Alpha)],
                ParticleScaling: [Number(values.Seg1Scaling), Number(values.Seg2Scaling), Number(values.Seg3Scaling)],

                // HeadLifeSpan/HeadDecay/TailLifeSpan/TailDecay are 3-value interval arrays [start, end, repeat]
                LifeSpanUVAnim: [Number(values.HeadLifeSpanStart) || 0, Number(values.HeadLifeSpanEnd) || 0, Number(values.HeadLifeSpanRepeat) || 1],
                DecayUVAnim: [Number(values.HeadDecayStart) || 0, Number(values.HeadDecayEnd) || 0, Number(values.HeadDecayRepeat) || 1],
                TailUVAnim: [Number(values.TailLifeSpanStart) || 0, Number(values.TailLifeSpanEnd) || 0, Number(values.TailLifeSpanRepeat) || 1],
                TailDecayUVAnim: [Number(values.TailDecayStart) || 0, Number(values.TailDecayEnd) || 0, Number(values.TailDecayRepeat) || 1],
                TailLength: Number(values.TailLength),
                Time: Number(values.Time),
                LifeSpan: Number(values.LifeSpan),

                Unshaded: values.Unshaded,
                Unfogged: values.Unfogged,
                SortPrimsFarZ: values.SortPrimsFarZ,
                LineEmitter: values.LineEmitter,
                ModelSpace: values.ModelSpace,
                XYQuad: values.XYQuad,
                Squirt: values.Squirt,
                Head: values.Head,
                Tail: values.Tail,
                Visibility: Number(values.Visibility),  // 添加可见度保存
            };

            // Merge Animation Data
            Object.entries(PROP_TO_ANIM_KEY).forEach(([propName, animKey]) => {
                if (animDataMap[propName]) {
                    (updatedNode as any)[animKey] = animDataMap[propName];
                } else {
                    // Start of block: Explicitly Delete Removed Animations
                    // If the user unchecked "Dynamic", ensure the anim key is removed or set to undefined
                    delete (updatedNode as any)[animKey];
                }
            });

            updateNode(nodeId, updatedNode);
            // NOTE: Auto renderer reload disabled - was causing model data corruption
            // const { triggerRendererReload } = useModelStore.getState();
            // triggerRendererReload();
            onClose();
        } catch (e) {
            console.error("Validation failed", e);
        }
    };

    const [currentEditingTitle, setCurrentEditingTitle] = useState<string>('');

    const handleOpenKeyframeEditor = (propName: string, title: string) => {
        setCurrentEditingProp(propName);
        setCurrentEditingTitle(title);
        setKeyframeEditorVisible(true);
    };

    const handleKeyframeSave = (animVector: any) => {
        if (currentEditingProp) {
            setAnimDataMap(prev => ({
                ...prev,
                [currentEditingProp]: animVector
            }));
            setKeyframeEditorVisible(false);
            setCurrentEditingProp(null);
        }
    };

    const handleDynamicChange = (propName: string, checked: boolean) => {
        if (checked) {
            // Initialize empty animation if none exists
            if (!animDataMap[propName]) {
                setAnimDataMap(prev => ({
                    ...prev,
                    [propName]: { Keys: [], LineType: 0, GlobalSeqId: null }
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

    // --- New Components ---

    // Boxed Numeric Field (Mimics Magos)
    const BoxedNumericField = ({ label, name, min = undefined, max = undefined, precision = undefined, width = undefined }:
        { label: string, name: string, min?: number, max?: number, precision?: number, width?: number | string }) => {
        const isDynamic = !!animDataMap[name];

        return (
            <div style={{
                border: '1px solid #484848',
                padding: '12px 6px 6px 6px',
                position: 'relative',
                marginTop: 8,
                backgroundColor: '#2b2b2b',
                borderRadius: 2,
                width: width
            }}>
                <span style={{
                    position: 'absolute',
                    top: -9,
                    left: 8,
                    backgroundColor: '#1f1f1f', // Match modal bg
                    padding: '0 4px',
                    fontSize: 12,
                    color: '#ccc'
                }}>
                    {label}
                </span>

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
                    onClick={() => handleOpenKeyframeEditor(name, label)}
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
                        style={{ width: '100%', backgroundColor: '#333', borderColor: '#444', color: '#fff' }}
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

    // Rendering Section Box (Right Side of Top)
    const RenderingSection = () => (
        <div style={{
            border: '1px solid #484848',
            padding: '12px 8px',
            position: 'relative',
            marginTop: 8,
            backgroundColor: '#2b2b2b',
            borderRadius: 2,
            height: 'calc(100% - 8px)' // Fill height to match neighbor rows if possible
        }}>
            <span style={{
                position: 'absolute',
                top: -9,
                left: 8,
                backgroundColor: '#1f1f1f',
                padding: '0 4px',
                fontSize: 12,
                color: '#ccc'
            }}>
                渲染
            </span>

            <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 4, color: '#ccc' }}>贴图 ID:</div>
                <Form.Item name="TextureID" noStyle>
                    <Select options={textureOptions} style={{ width: '100%' }} size="small" popupMatchSelectWidth={false} />
                </Form.Item>
            </div>

            <div>
                <div style={{ marginBottom: 4, color: '#ccc' }}>过滤模式:</div>
                <Form.Item name="FilterMode" noStyle>
                    <Select options={[
                        { label: 'Blend', value: 0 },
                        { label: 'Additive', value: 1 },
                        { label: 'Modulate', value: 2 },
                        { label: 'Modulate2x', value: 3 },
                        { label: 'AlphaKey', value: 4 },
                    ]} style={{ width: '100%' }} size="small" />
                </Form.Item>
            </div>
        </div>
    );

    // Segment Box
    const SegmentBox = ({ title, prefix }: { title: string, prefix: string }) => (
        <fieldset style={{ border: '1px solid #484848', padding: '10px 8px 6px', margin: 0, marginTop: 8, backgroundColor: '#2b2b2b' }}>
            <legend style={{ fontSize: 12, color: '#ccc', marginLeft: 8, padding: '0 4px', width: 'auto' }}>{title}</legend>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>颜色:</span>
                <Form.Item name={`${prefix}Color`} noStyle>
                    <ColorPicker size="small" showText format="rgb" />
                </Form.Item>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>透明:</span>
                <Form.Item name={`${prefix}Alpha`} noStyle>
                    <InputNumber min={0} max={255} size="small" style={{ flex: 1 }} />
                </Form.Item>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>缩放:</span>
                <Form.Item name={`${prefix}Scaling`} noStyle>
                    <InputNumber step={1} precision={0} size="small" style={{ flex: 1 }} />
                </Form.Item>
            </div>
        </fieldset>
    );

    // Texture Options
    const textureOptions = modelData?.Textures?.map((tex: any, index: number) => ({
        label: `[${index}] ${tex.Image}`,
        value: index
    })) || [];
    textureOptions.unshift({ label: '(None)', value: -1 });

    return (
        <DraggableModal
            title="II型粒子发射器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null} // Hide default footer
            width={850}
            style={{ top: 20 }}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '8px 12px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            <Form form={form} layout="vertical">
                {/* --- TOP SECTION --- */}
                <div style={{ display: 'flex', gap: 8 }}>
                    {/* Row 1 Params (Fit 5 items) */}
                    <BoxedNumericField label="可见度" name="Visibility" min={0} max={1} precision={1} width="20%" />
                    <BoxedNumericField label="放射速率" name="EmissionRate" width="20%" />
                    <BoxedNumericField label="速度" name="Speed" width="20%" />
                    <BoxedNumericField label="变化" name="Variation" precision={2} width="20%" />
                    <BoxedNumericField label="纬度" name="Latitude" precision={2} width="20%" />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {/* Row 2 Params */}
                    <div style={{ width: '20%' }}><BoxedNumericField label="宽度" name="Width" /></div>
                    <div style={{ width: '20%' }}><BoxedNumericField label="长度" name="Length" /></div>
                    <div style={{ width: '20%' }}><BoxedNumericField label="重力" name="Gravity" /></div>

                    {/* Rendering Section */}
                    <div style={{ flex: 1 }}>
                        <RenderingSection />
                    </div>
                </div>

                {/* --- MAIN CONTENT SPLIT (Left Column vs Right Column) --- */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>

                    {/* LEFT COLUMN: Segments, Lifecycle, Others */}
                    <div style={{ flex: 1 }}>
                        {/* Segments */}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <div style={{ flex: 1 }}><SegmentBox title="第一部分" prefix="Seg1" /></div>
                            <div style={{ flex: 1 }}><SegmentBox title="第二部分" prefix="Seg2" /></div>
                            <div style={{ flex: 1 }}><SegmentBox title="第三部分" prefix="Seg3" /></div>
                        </div>

                        {/* Lifecycle - MDX uses HeadLifeSpan/HeadDecay/TailLifeSpan/TailDecay as interval arrays */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>头部 (持续时间)</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>开始:</span>
                                    <Form.Item name="HeadLifeSpanStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>结束:</span>
                                    <Form.Item name="HeadLifeSpanEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>重复:</span>
                                    <Form.Item name="HeadLifeSpanRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>头部 (衰减)</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>开始:</span>
                                    <Form.Item name="HeadDecayStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>结束:</span>
                                    <Form.Item name="HeadDecayEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>重复:</span>
                                    <Form.Item name="HeadDecayRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>尾部 (持续时间)</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>开始:</span>
                                    <Form.Item name="TailLifeSpanStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>结束:</span>
                                    <Form.Item name="TailLifeSpanEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>重复:</span>
                                    <Form.Item name="TailLifeSpanRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>尾部 (衰减)</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>开始:</span>
                                    <Form.Item name="TailDecayStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>结束:</span>
                                    <Form.Item name="TailDecayEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>重复:</span>
                                    <Form.Item name="TailDecayRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>
                        </div>

                        {/* Other Params */}
                        <div style={{ border: '1px solid #484848', padding: '8px 12px', marginTop: 12, backgroundColor: '#2b2b2b' }}>
                            <div style={{ position: 'relative', top: -16, backgroundColor: '#1f1f1f', padding: '0 4px', width: 'fit-content', color: '#ccc', fontSize: 12 }}>其他</div>
                            <div style={{ marginTop: -8 }}>
                                <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 30 }}>行数:</span>
                                        <Form.Item name="Rows" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>持续时间:</span>
                                        <Form.Item name="LifeSpan" noStyle><InputNumber size="small" style={{ flex: 1 }} precision={1} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>优先平面:</span>
                                        <Form.Item name="PriorityPlane" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 30 }}>时间:</span>
                                        <Form.Item name="Time" noStyle><InputNumber size="small" style={{ flex: 1 }} precision={1} /></Form.Item>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 30 }}>列数:</span>
                                        <Form.Item name="Columns" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>尾部长度:</span>
                                        <Form.Item name="TailLength" noStyle><InputNumber size="small" style={{ flex: 1 }} precision={1} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>可替换ID:</span>
                                        <Form.Item name="ReplaceableId" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ flex: 1 }}></div> {/* Spacer */}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Flags + Buttons */}
                    <div style={{ width: 140, display: 'flex', flexDirection: 'column' }}>
                        {/* Flags */}
                        <div style={{ border: '1px solid #484848', padding: '6px 8px', flex: 1, backgroundColor: '#2b2b2b', marginTop: 8, position: 'relative' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid #444', color: '#ccc', fontSize: 12 }}>标记</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Form.Item name="Unshaded" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>无阴影</Checkbox></Form.Item>
                                <Form.Item name="Unfogged" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>无雾化</Checkbox></Form.Item>
                                <Form.Item name="SortPrimsFarZ" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>透明度</Checkbox></Form.Item>
                                <Form.Item name="LineEmitter" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>线发射器</Checkbox></Form.Item>
                                <Form.Item name="ModelSpace" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>模型空间</Checkbox></Form.Item>
                                <Form.Item name="XYQuad" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>XY 象限</Checkbox></Form.Item>
                                <Form.Item name="Squirt" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>喷射</Checkbox></Form.Item>
                                <Form.Item name="Head" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>头部</Checkbox></Form.Item>
                                <Form.Item name="Tail" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>尾部</Checkbox></Form.Item>
                            </div>

                            {/* Buttons inside Flags Box (Bottom) */}
                            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <Button onClick={handleOk} type="primary" size="small" block>确定</Button>
                                <Button onClick={onClose} size="small" block>取消</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Form>

            {keyframeEditorVisible && (
                <KeyframeEditor
                    visible={keyframeEditorVisible}
                    onCancel={() => {
                        setKeyframeEditorVisible(false);
                        setCurrentEditingProp(null);
                    }}
                    onOk={handleKeyframeSave}
                    initialData={currentEditingProp ? animDataMap[currentEditingProp] : null}
                    title={`编辑: ${currentEditingTitle}`}
                    vectorSize={1}
                    globalSequences={modelData?.GlobalSequences?.map(g => g.Duration) || []}
                    sequences={modelData?.Sequences || []}
                />
            )}
        </DraggableModal>
    );
};

export default ParticleEmitter2Dialog;
