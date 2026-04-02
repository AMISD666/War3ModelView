/**
 * Main layout wrapper that keeps a single MainLayout instance mounted.
 * This avoids war3-model shared state corruption while still supporting
 * batch mode, detached panels, and resizable side panes.
 */

import React, { Suspense, lazy, useState, useCallback, useRef, useEffect } from 'react'
import { Layout, ConfigProvider, theme, Button } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { listen } from '@tauri-apps/api/event'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { useModelStore } from '../store/modelStore'
import { useRendererStore } from '../store/rendererStore'
import { TabBar } from './TabBar'
import { handleGlobalShortcutKeyDown } from '../shortcuts/manager'
import AppErrorBoundary from './common/AppErrorBoundary'
import { uiText } from '../constants/uiText'

const MainLayoutOld = lazy(() => import('./MainLayout'))
const NodeManagerWindow = lazy(() => import('./node/NodeManagerWindow').then((m) => ({ default: m.NodeManagerWindow })))
const CreateNodeDialog = lazy(() => import('./node/CreateNodeDialog').then((m) => ({ default: m.CreateNodeDialog })))
const ViewSettingsWindow = lazy(() => import('./ViewSettingsWindow').then((m) => ({ default: m.ViewSettingsWindow })))
const BatchManager = lazy(() => import('./batch/BatchManager').then((m) => ({ default: m.BatchManager })))
const MpqBrowserPanel = lazy(() => import('./mpq/MpqBrowserPanel').then((m) => ({ default: m.MpqBrowserPanel })))

const { Content } = Layout

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const MainLayoutNew: React.FC = () => {
    const { showNodeManager, showMpqBrowser, showCreateNodeDialog, setShowNodeManager, setShowMpqBrowser } = useUIStore()
    const mainMode = useSelectionStore((state) => state.mainMode)
    const showSettingsPanel = useRendererStore((state) => state.showSettingsPanel)

    const [nodeManagerWidth, setNodeManagerWidth] = useState(300)
    const [isResizingNodeMgr, setIsResizingNodeMgr] = useState(false)
    const [batchPanelWidth, setBatchPanelWidth] = useState(54)
    const [isResizingBatch, setIsResizingBatch] = useState(false)
    const [mpqPanelWidth, setMpqPanelWidth] = useState(360)
    const [isResizingMpqPanel, setIsResizingMpqPanel] = useState(false)
    const [isBatchFullView, setIsBatchFullView] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false
        return window.localStorage.getItem('batch.fullView') === '1'
    })
    const [batchSelectedAnimation, setBatchSelectedAnimation] = useState<number>(0)

    const containerRef = useRef<HTMLDivElement>(null)

    const addTab = useModelStore((state) => state.addTab)
    const tabs = useModelStore((state) => state.tabs)
    const activeTabId = useModelStore((state) => state.activeTabId)
    const activeBatchTab = tabs.find((tab) => tab.id === activeTabId) || null
    const batchSelectedPath = activeBatchTab?.path || null

    const getNodeManagerBounds = useCallback(() => {
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth
        const minWidth = 180
        const maxWidth = Math.max(minWidth, Math.min(560, containerWidth - 520))
        return { minWidth, maxWidth }
    }, [])

    const getBatchPanelBounds = useCallback(() => {
        const containerWidth = Math.max(1, containerRef.current?.clientWidth ?? window.innerWidth)
        const minPercentByPx = (260 / containerWidth) * 100
        const minPercent = Math.min(48, Math.max(20, minPercentByPx))
        const maxPercent = Math.max(52, Math.min(80, 100 - minPercent))
        return { minPercent, maxPercent }
    }, [])

    const getMpqPanelBounds = useCallback(() => {
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth
        const minWidth = 260
        const maxWidth = Math.max(minWidth, Math.min(760, containerWidth - 420))
        return { minWidth, maxWidth }
    }, [])

    const handleBatchSelectModel = useCallback(
        (path: string, animationIndex: number) => {
            console.log('[MainLayoutNew] Batch model selected:', path, 'animation:', animationIndex)
            setBatchSelectedAnimation(animationIndex)
            addTab(path)
        },
        [addTab]
    )

    const handleBatchAnimationChange = useCallback((animationIndex: number) => {
        setBatchSelectedAnimation(animationIndex)
    }, [])

    const handleNodeMgrMouseDown = (e: React.MouseEvent) => {
        setIsResizingNodeMgr(true)
        e.preventDefault()
    }

    const handleBatchDividerMouseDown = (e: React.MouseEvent) => {
        setIsResizingBatch(true)
        e.preventDefault()
    }

    const handleMpqDividerMouseDown = (e: React.MouseEvent) => {
        setIsResizingMpqPanel(true)
        e.preventDefault()
    }

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingNodeMgr) {
                const containerRect = containerRef.current?.getBoundingClientRect()
                const newWidth = containerRect ? e.clientX - containerRect.left : e.clientX
                const { minWidth, maxWidth } = getNodeManagerBounds()
                setNodeManagerWidth(clamp(newWidth, minWidth, maxWidth))
            }

            if (isResizingBatch && containerRef.current) {
                const containerRect = containerRef.current.getBoundingClientRect()
                const newWidthPx = e.clientX - containerRect.left
                const newWidthPercent = (newWidthPx / containerRect.width) * 100
                const { minPercent, maxPercent } = getBatchPanelBounds()
                setBatchPanelWidth(clamp(newWidthPercent, minPercent, maxPercent))
            }

            if (isResizingMpqPanel && containerRef.current) {
                const containerRect = containerRef.current.getBoundingClientRect()
                const newWidth = containerRect.right - e.clientX
                const { minWidth, maxWidth } = getMpqPanelBounds()
                setMpqPanelWidth(clamp(newWidth, minWidth, maxWidth))
            }
        }

        const handleMouseUp = () => {
            setIsResizingNodeMgr(false)
            setIsResizingBatch(false)
            setIsResizingMpqPanel(false)
        }

        if (isResizingNodeMgr || isResizingBatch || isResizingMpqPanel) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizingNodeMgr, isResizingBatch, isResizingMpqPanel, getNodeManagerBounds, getBatchPanelBounds, getMpqPanelBounds])

    useEffect(() => {
        const clampPanelSizes = () => {
            const { minWidth, maxWidth } = getNodeManagerBounds()
            const { minPercent, maxPercent } = getBatchPanelBounds()
            const mpqBounds = getMpqPanelBounds()
            setNodeManagerWidth((prev) => clamp(prev, minWidth, maxWidth))
            setBatchPanelWidth((prev) => clamp(prev, minPercent, maxPercent))
            setMpqPanelWidth((prev) => clamp(prev, mpqBounds.minWidth, mpqBounds.maxWidth))
        }

        clampPanelSizes()
        window.addEventListener('resize', clampPanelSizes)
        return () => window.removeEventListener('resize', clampPanelSizes)
    }, [getNodeManagerBounds, getBatchPanelBounds, getMpqPanelBounds])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem('batch.fullView', isBatchFullView ? '1' : '0')
    }, [isBatchFullView])

    useEffect(() => {
        const unlisten = listen<string[]>('open-files', async (event) => {
            console.log('[MainLayoutNew] Received open-files event:', event.payload)
            const paths = event.payload
            if (!paths || paths.length === 0) return

            for (const path of paths) {
                addTab(path)
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
        })

        return () => {
            unlisten.then((fn) => fn())
        }
    }, [addTab])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            handleGlobalShortcutKeyDown(event)
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [])

    const isBatchMode = mainMode === 'batch'

    return (
        <>
            <div
                ref={containerRef}
                style={{ height: '100dvh', display: 'flex', overflow: 'hidden', position: 'relative', minWidth: 0 }}
            >
                {isBatchMode && (
                    <>
                        <div
                            style={{
                                width: isBatchFullView ? '100%' : `${batchPanelWidth}%`,
                                height: '100%',
                                overflow: 'hidden',
                                flexShrink: 0,
                                minWidth: 0,
                            }}
                        >
                            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
                                <AppErrorBoundary scope="Batch Panel" compact>
                                    <Suspense fallback={null}>
                                        <BatchManager
                                            onSelectModel={handleBatchSelectModel}
                                            onAnimationChange={handleBatchAnimationChange}
                                            selectedPath={batchSelectedPath}
                                            isFullBatchView={isBatchFullView}
                                            onToggleFullBatchView={() => setIsBatchFullView((prev) => !prev)}
                                        />
                                    </Suspense>
                                </AppErrorBoundary>
                            </ConfigProvider>
                        </div>

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
                                    justifyContent: 'center',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isResizingBatch) {
                                        e.currentTarget.style.backgroundColor = '#007acc80'
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isResizingBatch) {
                                        e.currentTarget.style.backgroundColor = '#333'
                                    }
                                }}
                            >
                                <div
                                    style={{
                                        width: '2px',
                                        height: '40px',
                                        backgroundColor: '#666',
                                        borderRadius: '1px',
                                    }}
                                />
                            </div>
                        )}
                    </>
                )}

                <div
                    style={{
                        flex: 1,
                        display: isBatchMode && isBatchFullView ? 'none' : 'flex',
                        height: '100%',
                        overflow: 'hidden',
                        minWidth: 0,
                    }}
                >
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
                                    minWidth: 0,
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
                                        gap: 8,
                                    }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {uiText.layout.nodeManager}
                                    </span>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<CloseOutlined />}
                                        onClick={() => setShowNodeManager(false)}
                                        title={uiText.layout.closeNodeManager}
                                        style={{ color: '#bbb', marginRight: 6 }}
                                    />
                                </div>
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <AppErrorBoundary scope="Node Manager" compact>
                                        <Suspense fallback={null}>
                                            <NodeManagerWindow />
                                        </Suspense>
                                    </AppErrorBoundary>
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
                                        transition: 'background-color 0.2s',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isResizingNodeMgr) {
                                            e.currentTarget.style.backgroundColor = '#007acc40'
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isResizingNodeMgr) {
                                            e.currentTarget.style.backgroundColor = 'transparent'
                                        }
                                    }}
                                />
                            </div>
                        </ConfigProvider>
                    )}

                    <div
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            backgroundColor: isBatchMode ? '#1a1a1a' : 'transparent',
                            minWidth: 0,
                        }}
                    >
                        {!isBatchMode && <TabBar />}
                        {isBatchMode && <TabBar emptyText={uiText.layout.batchPreviewEmpty} />}

                        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                            <AppErrorBoundary scope="Main Editor">
                                <Suspense fallback={<div style={{ flex: 1, backgroundColor: '#1a1a1a' }} />}>
                                    <MainLayoutOld />
                                </Suspense>
                            </AppErrorBoundary>
                        </Content>
                    </div>

                    {showMpqBrowser && (
                        <div
                            style={{
                                width: mpqPanelWidth,
                                borderLeft: '1px solid #303030',
                                backgroundColor: '#1e1e1e',
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative',
                                flexShrink: 0,
                                minWidth: 0,
                            }}
                        >
                            <div
                                onMouseDown={handleMpqDividerMouseDown}
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: '4px',
                                    cursor: 'ew-resize',
                                    backgroundColor: isResizingMpqPanel ? '#007acc' : 'transparent',
                                    transition: 'background-color 0.2s',
                                    zIndex: 2,
                                }}
                                onMouseEnter={(e) => {
                                    if (!isResizingMpqPanel) {
                                        e.currentTarget.style.backgroundColor = '#007acc40'
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isResizingMpqPanel) {
                                        e.currentTarget.style.backgroundColor = 'transparent'
                                    }
                                }}
                            />
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
                                    <AppErrorBoundary scope="MPQ Browser" compact>
                                        <Suspense fallback={null}>
                                            <MpqBrowserPanel onClose={() => setShowMpqBrowser(false)} />
                                        </Suspense>
                                    </AppErrorBoundary>
                                </ConfigProvider>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {showCreateNodeDialog && (
                <AppErrorBoundary scope="Create Node Dialog" compact>
                    <Suspense fallback={null}>
                        <CreateNodeDialog />
                    </Suspense>
                </AppErrorBoundary>
            )}

            {showSettingsPanel && (
                <AppErrorBoundary scope="View Settings" compact>
                    <Suspense fallback={null}>
                        <ViewSettingsWindow />
                    </Suspense>
                </AppErrorBoundary>
            )}
        </>
    )
}

export default MainLayoutNew
