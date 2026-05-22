import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Form, Button, Input } from 'antd';

import { DraggableModal } from '../DraggableModal';
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell';
import AppErrorBoundary from '../common/AppErrorBoundary';
import { windowManager } from '../../utils/WindowManager';
import type { ParticleEmitter2Node } from '../../types/node';
import { useModelStore } from '../../store/modelStore';
import { saveParticleEmitter2Preset } from '../../services/particleEmitter2PresetService';
import { showMessage } from '../../store/messageStore';
import { uiText } from '../../constants/uiText';
import { useNodeEditorPreview } from '../../hooks/useNodeEditorPreview';
import { useWindowEvent } from '../../hooks/useWindowEvent';
import { NODE_EDITOR_COMMANDS } from '../../types/nodeEditorRpc';
import { nodeEditorCommandHandler } from '../../application/commands';
import { KEYFRAME_SAVE_EVENT, type KeyframeSavePayload } from '../../application/window-bridge';
import { DEFERRED_PREVIEW_FIELD_NAMES, PROP_TO_ANIM_KEY } from './particle-emitter2/constants';
import { DeferredCommitContext } from './particle-emitter2/DeferredInputNumber';
import { BoxedNumericField, FlagsPanel, LifecycleSection, OtherParamsSection, OverallAdjustments, RenderingSection, SegmentBox } from './particle-emitter2/ParticleEmitter2DialogSections';
import { clamp, fromAntdColor, getFiniteNumber, getStaticValue, hsvToRgb, isAnimVector, parseInterval, rgbToHsv, toAntdColor } from './particle-emitter2/helpers';
import type { ParticleEmitter2DialogProps, SegmentColorTuple } from './particle-emitter2/types';
import { createParticleEmitter2TextureOptions, isParticleEmitter2TextureIdAvailable } from './particle-emitter2/textureOptions';

const ParticleEmitter2Dialog: React.FC<ParticleEmitter2DialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
    standaloneModelPath,
    onStandaloneTextureDetailRefreshRequest,
    resolveStandaloneTextureDetail,
}) => {
    const [form] = Form.useForm();
    const { getNodeById, modelData: storeModelData, modelPath: storeModelPath } = useModelStore();
    const modelData = isStandalone ? standaloneModelData : storeModelData;
    const modelPath = isStandalone ? (standaloneModelPath ?? '') : storeModelPath;
    const selectedParticleEmitter2Texture = isStandalone
        ? standaloneModelData?.selectedParticleEmitter2Texture ?? null
        : null;
    const textureSummaries = isStandalone
        ? standaloneModelData?.textureSummaries ?? []
        : [];
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
    const didUserEditRef = React.useRef(false);
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

    const normalizeForEquality = (value: unknown): unknown => {
        if (ArrayBuffer.isView(value)) {
            return Array.from(value as unknown as ArrayLike<unknown>).map(normalizeForEquality);
        }
        if (Array.isArray(value)) {
            return value.map(normalizeForEquality);
        }
        if (value && typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>)
                    .filter(([, entry]) => typeof entry !== 'undefined')
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([key, entry]) => [key, normalizeForEquality(entry)])
            );
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.abs(value) < 1e-8 ? 0 : Number(value.toFixed(8));
        }
        return value;
    };

    const nodesAreEquivalent = (left: ParticleEmitter2Node, right: ParticleEmitter2Node): boolean =>
        JSON.stringify(normalizeForEquality(left)) === JSON.stringify(normalizeForEquality(right));

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
            didUserEditRef.current = false;
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
        didUserEditRef.current = false;

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
            FilterMode: 0, // 0=Blend, 1=Additive, 2=Modulate, 3=Modulate2x, 4=Transparent/AlphaKey, 5=AddAlpha, 6=None
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
        const safeTextureId = Number.isInteger(textureId) ? textureId : -1;
        if (!isParticleEmitter2TextureIdAvailable(safeTextureId, {
            textureSummaries,
            selectedTexture: selectedParticleEmitter2Texture,
            legacyTextures: isStandalone ? null : modelData?.Textures,
        })) return;
        const previewNode: ParticleEmitter2Node = {
            ...sourceNode,
            TextureID: safeTextureId,
        };
        didUserEditRef.current = true;
        form.setFieldValue('TextureID', safeTextureId);
        if (isStandalone) {
            applyCommittedNode(previewNode);
            onStandaloneTextureDetailRefreshRequest?.(safeTextureId);
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
        const sourceNode = getCurrentSourceNode();
        if (sourceNode && nodesAreEquivalent(sourceNode, nextNode)) {
            return;
        }
        applyCommittedNode(nextNode);
    }, [applyCommittedNode, buildUpdatedNodeFromValues, form, getCurrentSourceNode, isStandalone, nodeId]);

    useEffect(() => {
        if (!isStandalone || nodeId === null) return;
        if (suppressAutoPreviewRef.current) return;
        if (formHydratedForNodeIdRef.current !== nodeId) return;
        if (!didUserEditRef.current && !didRealtimePreviewRef.current) return;

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
        if (!didUserEditRef.current) {
            clearPreviewNode();
            return false;
        }
        if (nodesAreEquivalent(oldNode, updatedNode)) {
            clearPreviewNode();
            return false;
        }
        isCommittingRef.current = true;
        applyCommittedNode(updatedNode, {
            name: `Edit Particle Emitter`,
            undoNode: oldNode,
            redoNode: updatedNode,
        });
        return true;
    }, [applyCommittedNode, buildUpdatedNodeFromValues, clearPreviewNode, form, getCurrentSourceNode, nodeId]);

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
        if (didUserEditRef.current) {
            commitCurrentValues();
        } else {
            clearPreviewNode();
        }
        onClose();
    };

    const handleOpenPresetModal = () => {
        setPresetName((currentNode?.Name || '').trim() || uiText.particleEmitter2Dialog.presetDefaultName);
        setPresetModalOpen(true);
    };

    const resolvePresetTexture = async (textureId: number) => {
        if (!Number.isInteger(textureId) || textureId < 0) {
            return null;
        }
        if (selectedParticleEmitter2Texture?.index === textureId) {
            return selectedParticleEmitter2Texture;
        }
        if (isStandalone) {
            onStandaloneTextureDetailRefreshRequest?.(textureId);
            const refreshedTexture = await resolveStandaloneTextureDetail?.(textureId);
            if (refreshedTexture?.index === textureId) {
                return refreshedTexture;
            }
        }
        return isStandalone ? null : modelData?.Textures?.[textureId] ?? null;
    };

    const handleSavePreset = async () => {
        try {
            const values = await form.validateFields();
            const updatedNode = buildUpdatedNodeFromValues(values);
            if (!updatedNode) return;

            const textureId = Number(updatedNode.TextureID);
            const texture = await resolvePresetTexture(textureId);

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

    const resetOverallHueState = useCallback(() => {
        hueBaseColorsRef.current = null;
        setOverallHueShift(0);
    }, []);

    const renderBoxedNumericField = (
        label: string,
        name: string,
        options: { min?: number; max?: number; precision?: number; width?: number | string } = {}
    ) => (
        <BoxedNumericField
            label={label}
            name={name}
            isDynamic={!!animDataMap[name]}
            onDynamicChange={handleDynamicChange}
            onOpenKeyframeEditor={handleOpenKeyframeEditor}
            {...options}
        />
    );

    const renderSegmentBox = (title: string, prefix: string) => (
        <SegmentBox
            title={title}
            prefix={prefix}
            form={form}
            getCurrentSegmentColors={getCurrentSegmentColors}
            flushPreviewNowWithOverrides={flushPreviewNowWithOverrides}
            resetOverallHueState={resetOverallHueState}
            fromAntdColor={fromAntdColor}
        />
    );

    // Texture Options
    const textureOptions = createParticleEmitter2TextureOptions({
        textureSummaries,
        selectedTexture: selectedParticleEmitter2Texture,
        legacyTextures: isStandalone ? null : modelData?.Textures,
    });

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
                    didUserEditRef.current = true;
                    const changedKeys = Object.keys(changedValues);
                    const hasDeferredChange = changedKeys.some((key) => DEFERRED_PREVIEW_FIELD_NAMES.has(key));
                    if (hasDeferredChange) {
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
                    {renderBoxedNumericField(uiText.particleEmitter2Dialog.visibility, 'Visibility', { min: 0, max: 1, precision: 1, width: '20%' })}
                    {renderBoxedNumericField(uiText.particleEmitter2Dialog.emissionRate, 'EmissionRate', { width: '20%' })}
                    {renderBoxedNumericField(uiText.particleEmitter2Dialog.speed, 'Speed', { width: '20%' })}
                    {renderBoxedNumericField(uiText.particleEmitter2Dialog.variation, 'Variation', { precision: 2, width: '20%' })}
                    {renderBoxedNumericField(uiText.particleEmitter2Dialog.latitude, 'Latitude', { precision: 2, width: '20%' })}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {/* Row 2 Params */}
                    <div style={{ width: '20%' }}>{renderBoxedNumericField(uiText.particleEmitter2Dialog.width, 'Width')}</div>
                    <div style={{ width: '20%' }}>{renderBoxedNumericField(uiText.particleEmitter2Dialog.length, 'Length')}</div>
                    <div style={{ width: '20%' }}>{renderBoxedNumericField(uiText.particleEmitter2Dialog.gravity, 'Gravity')}</div>

                    {/* Rendering Section */}
                    <div style={{ flex: 1 }}>
                        <RenderingSection
                            textureOptions={textureOptions}
                            isTextureDropActive={isTextureDropActive}
                            setIsTextureDropActive={setIsTextureDropActive}
                            applyRealtimeTexture={applyRealtimeTexture}
                        />
                    </div>
                </div>

                {/* --- MAIN CONTENT SPLIT (Left Column vs Right Column) --- */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>

                    {/* LEFT COLUMN: Segments, Lifecycle, Others */}
                    <div style={{ flex: 1 }}>
                        {/* Segments */}
                        <OverallAdjustments
                            overallHueShift={overallHueShift}
                            overallAlphaScale={overallAlphaScale}
                            overallScaleScale={overallScaleScale}
                            applyOverallHueShift={applyOverallHueShift}
                            applyOverallAlphaScale={applyOverallAlphaScale}
                            applyOverallScaleScale={applyOverallScaleScale}
                            resetOverallHueShift={resetOverallHueShift}
                            resetOverallAlphaScale={resetOverallAlphaScale}
                            resetOverallScaleScale={resetOverallScaleScale}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <div style={{ flex: 1 }}>{renderSegmentBox(uiText.particleEmitter2Dialog.segment1, 'Seg1')}</div>
                            <div style={{ flex: 1 }}>{renderSegmentBox(uiText.particleEmitter2Dialog.segment2, 'Seg2')}</div>
                            <div style={{ flex: 1 }}>{renderSegmentBox(uiText.particleEmitter2Dialog.segment3, 'Seg3')}</div>
                        </div>

                        {/* Lifecycle - MDX uses HeadLifeSpan/HeadDecay/TailLifeSpan/TailDecay as interval arrays */}
                        <LifecycleSection />

                        {/* Other Params */}
                        <OtherParamsSection />
                    </div>

                    {/* RIGHT COLUMN: Flags + Buttons */}
                    <FlagsPanel onOpenPresetModal={handleOpenPresetModal} />
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
