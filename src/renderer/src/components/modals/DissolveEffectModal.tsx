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
                backgroundColor: '#252525', 
                border: '1px solid #444', 
                position: 'relative', 
                borderRadius: 4, 
                cursor: 'pointer',
                marginTop: 24,
                marginBottom: 24
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
                            backgroundColor: color,
                            border: `2px solid ${isSelected ? '#fff' : '#222'}`,
                            borderRadius: '4px',
                            cursor: 'ew-resize',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            boxShadow: isSelected ? '0 0 0 2px rgba(24, 144, 255, 0.5)' : 'none',
                            zIndex: isSelected ? 10 : 1
                        }}
                        title={`帧: ${p.frame} (${p.type === 'start' ? '开始' : '结束'})`}
                    />
                );
            })}
            <div style={{ position: 'absolute', bottom: -20, left: 0, color: '#888', fontSize: 11 }}>{min}</div>
            <div style={{ position: 'absolute', bottom: -20, right: 0, color: '#888', fontSize: 11 }}>{max}</div>
            <div style={{ position: 'absolute', top: -20, left: 0, width: '100%', textAlign: 'center', color: '#888', fontSize: 11, pointerEvents: 'none' }}>
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
    // Model store data
    const nodes = useModelStore(state => state.nodes);
    const sequences = useModelStore(state => state.sequences);
    
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

    // Extract all geosets logically
    // Since war3 models' geosets are not guaranteed to have IDs as nodes, we typically rely on index or Geoset selection
    const geosetCount = useModelStore.getState().modelData?.Geosets?.length || 0;
    const geosetOptions = Array.from({ length: geosetCount }, (_, i) => ({ label: `多边形组 ${i}`, value: i }));

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text style={{ color: '#aaa', fontSize: 13, fontWeight: 500 }}>选择多边形组:</Text>
                <Select
                    mode="multiple"
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="请选择要应用消散效果的多边形组"
                    value={selectedGeosets}
                    onChange={setSelectedGeosets}
                    options={geosetOptions}
                    maxTagCount="responsive"
                />
            </div>

            <Divider style={{ margin: '4px 0', borderColor: '#333' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text style={{ color: '#aaa', fontSize: 13, fontWeight: 500 }}>消散掩码贴图:</Text>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Input 
                        value={texturePath} 
                        readOnly 
                        placeholder="暂未选择消散贴图..."
                        style={{ flex: 1, backgroundColor: '#1e1e1e', borderColor: '#444', color: '#eee' }} 
                    />
                    <Button type="default" onClick={handleSelectTexture}>浏览...</Button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 12 }}>
                <Text style={{ color: '#aaa', fontSize: 13, fontWeight: 500 }}>消散滑块控制 (范围: {currentMin} - {currentMax}):</Text>
                <DissolveTimelineSlider
                    min={currentMin}
                    max={currentMax}
                    points={points}
                    onPointsChange={setPoints}
                    selectedPointId={selectedPointId}
                    onSelectPoint={setSelectedPointId}
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#2a2a2a', padding: 12, borderRadius: 6, border: '1px solid #333' }}>
                <Radio.Group onChange={e => setTimeMode(e.target.value)} value={timeMode}>
                    <Radio value="sequence" style={{ color: '#ccc' }}>绑定到动作序列</Radio>
                    <Radio value="manual" style={{ color: '#ccc' }}>手动输入关键帧范围</Radio>
                </Radio.Group>

                {timeMode === 'sequence' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: 24 }}>
                        <Text style={{ color: '#888' }}>动作:</Text>
                        <Select
                            style={{ flex: 1 }}
                            value={selectedSequenceIndex}
                            onChange={setSelectedSequenceIndex}
                            options={sequences.map((s, i) => ({ label: `${s.Name} [${s.Interval[0]}-${s.Interval[1]}]`, value: i }))}
                        />
                    </div>
                )}

                {timeMode === 'manual' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingLeft: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Text style={{ color: '#888' }}>开始:</Text>
                            <InputNumber value={manualStart} onChange={val => setManualStart(val || 0)} className="dark-input-number" />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Text style={{ color: '#888' }}>结束:</Text>
                            <InputNumber value={manualEnd} onChange={val => setManualEnd(val || 0)} className="dark-input-number" />
                        </div>
                    </div>
                )}
            </div>

            <div style={{ flex: 1 }} />

            <Button type="primary" block size="large" onClick={handleExecute} style={{ backgroundColor: '#1890ff', fontWeight: 'bold' }}>
                开始执行
            </Button>

            <style dangerouslySetInnerHTML={{
                __html: `
                .dark-input-number .ant-input-number-input {
                    background-color: #1e1e1e !important;
                    color: #ccc !important;
                }
                .dark-input-number .ant-input-number-group-addon {
                    background-color: #2a2a2a !important;
                    border-color: #444 !important;
                    color: #888 !important;
                }
                .dark-input-number {
                    background-color: #1e1e1e !important;
                    border-color: #444 !important;
                }
                .dark-input-number:hover {
                    border-color: #1890ff !important;
                }
            `}} />
        </div>
    );

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="消散动画工具" onClose={onClose}>
                <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
