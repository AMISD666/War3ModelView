
/**
 * 节点管理器窗口组件
 */

import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Tree, Input, Space, Button, Tooltip, message, Modal, Menu } from 'antd';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    SearchOutlined,
    DeploymentUnitOutlined,
    BuildOutlined,
    BulbOutlined,
    FireOutlined,
    SoundOutlined,
    BlockOutlined,
    PaperClipOutlined
} from '@ant-design/icons';

// ... (imports)

// Helper to get icon by node type
const getNodeIcon = (type: NodeType) => {
    switch (type) {
        case NodeType.BONE: return <DeploymentUnitOutlined />;
        case NodeType.HELPER: return <BuildOutlined />;
        case NodeType.LIGHT: return <BulbOutlined />;
        case NodeType.PARTICLE_EMITTER:
        case NodeType.PARTICLE_EMITTER_2:
        case NodeType.RIBBON_EMITTER: return <FireOutlined />;
        case NodeType.EVENT_OBJECT: return <SoundOutlined />;
        case NodeType.COLLISION_SHAPE: return <BlockOutlined />;
        case NodeType.ATTACHMENT: return <PaperClipOutlined />;
        default: return <DeploymentUnitOutlined />;
    }
};

// ... (inside component)


import type { TreeProps, MenuProps } from 'antd';
import { useModelStore } from '../../store/modelStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useUIStore } from '../../store/uiStore';
import { NodeType } from '../../types/node';
import { buildTreeData, filterTreeNodes, getExpandedKeys, getAncestorKeys } from '../../utils/treeUtils';
import { canDeleteNode } from '../../utils/nodeUtils';
import { RenameNodeDialog } from './RenameNodeDialog';
import ParticleEmitter2Dialog from './ParticleEmitter2Dialog';
import CollisionShapeDialog from './CollisionShapeDialog';
import LightDialog from './LightDialog';

import EventObjectDialog from './EventObjectDialog';
import RibbonEmitterDialog from './RibbonEmitterDialog';

const { Search } = Input;

export const NodeManagerWindow: React.FC = () => {
    const { nodes, modelData, deleteNode, reparentNodes, setClipboardNode, pasteNode, renameNode, clipboardNode, addNode } = useModelStore();
    const { selectedNodeIds, selectNode, clearNodeSelection } = useSelectionStore();
    const { setNodeDialogVisible, setCreateNodeDialogVisible } = useUIStore();

    const [searchText, setSearchText] = useState('');
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [autoExpandParent, setAutoExpandParent] = useState(true);

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

    // Rename Dialog State
    const [renameVisible, setRenameVisible] = useState(false);
    const [renamingNodeId, setRenamingNodeId] = useState<number | null>(null);
    const [renamingNodeName, setRenamingNodeName] = useState('');
    const [pe2DialogVisible, setPe2DialogVisible] = useState(false);
    const [collisionDialogVisible, setCollisionDialogVisible] = useState(false);
    const [lightDialogVisible, setLightDialogVisible] = useState(false);
    const [eventDialogVisible, setEventDialogVisible] = useState(false);
    const [ribbonDialogVisible, setRibbonDialogVisible] = useState(false);

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

    // Keep refs in sync with state
    React.useEffect(() => {
        draggedNodeIdRef.current = draggedNodeId;
    }, [draggedNodeId]);

    React.useEffect(() => {
        isDraggingRef.current = isDragging;
    }, [isDragging]);

    // Note: Mouse-based drag-drop is handled entirely in onMouseDown closures
    // No need for global listeners since each drag operation has its own handlers

    // 构建树形数据
    const treeData = useMemo(() => buildTreeData(nodes), [nodes]);

    // 过滤树节点
    const filteredTreeData = useMemo(() => {
        if (!searchText) return treeData;
        return filterTreeNodes(treeData, searchText);
    }, [treeData, searchText]);

    // Auto-expand all nodes when model is loaded
    useEffect(() => {
        if (nodes.length > 0 && expandedKeys.length === 0) {
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
        }
    }, [nodes.length, treeData]);

    // 搜索时自动展开
    useEffect(() => {
        if (searchText) {
            const keys = getExpandedKeys(treeData, searchText);
            setExpandedKeys(keys);
            setAutoExpandParent(true);
        } else if (nodes.length > 0) {
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
        }
    }, [searchText, treeData, nodes.length]);

    const handleSelect: TreeProps['onSelect'] = (_selectedKeys, info) => {
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
    };

    const handleExpand: TreeProps['onExpand'] = (expandedKeysValue) => {
        setExpandedKeys(expandedKeysValue as string[]);
        setAutoExpandParent(false);
    };

    const handleCreate = () => {
        setCreateNodeDialogVisible(true);
    };

    const handleEdit = () => {
        if (selectedNodeIds.length === 0) {
            message.warning('请先选择一个节点');
            return;
        }
        if (selectedNodeIds.length > 1) {
            message.warning('只能编辑一个节点');
            return;
        }
        setNodeDialogVisible(true, selectedNodeIds[0]);
    };

    const handleDelete = (nodeId?: number) => {
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
        Modal.confirm({
            title: '确认删除',
            content: '确定要删除节点 ' + targetId + ' 吗？此操作不可恢复。',
            okText: '删除',
            okType: 'danger',
            cancelText: '取消',
            onOk: () => {
                deleteNode(targetId);
                clearNodeSelection();
                message.success('节点已删除');
            }
        });
    };

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

    const getContextMenuItems = (nodeId: number): MenuProps['items'] => {
        // Special handling for virtual root node (-1)
        if (nodeId === -1) {
            const items: MenuProps['items'] = [
                {
                    key: 'add_child',
                    label: '新建子节点',
                    icon: <PlusOutlined />,
                    children: [
                        {
                            key: 'add_bone',
                            label: '骨骼 (Bone)',
                            onClick: () => {
                                addNode({ type: NodeType.BONE, Name: 'New Bone', Parent: -1 });
                                message.success('已在根节点下创建骨骼');
                            }
                        },
                        {
                            key: 'add_helper',
                            label: '辅助器 (Helper)',
                            onClick: () => {
                                addNode({ type: NodeType.HELPER, Name: 'New Helper', Parent: -1 });
                                message.success('已在根节点下创建辅助器');
                            }
                        },
                        {
                            key: 'add_attachment',
                            label: '挂接点 (Attachment)',
                            onClick: () => {
                                addNode({ type: NodeType.ATTACHMENT, Name: 'New Attachment', Parent: -1 });
                                message.success('已在根节点下创建挂接点');
                            }
                        },
                        {
                            key: 'add_particle',
                            label: '粒子发射器2 (ParticleEmitter2)',
                            onClick: () => {
                                addNode({ type: NodeType.PARTICLE_EMITTER_2, Name: 'New Particle', Parent: -1 });
                                message.success('已在根节点下创建粒子发射器');
                            }
                        },
                        {
                            key: 'add_light',
                            label: '灯光 (Light)',
                            onClick: () => {
                                addNode({ type: NodeType.LIGHT, Name: 'New Light', Parent: -1 });
                                message.success('已在根节点下创建灯光');
                            }
                        }
                    ]
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

        const items: MenuProps['items'] = [
            {
                key: 'edit',
                label: '编辑节点',
                icon: <EditOutlined />,
                onClick: () => {
                    setNodeDialogVisible(true, nodeId);
                }
            }
        ];

        if (node.type === NodeType.PARTICLE_EMITTER_2) {
            items.push({
                key: 'edit_particle',
                label: '编辑粒子系统',
                icon: <FireOutlined />,
                onClick: () => setPe2DialogVisible(true)
            });
        } else if (node.type === NodeType.RIBBON_EMITTER) {
            items.push({
                key: 'edit_ribbon',
                label: '编辑丝带',
                icon: <FireOutlined />,
                onClick: () => setRibbonDialogVisible(true)
            });
        } else if (node.type === NodeType.PARTICLE_EMITTER) {
            items.push({
                key: 'edit_particle_disabled',
                label: '编辑粒子系统 (暂不支持)',
                icon: <FireOutlined />,
                disabled: true
            });
        } else if (node.type === NodeType.COLLISION_SHAPE) {
            items.push({
                key: 'edit_collision',
                label: '编辑碰撞形状',
                icon: <BlockOutlined />,
                onClick: () => setCollisionDialogVisible(true)
            });
        } else if (node.type === NodeType.LIGHT) {
            items.push({
                key: 'edit_light',
                label: '编辑灯光',
                icon: <BulbOutlined />,
                onClick: () => setLightDialogVisible(true)
            });
        } else if (node.type === NodeType.EVENT_OBJECT) {
            items.push({
                key: 'edit_event',
                label: '编辑事件对象',
                icon: <SoundOutlined />,
                onClick: () => setEventDialogVisible(true)
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
                children: [
                    {
                        key: 'create_dialog',
                        label: '打开创建对话框...',
                        onClick: () => setCreateNodeDialogVisible(true)
                    },
                    { type: 'divider' },
                    {
                        key: 'create_bone',
                        label: '骨骼 (Bone)',
                        icon: <DeploymentUnitOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.BONE, Name: 'New Bone', Parent: nodeId });
                            message.success('已创建骨骼节点');
                        }
                    },
                    {
                        key: 'create_helper',
                        label: '辅助体 (Helper)',
                        icon: <BuildOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.HELPER, Name: 'New Helper', Parent: nodeId });
                            message.success('已创建辅助体节点');
                        }
                    },
                    {
                        key: 'create_attachment',
                        label: '附件点 (Attachment)',
                        icon: <PaperClipOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.ATTACHMENT, Name: 'New Attachment', Parent: nodeId });
                            message.success('已创建附件点节点');
                        }
                    },
                    { type: 'divider' },
                    {
                        key: 'create_particle2',
                        label: '粒子发射器2 (ParticleEmitter2)',
                        icon: <FireOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.PARTICLE_EMITTER_2, Name: 'New Particle', Parent: nodeId });
                            message.success('已创建粒子发射器2节点');
                        }
                    },
                    {
                        key: 'create_ribbon',
                        label: '丝带发射器 (RibbonEmitter)',
                        icon: <FireOutlined style={{ color: '#1890ff' }} />,
                        onClick: () => {
                            addNode({ type: NodeType.RIBBON_EMITTER, Name: 'New Ribbon', Parent: nodeId });
                            message.success('已创建丝带发射器节点');
                        }
                    },
                    { type: 'divider' },
                    {
                        key: 'create_light',
                        label: '灯光 (Light)',
                        icon: <BulbOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.LIGHT, Name: 'New Light', Parent: nodeId });
                            message.success('已创建灯光节点');
                        }
                    },
                    {
                        key: 'create_event',
                        label: '事件对象 (EventObject)',
                        icon: <SoundOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.EVENT_OBJECT, Name: 'New Event', Parent: nodeId });
                            message.success('已创建事件对象节点');
                        }
                    },
                    {
                        key: 'create_collision',
                        label: '碰撞形状 (CollisionShape)',
                        icon: <BlockOutlined />,
                        onClick: () => {
                            addNode({ type: NodeType.COLLISION_SHAPE, Name: 'New Collision', Parent: nodeId });
                            message.success('已创建碰撞形状节点');
                        }
                    }
                ]
            },
            {
                key: 'rename',
                label: '重命名',
                onClick: () => {
                    setRenamingNodeId(nodeId);
                    setRenamingNodeName(node.Name);
                    setRenameVisible(true);
                }
            },
            {
                key: 'delete',
                label: '删除节点',
                danger: true,
                onClick: () => handleDelete(nodeId)
            }
        );

        return items;
    };

    // Context Menu State
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [contextMenuNodeId, setContextMenuNodeId] = useState<number | null>(null);
    const contextMenuRef = React.useRef<HTMLDivElement>(null);


    const handleRightClick: TreeProps['onRightClick'] = ({ event, node }) => {
        const nodeId = parseInt(node.key as string);
        setContextMenuNodeId(nodeId);

        // Auto-select the node on right click
        selectNode(nodeId);

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

    const contextMenuItems = useMemo(() => {
        if (contextMenuNodeId === null) return [];
        return getContextMenuItems(contextMenuNodeId);
    }, [contextMenuNodeId, nodes]); // Re-calculate when node or selection changes

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
        // Open specialized editor based on node type
        switch (node.type) {
            case NodeType.PARTICLE_EMITTER_2:
                selectNode(node.ObjectId);
                setPe2DialogVisible(true);
                break;
            case NodeType.LIGHT:
                selectNode(node.ObjectId);
                setLightDialogVisible(true);
                break;
            case NodeType.COLLISION_SHAPE:
                selectNode(node.ObjectId);
                setCollisionDialogVisible(true);
                break;
            case NodeType.EVENT_OBJECT:
                selectNode(node.ObjectId);
                setEventDialogVisible(true);
                break;
            case NodeType.RIBBON_EMITTER:
                selectNode(node.ObjectId);
                setRibbonDialogVisible(true);
                break;
            default:
                // For other node types (Bone, Helper, Attachment, etc.), open generic node dialog
                setNodeDialogVisible(true, node.ObjectId);
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

    return (
        <div
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
            <Space size="small" style={{ marginBottom: 8 }}>
                <Tooltip title="创建节点">
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate} />
                </Tooltip>
                <Tooltip title="编辑节点">
                    <Button size="small" icon={<EditOutlined />} onClick={handleEdit} disabled={selectedNodeIds.length !== 1} />
                </Tooltip>
                <Tooltip title="删除节点">
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete()} disabled={selectedNodeIds.length === 0} />
                </Tooltip>
            </Space>
            <div
                ref={treeWrapperRef}
                className="node-manager-tree-wrapper"
                style={{
                    flex: 1,
                    overflow: 'auto',
                    border: '1px solid #303030',
                    borderRadius: '2px',
                    backgroundColor: '#1e1e1e',
                    padding: '4px'
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
                                        padding: '2px 4px',
                                        cursor: isVirtualRoot ? 'default' : (isDragging && draggedNodeId === nodeId ? 'grabbing' : 'grab'),
                                        borderRadius: '2px',
                                        backgroundColor: isDropTarget ? 'rgba(24, 144, 255, 0.3)' : (isVirtualRoot ? 'rgba(80, 80, 80, 0.3)' : 'transparent'),
                                        border: isDropTarget ? '1px dashed #1890ff' : '1px solid transparent',
                                        opacity: isDragging && draggedNodeId === nodeId ? 0.5 : (isCut ? 0.5 : 1),
                                        transition: 'background-color 0.15s, border 0.15s',
                                        userSelect: 'none'
                                    }}
                                >
                                    <span style={{ marginRight: 8, color: isVirtualRoot ? '#1890ff' : '#aaa' }}>
                                        {isVirtualRoot ? '🌐' : getNodeIcon(nodeData.type)}
                                    </span>
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
                                        <span style={{ color: '#666', fontSize: '10px', marginLeft: '8px' }}>
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
                            items={contextMenuItems}
                            mode="vertical"
                            theme="dark"
                            selectable={false}
                            onClick={() => setContextMenuVisible(false)}
                            style={{ border: 'none', width: 160 }}
                        />
                    </div>
                )
            }

            <RenameNodeDialog
                visible={renameVisible}
                nodeId={renamingNodeId}
                currentName={renamingNodeName}
                onRename={(newName) => {
                    if (renamingNodeId !== null) {
                        renameNode(renamingNodeId, newName);
                        setRenameVisible(false);
                        message.success('重命名成功');
                    }
                }}
                onCancel={() => setRenameVisible(false)}
            />

            <ParticleEmitter2Dialog
                visible={pe2DialogVisible}
                nodeId={selectedNodeIds.length > 0 ? selectedNodeIds[0] : null}
                onClose={() => setPe2DialogVisible(false)}
            />
            <CollisionShapeDialog
                visible={collisionDialogVisible}
                nodeId={selectedNodeIds.length > 0 ? selectedNodeIds[0] : null}
                onClose={() => setCollisionDialogVisible(false)}
            />
            <LightDialog
                visible={lightDialogVisible}
                nodeId={selectedNodeIds.length > 0 ? selectedNodeIds[0] : null}
                onClose={() => setLightDialogVisible(false)}
            />
            <EventObjectDialog
                visible={eventDialogVisible}
                nodeId={selectedNodeIds.length > 0 ? selectedNodeIds[0] : null}
                onClose={() => setEventDialogVisible(false)}
            />
            <RibbonEmitterDialog
                visible={ribbonDialogVisible}
                nodeId={selectedNodeIds.length > 0 ? selectedNodeIds[0] : null}
                onClose={() => setRibbonDialogVisible(false)}
            />
        </div >
    );
};
