import { SmartInputNumber as BaseInputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Form, Checkbox, Select, Button, Input, Slider } from 'antd';
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker';
import { UndoOutlined } from '@ant-design/icons';

import { DraggableModal } from '../DraggableModal';
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell';
import AppErrorBoundary from '../common/AppErrorBoundary';
import { windowManager } from '../../utils/WindowManager';
import type { Color } from 'antd/es/color-picker';
import type { ParticleEmitter2Node } from '../../types/node';
import { useModelStore } from '../../store/modelStore';
import { getDraggedTextureIndex } from '../../utils/textureDragDrop';
import { saveParticleEmitter2Preset } from '../../services/particleEmitter2PresetService';
import { showMessage } from '../../store/messageStore';
import { uiText } from '../../constants/uiText';
import { MATERIAL_FILTER_MODE_OPTIONS } from '../../constants/filterModes';
import { useNodeEditorPreview } from '../../hooks/useNodeEditorPreview';
import { useWindowEvent } from '../../hooks/useWindowEvent';
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc';
import { nodeEditorCommandHandler } from '../../application/commands';
import { KEYFRAME_SAVE_EVENT, type KeyframeSavePayload } from '../../application/window-bridge';

const DEFERRED_PREVIEW_FIELD_NAMES = new Set([
    'Visibility',
    'EmissionRate',
    'Speed',
    'Variation',
    'Latitude',
    'Width',
    'Length',
    'Gravity',
    'Seg1Alpha',
    'Seg1Scaling',
    'Seg2Alpha',
    'Seg2Scaling',
    'Seg3Alpha',
    'Seg3Scaling',
    'HeadLifeSpanStart',
    'HeadLifeSpanEnd',
    'HeadLifeSpanRepeat',
    'HeadDecayStart',
    'HeadDecayEnd',
    'HeadDecayRepeat',
    'TailLifeSpanStart',
    'TailLifeSpanEnd',
    'TailLifeSpanRepeat',
    'TailDecayStart',
    'TailDecayEnd',
    'TailDecayRepeat',
    'Rows',
    'LifeSpan',
    'PriorityPlane',
    'Time',
    'Columns',
    'TailLength',
    'ReplaceableId',
]);

const DeferredCommitContext = React.createContext<(() => void) | null>(null);

const InputNumber = React.forwardRef<any, React.ComponentProps<typeof BaseInputNumber>>((props, ref) => {
    const commitDeferredChanges = React.useContext(DeferredCommitContext);
    const { onBlur, onPressEnter, ...rest } = props as any;

    return (
        <BaseInputNumber
            ref={ref}
            {...rest}
            onBlur={(event: any) => {
                onBlur?.(event);
                commitDeferredChanges?.();
            }}
            onPressEnter={(event: any) => {
                onPressEnter?.(event);
                commitDeferredChanges?.();
            }}
        />
    );
});

InputNumber.displayName = 'ParticleEmitter2DeferredInputNumber';

type SegmentColorTuple = [[number, number, number], [number, number, number], [number, number, number]];

interface ParticleEmitter2ColorFieldControlProps {
    name: string;
    committedValue: string;
    form: any;
    getCurrentSegmentColors: () => SegmentColorTuple;
    flushPreviewNowWithOverrides: (overrides?: Partial<ParticleEmitter2Node>) => void;
    resetOverallHueState: () => void;
    fromAntdColor: (color: Color | string) => [number, number, number];
}

const ParticleEmitter2ColorFieldControl: React.FC<ParticleEmitter2ColorFieldControlProps> = ({
    name,
    committedValue,
    form,
    getCurrentSegmentColors,
    flushPreviewNowWithOverrides,
    resetOverallHueState,
    fromAntdColor,
}) => {
    const [draftValue, setDraftValue] = useState(committedValue);
    const [pickerOpen, setPickerOpen] = useState(false);

    useEffect(() => {
        if (!pickerOpen) {
            setDraftValue(committedValue);
        }
    }, [committedValue, pickerOpen]);

    const commitColorValue = useCallback((rawValue: string) => {
        const nextValue = rawValue.trim() || 'rgb(255, 255, 255)';
        resetOverallHueState();
        if (nextValue !== committedValue) {
            const nextSegmentColors = getCurrentSegmentColors();
            const nextRgb = fromAntdColor(nextValue);
            if (name === 'Seg1Color') nextSegmentColors[0] = nextRgb;
            if (name === 'Seg2Color') nextSegmentColors[1] = nextRgb;
            if (name === 'Seg3Color') nextSegmentColors[2] = nextRgb;
            form.setFieldsValue({ [name]: nextValue });
            flushPreviewNowWithOverrides({ SegmentColor: nextSegmentColors });
        }
        setDraftValue(nextValue);
    }, [committedValue, flushPreviewNowWithOverrides, form, fromAntdColor, getCurrentSegmentColors, name, resetOverallHueState]);

    const commitDraftValue = useCallback(() => {
        commitColorValue(draftValue);
    }, [commitColorValue, draftValue]);

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <ColorPicker
                size="small"
                showText={false}
                format="rgb"
                value={draftValue}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onChange={(color: Color) => {
                    setDraftValue(
                        color && typeof color.toRgbString === 'function'
                            ? color.toRgbString()
                            : committedValue
                    );
                }}
                onChangeComplete={(color: Color) => {
                    const nextValue =
                        color && typeof color.toRgbString === 'function'
                            ? color.toRgbString()
                            : committedValue;
                    commitColorValue(nextValue);
                }}
            />
            <Input
                size="small"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                onBlur={commitDraftValue}
                onPressEnter={commitDraftValue}
                placeholder="rgb(255, 255, 255)"
                style={{ flex: 1, minWidth: 0 }}
            />
        </div>
    );
};

interface ParticleEmitter2DialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
    /** 独立 WebView：无 Zustand，经 RPC 同步 */
    isStandalone?: boolean;
    standaloneNode?: ParticleEmitter2Node | null;
    standaloneEmit?: NodeEditorCommandSender;
    standaloneModelData?: { Textures?: any[]; GlobalSequences?: any[]; Sequences?: any[] } | null;
    standaloneModelPath?: string;
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

const isAnimVector = (val: any): boolean => {
    return val && typeof val === 'object' && Array.isArray(val.Keys);
};

const getStaticValue = (val: any, defaultVal: number = 0): number => {
    if (isAnimVector(val)) {
        const keys = val.Keys;
        if (!Array.isArray(keys) || keys.length === 0) return defaultVal;
        const firstKey = keys[0];
        const vec = firstKey?.Vector ?? firstKey?.Value;
        if (Array.isArray(vec)) {
            const n = Number(vec[0]);
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

const getFiniteNumber = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeHue = (value: number): number => {
    const wrapped = value % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
};

const rgbToHsv = (r: number, g: number, b: number): [number, number, number] => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;

    if (delta > 1e-8) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    const s = max <= 1e-8 ? 0 : delta / max;
    const v = max;
    return [h, s, v];
};

const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
    const hh = normalizeHue(h);
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;

    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else[r, g, b] = [c, 0, x];

    return [r + m, g + m, b + m];
};

const ParticleEmitter2Dialog: React.FC<ParticleEmitter2DialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
    standaloneModelPath,
}) => {
    const [form] = Form.useForm();
    const { getNodeById, modelData: storeModelData, modelPath: storeModelPath } = useModelStore();
    const modelData = isStandalone ? standaloneModelData : storeModelData;
    const modelPath = isStandalone ? (standaloneModelPath ?? '') : storeModelPath;
    const [isTextureDropActive, setIsTextureDropActive] = useState(false);
    const [overallHueShift, setOverallHueShift] = useState(0);
    const [overallAlphaScale, setOverallAlphaScale] = useState(1);
    const [overallScaleScale, setOverallScaleScale] = useState(1);
    const hueBaseColorsRef = useRef<[number, number, number][] | null>(null);
    const alphaBaseValuesRef = useRef<number[] | null>(null);
    const scalingBaseValuesRef = useRef<number[] | null>(null);

    const currentNode =
        nodeId !== null
            ? (isStandalone
                ? (standaloneNode as ParticleEmitter2Node | null)
                : (getNodeById(nodeId) as ParticleEmitter2Node))
            : null;

    const getCurrentSourceNode = React.useCallback((): ParticleEmitter2Node | null => {
        if (nodeId === null) return null;
        if (isStandalone) {
            return (standaloneNode as ParticleEmitter2Node | null) ?? null;
        }
        return (useModelStore.getState().getNodeById(nodeId) as ParticleEmitter2Node | undefined) ?? null;
    }, [isStandalone, nodeId, standaloneNode]);

    const applyCommittedNode = React.useCallback(
        (next: ParticleEmitter2Node, history?: { name: string; undoNode: any; redoNode: any }) => {
            if (nodeId === null) return;
            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next, history });
                return;
            }
            nodeEditorCommandHandler.applyNodeUpdate({ objectId: nodeId, node: next, history });
        },
        [isStandalone, standaloneEmit, nodeId]
    );
    const clearPreviewNode = React.useCallback(() => {
        if (isStandalone && standaloneEmit) {
            standaloneEmit(NODE_EDITOR_COMMANDS.clearNodePreview, { objectId: nodeId });
            return;
        }
        nodeEditorCommandHandler.clearNodePreview({ objectId: nodeId });
    }, [isStandalone, nodeId, standaloneEmit]);
    const initialNodeRef = React.useRef<ParticleEmitter2Node | null>(null);
    const isCommittingRef = React.useRef(false);
    const didRealtimePreviewRef = React.useRef(false);
    const suppressAutoPreviewRef = React.useRef(false);
    const commitOnUnmountRef = React.useRef<(() => boolean) | null>(null);
    const clearPreviewOnUnmountRef = React.useRef<(() => void) | null>(null);
    const standaloneDraftCommitTimerRef = React.useRef<number | null>(null);
    const deferredPreviewCommitTimerRef = React.useRef<number | null>(null);
    /** 仅在打开对话框或切换 nodeId 时灌入表单，避免 updateNode 导致 currentNode 引用变化而反复 setFieldsValue（失焦、数值被刷成 0） */
    const formHydratedForNodeIdRef = React.useRef<number | null>(null);

    // Animation State
    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({});
    /** 供 rAF 预览刷新读取，避免闭包拿到过期的 animDataMap */
    const animDataMapRef = useRef<Record<string, any>>({});
    /** 表单初始 setFieldsValue 完成后才允许 onValuesChange 驱动主窗口预览，避免打开时连发 updateNode */
    const [currentEditingProp, setCurrentEditingProp] = useState<string | null>(null);
    const [presetModalOpen, setPresetModalOpen] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [isSavingPreset, setIsSavingPreset] = useState(false);

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

    const getCurrentSegmentColors = useCallback((): [[number, number, number], [number, number, number], [number, number, number]] => {
        const values = form.getFieldsValue(['Seg1Color', 'Seg2Color', 'Seg3Color']);
        return [
            fromAntdColor(values.Seg1Color ?? 'rgb(255, 255, 255)'),
            fromAntdColor(values.Seg2Color ?? 'rgb(255, 255, 255)'),
            fromAntdColor(values.Seg3Color ?? 'rgb(255, 255, 255)'),
        ];
    }, [form]);

    const getCurrentSegmentAlpha = useCallback((): [number, number, number] => {
        const values = form.getFieldsValue(['Seg1Alpha', 'Seg2Alpha', 'Seg3Alpha']);
        return [
            clamp(Number(values.Seg1Alpha ?? 255), 0, 255),
            clamp(Number(values.Seg2Alpha ?? 255), 0, 255),
            clamp(Number(values.Seg3Alpha ?? 255), 0, 255),
        ];
    }, [form]);

    const getCurrentSegmentScaling = useCallback((): [number, number, number] => {
        const values = form.getFieldsValue(['Seg1Scaling', 'Seg2Scaling', 'Seg3Scaling']);
        return [
            Math.max(0, Number(values.Seg1Scaling ?? 1)),
            Math.max(0, Number(values.Seg2Scaling ?? 1)),
            Math.max(0, Number(values.Seg3Scaling ?? 1)),
        ];
    }, [form]);

    useEffect(() => {
        animDataMapRef.current = animDataMap;
    }, [animDataMap]);

    // Load data into form with DEFAULTS（仅首次打开本节点时灌入，不因 store 每次 updateNode 而重灌）
    useEffect(() => {
        if (!visible) {
            setIsTextureDropActive(false);
            initialNodeRef.current = null;
            isCommittingRef.current = false;
            didRealtimePreviewRef.current = false;
            suppressAutoPreviewRef.current = false;
            formHydratedForNodeIdRef.current = null;
            hueBaseColorsRef.current = null;
            alphaBaseValuesRef.current = null;
            scalingBaseValuesRef.current = null;
            setOverallHueShift(0);
            setOverallAlphaScale(1);
            setOverallScaleScale(1);
            clearPreviewNode();
            return;
        }

        if (nodeId === null) return;

        if (formHydratedForNodeIdRef.current === nodeId) {
            return;
        }

        const sourceNode: ParticleEmitter2Node | null = isStandalone
            ? (standaloneNode as ParticleEmitter2Node | null)
            : (useModelStore.getState().getNodeById(nodeId) as ParticleEmitter2Node | undefined) ?? null;

        if (!sourceNode) return;

        formHydratedForNodeIdRef.current = nodeId;
        suppressAutoPreviewRef.current = true;

        const currentNode = sourceNode;
        if (!initialNodeRef.current && currentNode) {
            initialNodeRef.current = JSON.parse(JSON.stringify(currentNode));
        }
        hueBaseColorsRef.current = null;
        alphaBaseValuesRef.current = null;
        scalingBaseValuesRef.current = null;
        setOverallHueShift(0);
        setOverallAlphaScale(1);
        setOverallScaleScale(1);

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
            SortPrimsFarZ: false,
            LineEmitter: false,
            ModelSpace: false,
            XYQuad: false,
            Squirt: false,
            Head: true,
            Tail: false,
        };

        const newAnimDataMap: Record<string, any> = {};

        const parseInterval = (value: any): [number, number, number] => {
            if (Array.isArray(value)) {
                return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 1];
            }
            if (value && typeof value === 'object' && '0' in value) {
                return [value['0'] ?? 0, value['1'] ?? 0, value['2'] ?? 1];
            }
            return [typeof value === 'number' ? value : 0, 0, 1];
        };

        const headLifeSpan = parseInterval(currentNode.LifeSpanUVAnim);
        const headDecay = parseInterval(currentNode.DecayUVAnim);
        const tailLifeSpan = parseInterval(currentNode.TailUVAnim);
        const tailDecay = parseInterval(currentNode.TailDecayUVAnim);

        const cn = currentNode as any;
        form.setFieldsValue({
            ...defaults,
            TextureID: cn.TextureID ?? defaults.TextureID,
            FilterMode: cn.FilterMode ?? defaults.FilterMode,
            Rows: cn.Rows ?? defaults.Rows,
            Columns: cn.Columns ?? defaults.Columns,
            PriorityPlane: cn.PriorityPlane ?? defaults.PriorityPlane,
            ReplaceableId: cn.ReplaceableId ?? defaults.ReplaceableId,
            TailLength: cn.TailLength ?? defaults.TailLength,
            Time: cn.Time ?? defaults.Time,
            LifeSpan: cn.LifeSpan ?? defaults.LifeSpan,
            Unshaded: cn.Unshaded ?? defaults.Unshaded,
            Unfogged: cn.Unfogged ?? defaults.Unfogged,
            SortPrimsFarZ: cn.SortPrimsFarZ ?? defaults.SortPrimsFarZ,
            LineEmitter: cn.LineEmitter ?? defaults.LineEmitter,
            ModelSpace: cn.ModelSpace ?? defaults.ModelSpace,
            XYQuad: cn.XYQuad ?? defaults.XYQuad,
            Squirt: cn.Squirt ?? defaults.Squirt,
            Head: cn.Head ?? defaults.Head,
            Tail: cn.Tail ?? defaults.Tail,
            Visibility: getStaticValue(cn.Visibility, defaults.Visibility),
            EmissionRate: getStaticValue(cn.EmissionRate, defaults.EmissionRate),
            Speed: getStaticValue(cn.Speed, defaults.Speed),
            Variation: getStaticValue(cn.Variation, defaults.Variation),
            Latitude: getStaticValue(cn.Latitude, defaults.Latitude),
            Width: getStaticValue(cn.Width, defaults.Width),
            Length: getStaticValue(cn.Length, defaults.Length),
            Gravity: getStaticValue(cn.Gravity, defaults.Gravity),
            Seg1Color: toAntdColor(currentNode.SegmentColor?.[0]),
            Seg1Alpha: currentNode.Alpha?.[0] ?? defaults.Seg1Alpha,
            Seg1Scaling: currentNode.ParticleScaling?.[0] ?? defaults.Seg1Scaling,
            Seg2Color: toAntdColor(currentNode.SegmentColor?.[1]),
            Seg2Alpha: currentNode.Alpha?.[1] ?? defaults.Seg2Alpha,
            Seg2Scaling: currentNode.ParticleScaling?.[1] ?? defaults.Seg2Scaling,
            Seg3Color: toAntdColor(currentNode.SegmentColor?.[2]),
            Seg3Alpha: currentNode.Alpha?.[2] ?? defaults.Seg3Alpha,
            Seg3Scaling: currentNode.ParticleScaling?.[2] ?? defaults.Seg3Scaling,
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

        Object.entries(PROP_TO_ANIM_KEY).forEach(([propName, animKey]) => {
            const value = (currentNode as any)[propName];
            if (isAnimVector(value)) {
                newAnimDataMap[propName] = value;
            }
            const animData = (currentNode as any)[animKey];
            if (isAnimVector(animData)) {
                newAnimDataMap[propName] = animData;
            }
        });
        animDataMapRef.current = newAnimDataMap;
        setAnimDataMap(newAnimDataMap);

        const hydrationUnlockTimer = window.setTimeout(() => {
            suppressAutoPreviewRef.current = false;
        }, 0);

        return () => {
            clearTimeout(hydrationUnlockTimer);
            suppressAutoPreviewRef.current = false;
        };
    }, [clearPreviewNode, visible, nodeId, isStandalone, standaloneNode]);

    const applyRealtimeTexture = (textureId: number) => {
        const sourceNode = getCurrentSourceNode();
        if (nodeId === null || !sourceNode) return;
        const textureCount = modelData?.Textures?.length || 0;
        if (textureId >= textureCount && textureId !== -1) return;
        const safeTextureId = Number.isInteger(textureId) ? textureId : -1;
        const previewNode: ParticleEmitter2Node = {
            ...sourceNode,
            TextureID: safeTextureId,
        };
        form.setFieldValue('TextureID', safeTextureId);
        if (isStandalone) {
            applyCommittedNode(previewNode);
            return;
        }
        didRealtimePreviewRef.current = true;
        pushPreviewNode(previewNode);
    };

    const buildUpdatedNodeFromValues = useCallback((values: any): ParticleEmitter2Node | null => {
        const sourceNode = getCurrentSourceNode();
        if (!sourceNode) return null;

        const animMap = animDataMapRef.current;
        const currentSegmentColor: SegmentColorTuple = Array.isArray(sourceNode.SegmentColor) && sourceNode.SegmentColor.length >= 3
            ? sourceNode.SegmentColor as SegmentColorTuple
            : [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
        const currentAlpha = Array.isArray(sourceNode.Alpha) && sourceNode.Alpha.length >= 3
            ? sourceNode.Alpha
            : [255, 255, 255];
        const currentScaling = Array.isArray(sourceNode.ParticleScaling) && sourceNode.ParticleScaling.length >= 3
            ? sourceNode.ParticleScaling
            : [10, 10, 10];
        const updatedNode: ParticleEmitter2Node = {
            ...sourceNode,
            TextureID: getFiniteNumber(values.TextureID, getFiniteNumber(sourceNode.TextureID, -1)),
            FilterMode: values.FilterMode ?? sourceNode.FilterMode ?? 0,
            Rows: Math.max(1, getFiniteNumber(values.Rows, getFiniteNumber(sourceNode.Rows, 1))),
            Columns: Math.max(1, getFiniteNumber(values.Columns, getFiniteNumber(sourceNode.Columns, 1))),
            PriorityPlane: getFiniteNumber(values.PriorityPlane, getFiniteNumber(sourceNode.PriorityPlane, 0)),
            ReplaceableId: getFiniteNumber(values.ReplaceableId, getFiniteNumber(sourceNode.ReplaceableId, 0)),
            SegmentColor: [
                values.Seg1Color ? fromAntdColor(values.Seg1Color) as [number, number, number] : currentSegmentColor[0],
                values.Seg2Color ? fromAntdColor(values.Seg2Color) as [number, number, number] : currentSegmentColor[1],
                values.Seg3Color ? fromAntdColor(values.Seg3Color) as [number, number, number] : currentSegmentColor[2],
            ],
            Alpha: [
                clamp(getFiniteNumber(values.Seg1Alpha, currentAlpha[0]), 0, 255),
                clamp(getFiniteNumber(values.Seg2Alpha, currentAlpha[1]), 0, 255),
                clamp(getFiniteNumber(values.Seg3Alpha, currentAlpha[2]), 0, 255),
            ],
            ParticleScaling: [
                Math.max(0, getFiniteNumber(values.Seg1Scaling, currentScaling[0])),
                Math.max(0, getFiniteNumber(values.Seg2Scaling, currentScaling[1])),
                Math.max(0, getFiniteNumber(values.Seg3Scaling, currentScaling[2])),
            ],
            LifeSpanUVAnim: [
                getFiniteNumber(values.HeadLifeSpanStart, sourceNode.LifeSpanUVAnim?.[0] ?? 0),
                getFiniteNumber(values.HeadLifeSpanEnd, sourceNode.LifeSpanUVAnim?.[1] ?? 0),
                Math.max(1, getFiniteNumber(values.HeadLifeSpanRepeat, sourceNode.LifeSpanUVAnim?.[2] ?? 1))
            ],
            DecayUVAnim: [
                getFiniteNumber(values.HeadDecayStart, sourceNode.DecayUVAnim?.[0] ?? 0),
                getFiniteNumber(values.HeadDecayEnd, sourceNode.DecayUVAnim?.[1] ?? 0),
                Math.max(1, getFiniteNumber(values.HeadDecayRepeat, sourceNode.DecayUVAnim?.[2] ?? 1))
            ],
            TailUVAnim: [
                getFiniteNumber(values.TailLifeSpanStart, sourceNode.TailUVAnim?.[0] ?? 0),
                getFiniteNumber(values.TailLifeSpanEnd, sourceNode.TailUVAnim?.[1] ?? 0),
                Math.max(1, getFiniteNumber(values.TailLifeSpanRepeat, sourceNode.TailUVAnim?.[2] ?? 1))
            ],
            TailDecayUVAnim: [
                getFiniteNumber(values.TailDecayStart, sourceNode.TailDecayUVAnim?.[0] ?? 0),
                getFiniteNumber(values.TailDecayEnd, sourceNode.TailDecayUVAnim?.[1] ?? 0),
                Math.max(1, getFiniteNumber(values.TailDecayRepeat, sourceNode.TailDecayUVAnim?.[2] ?? 1))
            ],
            TailLength: getFiniteNumber(values.TailLength, getFiniteNumber(sourceNode.TailLength, 0)),
            Time: getFiniteNumber(values.Time, getFiniteNumber(sourceNode.Time, 0.5)),
            LifeSpan: Math.max(0.001, getFiniteNumber(values.LifeSpan, getFiniteNumber(sourceNode.LifeSpan, 1))),
            Unshaded: values.Unshaded ?? sourceNode.Unshaded ?? true,
            Unfogged: values.Unfogged ?? sourceNode.Unfogged ?? false,
            SortPrimsFarZ: values.SortPrimsFarZ ?? sourceNode.SortPrimsFarZ ?? false,
            LineEmitter: values.LineEmitter ?? sourceNode.LineEmitter ?? false,
            ModelSpace: values.ModelSpace ?? sourceNode.ModelSpace ?? false,
            XYQuad: values.XYQuad ?? sourceNode.XYQuad ?? false,
            Squirt: values.Squirt ?? sourceNode.Squirt ?? false,
            Head: values.Head ?? sourceNode.Head ?? true,
            Tail: values.Tail ?? sourceNode.Tail ?? false,
            Visibility: getFiniteNumber(values.Visibility, getStaticValue(sourceNode.Visibility, 1)),
        };
        const frameFlags =
            (updatedNode.Head ? 1 : 0) |
            (updatedNode.Tail ? 2 : 0);
        (updatedNode as any).FrameFlags = frameFlags;

        const dynamicProps: Array<{ prop: string }> = [
            { prop: 'EmissionRate' },
            { prop: 'Speed' },
            { prop: 'Variation' },
            { prop: 'Latitude' },
            { prop: 'Width' },
            { prop: 'Length' },
            { prop: 'Gravity' },
            { prop: 'Visibility' }
        ];

        dynamicProps.forEach(({ prop }) => {
            const animKey = PROP_TO_ANIM_KEY[prop];
            if (animMap[prop]) {
                (updatedNode as any)[prop] = animMap[prop];
                if (animKey) {
                    (updatedNode as any)[animKey] = animMap[prop];
                }
            } else {
                (updatedNode as any)[prop] = getFiniteNumber(
                    values[prop],
                    getStaticValue((sourceNode as any)[prop], 0)
                );
                if (animKey) {
                    delete (updatedNode as any)[animKey];
                }
            }
        });

        Object.entries(PROP_TO_ANIM_KEY).forEach(([propName, animKey]) => {
            if (animMap[propName]) {
                (updatedNode as any)[animKey] = animMap[propName];
            } else {
                delete (updatedNode as any)[animKey];
            }
        });

        return updatedNode;
    }, [getCurrentSourceNode]);

    const buildPreviewNode = useCallback(() => {
        const values = form.getFieldsValue();
        const updatedNode = buildUpdatedNodeFromValues(values);
        if (!updatedNode) return null;
        didRealtimePreviewRef.current = true;
        return updatedNode;
    }, [form, buildUpdatedNodeFromValues]);

    const { schedulePreview, pushPreviewNode } = useNodeEditorPreview<ParticleEmitter2Node>({
        visible,
        nodeId,
        currentNodeObjectId: currentNode?.ObjectId ?? null,
        isStandalone,
        standaloneEmit,
        buildPreviewNode,
    });

    const syncStandaloneDraft = useCallback((overrides?: Partial<ParticleEmitter2Node>) => {
        if (!isStandalone || nodeId === null) return;
        const values = form.getFieldsValue();
        const updatedNode = buildUpdatedNodeFromValues(values);
        if (!updatedNode) return;
        const nextNode: ParticleEmitter2Node = overrides ? { ...updatedNode, ...overrides } : updatedNode;
        applyCommittedNode(nextNode);
    }, [applyCommittedNode, buildUpdatedNodeFromValues, form, isStandalone, nodeId]);

    useEffect(() => {
        if (!isStandalone || nodeId === null) return;
        if (suppressAutoPreviewRef.current) return;
        if (formHydratedForNodeIdRef.current !== nodeId) return;

        if (standaloneDraftCommitTimerRef.current !== null) {
            clearTimeout(standaloneDraftCommitTimerRef.current);
        }

        standaloneDraftCommitTimerRef.current = window.setTimeout(() => {
            standaloneDraftCommitTimerRef.current = null;
            syncStandaloneDraft();
        }, 0);

        return () => {
            if (standaloneDraftCommitTimerRef.current !== null) {
                clearTimeout(standaloneDraftCommitTimerRef.current);
                standaloneDraftCommitTimerRef.current = null;
            }
        };
    }, [animDataMap, isStandalone, nodeId, syncStandaloneDraft]);

    const flushPreviewNowWithOverrides = useCallback((overrides?: Partial<ParticleEmitter2Node>) => {
        if (isStandalone) {
            syncStandaloneDraft(overrides);
            return;
        }
        const values = form.getFieldsValue();
        const updatedNode = buildUpdatedNodeFromValues(values);
        if (!updatedNode) return;
        const nextNode: ParticleEmitter2Node = overrides ? { ...updatedNode, ...overrides } : updatedNode;
        didRealtimePreviewRef.current = true;
        pushPreviewNode(nextNode);
    }, [buildUpdatedNodeFromValues, form, isStandalone, pushPreviewNode, syncStandaloneDraft]);

    const commitDeferredPreviewChanges = useCallback(() => {
        if (suppressAutoPreviewRef.current) {
            return;
        }
        if (deferredPreviewCommitTimerRef.current !== null) {
            clearTimeout(deferredPreviewCommitTimerRef.current);
        }
        deferredPreviewCommitTimerRef.current = window.setTimeout(() => {
            deferredPreviewCommitTimerRef.current = null;
            if (isStandalone) {
                if (standaloneDraftCommitTimerRef.current !== null) {
                    clearTimeout(standaloneDraftCommitTimerRef.current);
                    standaloneDraftCommitTimerRef.current = null;
                }
                syncStandaloneDraft();
                return;
            }
            schedulePreview();
        }, 0);
    }, [isStandalone, schedulePreview, syncStandaloneDraft]);

    const commitCurrentValues = useCallback(() => {
        const sourceNode = getCurrentSourceNode();
        if (!sourceNode || nodeId === null) return false;
        const values = form.getFieldsValue();
        const updatedNode = buildUpdatedNodeFromValues(values);
        if (!updatedNode) return false;

        const oldNode = initialNodeRef.current || sourceNode;
        isCommittingRef.current = true;
        applyCommittedNode(updatedNode, {
            name: `Edit Particle Emitter`,
            undoNode: oldNode,
            redoNode: updatedNode,
        });
        return true;
    }, [applyCommittedNode, buildUpdatedNodeFromValues, form, getCurrentSourceNode, nodeId]);

    useEffect(() => {
        commitOnUnmountRef.current = commitCurrentValues;
        clearPreviewOnUnmountRef.current = clearPreviewNode;
    }, [clearPreviewNode, commitCurrentValues]);

    useEffect(() => {
        return () => {
            if (deferredPreviewCommitTimerRef.current !== null) {
                clearTimeout(deferredPreviewCommitTimerRef.current);
                deferredPreviewCommitTimerRef.current = null;
            }
            if (standaloneDraftCommitTimerRef.current !== null) {
                clearTimeout(standaloneDraftCommitTimerRef.current);
                standaloneDraftCommitTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!isStandalone) return;

        return () => {
            try {
                clearPreviewOnUnmountRef.current?.();
            } catch (error) {
                console.error('[ParticleEmitter2Dialog] failed to clear standalone preview on close:', error);
            }
        };
    }, [isStandalone]);

    const handleCancel = () => {
        setPresetModalOpen(false);
        if (!isStandalone) {
            commitCurrentValues();
        }
        onClose();
    };

    const handleOpenPresetModal = () => {
        setPresetName((currentNode?.Name || '').trim() || uiText.particleEmitter2Dialog.presetDefaultName);
        setPresetModalOpen(true);
    };

    const handleSavePreset = async () => {
        try {
            const values = await form.validateFields();
            const updatedNode = buildUpdatedNodeFromValues(values);
            if (!updatedNode) return;

            const textureId = Number(updatedNode.TextureID);
            const texture = textureId >= 0 ? (modelData?.Textures?.[textureId] ?? null) : null;

            setIsSavingPreset(true);
            await saveParticleEmitter2Preset({
                name: presetName,
                emitter: updatedNode,
                texture,
                modelPath,
            });
            showMessage(
                'success',
                uiText.particleEmitter2Dialog.saveSuccessTitle,
                `${uiText.particleEmitter2Dialog.saveSuccessDescriptionPrefix}${presetName.trim()}`
            );
            setPresetModalOpen(false);
        } catch (e: any) {
            if (e?.errorFields) {
                return;
            }
            const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
            console.error('[ParticleEmitter2Dialog] 保存粒子预设失败:', e);
            showMessage('error', uiText.particleEmitter2Dialog.saveFailureTitle, detail || uiText.particleEmitter2Dialog.unknownError);
            setIsSavingPreset(false);
        }
    };

    const [currentEditingTitle, setCurrentEditingTitle] = useState<string>('');

    useWindowEvent<KeyframeSavePayload>(KEYFRAME_SAVE_EVENT, (event) => {
        const payload = event.payload;
        if (!payload || payload.callerId !== 'ParticleEmitter2Dialog' || !currentEditingProp) {
            return;
        }

        setAnimDataMap((prev) => {
            const next = {
                ...prev,
                [currentEditingProp]: payload.data,
            };
            animDataMapRef.current = next;
            return next;
        });
        setCurrentEditingProp(null);
        if (isStandalone) {
            syncStandaloneDraft();
        } else {
            schedulePreview();
        }
    });

    const handleOpenKeyframeEditor = (propName: string, title: string) => {
        setCurrentEditingProp(propName);
        setCurrentEditingTitle(title);

        const payload = {
            callerId: 'ParticleEmitter2Dialog',
            initialData: animDataMap[propName] || null,
            title: `编辑: ${title}`,
            vectorSize: 1,
            fieldName: propName, // Assuming propName is the field name
            globalSequences: (modelData?.GlobalSequences || [])
                .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
                .filter((v: any) => typeof v === 'number'),
            sequences: modelData?.Sequences || []
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
    };

    const handleDynamicChange = (propName: string, checked: boolean) => {
        if (checked) {
            if (!animDataMap[propName]) {
                setAnimDataMap((prev) => {
                    const next = {
                        ...prev,
                        [propName]: { Keys: [], LineType: 0, GlobalSeqId: null },
                    };
                    animDataMapRef.current = next;
                    return next;
                });
            }
        } else {
            setAnimDataMap((prev) => {
                const copy = { ...prev };
                delete copy[propName];
                animDataMapRef.current = copy;
                return copy;
            });
        }
        schedulePreview();
    };

    const captureOverallAdjustmentBases = useCallback(() => {
        if (!hueBaseColorsRef.current) {
            hueBaseColorsRef.current = getCurrentSegmentColors();
        }
        if (!alphaBaseValuesRef.current) {
            alphaBaseValuesRef.current = getCurrentSegmentAlpha();
        }
        if (!scalingBaseValuesRef.current) {
            scalingBaseValuesRef.current = getCurrentSegmentScaling();
        }
    }, [getCurrentSegmentAlpha, getCurrentSegmentColors, getCurrentSegmentScaling]);

    const resetOverallHueShift = useCallback(() => {
        const baseColors = hueBaseColorsRef.current;
        if (baseColors) {
            suppressAutoPreviewRef.current = true;
            form.setFieldsValue({
                Seg1Color: toAntdColor(baseColors[0]),
                Seg2Color: toAntdColor(baseColors[1]),
                Seg3Color: toAntdColor(baseColors[2]),
            });
            suppressAutoPreviewRef.current = false;
            flushPreviewNowWithOverrides({
                SegmentColor: [...baseColors],
            });
        }
        hueBaseColorsRef.current = null;
        setOverallHueShift(0);
    }, [flushPreviewNowWithOverrides, form]);

    const resetOverallAlphaScale = useCallback(() => {
        const baseAlpha = alphaBaseValuesRef.current;
        if (baseAlpha) {
            suppressAutoPreviewRef.current = true;
            form.setFieldsValue({
                Seg1Alpha: baseAlpha[0],
                Seg2Alpha: baseAlpha[1],
                Seg3Alpha: baseAlpha[2],
            });
            suppressAutoPreviewRef.current = false;
            flushPreviewNowWithOverrides({
                Alpha: [baseAlpha[0], baseAlpha[1], baseAlpha[2]],
            });
        }
        alphaBaseValuesRef.current = null;
        setOverallAlphaScale(1);
    }, [flushPreviewNowWithOverrides, form]);

    const resetOverallScaleScale = useCallback(() => {
        const baseScaling = scalingBaseValuesRef.current;
        if (baseScaling) {
            suppressAutoPreviewRef.current = true;
            form.setFieldsValue({
                Seg1Scaling: baseScaling[0],
                Seg2Scaling: baseScaling[1],
                Seg3Scaling: baseScaling[2],
            });
            suppressAutoPreviewRef.current = false;
            flushPreviewNowWithOverrides({
                ParticleScaling: [baseScaling[0], baseScaling[1], baseScaling[2]],
            });
        }
        scalingBaseValuesRef.current = null;
        setOverallScaleScale(1);
    }, [flushPreviewNowWithOverrides, form]);

    const applyOverallHueShift = useCallback((nextShift: number, flushNow: boolean) => {
        captureOverallAdjustmentBases();
        const baseColors = hueBaseColorsRef.current;
        if (!baseColors) return;

        const shiftedColors = baseColors.map((rgb) => {
            const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
            return hsvToRgb(h + nextShift, s, v);
        }) as [[number, number, number], [number, number, number], [number, number, number]];

        suppressAutoPreviewRef.current = !flushNow;
        form.setFieldsValue({
            Seg1Color: toAntdColor(shiftedColors[0]),
            Seg2Color: toAntdColor(shiftedColors[1]),
            Seg3Color: toAntdColor(shiftedColors[2]),
        });
        suppressAutoPreviewRef.current = false;
        setOverallHueShift(nextShift);
        if (flushNow) {
            flushPreviewNowWithOverrides({ SegmentColor: shiftedColors });
        }
    }, [captureOverallAdjustmentBases, flushPreviewNowWithOverrides, form]);

    const applyOverallAlphaScale = useCallback((nextScale: number, flushNow: boolean) => {
        captureOverallAdjustmentBases();
        const baseAlpha = alphaBaseValuesRef.current;
        if (!baseAlpha) return;
        const scaledAlpha = baseAlpha.map((value) => clamp(Math.round(value * nextScale), 0, 255)) as [number, number, number];
        suppressAutoPreviewRef.current = !flushNow;
        form.setFieldsValue({
            Seg1Alpha: scaledAlpha[0],
            Seg2Alpha: scaledAlpha[1],
            Seg3Alpha: scaledAlpha[2],
        });
        suppressAutoPreviewRef.current = false;
        setOverallAlphaScale(nextScale);
        if (flushNow) {
            flushPreviewNowWithOverrides({ Alpha: scaledAlpha });
        }
    }, [captureOverallAdjustmentBases, flushPreviewNowWithOverrides, form]);

    const applyOverallScaleScale = useCallback((nextScale: number, flushNow: boolean) => {
        captureOverallAdjustmentBases();
        const baseScaling = scalingBaseValuesRef.current;
        if (!baseScaling) return;
        const scaledValues = baseScaling.map((value) => Math.max(0, Number((value * nextScale).toFixed(3)))) as [number, number, number];
        suppressAutoPreviewRef.current = !flushNow;
        form.setFieldsValue({
            Seg1Scaling: scaledValues[0],
            Seg2Scaling: scaledValues[1],
            Seg3Scaling: scaledValues[2],
        });
        suppressAutoPreviewRef.current = false;
        setOverallScaleScale(nextScale);
        if (flushNow) {
            flushPreviewNowWithOverrides({ ParticleScaling: scaledValues });
        }
    }, [captureOverallAdjustmentBases, flushPreviewNowWithOverrides, form]);

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
                {uiText.particleEmitter2Dialog.rendering}
            </span>

            <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ color: '#ccc' }}>{uiText.particleEmitter2Dialog.textureId}:</span>
                    <span style={{ color: '#7f7f7f', fontSize: 12 }}>{uiText.particleEmitter2Dialog.replaceTextureHint}</span>
                </div>
                <div
                    style={{
                        border: isTextureDropActive ? '1px dashed #5a9cff' : '1px dashed transparent',
                        borderRadius: 4,
                        padding: 2,
                        transition: 'border-color 0.15s ease'
                    }}
                    onDragOver={(e) => {
                        const draggedIndex = getDraggedTextureIndex(e.dataTransfer);
                        if (draggedIndex === null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        setIsTextureDropActive(true);
                    }}
                    onDragEnter={(e) => {
                        const draggedIndex = getDraggedTextureIndex(e.dataTransfer);
                        if (draggedIndex === null) return;
                        e.preventDefault();
                        setIsTextureDropActive(true);
                    }}
                    onDragLeave={() => setIsTextureDropActive(false)}
                    onDrop={(e) => {
                        setIsTextureDropActive(false);
                        const draggedIndex = getDraggedTextureIndex(e.dataTransfer);
                        if (draggedIndex === null) return;
                        e.preventDefault();
                        applyRealtimeTexture(draggedIndex);
                    }}
                >
                    <Form.Item name="TextureID" noStyle>
                        <Select
                            options={textureOptions}
                            style={{ width: '100%' }}
                            size="small"
                            popupMatchSelectWidth={false}
                            onChange={(v) => applyRealtimeTexture(Number(v))}
                        />
                    </Form.Item>
                </div>
            </div>

            <div>
                <div style={{ marginBottom: 4, color: '#ccc' }}>过滤模式</div>
                <Form.Item name="FilterMode" noStyle>
                    <Select
                        options={MATERIAL_FILTER_MODE_OPTIONS as any}
                        style={{ width: '100%' }}
                        size="small"
                    />
                </Form.Item>
            </div>
        </div>
    );

    const renderColorField = (name: string) => (
        <Form.Item shouldUpdate={(prevValues, nextValues) => prevValues?.[name] !== nextValues?.[name]} noStyle>
            {() => {
                const rawValue = form.getFieldValue(name)
                const committedValue = typeof rawValue === 'string'
                    ? rawValue
                    : rawValue && typeof rawValue.toRgbString === 'function'
                        ? rawValue.toRgbString()
                        : 'rgb(255, 255, 255)'
                return (
                    <ParticleEmitter2ColorFieldControl
                        name={name}
                        committedValue={committedValue}
                        form={form}
                        getCurrentSegmentColors={getCurrentSegmentColors}
                        flushPreviewNowWithOverrides={flushPreviewNowWithOverrides}
                        resetOverallHueState={() => {
                            hueBaseColorsRef.current = null;
                            setOverallHueShift(0);
                        }}
                        fromAntdColor={fromAntdColor}
                    />
                )
            }}
        </Form.Item>
    )

    // Segment Box
    const renderSegmentBox = (title: string, prefix: string) => (
        <fieldset style={{ border: '1px solid #484848', padding: '10px 8px 6px', margin: 0, marginTop: 8, backgroundColor: '#2b2b2b' }}>
            <legend style={{ fontSize: 12, color: '#ccc', marginLeft: 8, padding: '0 4px', width: 'auto' }}>{title}</legend>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.color}:</span>
                {renderColorField(`${prefix}Color`)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.alpha}:</span>
                <Form.Item name={`${prefix}Alpha`} noStyle>
                    <InputNumber min={0} max={255} size="small" style={{ flex: 1 }} />
                </Form.Item>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.scaling}:</span>
                <Form.Item name={`${prefix}Scaling`} noStyle>
                    <InputNumber step={1} precision={0} size="small" style={{ flex: 1 }} />
                </Form.Item>
            </div>
        </fieldset>
    );

    // Texture Options
    const textureOptions = (modelData?.Textures || []).map((tex: any, index: number) => ({
        label: `[${index}] ${tex.Image}`,
        value: index
    }));
    textureOptions.unshift({ label: '(None)', value: -1 });

    const pe2FormEl = (
        <DeferredCommitContext.Provider value={commitDeferredPreviewChanges}>
            <Form
                form={form}
                layout="vertical"
                onValuesChange={(changedValues) => {
                    if ('Seg1Color' in changedValues || 'Seg2Color' in changedValues || 'Seg3Color' in changedValues) {
                        hueBaseColorsRef.current = null;
                        setOverallHueShift(0);
                    }
                    if ('Seg1Alpha' in changedValues || 'Seg2Alpha' in changedValues || 'Seg3Alpha' in changedValues) {
                        alphaBaseValuesRef.current = null;
                        setOverallAlphaScale(1);
                    }
                    if ('Seg1Scaling' in changedValues || 'Seg2Scaling' in changedValues || 'Seg3Scaling' in changedValues) {
                        scalingBaseValuesRef.current = null;
                        setOverallScaleScale(1);
                    }
                    if (suppressAutoPreviewRef.current) {
                        return;
                    }
                    const changedKeys = Object.keys(changedValues);
                    if (changedKeys.some((key) => DEFERRED_PREVIEW_FIELD_NAMES.has(key))) {
                        return;
                    }
                    if (isStandalone) {
                        if (standaloneDraftCommitTimerRef.current !== null) {
                            clearTimeout(standaloneDraftCommitTimerRef.current);
                        }
                        standaloneDraftCommitTimerRef.current = window.setTimeout(() => {
                            standaloneDraftCommitTimerRef.current = null;
                            syncStandaloneDraft();
                        }, 60);
                        return;
                    }
                    schedulePreview();
                }}
            >
                {/* --- TOP SECTION --- */}
                <div style={{ display: 'flex', gap: 8 }}>
                    {/* Row 1 Params (Fit 5 items) */}
                    <BoxedNumericField label={uiText.particleEmitter2Dialog.visibility} name="Visibility" min={0} max={1} precision={1} width="20%" />
                    <BoxedNumericField label={uiText.particleEmitter2Dialog.emissionRate} name="EmissionRate" width="20%" />
                    <BoxedNumericField label={uiText.particleEmitter2Dialog.speed} name="Speed" width="20%" />
                    <BoxedNumericField label={uiText.particleEmitter2Dialog.variation} name="Variation" precision={2} width="20%" />
                    <BoxedNumericField label={uiText.particleEmitter2Dialog.latitude} name="Latitude" precision={2} width="20%" />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {/* Row 2 Params */}
                    <div style={{ width: '20%' }}><BoxedNumericField label={uiText.particleEmitter2Dialog.width} name="Width" /></div>
                    <div style={{ width: '20%' }}><BoxedNumericField label={uiText.particleEmitter2Dialog.length} name="Length" /></div>
                    <div style={{ width: '20%' }}><BoxedNumericField label={uiText.particleEmitter2Dialog.gravity} name="Gravity" /></div>

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
                        <div style={{ border: '1px solid #484848', padding: '10px 8px', marginTop: 8, backgroundColor: '#2b2b2b' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    <span style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>整体色相</span>
                                    <Slider
                                        min={-180}
                                        max={180}
                                        step={1}
                                        value={overallHueShift}
                                        onChange={(value) => applyOverallHueShift(value, false)}
                                        onChangeComplete={(value) => applyOverallHueShift(value, true)}
                                        tooltip={{ formatter: (value) => `${value ?? 0}°` }}
                                        style={{ width: 150, margin: 0 }}
                                        styles={{
                                            rail: { background: 'linear-gradient(90deg, #ff4d4f, #faad14, #95de64, #5cdbd3, #597ef7, #b37feb, #ff4d4f)' },
                                            track: { background: 'transparent' },
                                        }}
                                    />
                                    <Button size="small" icon={<UndoOutlined />} onClick={resetOverallHueShift} title="重置整体色相" aria-label="重置整体色相" />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    <span style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>整体透明</span>
                                    <Slider
                                        min={0}
                                        max={2}
                                        step={0.01}
                                        value={overallAlphaScale}
                                        onChange={(value) => applyOverallAlphaScale(value, false)}
                                        onChangeComplete={(value) => applyOverallAlphaScale(value, true)}
                                        tooltip={{ formatter: (value) => `${Math.round((value ?? 1) * 100)}%` }}
                                        style={{ width: 140, margin: 0 }}
                                        styles={{
                                            rail: { background: 'linear-gradient(90deg, #4b4b4b, #e8e8e8)' },
                                        }}
                                    />
                                    <Button size="small" icon={<UndoOutlined />} onClick={resetOverallAlphaScale} title="重置整体透明" aria-label="重置整体透明" />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    <span style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>整体缩放</span>
                                    <Slider
                                        min={0}
                                        max={10}
                                        step={0.01}
                                        value={overallScaleScale}
                                        onChange={(value) => applyOverallScaleScale(value, false)}
                                        onChangeComplete={(value) => applyOverallScaleScale(value, true)}
                                        tooltip={{ formatter: (value) => `${(value ?? 1).toFixed(2)}x` }}
                                        style={{ width: 140, margin: 0 }}
                                        styles={{
                                            rail: { background: 'linear-gradient(90deg, #5b8c00, #d3f261)' },
                                        }}
                                    />
                                    <Button size="small" icon={<UndoOutlined />} onClick={resetOverallScaleScale} title="重置整体缩放" aria-label="重置整体缩放" />
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <div style={{ flex: 1 }}>{renderSegmentBox(uiText.particleEmitter2Dialog.segment1, 'Seg1')}</div>
                            <div style={{ flex: 1 }}>{renderSegmentBox(uiText.particleEmitter2Dialog.segment2, 'Seg2')}</div>
                            <div style={{ flex: 1 }}>{renderSegmentBox(uiText.particleEmitter2Dialog.segment3, 'Seg3')}</div>
                        </div>

                        {/* Lifecycle - MDX uses HeadLifeSpan/HeadDecay/TailLifeSpan/TailDecay as interval arrays */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>{uiText.particleEmitter2Dialog.headerLifespan}</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.start}:</span>
                                    <Form.Item name="HeadLifeSpanStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.end}:</span>
                                    <Form.Item name="HeadLifeSpanEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.repeat}:</span>
                                    <Form.Item name="HeadLifeSpanRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>{uiText.particleEmitter2Dialog.headerDecay}</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.start}:</span>
                                    <Form.Item name="HeadDecayStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.end}:</span>
                                    <Form.Item name="HeadDecayEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.repeat}:</span>
                                    <Form.Item name="HeadDecayRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>{uiText.particleEmitter2Dialog.tailLifespan}</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.start}:</span>
                                    <Form.Item name="TailLifeSpanStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.end}:</span>
                                    <Form.Item name="TailLifeSpanEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.repeat}:</span>
                                    <Form.Item name="TailLifeSpanRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>{uiText.particleEmitter2Dialog.tailDecay}</div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.start}:</span>
                                    <Form.Item name="TailDecayStart" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.end}:</span>
                                    <Form.Item name="TailDecayEnd" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.repeat}:</span>
                                    <Form.Item name="TailDecayRepeat" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                </div>
                            </div>
                        </div>

                        {/* Other Params */}
                        <div style={{ border: '1px solid #484848', padding: '8px 12px', marginTop: 12, backgroundColor: '#2b2b2b' }}>
                            <div style={{ position: 'relative', top: -16, backgroundColor: '#1f1f1f', padding: '0 4px', width: 'fit-content', color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.other}</div>
                            <div style={{ marginTop: -8 }}>
                                <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 30 }}>{uiText.particleEmitter2Dialog.rows}:</span>
                                        <Form.Item name="Rows" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>{uiText.particleEmitter2Dialog.lifeSpan}:</span>
                                        <Form.Item name="LifeSpan" noStyle><InputNumber size="small" style={{ flex: 1 }} precision={2} step={0.01} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>{uiText.particleEmitter2Dialog.priorityPlane}:</span>
                                        <Form.Item name="PriorityPlane" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 30 }}>{uiText.particleEmitter2Dialog.time}:</span>
                                        <Form.Item name="Time" noStyle><InputNumber size="small" style={{ flex: 1 }} precision={1} /></Form.Item>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 30 }}>{uiText.particleEmitter2Dialog.columns}:</span>
                                        <Form.Item name="Columns" noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>{uiText.particleEmitter2Dialog.tailLength}:</span>
                                        <Form.Item name="TailLength" noStyle><InputNumber size="small" style={{ flex: 1 }} precision={1} /></Form.Item>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                        <span style={{ marginRight: 4, fontSize: 12, width: 60 }}>{uiText.particleEmitter2Dialog.replaceableId}:</span>
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
                            <div style={{ fontWeight: 'bold', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid #444', color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.flags}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Form.Item name="Unshaded" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.unshaded}</Checkbox></Form.Item>
                                <Form.Item name="Unfogged" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.unfogged}</Checkbox></Form.Item>
                                <Form.Item name="LineEmitter" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.lineEmitter}</Checkbox></Form.Item>
                                <Form.Item name="SortPrimsFarZ" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.sortPrimsFarZ}</Checkbox></Form.Item>
                                <Form.Item name="ModelSpace" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.modelSpace}</Checkbox></Form.Item>
                                <Form.Item name="XYQuad" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.xyQuad}</Checkbox></Form.Item>
                                <Form.Item name="Squirt" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.squirt}</Checkbox></Form.Item>
                                <Form.Item name="Head" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.head}</Checkbox></Form.Item>
                                <Form.Item name="Tail" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.tail}</Checkbox></Form.Item>
                            </div>

                            {/* Buttons inside Flags Box (Bottom) */}
                            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <Button onClick={handleOpenPresetModal} size="small" block>{uiText.particleEmitter2Dialog.savePreset}</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Form>
        </DeferredCommitContext.Provider>
    );

    const pe2PresetPortal = presetModalOpen && typeof document !== 'undefined' ? createPortal(
        <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <DraggableModal
                title={uiText.particleEmitter2Dialog.savePreset}
                open={presetModalOpen}
                onCancel={() => setPresetModalOpen(false)}
                width={360}
                minWidth={360}
                minHeight={150}
                resizable={false}
                destroyOnClose
                styles={{ body: { padding: 16 } }}
                footer={(
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <Button size="small" onClick={() => setPresetModalOpen(false)}>{uiText.particleEmitter2Dialog.cancel}</Button>
                        <Button size="small" type="primary" loading={isSavingPreset} onClick={() => { void handleSavePreset() }}>{uiText.particleEmitter2Dialog.save}</Button>
                    </div>
                )}
            >
                <Input
                    placeholder={uiText.particleEmitter2Dialog.presetNamePlaceholder}
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onPressEnter={() => { void handleSavePreset() }}
                    autoFocus
                />
            </DraggableModal>
        </div>,
        document.body
    ) : null;

    if (isStandalone) {
        return (
            <>
                <NodeEditorStandaloneShell>
                    <AppErrorBoundary scope="Particle Emitter 2" compact>
                        {pe2FormEl}
                    </AppErrorBoundary>
                </NodeEditorStandaloneShell>
                {pe2PresetPortal}
            </>
        );
    }

    return (
        <DraggableModal
            title={uiText.particleEmitter2Dialog.title}
            open={visible}
            onCancel={handleCancel}
            footer={null} // Hide default footer
            width={850}
            style={{ top: 20 }}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '8px 12px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            <AppErrorBoundary scope="Particle Emitter 2" compact>
                {pe2FormEl}
            </AppErrorBoundary>
            {pe2PresetPortal}
        </DraggableModal>
    );
};

export default ParticleEmitter2Dialog;
