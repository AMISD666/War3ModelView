import { appMessage } from '../../store/messageStore'

/**
 * 节点管理器窗口组件
 */

import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Tree, Input, Menu } from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    SearchOutlined,
    BulbOutlined,
    FireOutlined,
    SoundOutlined,
    BlockOutlined
} from '@ant-design/icons';

import type { TreeProps, MenuProps } from 'antd';
import { useModelStore } from '../../store/modelStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useUIStore } from '../../store/uiStore';
import { useRendererStore } from '../../store/rendererStore';
import { NodeType, type TreeNode } from '../../types/node';
import { buildTreeData, filterTreeNodes, getExpandedKeys, getAncestorKeys } from '../../utils/treeUtils';
import { canDeleteNode, getNodeIcon, getNodeTypeName, isNodeManagerType } from '../../utils/nodeUtils';
import { createParticleEmitter2FromPreset, listParticleEmitter2Presets, ParticleEmitter2PresetSummary } from '../../services/particleEmitter2PresetService';
import { openNodeEditor } from '../../utils/nodeEditorOpen';
import { registerNodeManagerDeleteKeyListener } from '../../utils/nodeManagerShortcutBridge';
import {
    consumeNodeManagerListScrollRequest,
    markNodeManagerListScrollFromTree,
    shouldScrollNodeManagerToSelection,
} from '../../utils/nodeManagerListScrollBridge';
import { isTextInputActive } from '../../shortcuts/utils';
import { NodeTreeTitle } from './node-manager/NodeTreeTitle';
import {
    collectDescendantKeys,
    collectTreeKeys,
    findTreeNode
} from './node-manager/treeHelpers';
import {
    contextMenuPopoverStyle,
    contextMenuStyle,
    emptyTreeStyle,
    getTreeWrapperStyle,
    NODE_MANAGER_STYLE,
    rootStyle,
    searchStyle
} from './node-manager/styles';

const { Search } = Input;

export const NodeManagerWindow: React.FC = () => {
    const nodes = useModelStore(state => state.nodes);
    const modelData = useModelStore(state => state.modelData);
    const deleteNode = useModelStore(state => state.deleteNode);
    const reparentNodes = useModelStore(state => state.reparentNodes);
    const setClipboardNode = useModelStore(state => state.setClipboardNode);
    const pasteNode = useModelStore(state => state.pasteNode);
    const clipboardNode = useModelStore(state => state.clipboardNode);
    const addNode = useModelStore(state => state.addNode);
    const updateNode = useModelStore(state => state.updateNode);
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds);
    const selectNode = useSelectionStore(state => state.selectNode);
    const clearNodeSelection = useSelectionStore(state => state.clearNodeSelection);
    const mainMode = useSelectionStore(state => state.mainMode);
    const setCreateNodeDialogVisible = useUIStore(state => state.setCreateNodeDialogVisible);
    const hiddenNodeIds = useRendererStore(state => state.hiddenNodeIds);
    const toggleNodeVisibility = useRendererStore(state => state.toggleNodeVisibility);
    const setHiddenNodeIds = useRendererStore(state => state.setHiddenNodeIds);

    const [searchText, setSearchText] = useState('');
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [autoExpandParent, setAutoExpandParent] = useState(true);
    const [treeViewportHeight, setTreeViewportHeight] = useState(0);
    const hasInitializedExpansionRef = useRef(false);
    const autoScrollTimerRef = useRef<number | null>(null);
    const autoScrollFrameRef = useRef<number | null>(null);

    const [particleEmitterPresets, setParticleEmitterPresets] = useState<ParticleEmitter2PresetSummary[]>([]);

    // Mouse-based Drag-Drop State (replaces HTML5 drag-drop to work with Tauri dragDropEnabled)
    const [draggedNodeId, setDraggedNodeId] = useState<number | null>(null);
    const [dropTargetNodeId, setDropTargetNodeId] = useState<number | null>(null);
    const [cutNodeId, setCutNodeId] = useState<number | null>(null); // For Cut/Paste functionality
    const [copiedPivotPoint, setCopiedPivotPoint] = useState<[number, number, number] | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [_dragPosition, setDragPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // Use refs to track state in event handlers (React state won't update in event listener closures)
    const draggedNodeIdRef = React.useRef<number | null>(null);
    const dropTargetNodeIdRef = React.useRef<number | null>(null);
    const isDraggingRef = React.useRef(false);

    // Ref for tree wrapper
    const treeWrapperRef = React.useRef<HTMLDivElement>(null);
    const treeRef = React.useRef<React.ElementRef<typeof Tree>>(null);
    /** 节点管理器根容器：用于 Del 快捷键仅在面板内生效 */
    const nodeManagerRootRef = React.useRef<HTMLDivElement>(null);

    // 右键菜单（需早于 handleDelete，以便删除时关闭菜单）
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [contextMenuNodeId, setContextMenuNodeId] = useState<number | null>(null);
    const contextMenuRef = React.useRef<HTMLDivElement>(null);

    // Keep refs in sync with state
    React.useEffect(() => {
        draggedNodeIdRef.current = draggedNodeId;
    }, [draggedNodeId]);

    React.useEffect(() => {
        isDraggingRef.current = isDragging;
    }, [isDragging]);

    // Note: Mouse-based drag-drop is handled entirely in onMouseDown closures
    // No need for global listeners since each drag operation has its own handlers

    // 构建树形数据（只显示节点管理器关心的节点类型）
    const nodeManagerNodes = useMemo(() => nodes.filter(n => isNodeManagerType(n.type)), [nodes]);
    const treeData = useMemo(() => buildTreeData(nodeManagerNodes), [nodeManagerNodes]);
    const hiddenNodeIdSet = useMemo(() => new Set(hiddenNodeIds), [hiddenNodeIds]);

    useEffect(() => {
        if (hiddenNodeIds.length === 0) return;
        const validNodeIds = new Set(nodeManagerNodes.map((node) => node.ObjectId));
        const nextHiddenNodeIds = hiddenNodeIds.filter((nodeId) => validNodeIds.has(nodeId));
        if (nextHiddenNodeIds.length !== hiddenNodeIds.length) {
            setHiddenNodeIds(nextHiddenNodeIds);
        }
    }, [hiddenNodeIds, nodeManagerNodes, setHiddenNodeIds]);

    // 过滤树节点
    const filteredTreeData = useMemo(() => {
        if (!searchText) return treeData;
        return filterTreeNodes(treeData, searchText);
    }, [treeData, searchText]);

    // Auto-expand all nodes when model is loaded
    useEffect(() => {
        if (nodeManagerNodes.length === 0) {
            hasInitializedExpansionRef.current = false;
            if (expandedKeys.length > 0) {
                setExpandedKeys([]);
            }
            return;
        }

        if (!hasInitializedExpansionRef.current && expandedKeys.length === 0) {
            setExpandedKeys(collectTreeKeys(treeData));
            hasInitializedExpansionRef.current = true;
        }
    }, [expandedKeys.length, nodeManagerNodes.length, treeData]);

    useEffect(() => {
        if (treeData.length === 0) return;
        const validKeys = new Set(collectTreeKeys(treeData));
        setExpandedKeys((prev) => {
            const next = prev.filter((key) => validKeys.has(String(key)));
            return next.length === prev.length ? prev : next;
        });
    }, [treeData]);

    // 搜索时自动展开
    useEffect(() => {
        if (searchText) {
            const keys = getExpandedKeys(treeData, searchText);
            setExpandedKeys(keys);
            setAutoExpandParent(true);
        }
    }, [searchText, treeData]);

    /** 选中后让树区域获得焦点，便于 activeElement 落在管理器内、Delete 可被识别 */
    useLayoutEffect(() => {
        const wrapper = treeWrapperRef.current;
        if (!wrapper) return;

        const updateTreeViewportHeight = () => {
            const styles = window.getComputedStyle(wrapper);
            const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
            const nextHeight = Math.max(0, Math.floor(wrapper.clientHeight - verticalPadding));
            setTreeViewportHeight((prevHeight) => (prevHeight === nextHeight ? prevHeight : nextHeight));
        };

        updateTreeViewportHeight();

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateTreeViewportHeight)
            : null;
        resizeObserver?.observe(wrapper);
        window.addEventListener('resize', updateTreeViewportHeight);

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updateTreeViewportHeight);
        };
    }, []);

    const focusTreeSurface = useCallback(() => {
        requestAnimationFrame(() => {
            treeWrapperRef.current?.focus({ preventScroll: true });
        });
    }, []);

    const showOnlyNode = useCallback((nodeId: number) => {
        if (!Number.isInteger(nodeId) || nodeId < 0) return;
        setHiddenNodeIds(nodeManagerNodes
            .map((node) => node.ObjectId)
            .filter((id) => id !== nodeId));
    }, [nodeManagerNodes, setHiddenNodeIds]);

    const invertNodeVisibility = useCallback(() => {
        const hiddenSet = new Set(hiddenNodeIds);
        setHiddenNodeIds(nodeManagerNodes
            .map((node) => node.ObjectId)
            .filter((id) => !hiddenSet.has(id)));
    }, [hiddenNodeIds, nodeManagerNodes, setHiddenNodeIds]);

    const handleSelect: TreeProps['onSelect'] = (_selectedKeys, info) => {
        // 树内点击：禁止自动滚动列表（视口选中节点时由 Viewer 单独打开滚动）
        markNodeManagerListScrollFromTree();
        // Strictly control selection logic
        const nodeId = parseInt(info.node.key as string);
        const isMulti = info.nativeEvent.ctrlKey || info.nativeEvent.metaKey;

        if (isMulti) {
            // Ctrl+Click: Toggle
            selectNode(nodeId, true);
        } else {
            // Click: Replace selection (Single Select)
            selectNode(nodeId, false);
        }
        focusTreeSurface();
    };

    const handleExpand: TreeProps['onExpand'] = (expandedKeysValue, info) => {
        const nextExpandedKeys = expandedKeysValue.map(String);
        if (!info.expanded && nextExpandedKeys.length > 300) {
            const descendantKeys = new Set(collectDescendantKeys(info.node as unknown as TreeNode));
            setExpandedKeys(nextExpandedKeys.filter((key) => !descendantKeys.has(key)));
        } else {
            setExpandedKeys(nextExpandedKeys);
        }
        setAutoExpandParent(false);
    };

    const handleCreate = () => {
        setCreateNodeDialogVisible(true);
    };

    const refreshParticleEmitterPresets = useCallback(async () => {
        try {
            const presets = await listParticleEmitter2Presets();
            setParticleEmitterPresets(presets);
        } catch {
            setParticleEmitterPresets([]);
        }
    }, []);

    const handleCreateParticlePresetNode = useCallback(async (presetId: string, parentId: number) => {
        try {
            const { nodeName } = await createParticleEmitter2FromPreset({ presetId, parentId });
            appMessage.success('\u5df2\u521b\u5efa\u7c92\u5b50\u9884\u8bbe\u8282\u70b9: ' + nodeName);
        } catch (error: any) {
            appMessage.error(error?.message || '使用粒子预设失败');
        }
    }, []);

    const getParticlePresetMenuItems = useCallback((parentId: number): MenuProps['items'] => {
        if (particleEmitterPresets.length === 0) {
            return [{ key: `particle_preset_empty_${parentId}`, label: '暂无预设', disabled: true }];
        }

        return particleEmitterPresets.map((preset) => ({
            key: `particle_preset_${parentId}_${preset.id}`,
            label: preset.name,
            onClick: () => {
                void handleCreateParticlePresetNode(preset.id, parentId);
            }
        }));
    }, [handleCreateParticlePresetNode, particleEmitterPresets]);

    const handleEdit = () => {
        if (selectedNodeIds.length === 0) {
            appMessage.warning('请先选择一个节点');
            return;
        }
        if (selectedNodeIds.length > 1) {
            appMessage.warning('只能编辑一个节点');
            return;
        }
        void openNodeEditor('genericNode', selectedNodeIds[0]);
    };

    const handleDelete = useCallback((nodeId?: number) => {
        setContextMenuVisible(false);
        const targetId = nodeId ?? (selectedNodeIds.length > 0 ? selectedNodeIds[0] : null);
        if (targetId === null) {
            appMessage.warning('请先选择要删除的节点');
            return;
        }
        const checkResult = canDeleteNode(targetId, nodes, modelData?.Geosets);
        if (!checkResult.canDelete) {
            appMessage.error(checkResult.reason);
            return;
        }
        deleteNode(targetId);
        clearNodeSelection();
        appMessage.success('节点已删除');
    }, [selectedNodeIds, nodes, modelData?.Geosets, deleteNode, clearNodeSelection]);

    // Delete：经 nodeManagerShortcutBridge 在全局快捷键之前消费，避免与时间轴/几何抢键
    useEffect(() => {
        return registerNodeManagerDeleteKeyListener((e) => {
            if (e.key !== 'Delete' && e.code !== 'Delete') return false;
            if (e.repeat) return false;
            if (isTextInputActive()) return false;
            const active = document.activeElement;
            if (active instanceof HTMLSelectElement) return false;
            const root = nodeManagerRootRef.current;
            if (!root || !active || !root.contains(active)) return false;
            handleDelete();
            return true;
        });
    }, [handleDelete]);

    // Verify environment drag support
    // Drag diagnostics removed as per user request
    // useEffect(() => {
    //     const handleDragOver = (e: DragEvent) => {
    //         e.preventDefault();
    //         if (e.dataTransfer) {
    //             e.dataTransfer.dropEffect = 'move';
    //         }
    //     };
    //     const handleDrop = (e: DragEvent) => {
    //         console.log('Global drop:', e.target);
    //     };

    //     window.addEventListener('dragover', handleDragOver, true);
    //     window.addEventListener('drop', handleDrop, true);
    //     return () => {
    //         window.removeEventListener('dragover', handleDragOver, true);
    //         window.removeEventListener('drop', handleDrop, true);
    //     };
    // }, []);

    // Note: Native Tree drag-drop is disabled due to environment issues.
    // Manual drag-drop is implemented in titleRender instead.

    const nodeMenuLabel = (type: NodeType, text: string) => (
        <span className="node-manager-menuitem-label">
            <span className="node-manager-menuitem-icon">{getNodeIcon(type)}</span>
            <span className="node-manager-menuitem-text">{text}</span>
        </span>
    );

    const getNodePivotPoint = (nodeId: number): [number, number, number] | null => {
        const sourceNode = nodes.find((candidate) => candidate.ObjectId === nodeId);
        const pivot = sourceNode?.PivotPoint ?? (modelData as any)?.PivotPoints?.[nodeId];
        if (!pivot || typeof pivot.length !== 'number' || pivot.length < 3) return null;

        const nextPivot: [number, number, number] = [
            Number(pivot[0] ?? 0),
            Number(pivot[1] ?? 0),
            Number(pivot[2] ?? 0)
        ];

        return nextPivot.every(Number.isFinite) ? nextPivot : null;
    };

    const handlePasteNode = useCallback(async (parentId: number, successMessage: string) => {
        try {
            const result = await pasteNode(parentId);
            if (!result.pasted) return;

            if (result.failed.length > 0) {
                appMessage.warning(`${successMessage}，但有 ${result.failed.length} 个贴图复制失败`);
                console.warn('[NodeManagerWindow] Failed to copy pasted node assets:', result.failed);
                return;
            }

            appMessage.success(result.copiedCount > 0
                ? `${successMessage}，已复制 ${result.copiedCount} 个贴图`
                : successMessage);
        } catch (error: any) {
            appMessage.error(error?.message || '粘贴节点失败');
        }
    }, [pasteNode]);

    const getContextMenuItems = (nodeId: number): MenuProps['items'] => {
        // Special handling for virtual root node (-1)
        if (nodeId === -1) {
            const items: MenuProps['items'] = [
                {
                    key: 'add_child',
                    label: '新建子节点',
                    icon: <PlusOutlined />,
                    popupClassName: 'node-manager-context-submenu',
                    children: [
                        {
                            key: 'add_bone',
                            label: nodeMenuLabel(NodeType.BONE, '骨骼 (Bone)'),
                            onClick: () => {
                                addNode({ type: NodeType.BONE, Name: 'New Bone', Parent: -1 });
                                appMessage.success('已在根节点下创建骨骼');
                            }
                        },
                        {
                            key: 'add_helper',
                            label: nodeMenuLabel(NodeType.HELPER, '辅助器 (Helper)'),
                            onClick: () => {
                                addNode({ type: NodeType.HELPER, Name: 'New Helper', Parent: -1 });
                                appMessage.success('已在根节点下创建辅助器');
                            }
                        },
                        {
                            key: 'add_attachment',
                            label: nodeMenuLabel(NodeType.ATTACHMENT, '挂接点 (Attachment)'),
                            onClick: () => {
                                addNode({ type: NodeType.ATTACHMENT, Name: 'New Attachment', Parent: -1 });
                                appMessage.success('已在根节点下创建挂接点');
                            }
                        },                        {
                            key: 'add_particle1',
                            label: nodeMenuLabel(NodeType.PARTICLE_EMITTER, '粒子发射器1'),
                            onClick: () => {
                                addNode({ type: NodeType.PARTICLE_EMITTER, Name: 'New Particle', Parent: -1 });
                                appMessage.success('已创建粒子发射器1');
                            }
                        },
                        {
                            key: 'add_particle2',
                            label: nodeMenuLabel(NodeType.PARTICLE_EMITTER_2, '粒子发射器2 (ParticleEmitter2)'),
                            onClick: () => {
                                addNode({ type: NodeType.PARTICLE_EMITTER_2, Name: 'New Particle', Parent: -1 });
                                appMessage.success('已在根节点下创建粒子发射器');
                            }
                        },
                        {
                            key: 'add_ribbon',
                            label: nodeMenuLabel(NodeType.RIBBON_EMITTER, getNodeTypeName(NodeType.RIBBON_EMITTER)),
                            onClick: () => {
                                addNode({ type: NodeType.RIBBON_EMITTER, Name: 'New Ribbon', Parent: -1 });
                                appMessage.success('已创建丝带发射器节点');
                            }
                        },
                        {
                            key: 'add_light',
                            label: nodeMenuLabel(NodeType.LIGHT, '灯光 (Light)'),
                            onClick: () => {
                                addNode({ type: NodeType.LIGHT, Name: 'New Light', Parent: -1 });
                                appMessage.success('已在根节点下创建灯光');
                            }
                        },
                        {
                            key: 'add_event',
                            label: nodeMenuLabel(NodeType.EVENT_OBJECT, getNodeTypeName(NodeType.EVENT_OBJECT)),
                            onClick: () => {
                                addNode({ type: NodeType.EVENT_OBJECT, Name: 'New Event', Parent: -1 });
                                appMessage.success('已创建事件对象节点');
                            }
                        },
                        {
                            key: 'add_collision',
                            label: nodeMenuLabel(NodeType.COLLISION_SHAPE, getNodeTypeName(NodeType.COLLISION_SHAPE)),
                            onClick: () => {
                                addNode({ type: NodeType.COLLISION_SHAPE, Name: 'New Collision', Parent: -1 });
                                appMessage.success('已创建碰撞形状节点');
                            }
                        },
                    ]
                },
                {
                    key: 'use_particle_preset_root',
                    label: '\u4f7f\u7528\u9884\u8bbe',
                    icon: <FireOutlined />,
                    popupClassName: 'node-manager-context-submenu',
                    children: getParticlePresetMenuItems(-1)
                },
                { type: 'divider' },
                {
                    key: 'paste',
                    label: '粘贴节点',
                    disabled: !clipboardNode,
                    onClick: () => {
                        void handlePasteNode(-1, '节点已粘贴到根节点');
                    }
                },
                {
                    key: 'moveHere',
                    label: '移动到此处(作为根节点)',
                    disabled: cutNodeId === null,
                    onClick: () => {
                        if (cutNodeId !== null) {
                            reparentNodes([cutNodeId], -1);
                            appMessage.success('节点已移动到根节点');
                            setCutNodeId(null);
                        }
                    }
                }
            ];
            return items;
        }

        const node = nodes.find(n => n.ObjectId === nodeId);
        if (!node) return [];

        const deleteCheck = canDeleteNode(nodeId, nodes, modelData?.Geosets);
        const nodePivotPoint = getNodePivotPoint(nodeId);

        const items: MenuProps['items'] = [
            {
                key: 'edit',
                label: '编辑节点',
                icon: <EditOutlined />,
                onClick: () => {
                    void openNodeEditor('genericNode', nodeId);
                }
            }
        ];

        if (node.type === NodeType.PARTICLE_EMITTER_2) {
            items.push({
                key: 'edit_particle',
                label: '编辑粒子系统',
                icon: <FireOutlined />,
                onClick: () => void openNodeEditor('particleEmitter2', nodeId)
            });
        } else if (node.type === NodeType.RIBBON_EMITTER) {
            items.push({
                key: 'edit_ribbon',
                label: '编辑丝带',
                icon: <FireOutlined />,
                onClick: () => void openNodeEditor('ribbonEmitter', nodeId)
            });
        } else if (node.type === NodeType.PARTICLE_EMITTER) {
            items.push({
                key: 'edit_particle_1',
                label: '编辑粒子系统',
                icon: <FireOutlined />,
                onClick: () => void openNodeEditor('particleEmitter', nodeId)
            });
        } else if (node.type === NodeType.COLLISION_SHAPE) {
            items.push({
                key: 'edit_collision',
                label: '编辑碰撞形状',
                icon: <BlockOutlined />,
                onClick: () => void openNodeEditor('collisionShape', nodeId)
            });
        } else if (node.type === NodeType.LIGHT) {
            items.push({
                key: 'edit_light',
                label: '编辑灯光',
                icon: <BulbOutlined />,
                onClick: () => void openNodeEditor('light', nodeId)
            });
        } else if (node.type === NodeType.EVENT_OBJECT) {
            items.push({
                key: 'edit_event',
                label: '编辑事件对象',
                icon: <SoundOutlined />,
                onClick: () => void openNodeEditor('eventObject', nodeId)
            });
        }

        items.push(
            {
                key: 'expandAll',
                label: '展开所有',
                onClick: () => {
                    const treeNode = findTreeNode(treeData, nodeId);
                    if (treeNode) {
                        const newKeys = [...expandedKeys, String(treeNode.key), ...collectDescendantKeys(treeNode)];
                        setExpandedKeys(Array.from(new Set(newKeys)));
                    }
                }
            },
            { type: 'divider' },
            {
                key: 'copy',
                label: '复制节点',
                onClick: () => {
                    setClipboardNode(node);
                    setCutNodeId(null); // Clear cut state
                    appMessage.success('节点已复制');
                }
            },
            {
                key: 'copyPivotPoint',
                label: '复制质心点位置',
                disabled: !nodePivotPoint,
                onClick: () => {
                    if (!nodePivotPoint) {
                        appMessage.warning('当前节点没有可复制的质心点位置');
                        return;
                    }
                    setCopiedPivotPoint([...nodePivotPoint]);
                    appMessage.success('已复制质心点位置');
                }
            },
            {
                key: 'pastePivotPoint',
                label: '粘贴质心点位置',
                disabled: !copiedPivotPoint,
                onClick: () => {
                    if (!copiedPivotPoint) {
                        appMessage.warning('请先复制一个质心点位置');
                        return;
                    }
                    updateNode(nodeId, { PivotPoint: [...copiedPivotPoint] });
                    appMessage.success('已粘贴质心点位置');
                }
            },
            {
                key: 'cut',
                label: '剪切节点',
                onClick: () => {
                    setCutNodeId(nodeId);
                    setClipboardNode(null); // Clear copy state
                    appMessage.success('节点已剪切，请选择目标节点后右键粘贴');
                }
            },
            {
                key: 'paste',
                label: '粘贴节点',
                disabled: !clipboardNode,
                onClick: () => {
                    void handlePasteNode(nodeId, '节点已粘贴').then(() => {
                        setExpandedKeys(collectTreeKeys(treeData));
                    });
                }
            },
            {
                key: 'moveHere',
                label: '移动到此处(作为子节点)',
                disabled: cutNodeId === null || cutNodeId === nodeId,
                onClick: () => {
                    if (cutNodeId !== null) {
                        reparentNodes([cutNodeId], nodeId);
                        appMessage.success('节点已移动');
                        setCutNodeId(null);
                    }
                }
            },
            { type: 'divider' },
            {
                key: 'create',
                label: '添加节点',
                icon: <PlusOutlined />,
                popupClassName: 'node-manager-context-submenu',
                children: [
                    {
                        key: 'create_dialog',
                        label: '打开创建对话框...',
                        onClick: () => setCreateNodeDialogVisible(true)
                    },
                    {
                        key: 'create_bone',
                        label: nodeMenuLabel(NodeType.BONE, '骨骼 (Bone)'),
                        onClick: () => {
                            addNode({ type: NodeType.BONE, Name: 'New Bone', Parent: nodeId });
                            appMessage.success('已创建骨骼节点');
                        }
                    },
                    {
                        key: 'create_helper',
                        label: nodeMenuLabel(NodeType.HELPER, '辅助体 (Helper)'),
                        onClick: () => {
                            addNode({ type: NodeType.HELPER, Name: 'New Helper', Parent: nodeId });
                            appMessage.success('已创建辅助体节点');
                        }
                    },
                    {
                        key: 'create_attachment',
                        label: nodeMenuLabel(NodeType.ATTACHMENT, '附件点 (Attachment)'),
                        onClick: () => {
                            addNode({ type: NodeType.ATTACHMENT, Name: 'New Attachment', Parent: nodeId });
                            appMessage.success('已创建附件点节点');
                        }
                    },
                    {
                        key: 'create_particle1',
                        label: nodeMenuLabel(NodeType.PARTICLE_EMITTER, '粒子发射器1'),
                        onClick: () => {
                            addNode({ type: NodeType.PARTICLE_EMITTER, Name: 'New Particle', Parent: nodeId });
                            appMessage.success('已创建粒子发射器1');
                        }
                    },
                    {
                        key: 'create_particle2',
                        label: nodeMenuLabel(NodeType.PARTICLE_EMITTER_2, '粒子发射器2 (ParticleEmitter2)'),
                        onClick: () => {
                            addNode({ type: NodeType.PARTICLE_EMITTER_2, Name: 'New Particle', Parent: nodeId });
                            appMessage.success('已创建粒子发射器2节点');
                        }
                    },
                    {
                        key: 'create_ribbon',
                        label: nodeMenuLabel(NodeType.RIBBON_EMITTER, '丝带发射器 (RibbonEmitter)'),
                        onClick: () => {
                            addNode({ type: NodeType.RIBBON_EMITTER, Name: 'New Ribbon', Parent: nodeId });
                            appMessage.success('已创建丝带发射器节点');
                        }
                    },
                    {
                        key: 'create_light',
                        label: nodeMenuLabel(NodeType.LIGHT, '灯光 (Light)'),
                        onClick: () => {
                            addNode({ type: NodeType.LIGHT, Name: 'New Light', Parent: nodeId });
                            appMessage.success('已创建灯光节点');
                        }
                    },
                    {
                        key: 'create_event',
                        label: nodeMenuLabel(NodeType.EVENT_OBJECT, '事件对象 (EventObject)'),
                        onClick: () => {
                            addNode({ type: NodeType.EVENT_OBJECT, Name: 'New Event', Parent: nodeId });
                            appMessage.success('已创建事件对象节点');
                        }
                    },
                    {
                        key: 'create_collision',
                        label: nodeMenuLabel(NodeType.COLLISION_SHAPE, '碰撞形状 (CollisionShape)'),
                        onClick: () => {
                            addNode({ type: NodeType.COLLISION_SHAPE, Name: 'New Collision', Parent: nodeId });
                            appMessage.success('已创建碰撞形状节点');
                        }
                    },
                ]
            },
            {
                key: 'create_particle_preset',
                label: '\u4f7f\u7528\u9884\u8bbe',
                icon: <FireOutlined />,
                popupClassName: 'node-manager-context-submenu',
                children: getParticlePresetMenuItems(nodeId)
            },
            {
                key: 'rename',
                label: '重命名',
                onClick: () => {
                    void openNodeEditor('rename', nodeId);
                }
            },
            {
                key: 'delete',
                label: '删除节点',
                danger: true,
                disabled: !deleteCheck.canDelete,
                onClick: () => handleDelete(nodeId)
            }
        );

        return items;
    };

    const handleRightClick: TreeProps['onRightClick'] = ({ event, node }) => {
        event.preventDefault();
        const nodeId = parseInt(node.key as string);
        setContextMenuNodeId(nodeId);

        // Auto-select the node on right click
        markNodeManagerListScrollFromTree();
        selectNode(nodeId);
        focusTreeSurface();

        const x = event.clientX;
        const y = event.clientY;
        setContextMenuPosition({ x, y });
        setContextMenuVisible(true);
    };

    // Close context menu on click elsewhere
    useEffect(() => {
        const handleClick = () => setContextMenuVisible(false);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    useEffect(() => {
        void refreshParticleEmitterPresets();
    }, [refreshParticleEmitterPresets]);

    useEffect(() => {
        if (!contextMenuVisible) return;
        void refreshParticleEmitterPresets();
    }, [contextMenuVisible, refreshParticleEmitterPresets]);

    const contextMenuItems = contextMenuNodeId === null ? [] : getContextMenuItems(contextMenuNodeId);

    useLayoutEffect(() => {
        if (!contextMenuVisible || !contextMenuRef.current) return;
        const rect = contextMenuRef.current.getBoundingClientRect();
        const padding = 8;
        let x = contextMenuPosition.x;
        let y = contextMenuPosition.y;
        if (x + rect.width > window.innerWidth - padding) {
            x = Math.max(padding, window.innerWidth - rect.width - padding);
        }
        if (y + rect.height > window.innerHeight - padding) {
            y = Math.max(padding, window.innerHeight - rect.height - padding);
        }
        if (x !== contextMenuPosition.x || y !== contextMenuPosition.y) {
            setContextMenuPosition({ x, y });
        }
    }, [contextMenuVisible, contextMenuItems, contextMenuPosition.x, contextMenuPosition.y]);

    const handleNodeDoubleClick = (node: any) => {
        markNodeManagerListScrollFromTree();
        // Open specialized editor based on node type
        switch (node.type) {
            case NodeType.PARTICLE_EMITTER:
                selectNode(node.ObjectId);
                void openNodeEditor('particleEmitter', node.ObjectId);
                break;
            case NodeType.PARTICLE_EMITTER_2:
                selectNode(node.ObjectId);
                void openNodeEditor('particleEmitter2', node.ObjectId);
                break;
            case NodeType.LIGHT:
                selectNode(node.ObjectId);
                void openNodeEditor('light', node.ObjectId);
                break;
            case NodeType.COLLISION_SHAPE:
                selectNode(node.ObjectId);
                void openNodeEditor('collisionShape', node.ObjectId);
                break;
            case NodeType.EVENT_OBJECT:
                selectNode(node.ObjectId);
                void openNodeEditor('eventObject', node.ObjectId);
                break;
            case NodeType.RIBBON_EMITTER:
                selectNode(node.ObjectId);
                void openNodeEditor('ribbonEmitter', node.ObjectId);
                break;
            default:
                void openNodeEditor('genericNode', node.ObjectId);
                break;
        }
    };

    const handleMoveNodes = useCallback((nodeId: number, targetId: number) => {
        const { selectedNodeIds } = useSelectionStore.getState();
        const { reparentNodes } = useModelStore.getState();
        let nodesToMove = [nodeId];
        if (selectedNodeIds.includes(nodeId)) {
            nodesToMove = [...selectedNodeIds];
        }
        reparentNodes(nodesToMove, targetId);
        appMessage.success(
            targetId === -1
                ? `已移动到根节点`
                : (nodesToMove.length > 1 ? `已移动 ${nodesToMove.length} 个节点` : '节点已移动')
        );
    }, []);

    useEffect(() => {
        if (selectedNodeIds.length !== 1) return;
        const targetId = selectedNodeIds[0];
        const ancestorKeys = getAncestorKeys(nodes, targetId);
        if (ancestorKeys.length > 0) {
            setExpandedKeys(prev => {
                const missingKeys = ancestorKeys.filter((key) => !prev.includes(key));
                return missingKeys.length > 0 ? [...prev, ...missingKeys] : prev;
            });
        }
    }, [selectedNodeIds, nodes]);

    useEffect(() => {
        if (mainMode !== 'animation' && mainMode !== 'view') return;
        if (selectedNodeIds.length === 0) return;
        if (!shouldScrollNodeManagerToSelection) return;
        const targetId = selectedNodeIds[0];
        const wrapper = treeWrapperRef.current;
        if (!wrapper) return;
        const ancestorKeys = getAncestorKeys(nodes, targetId);
        if (ancestorKeys.some((key) => !expandedKeys.includes(key))) return;

        if (autoScrollTimerRef.current !== null) {
            window.clearTimeout(autoScrollTimerRef.current);
        }
        if (autoScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(autoScrollFrameRef.current);
        }

        autoScrollTimerRef.current = window.setTimeout(() => {
            autoScrollTimerRef.current = null;
            if (treeViewportHeight > 0) {
                treeRef.current?.scrollTo({ key: String(targetId), align: 'auto' });
                consumeNodeManagerListScrollRequest();
                return;
            }

            const el = wrapper.querySelector(`[data-node-id="${targetId}"]`) as HTMLElement | null;
            if (!el) return;

            autoScrollFrameRef.current = window.requestAnimationFrame(() => {
                autoScrollFrameRef.current = null;
                const wrapperRect = wrapper.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const isVisible = elRect.top >= wrapperRect.top && elRect.bottom <= wrapperRect.bottom;
                if (!isVisible) {
                    el.scrollIntoView({ block: 'center', inline: 'nearest' });
                }
                consumeNodeManagerListScrollRequest();
            });
        }, 80);
        return () => {
            if (autoScrollTimerRef.current !== null) {
                window.clearTimeout(autoScrollTimerRef.current);
                autoScrollTimerRef.current = null;
            }
            if (autoScrollFrameRef.current !== null) {
                window.cancelAnimationFrame(autoScrollFrameRef.current);
                autoScrollFrameRef.current = null;
            }
        };
    }, [selectedNodeIds, mainMode, nodes, expandedKeys, treeViewportHeight]);

    return (
        <div
            ref={nodeManagerRootRef}
            style={rootStyle}
            onContextMenu={(e) => e.preventDefault()}
        >
            <style dangerouslySetInnerHTML={{
                __html: NODE_MANAGER_STYLE
            }} />
            <Search
                placeholder="搜索节点..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                prefix={<SearchOutlined />}
                size="small"
                style={searchStyle}
            />
            {/* Diagnostic Element Removed */}

            <div
                ref={treeWrapperRef}
                tabIndex={-1}
                className="node-manager-tree-wrapper"
                style={getTreeWrapperStyle(treeViewportHeight)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    const target = e.target as HTMLElement | null;
                    if (target && target.closest('.ant-tree-treenode')) return;
                    setContextMenuNodeId(-1);
                    setContextMenuPosition({ x: e.clientX, y: e.clientY });
                    setContextMenuVisible(true);
                }}
            >
                {treeData.length > 0 ? (
                    <Tree
                        ref={treeRef}
                        className="node-manager-tree"
                        multiple
                        treeData={filteredTreeData}
                        selectedKeys={selectedNodeIds.map(String)}
                        expandedKeys={expandedKeys}
                        autoExpandParent={autoExpandParent}
                        motion={null}
                        height={treeViewportHeight || undefined}
                        itemHeight={16}
                        virtual={treeViewportHeight > 0}
                        onSelect={handleSelect}
                        onExpand={handleExpand}
                        onRightClick={handleRightClick}
                        onDoubleClick={(_e, node) => handleNodeDoubleClick(node.data)}
                        showIcon
                        showLine
                        blockNode
                        titleRender={(nodeData: any) => (
                            <NodeTreeTitle
                                nodeData={nodeData}
                                draggedNodeId={draggedNodeId}
                                dropTargetNodeId={dropTargetNodeId}
                                cutNodeId={cutNodeId}
                                hiddenNodeIdSet={hiddenNodeIdSet}
                                isDragging={isDragging}
                                draggedNodeIdRef={draggedNodeIdRef}
                                dropTargetNodeIdRef={dropTargetNodeIdRef}
                                isDraggingRef={isDraggingRef}
                                setDraggedNodeId={setDraggedNodeId}
                                setDropTargetNodeId={setDropTargetNodeId}
                                setIsDragging={setIsDragging}
                                setDragPosition={setDragPosition}
                                onMoveNodes={handleMoveNodes}
                                toggleNodeVisibility={toggleNodeVisibility}
                                showOnlyNode={showOnlyNode}
                                invertNodeVisibility={invertNodeVisibility}
                                focusTreeSurface={focusTreeSurface}
                            />
                        )}
                    />
                ) : (
                    <div style={emptyTreeStyle}>暂无节点数据</div>
                )}
            </div>

            {/* Global Context Menu */}
            {
                contextMenuVisible && (
                    <div
                        ref={contextMenuRef}
                        className="node-manager-context-menu-popover"
                        style={contextMenuPopoverStyle(contextMenuPosition.x, contextMenuPosition.y)}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Menu
                            className="node-manager-context-menu"
                            items={contextMenuItems}
                            mode="vertical"
                            theme="dark"
                            selectable={false}
                            onClick={() => setContextMenuVisible(false)}
                            style={contextMenuStyle}
                        />
                    </div>
                )
            }

        </div >
    );
};
