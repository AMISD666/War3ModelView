/**
 * 集成了 Ant Design 和 Zustand的新版 MainLayout - 支持可调整大小的节点管理器
 * 
 * CRITICAL: Only ONE MainLayoutOld is rendered to avoid war3-model shared state corruption.
 * In batch mode, BatchManager is shown on the left and the single MainLayoutOld on the right.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Layout, ConfigProvider, theme, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useUIStore } from '../store/uiStore';
import { useSelectionStore } from '../store/selectionStore';
import { useModelStore } from '../store/modelStore';
import MainLayoutOld from './MainLayout';
import { NodeManagerWindow } from './node/NodeManagerWindow';
import NodeDialog from './node/NodeDialog';
import { CreateNodeDialog } from './node/CreateNodeDialog';
import { ViewSettingsWindow } from './ViewSettingsWindow';
import { BatchManager } from './batch/BatchManager';
import { TabBar } from './TabBar';
import { listen } from '@tauri-apps/api/event';
import { handleGlobalShortcutKeyDown } from '../shortcuts/manager';

const { Content } = Layout;

export const MainLayoutNew: React.FC = () => {
    const {
        showNodeManager,
        showNodeDialog,
        editingNodeId,
        setNodeDialogVisible,
        setShowNodeManager
    } = useUIStore();

    const mainMode = useSelectionStore(state => state.mainMode);

    // Node Manager resizing
    const [nodeManagerWidth, setNodeManagerWidth] = useState(300);
    const [isResizingNodeMgr, setIsResizingNodeMgr] = useState(false);

    // Batch mode panel resizing
    const [batchPanelWidth, setBatchPanelWidth] = useState(50); // percentage (1:1 ratio)
    const [isResizingBatch, setIsResizingBatch] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Batch mode state: track selected model for preview
    const [batchSelectedPath, setBatchSelectedPath] = useState<string | null>(null);
    const [batchSelectedAnimation, setBatchSelectedAnimation] = useState<number>(0);
    const { setModelData: setZustandModelData, addTab, tabs } = useModelStore();

    // Handle model selection from BatchManager
    const handleBatchSelectModel = useCallback((path: string, animationIndex: number) => {
        console.log('[MainLayoutNew] Batch model selected:', path, 'animation:', animationIndex);
        setBatchSelectedPath(path);
        setBatchSelectedAnimation(animationIndex);
        // Load the model into the main viewer
        setZustandModelData(null, path);
    }, [setZustandModelData]);

    // Handle animation change from BatchManager
    const handleBatchAnimationChange = useCallback((animationIndex: number) => {
        setBatchSelectedAnimation(animationIndex);
    }, []);

    // Node Manager resize handlers
    const handleNodeMgrMouseDown = (e: React.MouseEvent) => {
        setIsResizingNodeMgr(true);
        e.preventDefault();
    };

    // Batch divider resize handlers
    const handleBatchDividerMouseDown = (e: React.MouseEvent) => {
        setIsResizingBatch(true);
        e.preventDefault();
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingNodeMgr) {
                const newWidth = e.clientX;
                if (newWidth >= 200 && newWidth <= 600) {
                    setNodeManagerWidth(newWidth);
                }
            }
            if (isResizingBatch && containerRef.current) {
                const containerRect = containerRef.current.getBoundingClientRect();
                const newWidthPx = e.clientX - containerRect.left;
                const newWidthPercent = (newWidthPx / containerRect.width) * 100;
                if (newWidthPercent >= 30 && newWidthPercent <= 80) {
                    setBatchPanelWidth(newWidthPercent);
                }
            }
        };

        const handleMouseUp = () => {
            setIsResizingNodeMgr(false);
            setIsResizingBatch(false);
        };

        if (isResizingNodeMgr || isResizingBatch) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingNodeMgr, isResizingBatch]);

    // Listen for open-files events from single-instance plugin (handles multiple files)
    useEffect(() => {
        const unlisten = listen<string[]>('open-files', async (event) => {
            console.log('[MainLayoutNew] Received open-files event:', event.payload);
            const paths = event.payload;
            if (paths && paths.length > 0) {
                // Add tabs sequentially with small delay to prevent race condition
                for (const path of paths) {
                    addTab(path);
                    // Small delay between tabs to allow state to settle
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [addTab]);

    // Global shortcut dispatch (unified shortcut manager)
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            handleGlobalShortcutKeyDown(event);
        };
        // Use capture so shortcuts still work even if some focused component stops propagation.
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    const isBatchMode = mainMode === 'batch';

    return (
        <>
            <div
                ref={containerRef}
                style={{ height: '100vh', display: 'flex', overflow: 'hidden', position: 'relative' }}
            >
                {/* Batch Mode: Left Panel - BatchManager */}
                {isBatchMode && (
                    <>
                        <div style={{
                            width: `${batchPanelWidth}%`,
                            height: '100%',
                            overflow: 'hidden',
                            flexShrink: 0
                        }}>
                            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
                                <BatchManager
                                    onSelectModel={handleBatchSelectModel}
                                    onAnimationChange={handleBatchAnimationChange}
                                    selectedPath={batchSelectedPath}
                                />
                            </ConfigProvider>
                        </div>

                        {/* Resizable Divider */}
                        <div
                            onMouseDown={handleBatchDividerMouseDown}
                            style={{
                                width: '6px',
                                height: '100%',
                                cursor: 'ew-resize',
                                backgroundColor: isResizingBatch ? '#007acc' : '#333',
                                transition: isResizingBatch ? 'none' : 'background-color 0.2s',
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onMouseEnter={(e) => {
                                if (!isResizingBatch) {
                                    e.currentTarget.style.backgroundColor = '#007acc80';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isResizingBatch) {
                                    e.currentTarget.style.backgroundColor = '#333';
                                }
                            }}
                        >
                            <div style={{
                                width: '2px',
                                height: '40px',
                                backgroundColor: '#666',
                                borderRadius: '1px'
                            }} />
                        </div>
                    </>
                )}

                {/* Main Content Area: Node Manager (non-batch) + MainLayoutOld */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    height: '100%',
                    overflow: 'hidden'
                }}>
                    {/* Node Manager - only shown when not in batch/uv mode */}
                    {showNodeManager && !isBatchMode && mainMode !== 'uv' && (
                        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
                            <div
                                style={{
                                    width: nodeManagerWidth,
                                    borderRight: '1px solid #303030',
                                    backgroundColor: '#1e1e1e',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    position: 'relative',
                                    flexShrink: 0
                                }}
                            >
                                <div style={{ padding: '8px 12px', borderBottom: '1px solid #303030', fontWeight: 'bold', color: '#fff' }}>
                                    节点管理器
                                </div>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<CloseOutlined />}
                                    onClick={() => setShowNodeManager(false)}
                                    style={{ position: 'absolute', top: 6, right: 8, color: '#fff', zIndex: 2 }}
                                />
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <NodeManagerWindow />
                                </div>
                                <div
                                    onMouseDown={handleNodeMgrMouseDown}
                                    style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: '4px',
                                        cursor: 'ew-resize',
                                        backgroundColor: isResizingNodeMgr ? '#007acc' : 'transparent',
                                        transition: 'background-color 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isResizingNodeMgr) {
                                            e.currentTarget.style.backgroundColor = '#007acc40';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isResizingNodeMgr) {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                        }
                                    }}
                                />
                            </div>
                        </ConfigProvider>
                    )}

                    {/* Preview Header - only in batch mode */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        backgroundColor: isBatchMode ? '#1a1a1a' : 'transparent'
                    }}>
                        {/* Tab Bar - only show in normal mode when tabs exist */}
                        {!isBatchMode && (
                            <TabBar />
                        )}

                        {isBatchMode && (
                            <div style={{
                                padding: '10px 16px',
                                borderBottom: '1px solid #333',
                                color: '#fff',
                                fontWeight: 'bold',
                                fontSize: 13,
                                backgroundColor: '#252525',
                                flexShrink: 0
                            }}>
                                {batchSelectedPath
                                    ? `预览: ${batchSelectedPath.split(/[/\\]/).pop()}`
                                    : '点击左侧模型卡片预览'}
                            </div>
                        )}

                        {/* SINGLE MainLayoutOld - always rendered, positioned based on mode */}
                        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <MainLayoutOld />
                        </Content>
                    </div>
                </div>
            </div>

            <NodeDialog
                visible={showNodeDialog}
                nodeId={editingNodeId}
                onClose={() => setNodeDialogVisible(false)}
            />
            <CreateNodeDialog />
            <ViewSettingsWindow />
        </>
    );
};

export default MainLayoutNew;
