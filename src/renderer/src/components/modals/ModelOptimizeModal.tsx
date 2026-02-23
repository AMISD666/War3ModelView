import React, { useState, useEffect, useRef } from 'react';
import { Modal, Checkbox, Slider, InputNumber, Button, Row, Col, Typography, Divider } from 'antd';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { clearAndFixModel, IClearConfig } from '../../utils/modelUtils';

const { Text, Title } = Typography;

interface ModelOptimizeModalProps {
    visible: boolean;
    onClose: () => void;
    modelData: any | null; // We might need this for actual operations later
}

const ModelOptimizeModal: React.FC<ModelOptimizeModalProps> = ({ visible, onClose, modelData }) => {
    // Polygon Optimization State
    const [removeRedundantVertices, setRemoveRedundantVertices] = useState(true);
    const [decimateModel, setDecimateModel] = useState(true);
    const [decimateRatio, setDecimateRatio] = useState<number>(75);

    // Keyframe Optimization State
    const [removeRedundantFrames, setRemoveRedundantFrames] = useState(true);
    const [optimizeKeyframes, setOptimizeKeyframes] = useState(true);

    // Mock calculations for now. Will be hooked up to real stats later.
    const [originalFaces, setOriginalFaces] = useState(0);
    const [estimatedFaces, setEstimatedFaces] = useState(0);

    // Draggable state
    const [disabled, setDisabled] = useState(false);
    const [bounds, setBounds] = useState({ left: 0, top: 0, bottom: 0, right: 0 });
    const draggleRef = useRef<HTMLDivElement>(null);

    const onStart = (_event: DraggableEvent, uiData: DraggableData) => {
        const { clientWidth, clientHeight } = window.document.documentElement;
        const targetRect = draggleRef.current?.getBoundingClientRect();
        if (!targetRect) {
            return;
        }
        setBounds({
            left: -targetRect.left + uiData.x,
            right: clientWidth - (targetRect.right - uiData.x),
            top: -targetRect.top + uiData.y,
            bottom: clientHeight - (targetRect.bottom - uiData.y),
        });
    };

    // Calculate faces mock logic whenever modelData or decimateRatio changes
    useEffect(() => {
        if (modelData) {
            // Simplified sum: iterate over geosets and count faces
            let total = 0;
            if (modelData.Geosets && Array.isArray(modelData.Geosets)) {
                modelData.Geosets.forEach((g: any) => {
                    if (g.Faces && Array.isArray(g.Faces)) {
                        total += g.Faces.length / 3; // Typically represented as array of vertex indices, every 3 is a triangle
                    }
                });
            }
            // If the format is different, we handle it
            setOriginalFaces(Math.floor(total));
        } else {
            setOriginalFaces(0);
        }
    }, [modelData]);

    useEffect(() => {
        if (decimateModel) {
            setEstimatedFaces(Math.floor(originalFaces * (decimateRatio / 100)));
        } else {
            setEstimatedFaces(originalFaces);
        }
    }, [originalFaces, decimateRatio, decimateModel]);

    const handleExecutePolygonOpt = () => {
        // Implementation will go here
        console.log('Execute Polygon Optimization', {
            removeRedundantVertices,
            decimateModel,
            decimateRatio
        });
    };

    const handleExecuteKeyframeOpt = () => {
        // Implementation will go here
        console.log('Execute Keyframe Optimization', {
            removeRedundantFrames,
            optimizeKeyframes
        });
    };

    return (
        <Modal
            title={
                <div
                    style={{
                        width: '100%',
                        cursor: disabled ? 'default' : 'move',
                        padding: '12px 16px',
                        margin: '-12px -16px', // offset default modal padding
                        backgroundColor: '#222', // slight distinction for header
                        borderTopLeftRadius: '8px',
                        borderTopRightRadius: '8px',
                        borderBottom: '1px solid #333'
                    }}
                    onMouseOver={() => {
                        if (disabled) setDisabled(false);
                    }}
                    onMouseOut={() => {
                        setDisabled(true);
                    }}
                >
                    <Title level={5} style={{ margin: 0, color: '#e0e0e0', fontWeight: 600 }}>模型优化</Title>
                </div>
            }
            open={visible}
            onCancel={onClose}
            footer={null}
            width={320}
            centered={false} // Turn off centered so dragging feels more stable naturally, or leave it.
            mask={false}
            wrapClassName="dark-modal-wrap"
            modalRender={(modal) => (
                <Draggable
                    disabled={disabled}
                    bounds={bounds}
                    onStart={(event, uiData) => onStart(event, uiData)}
                >
                    <div ref={draggleRef}>{modal}</div>
                </Draggable>
            )}
            styles={{
                content: {
                    backgroundColor: '#1e1e1e',
                    border: '1px solid #333',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)'
                },
                header: { backgroundColor: 'transparent', margin: 0, padding: 0 },
                body: { padding: '12px 0 0' }
            }}
            closeIcon={<span style={{ color: '#888', marginTop: 12, marginRight: 16 }}>✕</span>}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

                {/* --- Polygon Optimization Section --- */}
                <Text style={{ color: '#aaa', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>多边形优化</Text>

                <Row wrap={false} style={{ marginBottom: 4 }}>
                    <Col span={12}>
                        <Checkbox
                            checked={removeRedundantVertices}
                            onChange={(e) => setRemoveRedundantVertices(e.target.checked)}
                            style={{ color: '#ccc', fontSize: 13 }}
                        >
                            删除多余顶点
                        </Checkbox>
                    </Col>
                    <Col span={12}>
                        <Checkbox
                            checked={decimateModel}
                            onChange={(e) => setDecimateModel(e.target.checked)}
                            style={{ color: '#ccc', fontSize: 13 }}
                        >
                            模型减面
                        </Checkbox>
                    </Col>
                </Row>

                <div style={{
                    opacity: decimateModel ? 1 : 0.4,
                    pointerEvents: decimateModel ? 'auto' : 'none',
                    transition: 'opacity 0.2s',
                    padding: '8px 12px',
                    backgroundColor: '#252525',
                    borderRadius: 6,
                    border: '1px solid #2f2f2f'
                }}>
                    <Row align="middle" gutter={12}>
                        <Col flex="auto">
                            <Slider
                                min={0}
                                max={100}
                                step={1}
                                value={decimateRatio}
                                onChange={setDecimateRatio}
                                tooltip={{ formatter: (val) => `${val}%` }}
                                styles={{
                                    track: { backgroundColor: '#1890ff' },
                                    handle: { borderColor: '#1890ff', backgroundColor: '#1e1e1e' }
                                }}
                            />
                        </Col>
                        <Col>
                            <InputNumber
                                min={0}
                                max={100}
                                value={decimateRatio}
                                onChange={(val) => setDecimateRatio(val || 0)}
                                addonAfter="%"
                                size="small"
                                style={{ width: 70 }}
                                className="dark-input-number"
                            />
                        </Col>
                    </Row>
                    <Row justify="space-between" style={{ marginTop: 4, fontSize: 12 }}>
                        <Text style={{ color: '#888' }}>模型原面数: <span style={{ color: '#ccc' }}>{originalFaces}</span></Text>
                        <Text style={{ color: '#888' }}>预计面数: <span style={{ color: '#1890ff' }}>{estimatedFaces}</span></Text>
                    </Row>
                </div>

                <Button
                    type="primary"
                    block
                    onClick={handleExecutePolygonOpt}
                    style={{
                        marginTop: 4,
                        height: 32,
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: 500,
                        backgroundColor: '#1890ff',
                        borderColor: '#1890ff'
                    }}
                >
                    执行多边形优化
                </Button>

                <Divider style={{ margin: '10px 0', borderColor: '#333' }} />

                {/* --- Keyframe Optimization Section --- */}
                <Text style={{ color: '#aaa', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>关键帧优化</Text>

                <Row wrap={false} style={{ marginBottom: 4 }}>
                    <Col span={12}>
                        <Checkbox
                            checked={removeRedundantFrames}
                            onChange={(e) => setRemoveRedundantFrames(e.target.checked)}
                            style={{ color: '#ccc', fontSize: 13 }}
                        >
                            多余帧删除
                        </Checkbox>
                    </Col>
                    <Col span={12}>
                        <Checkbox
                            checked={optimizeKeyframes}
                            onChange={(e) => setOptimizeKeyframes(e.target.checked)}
                            style={{ color: '#ccc', fontSize: 13 }}
                        >
                            关键帧优化
                        </Checkbox>
                    </Col>
                </Row>

                <Button
                    type="default"
                    block
                    onClick={handleExecuteKeyframeOpt}
                    style={{
                        marginTop: 4,
                        height: 32,
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: 500,
                        backgroundColor: '#2a2a2a',
                        borderColor: '#444',
                        color: '#eee'
                    }}
                >
                    执行关键帧优化
                </Button>

            </div>
            {/* Minimal inline CSS for dark mode inputs if not globally defined */}
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
        </Modal>
    );
};

export default ModelOptimizeModal;
