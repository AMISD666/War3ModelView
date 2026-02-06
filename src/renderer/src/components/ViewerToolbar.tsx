import React from 'react';
import { Button, Tooltip, Space, message, InputNumber } from 'antd';
import {
    GatewayOutlined, // Vertex/Point
    AppstoreOutlined, // Face
    GroupOutlined, // Group/Connected
    DragOutlined, // Move
    RedoOutlined, // Rotate
    ExpandOutlined, // Scale
    SkinOutlined, // Binding
    VideoCameraOutlined, // Keyframe
    ThunderboltOutlined, // Recalculate Normals
    SplitCellsOutlined, // Split
    MergeCellsOutlined, // Weld
    LinkOutlined, // Bind
    DisconnectOutlined, // Unbind
    ApartmentOutlined, // Parent
    TableOutlined, // Grid Settings
    GlobalOutlined, // Global Transform
    CameraOutlined, // Gizmo Facing
    AimOutlined, // Pivot
    FullscreenOutlined // Fit to View
} from '@ant-design/icons';

import { useSelectionStore } from '../store/selectionStore';
import { useModelStore } from '../store/modelStore';
import { useRendererStore } from '../store/rendererStore';
import { useCommandManager } from '../utils/CommandManager';
import { BindVerticesCommand } from '../commands/BindVerticesCommand';

interface ViewerToolbarProps {
    onRecalculateNormals?: () => void
    onSplitVertices?: () => void
    onWeldVertices?: () => void
    onFitToView?: () => void
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
    onRecalculateNormals,
    onSplitVertices,
    onWeldVertices,
    onFitToView
}) => {
    const {
        mainMode,
        geometrySubMode,
        setGeometrySubMode,
        animationSubMode,
        setAnimationSubMode,
        transformMode,
        setTransformMode,
        selectedVertexIds,
        selectedNodeIds,
        isPickingParent,
        setIsPickingParent,
        isGlobalTransformMode,
        setIsGlobalTransformMode,
        globalTransformPivot,
        setGlobalTransformPivot
    } = useSelectionStore();
    const { modelData: _modelData } = useModelStore();
    const {
        renderer,
        setShowSettingsPanel,
        snapTranslateEnabled,
        setSnapTranslateEnabled,
        snapTranslateStep,
        setSnapTranslateStep,
        snapRotateEnabled,
        setSnapRotateEnabled,
        snapRotateStep,
        setSnapRotateStep,
        gizmoOrientation,
        setGizmoOrientation
    } = useRendererStore(state => state);
    const { executeCommand } = useCommandManager();
    const snapButtonSize = 32
    const snapButtonStyle: React.CSSProperties = {
        width: snapButtonSize,
        height: snapButtonSize,
        padding: 0,
        lineHeight: `${snapButtonSize}px`,
        textAlign: 'center'
    }
    const snapInputStyle: React.CSSProperties = {
        width: snapButtonSize,
        minWidth: snapButtonSize,
        height: 18,
        fontSize: 10,
        padding: 0,
        lineHeight: '18px'
    }
    const snapStackStyle: React.CSSProperties = {
        position: 'relative',
        width: snapButtonSize,
        height: snapButtonSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    }
    const snapInputFloatingStyle: React.CSSProperties = {
        ...snapInputStyle,
        position: 'absolute',
        top: snapButtonSize + 2,
        left: 0
    }

    const handleBind = () => {
        if (!renderer || selectedNodeIds.length !== 1) {
            message.warning('请先选择一个骨骼')
            return
        }
        if (selectedVertexIds.length === 0) {
            message.warning('请先选择要绑定的顶点')
            return
        }
        const boneId = selectedNodeIds[0]
        // Group vertices by geoset
        const grouped = new Map<number, number[]>()
        selectedVertexIds.forEach(v => {
            if (!grouped.has(v.geosetIndex)) grouped.set(v.geosetIndex, [])
            grouped.get(v.geosetIndex)!.push(v.index)
        })
        const targets = Array.from(grouped.entries()).map(([geosetIndex, vertexIndices]) => ({
            geosetIndex,
            vertexIndices
        }))
        const cmd = new BindVerticesCommand(renderer, targets, boneId, 'bind')
        executeCommand(cmd)
        message.success(`已绑定 ${selectedVertexIds.length} 个顶点到骨骼 ${boneId}`)
    }

    const handleUnbind = () => {
        if (!renderer || selectedNodeIds.length !== 1) {
            message.warning('请先选择一个骨骼')
            return
        }
        if (selectedVertexIds.length === 0) {
            message.warning('请先选择要解绑的顶点')
            return
        }
        const boneId = selectedNodeIds[0]
        const grouped = new Map<number, number[]>()
        selectedVertexIds.forEach(v => {
            if (!grouped.has(v.geosetIndex)) grouped.set(v.geosetIndex, [])
            grouped.get(v.geosetIndex)!.push(v.index)
        })
        const targets = Array.from(grouped.entries()).map(([geosetIndex, vertexIndices]) => ({
            geosetIndex,
            vertexIndices
        }))
        const cmd = new BindVerticesCommand(renderer, targets, boneId, 'unbind')
        executeCommand(cmd)
        message.success(`已解绑 ${selectedVertexIds.length} 个顶点从骨骼 ${boneId}`)
    }

    if (mainMode === 'uv' || mainMode === 'batch') return null;

    // Check if selected vertices are all from the same geoset (required for weld)
    const canSplit = geometrySubMode === 'vertex' && selectedVertexIds.length >= 1
    const canWeld = geometrySubMode === 'vertex' &&
        selectedVertexIds.length >= 2 &&
        selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex)

    return (
        <div style={{
            position: 'absolute',
            top: 10,
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
                        <Tooltip title="组模式 (选择相连元素)">
                            <Button
                                type={geometrySubMode === 'group' ? 'primary' : 'default'}
                                icon={<GroupOutlined />}
                                onClick={() => setGeometrySubMode('group')}
                            />
                        </Tooltip>
                        <Tooltip title="重算法线">
                            <Button
                                icon={<ThunderboltOutlined />}
                                onClick={onRecalculateNormals}
                            />
                        </Tooltip>
                        {/* Vertex Operations - always visible in geometry mode */}
                        <Tooltip title="分离 - 将选中顶点及其面分离为新多边形">
                            <Button
                                icon={<SplitCellsOutlined />}
                                onClick={onSplitVertices}
                                disabled={!canSplit}
                                style={{
                                    opacity: canSplit ? 1 : 0.5,
                                    color: canSplit ? undefined : '#888'
                                }}
                            />
                        </Tooltip>
                        <Tooltip title="焊接 - 将选中顶点合并到中心点">
                            <Button
                                icon={<MergeCellsOutlined />}
                                onClick={onWeldVertices}
                                disabled={!canWeld}
                                style={{
                                    opacity: canWeld ? 1 : 0.5,
                                    color: canWeld ? undefined : '#888'
                                }}
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
                                    <Button icon={<LinkOutlined />} onClick={handleBind} />
                                </Tooltip>
                                <Tooltip title="解除选中顶点的骨骼绑定">
                                    <Button icon={<DisconnectOutlined />} onClick={handleUnbind} />
                                </Tooltip>
                                <Tooltip title="修改选中骨骼的父节点">
                                    <Button
                                        icon={<ApartmentOutlined />}
                                        onClick={() => setIsPickingParent(true)}
                                        style={isPickingParent ? {
                                            backgroundColor: '#faad14',
                                            borderColor: '#faad14',
                                            color: '#000'
                                        } : undefined}
                                    />
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
                {/* Hide rotate/scale in animation binding mode */}
                {!(mainMode === 'animation' && animationSubMode === 'binding') && (
                    <>
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
                    </>
                )}
            </Space>

            <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />
            <Space size={4}>
                <Tooltip title={'\u4e16\u754c\u5750\u6807\u671d\u5411'}>
                    <Button
                        type={gizmoOrientation === 'world' ? 'primary' : 'default'}
                        icon={<GlobalOutlined />}
                        onClick={() => setGizmoOrientation('world')}
                    />
                </Tooltip>
                <Tooltip title={'\u6444\u50cf\u673a\u671d\u5411'}>
                    <Button
                        type={gizmoOrientation === 'camera' ? 'primary' : 'default'}
                        icon={<CameraOutlined />}
                        onClick={() => setGizmoOrientation('camera')}
                    />
                </Tooltip>
            </Space>

            <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />
            <Space size={10}>
                <div style={snapStackStyle}>
                    <Tooltip title={'\u8ddd\u79bb\u6355\u6349'}>
                        <Button
                            type={snapTranslateEnabled ? 'primary' : 'default'}
                            onClick={() => setSnapTranslateEnabled(!snapTranslateEnabled)}
                            style={snapButtonStyle}
                        >{'\u8ddd'}</Button>
                    </Tooltip>
                    <InputNumber
                        size="small"
                        min={0.001}
                        step={0.1}
                        value={snapTranslateStep}
                        controls={false}
                        onChange={(value) => {
                            const next = typeof value === 'number' && value > 0 ? value : 0.001
                            setSnapTranslateStep(next)
                        }}
                        style={snapInputFloatingStyle}
                    />
                </div>
                <div style={snapStackStyle}>
                    <Tooltip title={'\u89d2\u5ea6\u6355\u6349'}>
                        <Button
                            type={snapRotateEnabled ? 'primary' : 'default'}
                            onClick={() => setSnapRotateEnabled(!snapRotateEnabled)}
                            style={snapButtonStyle}
                        >{'\u89d2'}</Button>
                    </Tooltip>
                    <InputNumber
                        size="small"
                        min={1}
                        step={1}
                        value={snapRotateStep}
                        controls={false}
                        onChange={(value) => {
                            const next = typeof value === 'number' && value > 0 ? value : 1
                            setSnapRotateStep(next)
                        }}
                        style={snapInputFloatingStyle}
                    />
                </div>
            </Space>

            {mainMode === 'view' && (
                <>
                    <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />
                    <Space>
                        <Tooltip title="全局变换模式 (锁定在原点，对整个模型生效)">
                            <Button
                                type={isGlobalTransformMode ? 'primary' : 'default'}
                                icon={<GlobalOutlined />}
                                onClick={() => setIsGlobalTransformMode(!isGlobalTransformMode)}
                                style={isGlobalTransformMode ? { backgroundColor: '#52c41a', borderColor: '#52c41a' } : undefined}
                            >
                                全局变换
                            </Button>
                        </Tooltip>
                        <Tooltip title="全局枢轴：原点 / 模型中心">
                            <Button
                                type={globalTransformPivot === 'modelCenter' ? 'primary' : 'default'}
                                icon={<AimOutlined />}
                                onClick={() => setGlobalTransformPivot(globalTransformPivot === 'modelCenter' ? 'origin' : 'modelCenter')}
                            >
                                中心枢轴
                            </Button>
                        </Tooltip>
                    </Space>
                    <div style={{ width: 1, backgroundColor: '#555', height: '24px', alignSelf: 'center' }} />
                </>
            )}

            <Space>
                <Tooltip title="适应视图 (F)">
                    <Button
                        icon={<FullscreenOutlined />}
                        onClick={onFitToView}
                    />
                </Tooltip>
            </Space>
        </div>
    );
};
