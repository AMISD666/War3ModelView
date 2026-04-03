
/**
 * 节点管理器窗口组件
 */

import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Tree, Input, Space, Button, Tooltip, message, Menu } from 'antd';
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
import { NodeType } from '../../types/node';
import { buildTreeData, filterTreeNodes, getExpandedKeys, getAncestorKeys } from '../../utils/treeUtils';
import { canDeleteNode, getNodeIcon, getNodeTypeName, isNodeManagerType } from '../../utils/nodeUtils';
import { createParticleEmitter2FromPreset, listParticleEmitter2Presets, ParticleEmitter2PresetSummary } from '../../services/particleEmitter2PresetService';
import { openNodeEditor } from '../../utils/nodeEditorOpen';
import { registerNodeManagerDeleteKeyListener } from '../../utils/nodeManagerShortcutBridge';
import {
    markNodeManagerListScrollFromTree,
    shouldScrollNodeManagerToSelection,
} from '../../utils/nodeManagerListScrollBridge';
import { isTextInputActive } from '../../shortcuts/utils';

const { Search } = Input;

export const NodeManagerWindow: React.FC = () => {
    const { nodes, modelData, deleteNode, reparentNodes, setClipboardNode, pasteNode, clipboardNode, addNode } = useModelStore();
    const { selectedNodeIds, selectNode, clearNodeSelection, mainMode } = useSelectionStore();
    const { setCreateNodeDialogVisible } = useUIStore();

    const [searchText, setSearchText] = useState('');
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [autoExpandParent, setAutoExpandParent] = useState(true);
    const hasInitializedExpansionRef = useRef(false);

    // Track Ctrl key state for drag operations
    const ctrlKeyPressedRef = React.useRef(false);

    // Listen for keyboard events to track Ctrl key
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') {
                ctrlKeyPressedRef.current = true;
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') {
                ctrlKeyPressedRef.current = false;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const [particleEmitterPresets, setParticleEmitterPresets] = useState<ParticleEmitter2PresetSummary[]>([]);

    // Mouse-based Drag-Drop State (replaces HTML5 drag-drop to work with Tauri dragDropEnabled)
    const [draggedNodeId, setDraggedNodeId] = useState<number | null>(null);
    const [dropTargetNodeId, setDropTargetNodeId] = useState<number | null>(null);
    const [cutNodeId, setCutNodeId] = useState<number | null>(null); // For Cut/Paste functionality
    const [isDragging, setIsDragging] = useState(false);
    const [_dragPosition, setDragPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // Use refs to track state in event handlers (React state won't update in event listener closures)
    const draggedNodeIdRef = React.useRef<number | null>(null);
    const dropTargetNodeIdRef = React.useRef<number | null>(null);
    const isDraggingRef = React.useRef(false);

    // Ref for tree wrapper
    const treeWrapperRef = React.useRef<HTMLDivElement>(null);
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

    const collectTreeKeys = useCallback((data: any[]): string[] => {
        const keys: string[] = [];
        const walk = (items: any[]) => {
            items.forEach((item) => {
                keys.push(String(item.key));
                if (item.children && item.children.length > 0) {
                    walk(item.children);
                }
            });
        };
        walk(data);
        return keys;
    }, []);

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
    }, [collectTreeKeys, expandedKeys.length, nodeManagerNodes.length, treeData]);

    useEffect(() => {
        if (treeData.length === 0) return;
        const validKeys = new Set(collectTreeKeys(treeData));
        setExpandedKeys((prev) => {
            const next = prev.filter((key) => validKeys.has(String(key)));
            return next.length === prev.length ? prev : next;
        });
    }, [collectTreeKeys, treeData]);

    // 搜索时自动展开
    useEffect(() => {
        if (searchText) {
            const keys = getExpandedKeys(treeData, searchText);
            setExpandedKeys(keys);
            setAutoExpandParent(true);
        }
    }, [searchText, treeData]);

    /** 选中后让树区域获得焦点，便于 activeElement 落在管理器内、Delete 可被识别 */
    const focusTreeSurface = useCallback(() => {
        requestAnimationFrame(() => {
            treeWrapperRef.current?.focus({ preventScroll: true });
        });
    }, []);

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

    const handleExpand: TreeProps['onExpand'] = (expandedKeysValue) => {
        setExpandedKeys(expandedKeysValue as string[]);
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
            message.success('\u5df2\u521b\u5efa\u7c92\u5b50\u9884\u8bbe\u8282\u70b9: ' + nodeName);
        } catch (error: any) {
            message.error(error?.message || '使用粒子预设失败');
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
            message.warning('请先选择一个节点');
            return;
        }
        if (selectedNodeIds.length > 1) {
            message.warning('只能编辑一个节点');
            return;
        }
        void openNodeEditor('genericNode', selectedNodeIds[0]);
    };

    const handleDelete = useCallback((nodeId?: number) => {
        setContextMenuVisible(false);
        const targetId = nodeId ?? (selectedNodeIds.length > 0 ? selectedNodeIds[0] : null);
        if (targetId === null) {
            message.warning('请先选择要删除的节点');
            return;
        }
        const checkResult = canDeleteNode(targetId, nodes, modelData?.Geosets);
        if (!checkResult.canDelete) {
            message.error(checkResult.reason);
            return;
        }
        deleteNode(targetId);
        clearNodeSelection();
        message.success('节点已删除');
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
                                message.success('已在根节点下创建骨骼');
                            }
                        },
                        {
                            key: 'add_helper',
                            label: nodeMenuLabel(NodeType.HELPER, '辅助器 (Helper)'),
                            onClick: () => {
                                addNode({ type: NodeType.HELPER, Name: 'New Helper', Parent: -1 });
                                message.success('已在根节点下创建辅助器');
                            }
                        },
                        {
                            key: 'add_attachment',
                            label: nodeMenuLabel(NodeType.ATTACHMENT, '挂接点 (Attachment)'),
                            onClick: () => {
                                addNode({ type: NodeType.ATTACHMENT, Name: 'New Attachment', Parent: -1 });
                                message.success('已在根节点下创建挂接点');
                            }
                        },                        {
                            key: 'add_particle1',
                            label: nodeMenuLabel(NodeType.PARTICLE_EMITTER, '粒子发射器1'),
                            onClick: () => {
                                addNode({ type: NodeType.PARTICLE_EMITTER, Name: 'New Particle', Parent: -1 });
                                message.success('已创建粒子发射器1');
                            }
                        },
                        {
                            key: 'add_particle2',
                            label: nodeMenuLabel(NodeType.PARTICLE_EMITTER_2, '粒子发射器2 (ParticleEmitter2)'),
                            onClick: () => {
                                addNode({ type: NodeType.PARTICLE_EMITTER_2, Name: 'New Particle', Parent: -1 });
                                message.success('已在根节点下创建粒子发射器');
                            }
                        },
                        {
                            key: 'add_ribbon',
                            label: nodeMenuLabel(NodeType.RIBBON_EMITTER, getNodeTypeName(NodeType.RIBBON_EMITTER)),
                            onClick: () => {
                                addNode({ type: NodeType.RIBBON_EMITTER, Name: 'New Ribbon', Parent: -1 });
                                message.success('已创建丝带发射器节点');
                            }
                        },
                        {
                            key: 'add_light',
                            label: nodeMenuLabel(NodeType.LIGHT, '灯光 (Light)'),
                            onClick: () => {
                                addNode({ type: NodeType.LIGHT, Name: 'New Light', Parent: -1 });
                                message.success('已在根节点下创建灯光');
                            }
                        },
                        {
                            key: 'add_event',
                            label: nodeMenuLabel(NodeType.EVENT_OBJECT, getNodeTypeName(NodeType.EVENT_OBJECT)),
                            onClick: () => {
                                addNode({ type: NodeType.EVENT_OBJECT, Name: 'New Event', Parent: -1 });
                                message.success('已创建事件对象节点');
                            }
                        },
                        {
                            key: 'add_collision',
                            label: nodeMenuLabel(NodeType.COLLISION_SHAPE, getNodeTypeName(NodeType.COLLISION_SHAPE)),
                            onClick: () => {
                                addNode({ type: NodeType.COLLISION_SHAPE, Name: 'New Collision', Parent: -1 });
                                message.success('已创建碰撞形状节点');
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
                        pasteNode(-1);
                        message.success('节点已粘贴到根节点');
                    }
                },
                {
                    key: 'moveHere',
                    label: '移动到此处(作为根节点)',
                    disabled: cutNodeId === null,
                    onClick: () => {
                        if (cutNodeId !== null) {
                            reparentNodes([cutNodeId], -1);
                            message.success('节点已移动到根节点');
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
                    const getAllDescendantKeys = (n: any): string[] => {
                        let keys = [String(n.key)];
                        if (n.children) {
                            n.children.forEach((c: any) => {
                                keys = keys.concat(getAllDescendantKeys(c));
                            });
                        }
                        return keys;
                    };
                    const findTreeNode = (data: any[]): any => {
                        for (const item of data) {
                            if (item.key === String(nodeId)) return item;
                            if (item.children) {
                                const found = findTreeNode(item.children);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    const treeNode = findTreeNode(treeData);
                    if (treeNode) {
                        const newKeys = [...expandedKeys, ...getAllDescendantKeys(treeNode)];
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
                    message.success('节点已复制');
                }
            },
            {
                key: 'cut',
                label: '剪切节点',
                onClick: () => {
                    setCutNodeId(nodeId);
                    setClipboardNode(null); // Clear copy state
                    message.success('节点已剪切，请选择目标节点后右键粘贴');
                }
            },
            {
                key: 'paste',
                label: '粘贴节点',
                disabled: !clipboardNode,
                onClick: () => {
                    pasteNode(nodeId);
                    message.success('节点已粘贴');
                    setTimeout(() => {
                        const allKeys: string[] = [];
                        const collectKeys = (data: any[]) => {
                            data.forEach(node => {
                                allKeys.push(node.key);
                                if (node.children && node.children.length > 0) {
                                    collectKeys(node.children);
                                }
                            });
                        };
                        collectKeys(treeData);
                        setExpandedKeys(allKeys);
                    }, 50);
                }
            },
            {
                key: 'moveHere',
                label: '移动到此处(作为子节点)',
                disabled: cutNodeId === null || cutNodeId === nodeId,
                onClick: () => {
                    if (cutNodeId !== null) {
                        reparentNodes([cutNodeId], nodeId);
                        message.success('节点已移动');
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
                            message.success('已创建骨骼节点');
                        }
                    },
                    {
                        key: 'create_helper',
                        label: nodeMenuLabel(NodeType.HELPER, '辅助体 (Helper)'),
                        onClick: () => {
                            addNode({ type: NodeType.HELPER, Name: 'New Helper', Parent: nodeId });
                            message.success('已创建辅助体节点');
                        }
                    },
                    {
                        key: 'create_attachment',
                        label: nodeMenuLabel(NodeType.ATTACHMENT, '附件点 (Attachment)'),
                        onClick: () => {
                            addNode({ type: NodeType.ATTACHMENT, Name: 'New Attachment', Parent: nodeId });
                            message.success('已创建附件点节点');
                        }
                    },
                    {
                        key: 'create_particle1',
                        label: nodeMenuLabel(NodeType.PARTICLE_EMITTER, '粒子发射器1'),
                        onClick: () => {
                            addNode({ type: NodeType.PARTICLE_EMITTER, Name: 'New Particle', Parent: nodeId });
                            message.success('已创建粒子发射器1');
                        }
                    },
                    {
                        key: 'create_particle2',
                        label: nodeMenuLabel(NodeType.PARTICLE_EMITTER_2, '粒子发射器2 (ParticleEmitter2)'),
                        onClick: () => {
                            addNode({ type: NodeType.PARTICLE_EMITTER_2, Name: 'New Particle', Parent: nodeId });
                            message.success('已创建粒子发射器2节点');
                        }
                    },
                    {
                        key: 'create_ribbon',
                        label: nodeMenuLabel(NodeType.RIBBON_EMITTER, '丝带发射器 (RibbonEmitter)'),
                        onClick: () => {
                            addNode({ type: NodeType.RIBBON_EMITTER, Name: 'New Ribbon', Parent: nodeId });
                            message.success('已创建丝带发射器节点');
                        }
                    },
                    {
                        key: 'create_light',
                        label: nodeMenuLabel(NodeType.LIGHT, '灯光 (Light)'),
                        onClick: () => {
                            addNode({ type: NodeType.LIGHT, Name: 'New Light', Parent: nodeId });
                            message.success('已创建灯光节点');
                        }
                    },
                    {
                        key: 'create_event',
                        label: nodeMenuLabel(NodeType.EVENT_OBJECT, '事件对象 (EventObject)'),
                        onClick: () => {
                            addNode({ type: NodeType.EVENT_OBJECT, Name: 'New Event', Parent: nodeId });
                            message.success('已创建事件对象节点');
                        }
                    },
                    {
                        key: 'create_collision',
                        label: nodeMenuLabel(NodeType.COLLISION_SHAPE, '碰撞形状 (CollisionShape)'),
                        onClick: () => {
                            addNode({ type: NodeType.COLLISION_SHAPE, Name: 'New Collision', Parent: nodeId });
                            message.success('已创建碰撞形状节点');
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

    useEffect(() => {
        if (selectedNodeIds.length !== 1) return;
        const targetId = selectedNodeIds[0];
        const ancestorKeys = getAncestorKeys(nodes, targetId);
        if (ancestorKeys.length > 0) {
            setExpandedKeys(prev => Array.from(new Set([...prev, ...ancestorKeys])));
        }
    }, [selectedNodeIds, nodes]);

    useEffect(() => {
        if (mainMode !== 'animation') return;
        if (selectedNodeIds.length === 0) return;
        if (!shouldScrollNodeManagerToSelection) return;
        const targetId = selectedNodeIds[0];
        const wrapper = treeWrapperRef.current;
        if (!wrapper) return;
        const timer = window.setTimeout(() => {
            const el = wrapper.querySelector(`[data-node-id="${targetId}"]`) as HTMLElement | null;
            if (el) {
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [selectedNodeIds, mainMode, filteredTreeData, expandedKeys]);

    return (
        <div
            ref={nodeManagerRootRef}
            style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px', overflow: 'hidden' }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <style dangerouslySetInnerHTML={{
                __html: `
                .node-manager-tree-wrapper, .node-manager-tree-wrapper * {
                    -webkit-app-region: no-drag !important;
                    user-select: none;
                }
                .ant-tree-treenode {
                    -webkit-user-drag: element;
                }
            `}} />
            <Search
                placeholder="搜索节点..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                prefix={<SearchOutlined />}
                size="small"
                style={{ marginBottom: 8 }}
            />
            {/* Diagnostic Element Removed */}

            <div
                ref={treeWrapperRef}
                tabIndex={-1}
                className="node-manager-tree-wrapper"
                style={{
                    flex: 1,
                    overflow: 'auto',
                    border: '1px solid #303030',
                    borderRadius: '2px',
                    backgroundColor: '#1e1e1e',
                    padding: '4px',
                    outline: 'none',
                }}
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
                        className="node-manager-tree"
                        multiple
                        treeData={filteredTreeData}
                        selectedKeys={selectedNodeIds.map(String)}
                        expandedKeys={expandedKeys}
                        autoExpandParent={autoExpandParent}
                        onSelect={handleSelect}
                        onExpand={handleExpand}
                        onRightClick={handleRightClick}
                        onDoubleClick={(_e, node) => handleNodeDoubleClick(node.data)}
                        showIcon
                        showLine
                        blockNode
                        titleRender={(nodeData: any) => {
                            const nodeId = nodeData.data?.ObjectId ?? parseInt(nodeData.key);
                            const isVirtualRoot = nodeData.isVirtualRoot === true || nodeId === -1;
                            const isDropTarget = dropTargetNodeId === nodeId;
                            // isDraggingThis available for future styling: const isDraggingThis = draggedNodeId === nodeId;
                            const isCut = cutNodeId === nodeId;

                            return (
                                <div
                                    data-node-id={nodeId}
                                    className="node-manager-row"
                                    onMouseDown={(e) => {
                                        // Only start drag on left button
                                        if (e.button !== 0) return;

                                        // Don't allow dragging the virtual root node
                                        if (isVirtualRoot) return;

                                        // Prevent text selection during drag
                                        e.preventDefault();

                                        // Store the starting position
                                        const startX = e.clientX;
                                        const startY = e.clientY;
                                        let dragStarted = false;

                                        const handleMouseMove = (moveEvent: MouseEvent) => {
                                            const deltaX = Math.abs(moveEvent.clientX - startX);
                                            const deltaY = Math.abs(moveEvent.clientY - startY);

                                            // Start dragging after threshold
                                            if (!dragStarted && (deltaX > 5 || deltaY > 5)) {
                                                console.log('[MouseDrag] Start:', nodeId);
                                                dragStarted = true;
                                                draggedNodeIdRef.current = nodeId;
                                                isDraggingRef.current = true;
                                                setDraggedNodeId(nodeId);
                                                setIsDragging(true);
                                            }

                                            // Update position and target while dragging
                                            if (dragStarted) {
                                                setDragPosition({ x: moveEvent.clientX, y: moveEvent.clientY });

                                                // Find element under mouse to determine drop target
                                                const elementUnderMouse = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                                                if (elementUnderMouse) {
                                                    const nodeItem = elementUnderMouse.closest('[data-node-id]') as HTMLElement;
                                                    if (nodeItem) {
                                                        const targetId = parseInt(nodeItem.dataset.nodeId || '');
                                                        // Allow dropping to virtual root (-1) or any other node except self
                                                        if (!isNaN(targetId) && targetId !== nodeId) {
                                                            dropTargetNodeIdRef.current = targetId;
                                                            setDropTargetNodeId(targetId);
                                                        }
                                                    } else {
                                                        dropTargetNodeIdRef.current = null;
                                                        setDropTargetNodeId(null);
                                                    }
                                                }
                                            }
                                        };

                                        const handleMouseUp = () => {
                                            document.removeEventListener('mousemove', handleMouseMove);
                                            document.removeEventListener('mouseup', handleMouseUp);

                                            if (dragStarted) {
                                                const targetId = dropTargetNodeIdRef.current;
                                                console.log('[MouseDrag] Drop:', nodeId, '->', targetId);

                                                // Allow dropping to -1 (root) or any valid node
                                                if (targetId !== null && targetId !== nodeId) {
                                                    // Perform reparent
                                                    const { selectedNodeIds } = useSelectionStore.getState();
                                                    const { reparentNodes } = useModelStore.getState();
                                                    let nodesToMove = [nodeId];
                                                    if (selectedNodeIds.includes(nodeId)) {
                                                        nodesToMove = [...selectedNodeIds];
                                                    }
                                                    reparentNodes(nodesToMove, targetId);
                                                    message.success(
                                                        targetId === -1
                                                            ? `已移动到根节点`
                                                            : (nodesToMove.length > 1 ? `已移动 ${nodesToMove.length} 个节点` : '节点已移动')
                                                    );
                                                }

                                                // End drag
                                                isDraggingRef.current = false;
                                                draggedNodeIdRef.current = null;
                                                dropTargetNodeIdRef.current = null;
                                                setIsDragging(false);
                                                setDraggedNodeId(null);
                                                setDropTargetNodeId(null);
                                            }
                                        };

                                        document.addEventListener('mousemove', handleMouseMove);
                                        document.addEventListener('mouseup', handleMouseUp);
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        width: '100%',
                                        minWidth: 0,
                                        padding: 0,
                                        height: 18,
                                        cursor: isVirtualRoot ? 'default' : (isDragging && draggedNodeId === nodeId ? 'grabbing' : 'grab'),
                                        borderRadius: '2px',
                                        backgroundColor: isDropTarget ? 'rgba(24, 144, 255, 0.3)' : (isVirtualRoot ? 'rgba(80, 80, 80, 0.3)' : 'transparent'),
                                        border: isDropTarget ? '1px dashed #1890ff' : '1px solid transparent',
                                        opacity: isDragging && draggedNodeId === nodeId ? 0.5 : (isCut ? 0.5 : 1),
                                        transition: 'background-color 0.15s, border 0.15s',
                                        userSelect: 'none'
                                    }}
                                >
                                    <span style={{
                                        flex: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        minWidth: 0,
                                        fontWeight: isVirtualRoot ? 'bold' : 'normal',
                                        color: isVirtualRoot ? '#1890ff' : 'inherit'
                                    }}>
                                        {nodeData.title}
                                    </span>
                                    {/* Don't show ObjectId for virtual root */}
                                    {!isVirtualRoot && (
                                        <span style={{ color: '#666', fontSize: '10px', marginLeft: '6px' }}>
                                            {nodeData.data.ObjectId ?? ''}
                                        </span>
                                    )}
                                </div>
                            );
                        }}
                    />
                ) : (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>暂无节点数据</div>
                )}
            </div>

            {/* Global Context Menu */}
            {
                contextMenuVisible && (
                    <div
                        ref={contextMenuRef}
                        className="node-manager-context-menu-popover"
                        style={{
                            position: 'fixed',
                            left: contextMenuPosition.x,
                            top: contextMenuPosition.y,
                            zIndex: 1000,
                            backgroundColor: '#1f1f1f',
                            border: '1px solid #303030',
                            borderRadius: '2px',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
                            maxHeight: 'calc(100vh - 16px)',
                            overflowY: 'auto'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Menu
                            className="node-manager-context-menu"
                            items={contextMenuItems}
                            mode="vertical"
                            theme="dark"
                            selectable={false}
                            onClick={() => setContextMenuVisible(false)}
                            style={{ border: 'none' }}
                        />
                    </div>
                )
            }

        </div >
    );
};
