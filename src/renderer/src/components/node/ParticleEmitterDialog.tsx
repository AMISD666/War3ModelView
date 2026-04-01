import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, Input } from 'antd';

import { DraggableModal } from '../DraggableModal';
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell';
import { listen } from '@tauri-apps/api/event';
import { windowManager } from '../../utils/WindowManager';
import { useHistoryStore } from '../../store/historyStore';
import { useModelStore } from '../../store/modelStore';
import type { ParticleEmitterNode } from '../../types/node';

interface ParticleEmitterDialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
    isStandalone?: boolean;
    standaloneNode?: ParticleEmitterNode | null;
    standaloneEmit?: (command: string, payload?: any) => void;
    standaloneModelData?: { Textures?: any[]; GlobalSequences?: any[]; Sequences?: any[] } | null;
}

const EMITTER_USES_MDL = 32768;
const EMITTER_USES_TGA = 65536;

const isAnimVector = (val: any): boolean => {
    return val && typeof val === 'object' && Array.isArray(val.Keys);
};

const getStaticValue = (val: any, defaultVal: number = 0): number => {
    if (isAnimVector(val)) {
        const keys = val.Keys;
        if (!Array.isArray(keys) || keys.length === 0) return defaultVal;
        const firstKey = keys[0];
        const vec = firstKey?.Vector ?? firstKey?.Value;
        if (Array.isArray(vec) || ArrayBuffer.isView(vec)) {
            const n = Number((vec as any)[0]);
            return Number.isFinite(n) ? n : defaultVal;
        }
        if (vec !== undefined && vec !== null) {
            const n = Number(vec);
            return Number.isFinite(n) ? n : defaultVal;
        }
        return defaultVal;
    }
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    const n = Number(val);
    return Number.isFinite(n) ? n : defaultVal;
};

type NumericField = {
    name: string;
    title: string;
    min?: number;
    max?: number;
    precision?: number;
    step?: number;
};

const ParticleEmitterDialog: React.FC<ParticleEmitterDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
}) => {
    const [form] = Form.useForm();
    const { getNodeById, updateNode, modelData: storeModelData } = useModelStore();
    const modelData = isStandalone ? standaloneModelData : storeModelData;

    const currentNode =
        nodeId !== null
            ? (isStandalone
                ? (standaloneNode as ParticleEmitterNode | null)
                : (getNodeById(nodeId) as ParticleEmitterNode))
            : null;

    const applyNodeToStore = React.useCallback(
        (next: ParticleEmitterNode, history?: { name: string; undoNode: any; redoNode: any }) => {
            if (nodeId === null) return;
            if (isStandalone && standaloneEmit) {
                standaloneEmit('APPLY_NODE_UPDATE', { objectId: nodeId, node: next, history });
                return;
            }
            if (history) {
                useHistoryStore.getState().push({
                    name: history.name,
                    undo: () => updateNode(nodeId, history.undoNode),
                    redo: () => updateNode(nodeId, history.redoNode),
                });
            }
            updateNode(nodeId, next);
        },
        [isStandalone, standaloneEmit, nodeId, updateNode]
    );

    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({});
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

    const globalSequences = useMemo(() => {
        return (modelData?.GlobalSequences || [])
            .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
            .filter((v: any) => typeof v === 'number');
    }, [modelData?.GlobalSequences]);

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'ParticleEmitterDialog') {
                if (currentEditingProp) {
                    setAnimDataMap((prev) => ({
                        ...prev,
                        [currentEditingProp]: payload.data,
                    }));
                    setCurrentEditingProp(null);
                }
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [currentEditingProp]);

    const handleOpenKeyframeEditor = (propName: string, title: string) => {
        setCurrentEditingProp(propName);

        const payload = {
            callerId: 'ParticleEmitterDialog',
            initialData: animDataMap[propName] || null,
            title: `编辑: ${title}`,
            vectorSize: 1,
            fieldName: propName,
            sequences: modelData?.Sequences || [],
            globalSequences: globalSequences as any
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
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

    const formHydratedForNodeIdRef = React.useRef<number | null>(null);

    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null;
            return;
        }
        if (nodeId === null) return;
        if (formHydratedForNodeIdRef.current === nodeId) return;

        const sourceNode = isStandalone
            ? (standaloneNode as ParticleEmitterNode | null)
            : (useModelStore.getState().getNodeById(nodeId) as ParticleEmitterNode | undefined) ?? null;

        if (!sourceNode) return;

        formHydratedForNodeIdRef.current = nodeId;

        const currentNode = sourceNode;

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

        setAnimDataMap(newAnimDataMap);
    }, [visible, nodeId, isStandalone, standaloneNode, form, numericFields]);

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

            applyNodeToStore(updatedNode, {
                name: '编辑粒子系统',
                undoNode: currentNode,
                redoNode: updatedNode,
            });
            onClose();
        } catch (e) {
            console.error('Validation failed', e);
        }
    }; // End of handleOk

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

    const pe1Form = (
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
    );

    if (isStandalone) {
        return (
            <NodeEditorStandaloneShell>
                <>
                    {pe1Form}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
                        <Button onClick={handleOk} type="primary" size="small">确定</Button>
                        <Button onClick={onClose} size="small">取消</Button>
                    </div>
                </>
            </NodeEditorStandaloneShell>
        );
    }

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
                {pe1Form}
            </DraggableModal>
        </>
    );
}; // End of ParticleEmitterDialog

export default ParticleEmitterDialog;

