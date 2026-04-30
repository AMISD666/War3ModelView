import { appMessage } from '../store/messageStore'
import React from 'react';
import { Space } from 'antd'
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
    FullscreenOutlined, // Fit to View
    SwapOutlined,
    VerticalAlignMiddleOutlined
} from '@ant-design/icons';

import { SelectionId, useSelectionStore } from '../store/selectionStore';
import { useModelStore } from '../store/modelStore';
import { useRendererStore } from '../store/rendererStore';
import { useCommandManager } from '../utils/CommandManager';
import { BindVerticesCommand } from '../commands/BindVerticesCommand';
import { MirrorModelCommand } from '../commands/MirrorModelCommand';
import { NodeType } from '../types/node';
import { getNodeIcon } from '../utils/nodeUtils';
import { markNodeManagerListScrollFromTree } from '../utils/nodeManagerListScrollBridge';
import { PositiveStepInput } from './common/PositiveStepInput';
import { ShortcutBindableButton } from './common/ShortcutBindableButton';
import { ShortcutTooltip as Tooltip } from './common/ShortcutTooltip';
import { registerShortcutHandler } from '../shortcuts/manager';

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
    const mainMode = useSelectionStore(state => state.mainMode);
    const geometrySubMode = useSelectionStore(state => state.geometrySubMode);
    const setGeometrySubMode = useSelectionStore(state => state.setGeometrySubMode);
    const animationSubMode = useSelectionStore(state => state.animationSubMode);
    const setAnimationSubMode = useSelectionStore(state => state.setAnimationSubMode);
    const transformMode = useSelectionStore(state => state.transformMode);
    const setTransformMode = useSelectionStore(state => state.setTransformMode);
    const selectedVertexIds = useSelectionStore(state => state.selectedVertexIds);
    const selectedFaceIds = useSelectionStore(state => state.selectedFaceIds);
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds);
    const isPickingParent = useSelectionStore(state => state.isPickingParent);
    const setIsPickingParent = useSelectionStore(state => state.setIsPickingParent);
    const isGlobalTransformMode = useSelectionStore(state => state.isGlobalTransformMode);
    const setIsGlobalTransformMode = useSelectionStore(state => state.setIsGlobalTransformMode);
    const globalTransformPivot = useSelectionStore(state => state.globalTransformPivot);
    const setGlobalTransformPivot = useSelectionStore(state => state.setGlobalTransformPivot);
    const _modelData = useModelStore(state => state.modelData);
    const sequences = useModelStore(state => state.sequences);
    const currentSequence = useModelStore(state => state.currentSequence);
    const setFrame = useModelStore(state => state.setFrame);
    const renderer = useRendererStore(state => state.renderer);
    const setShowSettingsPanel = useRendererStore(state => state.setShowSettingsPanel);
    const snapTranslateEnabled = useRendererStore(state => state.snapTranslateEnabled);
    const setSnapTranslateEnabled = useRendererStore(state => state.setSnapTranslateEnabled);
    const snapTranslateStep = useRendererStore(state => state.snapTranslateStep);
    const setSnapTranslateStep = useRendererStore(state => state.setSnapTranslateStep);
    const snapRotateEnabled = useRendererStore(state => state.snapRotateEnabled);
    const setSnapRotateEnabled = useRendererStore(state => state.setSnapRotateEnabled);
    const snapRotateStep = useRendererStore(state => state.snapRotateStep);
    const setSnapRotateStep = useRendererStore(state => state.setSnapRotateStep);
    const gizmoOrientation = useRendererStore(state => state.gizmoOrientation);
    const setGizmoOrientation = useRendererStore(state => state.setGizmoOrientation);
    const pasteCreatesNewGeoset = useRendererStore(state => state.pasteCreatesNewGeoset);
    const setPasteCreatesNewGeoset = useRendererStore(state => state.setPasteCreatesNewGeoset);
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
        const activeRenderer = renderer ?? useRendererStore.getState().renderer
        if (!activeRenderer || selectedNodeIds.length !== 1) {
            appMessage.warning('请先选择一个骨骼')
            return
        }
        if (selectedVertexIds.length === 0) {
            appMessage.warning('请先选择要绑定的顶点')
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
        const cmd = new BindVerticesCommand(activeRenderer, targets, boneId, 'bind')
        executeCommand(cmd)
        if (!cmd.hasChanges()) {
            appMessage.info('选中顶点已经绑定到该骨骼')
            return
        }
        appMessage.success(`已绑定 ${selectedVertexIds.length} 个顶点到骨骼 ${boneId}`)
    }

    const handleExclusiveBind = () => {
        const activeRenderer = renderer ?? useRendererStore.getState().renderer
        if (!activeRenderer || selectedNodeIds.length !== 1) {
            appMessage.warning('请先选择一个骨骼')
            return
        }
        if (selectedVertexIds.length === 0) {
            appMessage.warning('请先选择要绑定的顶点')
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
        const cmd = new BindVerticesCommand(activeRenderer, targets, boneId, 'exclusiveBind')
        executeCommand(cmd)
        if (!cmd.hasChanges()) {
            appMessage.info('选中顶点已经只绑定到该骨骼')
            return
        }
        appMessage.success(`已完全绑定 ${selectedVertexIds.length} 个顶点到骨骼 ${boneId}`)
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

        appMessage.success(selectedVertexIds.length > 0 ? '已在顶点中心创建骨骼' : '已在原点创建骨骼')
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
        const activeRenderer = renderer ?? useRendererStore.getState().renderer
        if (!activeRenderer || selectedNodeIds.length !== 1) {
            appMessage.warning('请先选择一个骨骼')
            return
        }
        if (selectedVertexIds.length === 0) {
            appMessage.warning('请先选择要解绑的顶点')
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
        const cmd = new BindVerticesCommand(activeRenderer, targets, boneId, 'unbind')
        executeCommand(cmd)
        if (!cmd.hasChanges()) {
            appMessage.info('选中顶点未绑定到该骨骼')
            return
        }
        appMessage.success(`已解绑 ${selectedVertexIds.length} 个顶点从骨骼 ${boneId}`)
    }

    const handleMirrorModel = (axis: 'y' | 'z') => {
        if (!_modelData) {
            appMessage.warning('当前没有可镜像的模型')
            return
        }

        executeCommand(new MirrorModelCommand(axis))
        appMessage.success(axis === 'y' ? '已执行左右镜像' : '已执行垂直镜像')
    }

    const activateAnimationBindingMode = () => {
        setAnimationSubMode('binding')
        setGeometrySubMode('vertex')
        useSelectionStore.getState().clearFaceSelection()
        setGizmoOrientation('world')
    }

    const activateAnimationKeyframeMode = () => {
        const wasKeyframe = useSelectionStore.getState().animationSubMode === 'keyframe'
        setAnimationSubMode('keyframe')
        if (!wasKeyframe) {
            resetTimelineToCurrentSequenceStart()
        }
    }

    const activateBindingVertexMode = () => {
        setGeometrySubMode('vertex')
        useSelectionStore.getState().clearFaceSelection()
    }

    const activateBindingGroupMode = () => {
        const state = useSelectionStore.getState()
        setGeometrySubMode('group')
        if (state.selectedVertexIds.length > 0) {
            state.selectFaces(deriveFaceSelectionFromVertices(state.selectedVertexIds))
        }
    }

    const toggleGlobalTransformMode = () => {
        useSelectionStore.getState().setGlobalTransformPivot('modelCenter')
        setIsGlobalTransformMode(!useSelectionStore.getState().isGlobalTransformMode)
    }

    // Check if selected vertices are all from the same geoset (required for weld)
    const canSplit = (
        (geometrySubMode === 'vertex' && selectedVertexIds.length >= 1) ||
        ((geometrySubMode === 'face' || geometrySubMode === 'group') && selectedFaceIds.length >= 1)
    )
    const canWeld = geometrySubMode === 'vertex' &&
        selectedVertexIds.length >= 2 &&
        selectedVertexIds.every(v => v.geosetIndex === selectedVertexIds[0]?.geosetIndex)

    React.useEffect(() => {
        const isGeometryMode = () => useSelectionStore.getState().mainMode === 'geometry'
        const isViewMode = () => useSelectionStore.getState().mainMode === 'view'
        const isNonUvMode = () => useSelectionStore.getState().mainMode !== 'uv'
        const isAnimationMode = () => useSelectionStore.getState().mainMode === 'animation'
        const isAnimationBinding = () => {
            const state = useSelectionStore.getState()
            return state.mainMode === 'animation' && state.animationSubMode === 'binding'
        }

        const unsubscribeHandlers = [
            registerShortcutHandler('geometry.modeVertex', () => { setGeometrySubMode('vertex'); return true }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.modeFace', () => { setGeometrySubMode('face'); return true }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.modeGroup', () => { setGeometrySubMode('group'); return true }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.recalculateNormals', () => { onRecalculateNormals?.(); return !!onRecalculateNormals }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.autoSeparateLayers', () => { onAutoSeparateLayers?.(); return !!onAutoSeparateLayers }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.togglePasteTarget', () => {
                const state = useRendererStore.getState()
                state.setPasteCreatesNewGeoset(!state.pasteCreatesNewGeoset)
                return true
            }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.splitVertices', () => {
                if (!canSplit) return false
                onSplitVertices?.()
                return !!onSplitVertices
            }, { isActive: isGeometryMode }),
            registerShortcutHandler('geometry.weldVertices', () => {
                if (!canWeld) return false
                onWeldVertices?.()
                return !!onWeldVertices
            }, { isActive: isGeometryMode }),
            registerShortcutHandler('animation.modeBinding', () => { activateAnimationBindingMode(); return true }, { isActive: isAnimationMode }),
            registerShortcutHandler('animation.modeKeyframe', () => { activateAnimationKeyframeMode(); return true }, { isActive: isAnimationMode }),
            registerShortcutHandler('animation.bindingVertexMode', () => { activateBindingVertexMode(); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.bindingGroupMode', () => { activateBindingGroupMode(); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.bindingExpandSelection', () => {
                if (useSelectionStore.getState().selectedVertexIds.length === 0) return false
                handleExpandVertexSelection()
                return true
            }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.bindingShrinkSelection', () => {
                if (useSelectionStore.getState().selectedVertexIds.length === 0) return false
                handleShrinkVertexSelection()
                return true
            }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.createBone', () => { handleCreateBone(); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.bindVertices', () => { handleBind(); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.exclusiveBindVertices', () => { handleExclusiveBind(); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.unbindVertices', () => { handleUnbind(); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('animation.pickParent', () => { setIsPickingParent(true); return true }, { isActive: isAnimationBinding }),
            registerShortcutHandler('view.gizmoOrientationWorld', () => { setGizmoOrientation('world'); return true }, { isActive: isNonUvMode }),
            registerShortcutHandler('view.gizmoOrientationCamera', () => { setGizmoOrientation('camera'); return true }, { isActive: isNonUvMode }),
            registerShortcutHandler('view.snapTranslateToggle', () => {
                const state = useRendererStore.getState()
                state.setSnapTranslateEnabled(!state.snapTranslateEnabled)
                return true
            }, { isActive: isNonUvMode }),
            registerShortcutHandler('view.snapRotateToggle', () => {
                const state = useRendererStore.getState()
                state.setSnapRotateEnabled(!state.snapRotateEnabled)
                return true
            }, { isActive: isNonUvMode }),
            registerShortcutHandler('view.globalTransformToggle', () => { toggleGlobalTransformMode(); return true }, { isActive: isViewMode }),
            registerShortcutHandler('view.mirrorHorizontal', () => { handleMirrorModel('y'); return true }, { isActive: isViewMode }),
            registerShortcutHandler('view.mirrorVertical', () => { handleMirrorModel('z'); return true }, { isActive: isViewMode }),
        ]

        return () => {
            unsubscribeHandlers.forEach((unsubscribe) => unsubscribe())
        }
    }, [
        canSplit,
        canWeld,
        onAutoSeparateLayers,
        onRecalculateNormals,
        onSplitVertices,
        onWeldVertices,
        pasteCreatesNewGeoset,
        selectedVertexIds,
        isGlobalTransformMode,
    ])

    if (mainMode === 'uv') return null;

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
                            <ShortcutBindableButton
                                shortcutActionId="geometry.modeVertex"
                                type={geometrySubMode === 'vertex' ? 'primary' : 'default'}
                                icon={<GatewayOutlined />}
                                onClick={() => setGeometrySubMode('vertex')}
                            />
                        </Tooltip>
                        <Tooltip title="面模式">
                            <ShortcutBindableButton
                                shortcutActionId="geometry.modeFace"
                                type={geometrySubMode === 'face' ? 'primary' : 'default'}
                                icon={<AppstoreOutlined />}
                                onClick={() => setGeometrySubMode('face')}
                            />
                        </Tooltip>
                        <Tooltip title="组模式 (选择相连元素)">
                            <ShortcutBindableButton
                                shortcutActionId="geometry.modeGroup"
                                type={geometrySubMode === 'group' ? 'primary' : 'default'}
                                icon={<GroupOutlined />}
                                onClick={() => setGeometrySubMode('group')}
                            />
                        </Tooltip>
                        <Tooltip title="重算法线">
                            <ShortcutBindableButton
                                shortcutActionId="geometry.recalculateNormals"
                                icon={<ThunderboltOutlined />}
                                onClick={onRecalculateNormals}
                            />
                        </Tooltip>
                        <Tooltip title="一键智能分层">
                            <ShortcutBindableButton
                                shortcutActionId="geometry.autoSeparateLayers"
                                icon={<ApartmentOutlined />}
                                onClick={onAutoSeparateLayers}
                            />
                        </Tooltip>
                    </Space>
                    <div style={dividerStyle} />
                    <Space>
                        {/* Vertex Operations - always visible in geometry mode */}
                        <Tooltip title={pasteCreatesNewGeoset ? '复制后新建多边形组' : '复制后合并到原多边形组'}>
                            <ShortcutBindableButton
                                shortcutActionId="geometry.togglePasteTarget"
                                type={pasteCreatesNewGeoset ? 'primary' : 'default'}
                                icon={pasteCreatesNewGeoset ? <CopyOutlined /> : <ImportOutlined />}
                                onClick={() => setPasteCreatesNewGeoset(!pasteCreatesNewGeoset)}
                            />
                        </Tooltip>
                        <Tooltip title="分离 - 将选中顶点及其面分离为新多边形组">
                            <ShortcutBindableButton
                                className="visible-disabled-icon-button"
                                shortcutActionId="geometry.splitVertices"
                                icon={<SplitCellsOutlined />}
                                onClick={onSplitVertices}
                                disabled={!canSplit}
                            />
                        </Tooltip>
                        <Tooltip title="焊接 - 将选中顶点合并到中心点">
                            <ShortcutBindableButton
                                className="visible-disabled-icon-button"
                                shortcutActionId="geometry.weldVertices"
                                icon={<MergeCellsOutlined />}
                                onClick={onWeldVertices}
                                disabled={!canWeld}
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
                            <ShortcutBindableButton
                                shortcutActionId="animation.modeBinding"
                                type={animationSubMode === 'binding' ? 'primary' : 'default'}
                                 onClick={() => {
                                    activateAnimationBindingMode()
                                }}
                            >
                                绑定
                            </ShortcutBindableButton>
                        </Tooltip>
                        <Tooltip title="关键帧模式 (动画播放)">
                            <ShortcutBindableButton
                                shortcutActionId="animation.modeKeyframe"
                                type={animationSubMode === 'keyframe' ? 'primary' : 'default'}
                                 onClick={() => {
                                    activateAnimationKeyframeMode()
                                }}
                            >
                                关键帧
                            </ShortcutBindableButton>
                        </Tooltip>
                    </Space>
                    <div style={dividerStyle} />

                    {animationSubMode === 'binding' && (
                        <>
                            <Space>
                                <Tooltip title="点模式">
                                    <ShortcutBindableButton
                                        shortcutActionId="animation.bindingVertexMode"
                                        type={geometrySubMode === 'vertex' ? 'primary' : 'default'}
                                        icon={<GatewayOutlined />}
                                        onClick={() => {
                                            activateBindingVertexMode()
                                        }}
                                    />
                                </Tooltip>
                                <Tooltip title="组模式 (选择整个闭合连通顶点组)">
                                    <ShortcutBindableButton
                                        shortcutActionId="animation.bindingGroupMode"
                                        type={geometrySubMode === 'group' ? 'primary' : 'default'}
                                        icon={<GroupOutlined />}
                                        onClick={() => {
                                            activateBindingGroupMode()
                                        }}
                                    />
                                </Tooltip>
                                <Tooltip title="扩选 (增加当前选择周围一圈顶点)">
                                    <ShortcutBindableButton
                                        shortcutActionId="animation.bindingExpandSelection"
                                        icon={<PlusOutlined style={{ color: selectedVertexIds.length === 0 ? '#8c8c8c' : undefined }} />}
                                        onClick={handleExpandVertexSelection}
                                        disabled={selectedVertexIds.length === 0}
                                        style={selectedVertexIds.length === 0 ? { opacity: 1, borderColor: '#4b4b4b', color: '#8c8c8c' } : undefined}
                                    />
                                </Tooltip>
                                <Tooltip title="缩选 (去掉当前选择边界一圈顶点)">
                                    <ShortcutBindableButton
                                        shortcutActionId="animation.bindingShrinkSelection"
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
                                    <ShortcutBindableButton
                                        shortcutActionId="animation.createBone"
                                        icon={getNodeIcon(NodeType.BONE)}
                                        onClick={handleCreateBone}
                                    />
                                </Tooltip>
                                <Tooltip title="绑定选中的顶点到选中的骨骼">
                                    <ShortcutBindableButton shortcutActionId="animation.bindVertices" icon={<LinkOutlined />} onClick={handleBind} />
                                </Tooltip>
                                <Tooltip title="完全绑定 - 清除选中顶点的其他骨骼绑定，只保留当前骨骼">
                                    <ShortcutBindableButton shortcutActionId="animation.exclusiveBindVertices" icon={<AimOutlined />} onClick={handleExclusiveBind} />
                                </Tooltip>
                                <Tooltip title="解除选中顶点的骨骼绑定">
                                    <ShortcutBindableButton shortcutActionId="animation.unbindVertices" icon={<DisconnectOutlined />} onClick={handleUnbind} />
                                </Tooltip>
                                <Tooltip title="修改选中骨骼的父节点">
                                    <ShortcutBindableButton
                                        shortcutActionId="animation.pickParent"
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
                    <ShortcutBindableButton
                        shortcutActionId="transform.translate"
                        type={transformMode === 'translate' ? 'primary' : 'default'}
                        icon={<DragOutlined />}
                        onClick={() => setTransformMode('translate')}
                    />
                </Tooltip>
                {!(mainMode === 'animation' && animationSubMode === 'binding') && (
                    <>
                        <Tooltip title="旋转 (E)">
                            <ShortcutBindableButton
                                shortcutActionId="transform.rotate"
                                type={transformMode === 'rotate' ? 'primary' : 'default'}
                                icon={<RedoOutlined />}
                                onClick={() => setTransformMode('rotate')}
                            />
                        </Tooltip>
                        <Tooltip title="缩放 (R)">
                            <ShortcutBindableButton
                                shortcutActionId="transform.scale"
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
                            <ShortcutBindableButton
                                shortcutActionId="view.gizmoOrientationWorld"
                                type={gizmoOrientation === 'world' ? 'primary' : 'default'}
                                icon={<GlobalOutlined />}
                                onClick={() => setGizmoOrientation('world')}
                            />
                        </Tooltip>
                        <Tooltip title={'镜头朝向'}>
                            <ShortcutBindableButton
                                shortcutActionId="view.gizmoOrientationCamera"
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
                        <ShortcutBindableButton
                            shortcutActionId="view.snapTranslateToggle"
                            type={snapTranslateEnabled ? 'primary' : 'default'}
                            onClick={() => setSnapTranslateEnabled(!snapTranslateEnabled)}
                            style={snapButtonStyle}
                         icon={<DragOutlined />} />
                    </Tooltip>
                    <PositiveStepInput
                        min={0.001}
                        step={0.1}
                        value={snapTranslateStep}
                        precision={3}
                        onCommit={setSnapTranslateStep}
                        style={snapInputFloatingStyle}
                    />
                </div>
                <div style={snapStackStyle}>
                    <Tooltip title={'角度捕捉'}>
                        <ShortcutBindableButton
                            shortcutActionId="view.snapRotateToggle"
                            type={snapRotateEnabled ? 'primary' : 'default'}
                            onClick={() => setSnapRotateEnabled(!snapRotateEnabled)}
                            style={snapButtonStyle}
                         icon={<RedoOutlined />} />
                    </Tooltip>
                    <PositiveStepInput
                        min={1}
                        step={1}
                        value={snapRotateStep}
                        precision={0}
                        onCommit={setSnapRotateStep}
                        style={snapInputFloatingStyle}
                    />
                </div>
            </Space>

            {mainMode === 'view' && (
                <>
                    <div style={dividerStyle} />
                    <Space>
                        <Tooltip title="全局变换模式 (可以直接修改模型默认位置大小和旋转)">
                            <ShortcutBindableButton
                                shortcutActionId="view.globalTransformToggle"
                                type={isGlobalTransformMode ? 'primary' : 'default'}
                                icon={<GlobalOutlined />}
                                onClick={() => {
                                    toggleGlobalTransformMode()
                                }}
                                style={isGlobalTransformMode ? { backgroundColor: '#52c41a', borderColor: '#52c41a' } : undefined}
                            >
                                全局变换
                            </ShortcutBindableButton>
                        </Tooltip>
                        <Tooltip title="左右镜像">
                            <ShortcutBindableButton
                                shortcutActionId="view.mirrorHorizontal"
                                icon={<SwapOutlined />}
                                onClick={() => handleMirrorModel('y')}
                            />
                        </Tooltip>
                        <Tooltip title="垂直镜像">
                            <ShortcutBindableButton
                                shortcutActionId="view.mirrorVertical"
                                icon={<VerticalAlignMiddleOutlined style={{ transform: 'rotate(90deg)' }} />}
                                onClick={() => handleMirrorModel('z')}
                            />
                        </Tooltip>
                    </Space>
                    <div style={dividerStyle} />
                </>
            )}

            <Space>
                <Tooltip title="适应视图 (Z)">
                    <ShortcutBindableButton
                        shortcutActionId="view.fitToView"
                        icon={<FullscreenOutlined />}
                        onClick={onFitToView}
                    />
                </Tooltip>
            </Space>
        </div>
    );
};
