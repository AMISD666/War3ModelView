import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React from 'react';
import { Button, Tooltip, Space, message } from 'antd';
import {
    GatewayOutlined, // Vertex/Point
    AppstoreOutlined, // Face
    GroupOutlined, // Group/Connected
    PlusOutlined, // Expand Selection
    MinusOutlined, // Shrink Selection
    DragOutlined, // Move
    RedoOutlined, // Rotate
    ExpandOutlined, // Scale
    ThunderboltOutlined, // Recalculate Normals
    SplitCellsOutlined, // Split
    MergeCellsOutlined, // Weld
    CopyOutlined, // Copy mode toggle
    ImportOutlined, // Merge-into-existing mode toggle
    LinkOutlined, // Bind
    DisconnectOutlined, // Unbind
    ApartmentOutlined, // Parent
    TableOutlined, // Grid Settings
    GlobalOutlined, // Global Transform
    CameraOutlined, // Gizmo Facing
    AimOutlined, // Pivot
    FullscreenOutlined // Fit to View
} from '@ant-design/icons';

import { SelectionId, useSelectionStore } from '../store/selectionStore';
import { useModelStore } from '../store/modelStore';
import { useRendererStore } from '../store/rendererStore';
import { useCommandManager } from '../utils/CommandManager';
import { BindVerticesCommand } from '../commands/BindVerticesCommand';
import { NodeType } from '../types/node';
import { getNodeIcon } from '../utils/nodeUtils';
import { markNodeManagerListScrollFromTree } from '../utils/nodeManagerListScrollBridge';

interface ViewerToolbarProps {
    onRecalculateNormals?: () => void
    onSplitVertices?: () => void
    onAutoSeparateLayers?: () => void
    onWeldVertices?: () => void
    onFitToView?: () => void
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
    onRecalculateNormals,
    onSplitVertices,
    onAutoSeparateLayers,
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
        selectedFaceIds,
        selectedNodeIds,
        isPickingParent,
        setIsPickingParent,
        isGlobalTransformMode,
        setIsGlobalTransformMode,
        globalTransformPivot,
        setGlobalTransformPivot
    } = useSelectionStore();
    const { modelData: _modelData, sequences, currentSequence, setFrame } = useModelStore();
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
        setGizmoOrientation,
        pasteCreatesNewGeoset,
        setPasteCreatesNewGeoset
    } = useRendererStore(state => state);
    const { executeCommand } = useCommandManager();
    const snapButtonSize = 28
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
        height: 16,
        fontSize: 9,
        padding: 0,
        lineHeight: '16px'
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
        top: snapButtonSize + 1,
        left: 0
    }
    const dividerStyle: React.CSSProperties = {
        width: 1,
        backgroundColor: '#555',
        height: '20px',
        alignSelf: 'center'
    }

    const isAnimationBindingMode = mainMode === 'animation' && animationSubMode === 'binding'
    const shouldShowOrientationButtons = mainMode !== 'view' && !isAnimationBindingMode

    React.useEffect(() => {
        if ((isAnimationBindingMode || mainMode === 'view') && gizmoOrientation !== 'world') {
            setGizmoOrientation('world')
        }
    }, [gizmoOrientation, isAnimationBindingMode, mainMode, setGizmoOrientation])

    const buildVertexAdjacency = (geoset: any): Map<number, Set<number>> => {
        const adjacency = new Map<number, Set<number>>()
        const faces = geoset?.Faces
        if (!faces) return adjacency

        const link = (a: number, b: number) => {
            if (!adjacency.has(a)) adjacency.set(a, new Set<number>())
            if (!adjacency.has(b)) adjacency.set(b, new Set<number>())
            adjacency.get(a)!.add(b)
            adjacency.get(b)!.add(a)
        }

        for (let i = 0; i + 2 < faces.length; i += 3) {
            const a = Number(faces[i])
            const b = Number(faces[i + 1])
            const c = Number(faces[i + 2])
            if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue
            link(a, b)
            link(b, c)
            link(c, a)
        }

        return adjacency
    }

    const deriveFaceSelectionFromVertices = (vertexSelection: SelectionId[]): SelectionId[] => {
        if (!renderer) return []

        const byGeoset = new Map<number, Set<number>>()
        vertexSelection.forEach((sel) => {
            if (!byGeoset.has(sel.geosetIndex)) {
                byGeoset.set(sel.geosetIndex, new Set<number>())
            }
            byGeoset.get(sel.geosetIndex)!.add(sel.index)
        })

        const faces: SelectionId[] = []
        byGeoset.forEach((selectedSet, geosetIndex) => {
            const geoset = (renderer as any).model?.Geosets?.[geosetIndex]
            const faceIndices = geoset?.Faces
            if (!faceIndices) return

            for (let faceIndex = 0; faceIndex * 3 + 2 < faceIndices.length; faceIndex++) {
                const base = faceIndex * 3
                const a = Number(faceIndices[base])
                const b = Number(faceIndices[base + 1])
                const c = Number(faceIndices[base + 2])
                if (selectedSet.has(a) && selectedSet.has(b) && selectedSet.has(c)) {
                    faces.push({ geosetIndex, index: faceIndex })
                }
            }
        })

        return faces
    }

    const applyBindingVertexSelection = (vertexSelection: SelectionId[]) => {
        const { selectVertices, clearFaceSelection, selectFaces } = useSelectionStore.getState()
        selectVertices(vertexSelection)
        if (geometrySubMode === 'group') {
            selectFaces(deriveFaceSelectionFromVertices(vertexSelection))
        } else {
            clearFaceSelection()
        }
    }

    const handleExpandVertexSelection = () => {
        if (!renderer || selectedVertexIds.length === 0) return

        const nextByGeoset = new Map<number, Set<number>>()
        selectedVertexIds.forEach((sel) => {
            if (!nextByGeoset.has(sel.geosetIndex)) {
                nextByGeoset.set(sel.geosetIndex, new Set<number>())
            }
            nextByGeoset.get(sel.geosetIndex)!.add(sel.index)
        })

        nextByGeoset.forEach((selectedSet, geosetIndex) => {
            const geoset = (renderer as any).model?.Geosets?.[geosetIndex]
            const adjacency = buildVertexAdjacency(geoset)
            Array.from(selectedSet).forEach((vertexIndex) => {
                adjacency.get(vertexIndex)?.forEach((neighborIndex) => selectedSet.add(neighborIndex))
            })
        })

        const nextSelection: SelectionId[] = []
        nextByGeoset.forEach((selectedSet, geosetIndex) => {
            selectedSet.forEach((index) => nextSelection.push({ geosetIndex, index }))
        })
        applyBindingVertexSelection(nextSelection)
    }

    const handleShrinkVertexSelection = () => {
        if (!renderer || selectedVertexIds.length === 0) return

        const nextSelection: SelectionId[] = []
        const byGeoset = new Map<number, Set<number>>()
        selectedVertexIds.forEach((sel) => {
            if (!byGeoset.has(sel.geosetIndex)) {
                byGeoset.set(sel.geosetIndex, new Set<number>())
            }
            byGeoset.get(sel.geosetIndex)!.add(sel.index)
        })

        byGeoset.forEach((selectedSet, geosetIndex) => {
            const geoset = (renderer as any).model?.Geosets?.[geosetIndex]
            const adjacency = buildVertexAdjacency(geoset)
            selectedSet.forEach((vertexIndex) => {
                const neighbors = adjacency.get(vertexIndex)
                if (!neighbors || neighbors.size === 0) return
                const isBoundary = Array.from(neighbors).some((neighborIndex) => !selectedSet.has(neighborIndex))
                if (!isBoundary) {
                    nextSelection.push({ geosetIndex, index: vertexIndex })
                }
            })
        })

        applyBindingVertexSelection(nextSelection)
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

    const handleCreateBone = () => {
        const { addNode } = useModelStore.getState()
        const { selectedVertexIds } = useSelectionStore.getState()

        let pivot: [number, number, number] = [0, 0, 0]
        if (renderer && selectedVertexIds.length > 0) {
            try {
                let sx = 0, sy = 0, sz = 0
                let count = 0
                for (const v of selectedVertexIds) {
                    const geoset = (renderer as any).model?.Geosets?.[v.geosetIndex]
                    const verts = geoset?.Vertices
                    const base = v.index * 3
                    if (!verts || base + 2 >= verts.length) continue
                    sx += Number(verts[base]) || 0
                    sy += Number(verts[base + 1]) || 0
                    sz += Number(verts[base + 2]) || 0
                    count++
                }
                if (count > 0) {
                    pivot = [sx / count, sy / count, sz / count]
                }
            } catch (e) {
                // Fall back to origin if renderer data isn't ready.
                pivot = [0, 0, 0]
            }
        }

        const uniqueName = `New Bone ${Date.now()}`
        addNode({ type: NodeType.BONE, Name: uniqueName, Parent: -1, PivotPoint: pivot })

        // Select the newly created bone if we can find it after reordering.
        const created = useModelStore.getState().nodes.find((n: any) => n.type === NodeType.BONE && n.Name === uniqueName)
        if (created) {
            markNodeManagerListScrollFromTree();
            useSelectionStore.getState().selectNode(created.ObjectId, false)
        }

        message.success(selectedVertexIds.length > 0 ? '已在顶点中心创建骨骼' : '已在原点创建骨骼')
    }

    const resetTimelineToCurrentSequenceStart = () => {
        // Prefer the selected sequence interval; fall back to renderer animationInfo; then 0.
        const seq = sequences?.[currentSequence]
        const seqStart =
            (seq && (seq as any).Interval && typeof (seq as any).Interval[0] === 'number')
                ? (seq as any).Interval[0]
                : (renderer && (renderer as any).rendererData?.animationInfo?.Interval && typeof (renderer as any).rendererData.animationInfo.Interval[0] === 'number')
                    ? (renderer as any).rendererData.animationInfo.Interval[0]
                    : 0

        setFrame(seqStart)
        if (renderer && (renderer as any).rendererData) {
            ; (renderer as any).rendererData.frame = seqStart
            if (typeof (renderer as any).update === 'function') {
                ; (renderer as any).update(0)
            }
        }
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

    if (mainMode === 'uv') return null;

    // Check if selected vertices are all from the same geoset (required for weld)
    const canSplit = (
        (geometrySubMode === 'vertex' && selectedVertexIds.length >= 1) ||
        ((geometrySubMode === 'face' || geometrySubMode === 'group') && selectedFaceIds.length >= 1)
    )
    const canWeld = geometrySubMode === 'vertex' &&
        selectedVertexIds.length >= 2 &&
        selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex)

    return (
        <div style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%) scale(0.86)',
            transformOrigin: 'top center',
            backgroundColor: 'rgba(40, 40, 40, 0.9)',
            padding: '6px 12px',
            borderRadius: '7px',
            display: 'flex',
            gap: '12px',
            boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
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
                        <Tooltip title="一键智能分层">
                            <Button
                                icon={<ApartmentOutlined />}
                                onClick={onAutoSeparateLayers}
                            />
                        </Tooltip>
                    </Space>
                    <div style={dividerStyle} />
                    <Space>
                        {/* Vertex Operations - always visible in geometry mode */}
                        <Tooltip title={pasteCreatesNewGeoset ? '复制后新建多边形组' : '复制后合并到原多边形组'}>
                            <Button
                                type={pasteCreatesNewGeoset ? 'primary' : 'default'}
                                icon={pasteCreatesNewGeoset ? <CopyOutlined /> : <ImportOutlined />}
                                onClick={() => setPasteCreatesNewGeoset(!pasteCreatesNewGeoset)}
                            />
                        </Tooltip>
                        <Tooltip title="分离 - 将选中顶点及其面分离为新多边形组">
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
                    <div style={dividerStyle} />
                </>
            )}
            {mainMode === 'animation' && (
                <>
                    <Space>
                        <Tooltip title="骨骼绑定模式 (静止姿态)">
                            <Button
                                type={animationSubMode === 'binding' ? 'primary' : 'default'}
                                 onClick={() => {
                                    setAnimationSubMode('binding')
                                    setGeometrySubMode('vertex')
                                    useSelectionStore.getState().clearFaceSelection()
                                    setGizmoOrientation('world')
                                }}
                            >
                                绑定
                            </Button>
                        </Tooltip>
                        <Tooltip title="关键帧模式 (动画播放)">
                            <Button
                                type={animationSubMode === 'keyframe' ? 'primary' : 'default'}
                                 onClick={() => {
                                    const wasKeyframe = animationSubMode === 'keyframe'
                                    setAnimationSubMode('keyframe')
                                    if (!wasKeyframe) {
                                        resetTimelineToCurrentSequenceStart()
                                    }
                                }}
                            >
                                关键帧
                            </Button>
                        </Tooltip>
                    </Space>
                    <div style={dividerStyle} />

                    {animationSubMode === 'binding' && (
                        <>
                            <Space>
                                <Tooltip title="点模式">
                                    <Button
                                        type={geometrySubMode === 'vertex' ? 'primary' : 'default'}
                                        icon={<GatewayOutlined />}
                                        onClick={() => {
                                            setGeometrySubMode('vertex')
                                            useSelectionStore.getState().clearFaceSelection()
                                        }}
                                    />
                                </Tooltip>
                                <Tooltip title="组模式 (选择整个闭合连通顶点组)">
                                    <Button
                                        type={geometrySubMode === 'group' ? 'primary' : 'default'}
                                        icon={<GroupOutlined />}
                                        onClick={() => {
                                            setGeometrySubMode('group')
                                            if (selectedVertexIds.length > 0) {
                                                useSelectionStore.getState().selectFaces(deriveFaceSelectionFromVertices(selectedVertexIds))
                                            }
                                        }}
                                    />
                                </Tooltip>
                                <Tooltip title="扩选 (增加当前选择周围一圈顶点)">
                                    <Button
                                        icon={<PlusOutlined style={{ color: selectedVertexIds.length === 0 ? '#8c8c8c' : undefined }} />}
                                        onClick={handleExpandVertexSelection}
                                        disabled={selectedVertexIds.length === 0}
                                        style={selectedVertexIds.length === 0 ? { opacity: 1, borderColor: '#4b4b4b', color: '#8c8c8c' } : undefined}
                                    />
                                </Tooltip>
                                <Tooltip title="缩选 (去掉当前选择边界一圈顶点)">
                                    <Button
                                        icon={<MinusOutlined style={{ color: selectedVertexIds.length === 0 ? '#8c8c8c' : undefined }} />}
                                        onClick={handleShrinkVertexSelection}
                                        disabled={selectedVertexIds.length === 0}
                                        style={selectedVertexIds.length === 0 ? { opacity: 1, borderColor: '#4b4b4b', color: '#8c8c8c' } : undefined}
                                    />
                                </Tooltip>
                            </Space>
                            <div style={dividerStyle} />
                            <Space>
                                <Tooltip title="创建骨骼 (无顶点: 原点 / 有顶点: 顶点中心)">
                                    <Button
                                        icon={getNodeIcon(NodeType.BONE)}
                                        onClick={handleCreateBone}
                                    />
                                </Tooltip>
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
                            <div style={dividerStyle} />
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

            {shouldShowOrientationButtons && (
                <>
                    <div style={dividerStyle} />
                    <Space size={4}>
                        <Tooltip title={'世界坐标朝向'}>
                            <Button
                                type={gizmoOrientation === 'world' ? 'primary' : 'default'}
                                icon={<GlobalOutlined />}
                                onClick={() => setGizmoOrientation('world')}
                            />
                        </Tooltip>
                        <Tooltip title={'镜头朝向'}>
                            <Button
                                type={gizmoOrientation === 'camera' ? 'primary' : 'default'}
                                icon={<CameraOutlined />}
                                onClick={() => setGizmoOrientation('camera')}
                            />
                        </Tooltip>
                    </Space>
                </>
            )}
            <div style={dividerStyle} />
            <Space size={10}>
                <div style={snapStackStyle}>
                    <Tooltip title={'距离捕捉'}>
                        <Button
                            type={snapTranslateEnabled ? 'primary' : 'default'}
                            onClick={() => setSnapTranslateEnabled(!snapTranslateEnabled)}
                            style={snapButtonStyle}
                         icon={<DragOutlined />} />
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
                    <Tooltip title={'角度捕捉'}>
                        <Button
                            type={snapRotateEnabled ? 'primary' : 'default'}
                            onClick={() => setSnapRotateEnabled(!snapRotateEnabled)}
                            style={snapButtonStyle}
                         icon={<RedoOutlined />} />
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
                    <div style={dividerStyle} />
                    <Space>
                        <Tooltip title="全局变换模式 (可以直接修改模型默认位置大小和旋转)">
                            <Button
                                type={isGlobalTransformMode ? 'primary' : 'default'}
                                icon={<GlobalOutlined />}
                                onClick={() => {
                                    useSelectionStore.getState().setGlobalTransformPivot('modelCenter')
                                    setIsGlobalTransformMode(!isGlobalTransformMode)
                                }}
                                style={isGlobalTransformMode ? { backgroundColor: '#52c41a', borderColor: '#52c41a' } : undefined}
                            >
                                全局变换
                            </Button>
                        </Tooltip>
                    </Space>
                    <div style={dividerStyle} />
                </>
            )}

            <Space>
                <Tooltip title="适应视图 (Z)">
                    <Button
                        icon={<FullscreenOutlined />}
                        onClick={onFitToView}
                    />
                </Tooltip>
            </Space>
        </div>
    );
};





