import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, Input, InputNumber } from 'antd';

import { DraggableModal } from '../DraggableModal';
import KeyframeEditor from '../editors/KeyframeEditor';
import { useHistoryStore } from '../../store/historyStore';
import { useModelStore } from '../../store/modelStore';
import type { ParticleEmitterNode } from '../../types/node';

interface ParticleEmitterDialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
}

const EMITTER_USES_MDL = 32768;
const EMITTER_USES_TGA = 65536;

const isAnimVector = (val: any): boolean => {
    return val && typeof val === 'object' && Array.isArray(val.Keys);
};

const getStaticValue = (val: any, defaultVal: number = 0): number => {
    if (isAnimVector(val)) {
        const firstKey = val.Keys?.[0];
        const vec = firstKey?.Vector ?? firstKey?.Value;
        if (Array.isArray(vec) || ArrayBuffer.isView(vec)) {
            return Number((vec as any)[0] ?? defaultVal);
        }
        return Number(vec ?? defaultVal);
    }
    return Number(val ?? defaultVal);
};

type NumericField = {
    name: string;
    title: string;
    min?: number;
    max?: number;
    precision?: number;
    step?: number;
};

const ParticleEmitterDialog: React.FC<ParticleEmitterDialogProps> = ({ visible, nodeId, onClose }) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData } = useModelStore();

    const currentNode = nodeId !== null ? (getNodeById(nodeId) as ParticleEmitterNode) : null;

    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({});
    const [keyframeEditorVisible, setKeyframeEditorVisible] = useState(false);
    const [currentEditingProp, setCurrentEditingProp] = useState<string | null>(null);
    const [currentEditingTitle, setCurrentEditingTitle] = useState<string>('');

    const numericFields: NumericField[] = useMemo(
        () => [
            { name: 'EmissionRate', title: '发射速率', min: 0 },
            { name: 'LifeSpan', title: '持续时间', min: 0, precision: 3, step: 0.01 },
            { name: 'InitVelocity', title: '初速度', precision: 3, step: 0.01 },
            { name: 'Gravity', title: '重力', precision: 3, step: 0.01 },
            { name: 'Longitude', title: '经度', precision: 3, step: 0.01 },
            { name: 'Latitude', title: '纬度', precision: 3, step: 0.01 },
            { name: 'Visibility', title: '可见度', min: 0, max: 1, precision: 3, step: 0.01 },
        ],
        []
    );

    const handleOpenKeyframeEditor = (propName: string, title: string) => {
        setCurrentEditingProp(propName);
        setCurrentEditingTitle(title);
        setKeyframeEditorVisible(true);
    };

    const handleKeyframeSave = (animVector: any) => {
        if (!currentEditingProp) return;
        setAnimDataMap((prev) => ({
            ...prev,
            [currentEditingProp]: animVector,
        }));
        setKeyframeEditorVisible(false);
        setCurrentEditingProp(null);
    };

    const handleDynamicChange = (propName: string, checked: boolean) => {
        if (checked) {
            if (!animDataMap[propName]) {
                setAnimDataMap((prev) => ({
                    ...prev,
                    [propName]: { Keys: [], LineType: 0, GlobalSeqId: null },
                }));
            }
        } else {
            setAnimDataMap((prev) => {
                const copy = { ...prev };
                delete copy[propName];
                return copy;
            });
        }
    };

    useEffect(() => {
        if (!visible) return;

        const defaults = {
            Path: '',
            UsesMdl: false,
            UsesTga: false,
            EmissionRate: 10,
            LifeSpan: 1,
            InitVelocity: 0,
            Gravity: 0,
            Longitude: 0,
            Latitude: 0,
            Visibility: 1,
        };

        const newAnimDataMap: Record<string, any> = {};

        if (currentNode) {
            const flags = Number((currentNode as any).Flags ?? 0);
            const path = (currentNode as any).Path ?? (currentNode as any).FileName ?? '';

            for (const f of numericFields) {
                const val = (currentNode as any)[f.name];
                if (isAnimVector(val)) newAnimDataMap[f.name] = val;
            }

            form.setFieldsValue({
                ...defaults,
                Path: path,
                UsesMdl: (flags & EMITTER_USES_MDL) !== 0,
                UsesTga: (flags & EMITTER_USES_TGA) !== 0,
                EmissionRate: getStaticValue((currentNode as any).EmissionRate, defaults.EmissionRate),
                LifeSpan: getStaticValue((currentNode as any).LifeSpan, defaults.LifeSpan),
                InitVelocity: getStaticValue((currentNode as any).InitVelocity, defaults.InitVelocity),
                Gravity: getStaticValue((currentNode as any).Gravity, defaults.Gravity),
                Longitude: getStaticValue((currentNode as any).Longitude, defaults.Longitude),
                Latitude: getStaticValue((currentNode as any).Latitude, defaults.Latitude),
                Visibility: getStaticValue((currentNode as any).Visibility, defaults.Visibility),
            });
        } else {
            form.setFieldsValue(defaults);
        }

        setAnimDataMap(newAnimDataMap);
    }, [visible, currentNode, form, numericFields]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!currentNode || nodeId === null) return;

            let flags = Number((currentNode as any).Flags ?? 0);
            if (values.UsesMdl) flags |= EMITTER_USES_MDL;
            else flags &= ~EMITTER_USES_MDL;
            if (values.UsesTga) flags |= EMITTER_USES_TGA;
            else flags &= ~EMITTER_USES_TGA;

            const updatedNode: ParticleEmitterNode = {
                ...currentNode,
                ...(currentNode as any),
                Flags: flags as any,
                Path: String(values.Path ?? ''),
                FileName: String(values.Path ?? ''),
            } as any;

            for (const f of numericFields) {
                if (animDataMap[f.name]) {
                    (updatedNode as any)[f.name] = animDataMap[f.name];
                } else {
                    (updatedNode as any)[f.name] = Number(values[f.name]);
                }
            }

            useHistoryStore.getState().push({
                name: '编辑粒子系统',
                undo: () => updateNode(nodeId, currentNode),
                redo: () => updateNode(nodeId, updatedNode),
            });

            updateNode(nodeId, updatedNode);
            onClose();
        } catch (e) {
            console.error('Validation failed', e);
        }
    };

    const globalSequences = (modelData?.GlobalSequences || [])
        .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
        .filter((v: any) => typeof v === 'number');

    const NumericGroup: React.FC<{ field: NumericField }> = ({ field }) => {
        const isDynamic = !!animDataMap[field.name];

        return (
            <fieldset className="pe1-group">
                <legend>{field.title}</legend>

                <div className="pe1-dyn-row">
                    <Checkbox
                        checked={isDynamic}
                        onChange={(e) => handleDynamicChange(field.name, e.target.checked)}
                    >
                        动态化
                    </Checkbox>
                </div>

                <Button
                    size="small"
                    className="pe1-kf-btn"
                    disabled={!isDynamic}
                    onClick={() => handleOpenKeyframeEditor(field.name, field.title)}
                >
                    {field.title}
                </Button>

                <Form.Item name={field.name} style={{ marginBottom: 0 }}>
                    <InputNumber
                        size="small"
                        controls={false}
                        min={field.min}
                        max={field.max}
                        precision={field.precision}
                        step={field.step}
                        disabled={isDynamic}
                        placeholder="0"
                        className="pe1-number"
                    />
                </Form.Item>
            </fieldset>
        );
    };

    return (
        <>
            <DraggableModal
                title="I型粒子发射器"
                open={visible}
                onCancel={onClose}
                footer={(
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <Button onClick={handleOk} type="primary" size="small">确定</Button>
                        <Button onClick={onClose} size="small">取消</Button>
                    </div>
                )}
                width={540}
                resizable={false}
                maskClosable={false}
                wrapClassName="pe1-dialog"
                styles={{ body: { padding: 10 } }}
            >
                <Form form={form} layout="vertical">
                    <div className="pe1-grid">
                        <NumericGroup field={numericFields[0]} />
                        <NumericGroup field={numericFields[1]} />
                        <NumericGroup field={numericFields[2]} />

                        <NumericGroup field={numericFields[3]} />
                        <NumericGroup field={numericFields[4]} />
                        <NumericGroup field={numericFields[5]} />

                        <NumericGroup field={numericFields[6]} />

                        <fieldset className="pe1-group pe1-other">
                            <legend>其他</legend>

                            <div className="pe1-other-label">粒子文件名</div>
                            <Form.Item name="Path" style={{ marginBottom: 8 }}>
                                <Input
                                    size="small"
                                    className="pe1-text"
                                    placeholder="例如：Particles\\Dust.blp 或 .mdl/.tga"
                                />
                            </Form.Item>

                            <div className="pe1-other-checks">
                                <Form.Item name="UsesMdl" valuePropName="checked" style={{ marginBottom: 4 }}>
                                    <Checkbox>发射器使用 MDL 文件</Checkbox>
                                </Form.Item>
                                <Form.Item name="UsesTga" valuePropName="checked" style={{ marginBottom: 0 }}>
                                    <Checkbox>发射器使用 TGA 文件</Checkbox>
                                </Form.Item>
                            </div>
                        </fieldset>
                    </div>
                </Form>
            </DraggableModal>

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
                    globalSequences={globalSequences as any}
                    sequences={modelData?.Sequences || []}
                />
            )}
        </>
    );
};

export default ParticleEmitterDialog;
