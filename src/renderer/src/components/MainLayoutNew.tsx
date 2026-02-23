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
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
    const [batchPanelWidth, setBatchPanelWidth] = useState(54); // percentage
    const [isResizingBatch, setIsResizingBatch] = useState(false);
    const [isBatchFullView, setIsBatchFullView] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('batch.fullView') === '1';
    });
    const containerRef = useRef<HTMLDivElement>(null);

    // Batch mode state: track selected model for preview
    const [batchSelectedPath, setBatchSelectedPath] = useState<string | null>(null);
    const [batchSelectedAnimation, setBatchSelectedAnimation] = useState<number>(0);
    const { addTab } = useModelStore();
    const getNodeManagerBounds = useCallback(() => {
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const minWidth = 180;
        const maxWidth = Math.max(minWidth, Math.min(560, containerWidth - 520));
        return { minWidth, maxWidth };
    }, []);
    const getBatchPanelBounds = useCallback(() => {
        const containerWidth = Math.max(1, containerRef.current?.clientWidth ?? window.innerWidth);
        const minPercentByPx = (260 / containerWidth) * 100;
        const minPercent = Math.min(48, Math.max(20, minPercentByPx));
        const maxPercent = Math.max(52, Math.min(80, 100 - minPercent));
        return { minPercent, maxPercent };
    }, []);

    // Handle model selection from BatchManager
    const handleBatchSelectModel = useCallback((path: string, animationIndex: number) => {
        console.log('[MainLayoutNew] Batch model selected:', path, 'animation:', animationIndex);
        setBatchSelectedPath(path);
        setBatchSelectedAnimation(animationIndex);
        // Open through tab system so it is visible in main view tab bar.
        addTab(path);
    }, [addTab]);

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
                const containerRect = containerRef.current?.getBoundingClientRect();
                const newWidth = containerRect ? e.clientX - containerRect.left : e.clientX;
                const { minWidth, maxWidth } = getNodeManagerBounds();
                setNodeManagerWidth(clamp(newWidth, minWidth, maxWidth));
            }
            if (isResizingBatch && containerRef.current) {
                const containerRect = containerRef.current.getBoundingClientRect();
                const newWidthPx = e.clientX - containerRect.left;
                const newWidthPercent = (newWidthPx / containerRect.width) * 100;
                const { minPercent, maxPercent } = getBatchPanelBounds();
                setBatchPanelWidth(clamp(newWidthPercent, minPercent, maxPercent));
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
    }, [isResizingNodeMgr, isResizingBatch, getNodeManagerBounds, getBatchPanelBounds]);

    useEffect(() => {
        const clampPanelSizes = () => {
            const { minWidth, maxWidth } = getNodeManagerBounds();
            const { minPercent, maxPercent } = getBatchPanelBounds();
            setNodeManagerWidth((prev) => clamp(prev, minWidth, maxWidth));
            setBatchPanelWidth((prev) => clamp(prev, minPercent, maxPercent));
        };
        clampPanelSizes();
        window.addEventListener('resize', clampPanelSizes);
        return () => window.removeEventListener('resize', clampPanelSizes);
    }, [getNodeManagerBounds, getBatchPanelBounds]);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('batch.fullView', isBatchFullView ? '1' : '0');
    }, [isBatchFullView]);

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
                style={{ height: '100dvh', display: 'flex', overflow: 'hidden', position: 'relative', minWidth: 0 }}
            >
                {/* Batch Mode: Left Panel - BatchManager */}
                {isBatchMode && (
                    <>
                        <div style={{
                            width: isBatchFullView ? '100%' : `${batchPanelWidth}%`,
                            height: '100%',
                            overflow: 'hidden',
                            flexShrink: 0,
                            minWidth: 0
                        }}>
                            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
                                <BatchManager
                                    onSelectModel={handleBatchSelectModel}
                                    onAnimationChange={handleBatchAnimationChange}
                                    selectedPath={batchSelectedPath}
                                    isFullBatchView={isBatchFullView}
                                    onToggleFullBatchView={() => setIsBatchFullView((prev) => !prev)}
                                />
                            </ConfigProvider>
                        </div>

                        {/* Resizable Divider */}
                        {!isBatchFullView && (
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
                        )}
                    </>
                )}

                {/* Main Content Area: keep mounted to avoid renderer/context reset in full batch view */}
                <div style={{
                    flex: 1,
                    display: isBatchMode && isBatchFullView ? 'none' : 'flex',
                    height: '100%',
                    overflow: 'hidden',
                    minWidth: 0
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
                                    flexShrink: 0,
                                    minWidth: 0
                                }}
                            >
                                <div
                                    style={{
                                        padding: '6px 8px 6px 12px',
                                        borderBottom: '1px solid #303030',
                                        fontWeight: 'bold',
                                        color: '#fff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 8
                                    }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        节点管理器
                                    </span>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<CloseOutlined />}
                                        onClick={() => setShowNodeManager(false)}
                                        title="关闭节点管理器"
                                        style={{ color: '#bbb', marginRight: 6 }}
                                    />
                                </div>
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
                        backgroundColor: isBatchMode ? '#1a1a1a' : 'transparent',
                        minWidth: 0
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
                        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
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
