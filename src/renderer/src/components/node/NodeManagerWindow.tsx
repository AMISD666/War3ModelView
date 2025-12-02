
/**
 * 节点管理器窗口组件
 */

import React, { useMemo, useState, useEffect } from 'react';
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
    VideoCameraOutlined,
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
        case NodeType.CAMERA: return <VideoCameraOutlined />;
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
import { buildTreeData, filterTreeNodes, getExpandedKeys } from '../../utils/treeUtils';
import { canDeleteNode } from '../../utils/nodeUtils';
import { RenameNodeDialog } from './RenameNodeDialog';
import ParticleEmitter2Dialog from './ParticleEmitter2Dialog';

const { Search } = Input;

export const NodeManagerWindow: React.FC = () => {
    const { nodes, modelData, deleteNode, moveNodeTo, setClipboardNode, pasteNode, renameNode, clipboardNode } = useModelStore();
    const { selectedNodeIds, selectNode, clearNodeSelection } = useSelectionStore();
    const { setNodeDialogVisible, setCreateNodeDialogVisible } = useUIStore();

    const [searchText, setSearchText] = useState('');
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [autoExpandParent, setAutoExpandParent] = useState(true);

    // Rename Dialog State
    const [renameVisible, setRenameVisible] = useState(false);
    const [renamingNodeId, setRenamingNodeId] = useState<number | null>(null);
    const [renamingNodeName, setRenamingNodeName] = useState('');
    const [pe2DialogVisible, setPe2DialogVisible] = useState(false);

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

    const handleSelect: TreeProps['onSelect'] = (selectedKeys) => {
        if (selectedKeys.length > 0) {
            const nodeId = parseInt(selectedKeys[0] as string);
            selectNode(nodeId);
        } else {
            clearNodeSelection();
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

    const onDrop: TreeProps['onDrop'] = (info) => {
        console.log('[NodeManager] onDrop triggered', info);
        const dragId = parseInt(info.dragNode.key as string);
        const dropId = parseInt(info.node.key as string);
        const dropPos = info.node.pos.split('-');
        const dropPosition = info.dropPosition - Number(dropPos[dropPos.length - 1]);

        console.log('[NodeManager] Dragging ' + dragId + ' to ' + dropId + ', position: ' + dropPosition + ', dropToGap: ' + info.dropToGap);
        console.log('[NodeManager] Raw dropPosition:', info.dropPosition, 'Node pos:', info.node.pos);

        if (!info.dropToGap) {
            // Drop on the node -> make it a child
            console.log('[NodeManager] Dropping inside (reparenting)');
            moveNodeTo(dragId, dropId, 'inside');
        } else if (dropPosition < 1) {
            // Drop before the node (usually 0, sometimes -1)
            console.log('[NodeManager] Dropping before');
            moveNodeTo(dragId, dropId, 'before');
        } else {
            // Drop after the node (usually 1)
            console.log('[NodeManager] Dropping after');
            moveNodeTo(dragId, dropId, 'after');
        }
        message.success('节点已移动');
    };

    const allowDrop: TreeProps['allowDrop'] = (info) => {
        // Prevent dropping on itself
        if (info.dropNode.key === info.dragNode.key) {
            return false;
        }
        return true;
    };

    const getContextMenuItems = (nodeId: number): MenuProps['items'] => {
        const node = nodes.find(n => n.ObjectId === nodeId);
        if (!node) return [];

        const items: MenuProps['items'] = [
            {
                key: 'edit',
                label: '编辑节点',
                icon: <EditOutlined />,
                onClick: () => {
                    if (node.type === NodeType.PARTICLE_EMITTER_2) {
                        setPe2DialogVisible(true);
                    } else {
                        setNodeDialogVisible(true, nodeId);
                    }
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
                    message.success('节点已复制');
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
            { type: 'divider' },
            {
                key: 'create',
                label: '在此创建子节点',
                onClick: () => setCreateNodeDialogVisible(true)
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

    const handleRightClick: TreeProps['onRightClick'] = ({ event, node }) => {
        const nodeId = parseInt(node.key as string);
        setContextMenuNodeId(nodeId);

        // Auto-select the node on right click
        selectNode(nodeId);

        let x = event.clientX;
        let y = event.clientY;

        // Adjust menu position if it goes off-screen
        const menuHeight = 280; // Approximate max height of context menu
        if (y + menuHeight > window.innerHeight) {
            y -= menuHeight;
        }

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

    const handleNodeDoubleClick = (node: any) => {
        setNodeDialogVisible(true, node.ObjectId);
    };

    return (
        <div
            style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px', overflow: 'hidden' }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <Search
                placeholder="搜索节点..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                prefix={<SearchOutlined />}
                size="small"
                style={{ marginBottom: 8 }}
            />
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
                style={{
                    flex: 1,
                    overflow: 'auto',
                    border: '1px solid #303030',
                    borderRadius: '2px',
                    backgroundColor: '#1e1e1e',
                    padding: '4px',
                    // @ts-ignore
                    WebkitAppRegion: 'no-drag' // Force allow mouse events
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }}
            >
                {treeData.length > 0 ? (
                    <Tree
                        className="node-manager-tree"
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
                        draggable
                        blockNode
                        onDragStart={(info) => {
                            // Ensure dataTransfer is set for Electron/Chromium
                            if (info.event.dataTransfer) {
                                info.event.dataTransfer.effectAllowed = 'move';
                                info.event.dataTransfer.setData('text/plain', String(info.node.key));
                            }
                        }}
                        onDrop={onDrop}
                        allowDrop={allowDrop}
                        titleRender={(nodeData: any) => (
                            <div style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, padding: '0 4px' }}>
                                <span style={{ marginRight: 8, color: '#aaa' }}>{getNodeIcon(nodeData.type)}</span>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, pointerEvents: 'none' }}>
                                    {nodeData.title}
                                </span>
                                <span style={{ color: '#666', fontSize: '10px', marginLeft: '8px' }}>{nodeData.data.ObjectId}</span>
                            </div>
                        )}
                    />
                ) : (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>暂无节点数据</div>
                )}
            </div>

            {/* Global Context Menu */}
            {contextMenuVisible && (
                <div
                    style={{
                        position: 'fixed',
                        left: contextMenuPosition.x,
                        top: contextMenuPosition.y,
                        zIndex: 1000,
                        backgroundColor: '#1f1f1f',
                        border: '1px solid #303030',
                        borderRadius: '2px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
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
            )}

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
        </div>
    );
};
