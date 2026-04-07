import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal, Radio, InputNumber, Button, Select, Divider, Typography, Input } from 'antd';
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame';
import { useModelStore } from '../../store/modelStore';
import { useRpcClient } from '../../hooks/useRpc';

const { Text, Title } = Typography;

export interface DissolvePoint {
    id: string;
    frame: number;
    type: 'start' | 'end';
}

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
            type: 'start'
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
                const color = p.type === 'start' ? '#52c41a' : '#ff4d4f';
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
                            onPointsChange(points.map(pt => pt.id === p.id ? { ...pt, type: pt.type === 'start' ? 'end' : 'start' } : pt));
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
                        title={`帧: ${p.frame} (${p.type === 'start' ? '开始' : '结束'})`}
                    >
                        <div style={{
                            width: 4,
                            height: '100%',
                            backgroundColor: color,
                            borderRadius: '2px',
                            border: isSelected ? '1px solid #fff' : 'none',
                            boxShadow: isSelected ? '0 0 0 2px rgba(24, 144, 255, 0.5)' : '1px 1px 2px rgba(0,0,0,0.5)',
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
                空白处点击新建点 | 选中点按Del删除 | 右键切换类型
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
    const storeGeosetCount = useModelStore(state => state.modelData?.Geosets?.length || 0);

    const { state: rpcState } = useRpcClient<any>('dissolveEffect', { geosets: [], sequences: [], geosetCount: 0 });

    const nodes = isStandalone ? [] : storeNodes; // Placeholder if nodes are needed later over RPC
    const sequences = isStandalone ? (rpcState.sequences || []) : (storeSequences || []);
    const geosetCount = isStandalone ? (rpcState.geosetCount || 0) : storeGeosetCount;

    // UI State
    const [selectedGeosets, setSelectedGeosets] = useState<number[]>([]);
    const [texturePath, setTexturePath] = useState<string>('');
    const [points, setPoints] = useState<DissolvePoint[]>([]);
    const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
    const [timeMode, setTimeMode] = useState<'sequence' | 'manual'>('sequence');
    const [selectedSequenceIndex, setSelectedSequenceIndex] = useState<number>(0);
    const [manualStart, setManualStart] = useState<number>(0);
    const [manualEnd, setManualEnd] = useState<number>(1000);

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

    // Extract all geosets logically
    // Since war3 models' geosets are not guaranteed to have IDs as nodes, we typically rely on index or Geoset selection
    const geosetOptions = Array.from({ length: geosetCount }, (_, i) => ({ label: `${i}`, value: i }));

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

    const handleExecute = () => {
        console.log('Execute Dissolve:', { selectedGeosets, texturePath, points, timeMode, currentMin, currentMax });
        // The implementation logic will be filled here later
    };

    const innerContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#eee', fontSize: 13, fontWeight: 600 }}>多边形组 (Geosets)</Text>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <Button size="small" type="link" style={{ padding: 0, fontSize: 12, color: '#1890ff', fontWeight: 500 }} onClick={() => setSelectedGeosets(geosetOptions.map(o => o.value))}>全选</Button>
                        <Button size="small" type="link" style={{ padding: 0, fontSize: 12, color: '#ff7875', fontWeight: 500 }} onClick={() => setSelectedGeosets([])}>清空</Button>
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '120px', overflowY: 'auto', padding: '10px', backgroundColor: '#252526', border: '1px solid #3e3e3e', borderRadius: '4px' }}>
                    {geosetOptions.map(option => {
                        const isSelected = selectedGeosets.includes(option.value);
                        return (
                            <Button
                                key={option.value}
                                size="small"
                                type={isSelected ? "primary" : "default"}
                                style={{
                                    backgroundColor: isSelected ? '#1890ff' : '#333',
                                    borderColor: isSelected ? '#1890ff' : '#444',
                                    color: isSelected ? '#fff' : '#ccc',
                                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: 'none',
                                    minWidth: '32px',
                                    fontWeight: isSelected ? 600 : 400
                                }}
                                onClick={() => {
                                    if (isSelected) {
                                        setSelectedGeosets(prev => prev.filter(v => v !== option.value));
                                    } else {
                                        setSelectedGeosets(prev => [...prev, option.value]);
                                    }
                                }}
                            >
                                {option.label}
                            </Button>
                        );
                    })}
                    {geosetOptions.length === 0 && (
                        <Text style={{ color: '#666', fontSize: 12 }}>无可用多边形组</Text>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text style={{ color: '#eee', fontSize: 13, fontWeight: 600 }}>消散贴图</Text>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Input
                        value={texturePath}
                        readOnly
                        placeholder="选择贴图"
                        style={{ flex: 1, backgroundColor: '#1e1e1e', borderColor: '#3e3e3e', color: '#fff' }}
                    />
                    <Button type="primary" onClick={handleSelectTexture} style={{ borderRadius: '4px' }}>浏览...</Button>
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
