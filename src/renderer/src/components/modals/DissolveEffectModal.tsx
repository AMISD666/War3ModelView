import React, { useState, useEffect, useRef } from 'react';
import { Modal, Radio, InputNumber, Button, Select, Divider, Typography, Input, message } from 'antd';
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame';
import { useModelStore } from '../../store/modelStore';
import { useRendererStore } from '../../store/rendererStore';
import { useRpcClient } from '../../hooks/useRpc';

const { Text, Title } = Typography;

export interface DissolvePoint {
    id: string;
    frame: number;
    type: 'visible' | 'start' | 'end';
}
const DISSOLVE_POINT_META: Record<DissolvePoint['type'], { color: string; label: string; value: number }> = {
    visible: { color: '#40a9ff', label: '\u4e0d\u6d88\u6563', value: 1 },
    start: { color: '#52c41a', label: '\u6d88\u6563\u5f00\u59cb', value: 0.75 },
    end: { color: '#ff4d4f', label: '\u6d88\u6563\u7ed3\u675f', value: 0 },
};

interface DissolveTimelineSliderProps {
    min: number;
    max: number;
    points: DissolvePoint[];
    onPointsChange: (points: DissolvePoint[]) => void;
    selectedPointId: string | null;
    onSelectPoint: (id: string | null) => void;
}

const DissolveTimelineSlider: React.FC<DissolveTimelineSliderProps> = ({ min, max, points, onPointsChange, selectedPointId, onSelectPoint }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const range = max - min;
    const safeRange = range <= 0 ? 1 : range;

    // Handle Keyboard Delete
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' && selectedPointId) {
                onPointsChange(points.filter(p => p.id !== selectedPointId));
                onSelectPoint(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedPointId, points, onPointsChange, onSelectPoint]);

    // Handle Dragging
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!draggingId || !trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            let ratio = (e.clientX - rect.left) / rect.width;
            ratio = Math.max(0, Math.min(1, ratio));
            const newFrame = min + Math.round(ratio * safeRange);
            onPointsChange(points.map(p => p.id === draggingId ? { ...p, frame: newFrame } : p));
        };
        const handleMouseUp = () => {
            setDraggingId(null);
        };
        if (draggingId) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingId, min, safeRange, points, onPointsChange]);

    const handleTrackClick = (e: React.MouseEvent) => {
        // Prevent click if we dragged or clicked a thumb
        if (draggingId || (e.target as HTMLElement).dataset.thumb) return;

        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        let ratio = (e.clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        const newFrame = min + Math.round(ratio * safeRange);

        const newPoint: DissolvePoint = {
            id: Math.random().toString(36).substring(2, 9),
            frame: newFrame,
            type: 'visible'
        };
        onPointsChange([...points, newPoint]);
        onSelectPoint(newPoint.id);
    };

    return (
        <div
            ref={trackRef}
            onClick={handleTrackClick}
            style={{
                height: 24,
                backgroundColor: '#1a1a1a',
                border: '1px solid #3e3e3e',
                position: 'relative',
                borderRadius: 4,
                cursor: 'pointer',
                marginTop: 16,
                marginBottom: 16,
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)'
            }}
        >
            {points.map(p => {
                const ratio = (p.frame - min) / safeRange;
                const isSelected = p.id === selectedPointId;
                const meta = DISSOLVE_POINT_META[p.type];
                return (
                    <div
                        key={p.id}
                        data-thumb="true"
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingId(p.id);
                            onSelectPoint(p.id);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            onPointsChange(points.map(pt => {
                                if (pt.id !== p.id) return pt;
                                const nextType: DissolvePoint['type'] =
                                    pt.type === 'visible' ? 'start' :
                                    pt.type === 'start' ? 'end' :
                                    'visible';
                                return { ...pt, type: nextType };
                            }));
                            onSelectPoint(p.id);
                        }}
                        style={{
                            position: 'absolute',
                            left: `${ratio * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: 14,
                            marginLeft: -7,
                            cursor: 'ew-resize',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            zIndex: isSelected ? 10 : 1
                        }}
                        title={`帧 ${p.frame} (${meta.label}, 关键帧值 ${meta.value})`}
                    >
                        <div style={{
                            width: 4,
                            height: '100%',
                            backgroundColor: meta.color,
                            borderRadius: '2px',
                            border: isSelected ? '1px solid #fff' : 'none',
                            boxShadow: isSelected ? '0 0 0 1px #fff' : '1px 1px 2px rgba(0,0,0,0.5)',
                            pointerEvents: 'none'
                        }} />

                        {draggingId === p.id && (
                            <div style={{
                                position: 'absolute',
                                bottom: '100%',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                marginBottom: '4px',
                                backgroundColor: '#1890ff',
                                color: '#fff',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap',
                                pointerEvents: 'none',
                                zIndex: 20,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                            }}>
                                {p.frame} 帧
                            </div>
                        )}
                    </div>
                );
            })}
            <div style={{ position: 'absolute', bottom: -20, left: 0, color: '#aaa', fontSize: 11, fontWeight: 500 }}>{min}</div>
            <div style={{ position: 'absolute', bottom: -20, right: 0, color: '#aaa', fontSize: 11, fontWeight: 500 }}>{max}</div>
            <div style={{ position: 'absolute', top: -20, left: 0, width: '100%', textAlign: 'center', color: '#999', fontSize: 11, pointerEvents: 'none', letterSpacing: '0.02em' }}>
                点击空白处新建点 | 选中点按 Del 删除 | 右键循环切换状态
            </div>
        </div>
    );
};

interface DissolveEffectModalProps {
    visible: boolean;
    onClose: () => void;
    isStandalone?: boolean;
}

const DissolveEffectModal: React.FC<DissolveEffectModalProps> = ({ visible, onClose, isStandalone = false }) => {
    const storeNodes = useModelStore(state => state.nodes);
    const storeSequences = useModelStore(state => state.sequences);
    const storeGeosets = useModelStore(state => state.modelData?.Geosets || []);

    const { state: rpcState, emitCommand } = useRpcClient<any>('dissolveEffect', { geosets: [], sequences: [], geosetCount: 0 });

    const nodes = isStandalone ? [] : storeNodes; // Placeholder if nodes are needed later over RPC
    const sequences = isStandalone ? (rpcState.sequences || []) : (storeSequences || []);
    const geosets = isStandalone ? (rpcState.geosets || []) : storeGeosets;

    // UI State
    const [selectedGeosets, setSelectedGeosets] = useState<number[]>([]);
    const [texturePath, setTexturePath] = useState<string>('');
    const [points, setPoints] = useState<DissolvePoint[]>([]);
    const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
    const [timeMode, setTimeMode] = useState<'sequence' | 'manual'>('sequence');
    const [selectedSequenceIndex, setSelectedSequenceIndex] = useState<number>(0);
    const [manualStart, setManualStart] = useState<number>(0);
    const [manualEnd, setManualEnd] = useState<number>(1000);
    const [saveMode, setSaveMode] = useState<'overwrite' | 'saveAs'>('saveAs');

    // Derived min/max
    const currentMin = timeMode === 'sequence' ? (sequences[selectedSequenceIndex]?.Interval[0] || 0) : manualStart;
    const currentMax = timeMode === 'sequence' ? (sequences[selectedSequenceIndex]?.Interval[1] || 1000) : manualEnd;

    const hasInitializedPoints = useRef(false);
    const lastRangeRef = useRef({ min: currentMin, max: currentMax });

    useEffect(() => {
        // Wait until sequences are available so it initializes on real interval
        if (!hasInitializedPoints.current && currentMax > currentMin && sequences.length > 0) {
            const range = currentMax - currentMin;
            setPoints([
                { id: Math.random().toString(36).substring(2, 9), frame: currentMin, type: 'visible' },
                { id: Math.random().toString(36).substring(2, 9), frame: Math.round(currentMin + range * 0.3), type: 'start' },
                { id: Math.random().toString(36).substring(2, 9), frame: Math.round(currentMin + range * 0.8), type: 'end' }
            ]);
            hasInitializedPoints.current = true;
            lastRangeRef.current = { min: currentMin, max: currentMax };
        }
    }, [currentMin, currentMax, sequences]);

    useEffect(() => {
        // Proportionally rescale slider points when the timeline range changes (e.g. switching sequences)
        if (hasInitializedPoints.current && currentMax > currentMin) {
            const oldMin = lastRangeRef.current.min;
            const oldMax = lastRangeRef.current.max;
            const oldRange = oldMax - oldMin;
            const newRange = currentMax - currentMin;
            if (oldRange > 0 && (oldMin !== currentMin || oldMax !== currentMax)) {
                setPoints(prev => prev.map(p => {
                    const ratio = Math.max(0, Math.min(1, (p.frame - oldMin) / oldRange));
                    return { ...p, frame: Math.round(currentMin + ratio * newRange) };
                }));
            }
        }
        lastRangeRef.current = { min: currentMin, max: currentMax };
    }, [currentMin, currentMax]);

    // 多边形组与材质 ID（点击时按同材质批量选中）
    const geosetOptions = geosets.map((g: any, i: number) => ({
        label: `${i}`,
        value: i,
        materialId: g.MaterialID !== undefined ? g.MaterialID : 0
    }));

    const handleSelectTexture = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                title: '选择消散贴图',
                filters: [{ name: 'Textures', extensions: ['blp', 'tga', 'png'] }]
            });
            if (selected && typeof selected === 'string') {
                setTexturePath(selected);
            }
        } catch (err) {
            console.error('Failed to open texture dialog:', err);
        }
    };

    const handleExecute = async () => {
        if (selectedGeosets.length === 0) { message.warning('请至少选择一个多边形组'); return; }
        if (!texturePath) { message.warning('请选择消散贴图'); return; }
        if (points.length === 0) { message.warning('请在时间轴上设置至少一个关键帧点'); return; }

        const sortedPoints = [...points].sort((a, b) => a.frame - b.frame);
        const startPoints = sortedPoints.filter(p => p.type === 'start');
        const endPoints = sortedPoints.filter(p => p.type === 'end');
        if (startPoints.length === 0 || endPoints.length === 0) {
            message.warning('请确保时间轴上同时存在开始和结束关键帧'); return;
        }

        const dissolveParams = {
            selectedGeosets,
            dissolveTexturePath: texturePath,
            dissolveStartFrame: startPoints[0].frame,
            dissolveEndFrame: endPoints[endPoints.length - 1].frame,
            dissolvePoints: sortedPoints.map(point => ({
                frame: point.frame,
                value: DISSOLVE_POINT_META[point.type].value,
                type: point.type,
            })),
            seqStart: currentMin,
            seqEnd: currentMax,
            saveMode,
        };

        if (isStandalone) {
            emitCommand('EXECUTE_DISSOLVE', dissolveParams);
            message.info('正在执行消散效果...');
            return;
        }

        const store = useModelStore.getState();
        if (!store.modelData || !store.modelPath) { message.error('没有加载模型数据'); return; }

        try {
            const { executeDissolveEffect, refreshDissolveTexturesInRenderer } = await import('../../utils/dissolveEffect');
            const result = await executeDissolveEffect(store.modelData, store.modelPath, dissolveParams);
            store.setVisualDataPatch({ Materials: result.materials, Textures: result.textures });
            await refreshDissolveTexturesInRenderer(useRendererStore.getState().renderer, store.modelPath, result);
            Modal.success({
                title: '消散动画制作完成',
                content: `已修改 ${result.textureModifiedCount} 个贴图，更新 ${result.materialModifiedCount} 个材质的透明度关键帧`,
            });
        } catch (err: any) {
            message.error(err?.message || '执行消散效果失败');
        }
    };

    const innerContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text style={{ color: '#eee', fontSize: 13, fontWeight: 600 }}>多边形组 (Geosets)</Text>
                        <Text style={{ color: '#888', fontSize: 11 }}>点击将同步选中同材质组</Text>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <Button size="small" type="link" style={{ padding: 0, fontSize: 12, color: '#1890ff', fontWeight: 500 }} onClick={() => setSelectedGeosets(geosetOptions.map(o => o.value))}>全选</Button>
                        <Button size="small" type="link" style={{ padding: 0, fontSize: 12, color: '#ff7875', fontWeight: 500 }} onClick={() => setSelectedGeosets([])}>清空</Button>
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '160px', overflowY: 'auto', padding: '10px', backgroundColor: '#252526', border: '1px solid #3e3e3e', borderRadius: '4px' }}>
                    {geosetOptions.map(option => {
                        const isSelected = selectedGeosets.includes(option.value);

                        return (
                            <Button
                                key={option.value}
                                type={isSelected ? "primary" : "default"}
                                style={{
                                    backgroundColor: isSelected ? '#1890ff' : '#2b2b2b',
                                    borderColor: '#3e3e3e',
                                    borderWidth: '2px',
                                    color: isSelected ? '#fff' : '#ccc',
                                    transition: 'all 0.15s',
                                    boxShadow: isSelected ? '0 0 8px rgba(24, 144, 255, 0.45)' : 'none',
                                    minWidth: '55px',
                                    height: 'auto',
                                    padding: '4px 6px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: 1.2,
                                    opacity: isSelected ? 1 : 0.95
                                }}
                                onClick={() => {
                                    const relatedGeosetIndices = geosetOptions
                                        .filter(o => o.materialId === option.materialId)
                                        .map(o => o.value);
                                    
                                    if (isSelected) {
                                        setSelectedGeosets(prev => prev.filter(v => !relatedGeosetIndices.includes(v)));
                                    } else {
                                        setSelectedGeosets(prev => Array.from(new Set([...prev, ...relatedGeosetIndices])));
                                    }
                                }}
                                title={`点击可选中/取消所有 Material ID 为 ${option.materialId} 的组`}
                            >
                                <div style={{ fontSize: '10px', opacity: isSelected ? 0.9 : 0.6, marginBottom: '2px' }}>材质 {option.materialId}</div>
                                <div style={{ fontSize: '14px', fontWeight: 'bold' }}>组 {option.label}</div>
                            </Button>
                        );
                    })}
                    {geosetOptions.length === 0 && (
                        <Text style={{ color: '#666', fontSize: 12 }}>无可用多边形组</Text>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Text style={{ color: '#eee', fontSize: 13, fontWeight: 600 }}>消散贴图与模式</Text>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Input
                        value={texturePath}
                        readOnly
                        placeholder="选择消散贴图"
                        style={{ flex: 1, backgroundColor: '#1e1e1e', borderColor: '#3e3e3e', color: '#fff' }}
                        onClick={handleSelectTexture}
                    />
                    <Button type="primary" onClick={handleSelectTexture} style={{ borderRadius: '4px' }}>浏览...</Button>
                    <Radio.Group 
                        size="small" 
                        onChange={e => setSaveMode(e.target.value)} 
                        value={saveMode} 
                        style={{ display: 'flex', backgroundColor: '#1e1e1e', padding: '3px 8px', borderRadius: '4px', border: '1px solid #3e3e3e', height: '32px', alignItems: 'center' }}
                    >
                        <Radio value="saveAs" style={{ color: '#ccc', fontSize: 12, marginRight: 8 }}>另存新贴图</Radio>
                        <Radio value="overwrite" style={{ color: '#ccc', fontSize: 12, marginRight: 0 }}>破坏性覆盖</Radio>
                    </Radio.Group>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#252526', padding: '14px', borderRadius: '6px', border: '1px solid #3e3e3e', gap: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#eee', fontSize: 13, fontWeight: 600 }}>时间轴控制</Text>
                    <Radio.Group size="small" onChange={e => setTimeMode(e.target.value)} value={timeMode} style={{ display: 'flex' }}>
                        <Radio.Button value="sequence" style={{ flex: 1, textAlign: 'center', backgroundColor: timeMode === 'sequence' ? '#1890ff' : '#1e1e1f', borderColor: '#3e3e3e', color: timeMode === 'sequence' ? '#fff' : '#999' }}>动作序列</Radio.Button>
                        <Radio.Button value="manual" style={{ flex: 1, textAlign: 'center', backgroundColor: timeMode === 'manual' ? '#1890ff' : '#1e1e1f', borderColor: '#3e3e3e', color: timeMode === 'manual' ? '#fff' : '#999' }}>手动范围</Radio.Button>
                    </Radio.Group>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {timeMode === 'sequence' ? (
                        <Select
                            style={{ flex: 1 }}
                            value={selectedSequenceIndex}
                            onChange={setSelectedSequenceIndex}
                            options={sequences.map((s, i) => ({ label: `${s.Name} [${s.Interval[0]}-${s.Interval[1]}]`, value: i }))}
                            dropdownStyle={{ backgroundColor: '#2a2a2a', color: '#eee' }}
                        />
                    ) : (
                        <>
                            <Input
                                addonBefore="开始帧"
                                defaultValue={manualStart}
                                key={`start-${manualStart}`}
                                className="dark-input-number"
                                style={{ flex: 1 }}
                                onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v)) setManualStart(v); }}
                                onPressEnter={e => { const v = parseInt((e.target as HTMLInputElement).value); if (!isNaN(v)) setManualStart(v); (e.target as HTMLInputElement).blur(); }}
                            />
                            <Input
                                addonBefore="结束帧"
                                defaultValue={manualEnd}
                                key={`end-${manualEnd}`}
                                className="dark-input-number"
                                style={{ flex: 1 }}
                                onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v)) setManualEnd(v); }}
                                onPressEnter={e => { const v = parseInt((e.target as HTMLInputElement).value); if (!isNaN(v)) setManualEnd(v); (e.target as HTMLInputElement).blur(); }}
                            />
                        </>
                    )}
                </div>

                <div style={{ padding: '0 8px' }}>
                    <DissolveTimelineSlider
                        min={currentMin}
                        max={currentMax}
                        points={points}
                        onPointsChange={setPoints}
                        selectedPointId={selectedPointId}
                        onSelectPoint={setSelectedPointId}
                    />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 18px', alignItems: 'center', padding: '0 8px' }}>
                    {(Object.entries(DISSOLVE_POINT_META) as Array<[DissolvePoint['type'], typeof DISSOLVE_POINT_META[DissolvePoint['type']]]>).map(([type, meta]) => (
                        <div
                            key={type}
                            title={meta.label}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#cfcfcf', fontSize: 12 }}
                        >
                            <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: meta.color, boxShadow: `0 0 0 1px ${meta.color}55` }} />
                            <span>{meta.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1 }} />

            <Button type="primary" block size="large" onClick={handleExecute} style={{ backgroundColor: '#1890ff', fontWeight: 'bold' }}>
                开始执行
            </Button>

            <style dangerouslySetInnerHTML={{
                __html: `
                .dark-input-number .ant-input {
                    background-color: #1e1e1e !important;
                    color: #fff !important;
                    border: 1px solid #3e3e3e !important;
                    border-left: none !important;
                }
                .dark-input-number .ant-input-group-addon {
                    background-color: #333 !important;
                    border-color: #3e3e3e !important;
                    color: #bbb !important;
                    font-size: 11px !important;
                    padding: 0 10px !important;
                }
                .dark-input-number:hover .ant-input, 
                .dark-input-number:hover .ant-input-group-addon {
                    border-color: #666 !important;
                }
                .dark-input-number .ant-input:focus {
                    border-color: #1890ff !important;
                    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2) !important;
                }
                .ant-select-selector {
                    background-color: #1e1e1e !important;
                    border-color: #3e3e3e !important;
                }
                .ant-select-selection-item {
                    color: #eee !important;
                }
                .ant-select-arrow {
                    color: #888 !important;
                }
            `}} />
        </div>
    );

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="消散动画工具" onClose={onClose}>
                <div style={{ padding: '16px', flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {innerContent}
                </div>
            </StandaloneWindowFrame>
        );
    }

    return (
        <Modal
            title="消散动画工具"
            open={visible}
            onCancel={onClose}
            footer={null}
            width={580}
            wrapClassName="dark-modal-wrap"
        >
            {innerContent}
        </Modal>
    );
};

export default DissolveEffectModal;
