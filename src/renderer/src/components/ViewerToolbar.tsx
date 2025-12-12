import React from 'react';
import { Button, Tooltip, Space } from 'antd';
import {
    GatewayOutlined, // Vertex/Point
    AppstoreOutlined, // Face
    DragOutlined, // Move
    RedoOutlined, // Rotate
    ExpandOutlined, // Scale
    SkinOutlined, // Binding
    VideoCameraOutlined, // Keyframe
    ThunderboltOutlined // Recalculate Normals
} from '@ant-design/icons';
import { useSelectionStore } from '../store/selectionStore';

interface ViewerToolbarProps {
    onRecalculateNormals?: () => void
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ onRecalculateNormals }) => {
    const {
        mainMode,
        geometrySubMode,
        setGeometrySubMode,
        animationSubMode,
        setAnimationSubMode,
        transformMode,
        setTransformMode
    } = useSelectionStore();

    if (mainMode !== 'geometry' && mainMode !== 'animation') return null;

    return (
        <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(40, 40, 40, 0.9)',
            padding: '8px 16px',
            borderRadius: '8px',
            display: 'flex',
            gap: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 1000,
            pointerEvents: 'auto'
        }}>
            {mainMode === 'geometry' && (
                <>
                    <Space>
                        <Tooltip title="顶点模式">
                            <Button
                                type={geometrySubMode === 'vertex' ? 'primary' : 'default'}
                                icon={<GatewayOutlined />}
                                onClick={() => setGeometrySubMode('vertex')}
                            />
                        </Tooltip>
                        <Tooltip title="面模式">
                            <Button
                                type={geometrySubMode === 'face' ? 'primary' : 'default'}
                                icon={<AppstoreOutlined />}
                                onClick={() => setGeometrySubMode('face')}
                            />
                        </Tooltip>
                        <Tooltip title="重算法线">
                            <Button
                                icon={<ThunderboltOutlined />}
                                onClick={onRecalculateNormals}
                            />
                        </Tooltip>
                    </Space>
                    <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />
                </>
            )}

            {mainMode === 'animation' && (
                <>
                    <Space>
                        <Tooltip title="骨骼绑定模式 (静止姿态)">
                            <Button
                                type={animationSubMode === 'binding' ? 'primary' : 'default'}
                                icon={<SkinOutlined />}
                                onClick={() => setAnimationSubMode('binding')}
                            >
                                绑定模式
                            </Button>
                        </Tooltip>
                        <Tooltip title="关键帧模式 (动画播放)">
                            <Button
                                type={animationSubMode === 'keyframe' ? 'primary' : 'default'}
                                icon={<VideoCameraOutlined />}
                                onClick={() => setAnimationSubMode('keyframe')}
                            >
                                关键帧模式
                            </Button>
                        </Tooltip>
                    </Space>
                    <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />

                    {animationSubMode === 'binding' && (
                        <>
                            <Space>
                                <Tooltip title="绑定选中的顶点到选中的骨骼">
                                    <Button onClick={() => console.log('Bind Action')}>
                                        绑定
                                    </Button>
                                </Tooltip>
                                <Tooltip title="解除选中顶点的骨骼绑定">
                                    <Button onClick={() => console.log('Unbind Action')}>
                                        解绑
                                    </Button>
                                </Tooltip>
                                <Tooltip title="修改选中骨骼的父节点">
                                    <Button onClick={() => useSelectionStore.getState().setIsPickingParent(true)}>
                                        修改父节点
                                    </Button>
                                </Tooltip>
                            </Space>
                            <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />
                        </>
                    )}
                </>
            )}

            <Space>
                <Tooltip title="移动 (W)">
                    <Button
                        type={transformMode === 'translate' ? 'primary' : 'default'}
                        icon={<DragOutlined />}
                        onClick={() => setTransformMode('translate')}
                    />
                </Tooltip>
                <Tooltip title="旋转 (E)">
                    <Button
                        type={transformMode === 'rotate' ? 'primary' : 'default'}
                        icon={<RedoOutlined />}
                        onClick={() => setTransformMode('rotate')}
                    />
                </Tooltip>
                <Tooltip title="缩放 (R)">
                    <Button
                        type={transformMode === 'scale' ? 'primary' : 'default'}
                        icon={<ExpandOutlined />}
                        onClick={() => setTransformMode('scale')}
                    />
                </Tooltip>
            </Space>
        </div>
    );
};
