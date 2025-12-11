/**
 * 集成了 Ant Design 和 Zustand的新版 MainLayout - 支持可调整大小的节点管理器
 */

import React, { useState } from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import { useUIStore } from '../store/uiStore';
import { useSelectionStore } from '../store/selectionStore';
import MainLayoutOld from './MainLayout';
import { NodeManagerWindow } from './node/NodeManagerWindow';
import NodeDialog from './node/NodeDialog';
import { CreateNodeDialog } from './node/CreateNodeDialog';

const { Content } = Layout;

export const MainLayoutNew: React.FC = () => {
    const {
        showNodeManager,
        showNodeDialog,
        editingNodeId,
        setNodeDialogVisible
    } = useUIStore();

    const mainMode = useSelectionStore(state => state.mainMode);

    const [nodeManagerWidth, setNodeManagerWidth] = useState(300);
    const [isResizing, setIsResizing] = useState(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsResizing(true);
        e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        const newWidth = e.clientX;
        if (newWidth >= 200 && newWidth <= 600) {
            setNodeManagerWidth(newWidth);
        }
    };

    const handleMouseUp = () => {
        setIsResizing(false);
    };

    React.useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        } else {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    return (
        <>
            <div style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
                {showNodeManager && mainMode !== 'uv' && (
                    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
                        <div
                            style={{
                                width: nodeManagerWidth,
                                borderRight: '1px solid #303030',
                                backgroundColor: '#1e1e1e',
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative'
                            }}
                        >
                            <div style={{ padding: '8px 12px', borderBottom: '1px solid #303030', fontWeight: 'bold', color: '#fff' }}>
                                节点管理器
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <NodeManagerWindow />
                            </div>
                            <div
                                onMouseDown={handleMouseDown}
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: '4px',
                                    cursor: 'ew-resize',
                                    backgroundColor: isResizing ? '#007acc' : 'transparent',
                                    transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                    if (!isResizing) {
                                        e.currentTarget.style.backgroundColor = '#007acc40';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isResizing) {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }
                                }}
                            />
                        </div>
                    </ConfigProvider>
                )}

                <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <MainLayoutOld />
                </Content>
            </div>

            <NodeDialog
                visible={showNodeDialog}
                nodeId={editingNodeId}
                onClose={() => setNodeDialogVisible(false)}
            />
            <CreateNodeDialog />
        </>
    );
};

export default MainLayoutNew;
