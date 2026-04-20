import React, { useState, useCallback, useEffect, useRef, Suspense, useMemo } from 'react'
import type { ViewerRef } from './Viewer'
import MenuBar from './MenuBar'
// Lazy load modal components for faster startup
const GeosetAnimationModal = React.lazy(() => import('./modals/GeosetAnimationModal'))
const TextureEditorModal = React.lazy(() => import('./modals/TextureEditorModal'))
const TextureAnimationManagerModal = React.lazy(() => import('./modals/TextureAnimationManagerModal'))
const SequenceEditorModal = React.lazy(() => import('./modals/SequenceEditorModal'))
const CameraManagerModal = React.lazy(() => import('./modals/CameraManagerModal'))
const UVModeLayout = React.lazy(() => import('./UVModeLayout'))
const AnimationModeLayout = React.lazy(() => import('./animation/AnimationModeLayout'))
const MaterialEditorModal = React.lazy(() => import('./modals/MaterialEditorModal'))
const GeosetEditorModal = React.lazy(() => import('./modals/GeosetEditorModal'))
const GlobalSequenceModal = React.lazy(() => import('./modals/GlobalSequenceModal'))
const TransformModelDialog = React.lazy(() => import('./node/TransformModelDialog').then(m => ({ default: m.TransformModelDialog })))
const ModelOptimizeModal = React.lazy(() => import('./modals/ModelOptimizeModal'))
const Viewer = React.lazy(() => import('./Viewer'))
const AnimationPanel = React.lazy(() => import('./AnimationPanel'))
const EditorPanel = React.lazy(() => import('./EditorPanel'))

import { GeosetVisibilityPanel } from './GeosetVisibilityPanel'
import { getRecentFiles, clearRecentFiles, replaceRecentModelPath, RecentFile } from '../services/historyService'
import { useModelStore, mergeMaterialManagerPreview, mergeNodeEditorPreview } from '../store/modelStore'
import { NodeType } from '../types/node'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { useRendererStore } from '../store/rendererStore'
import { GlobalMessageLayer } from './GlobalMessageLayer'
import { showMessage, showConfirm } from '../store/messageStore'
import { registerShortcutHandler } from '../shortcuts/manager'
import { Button } from 'antd';
import AppErrorBoundary from './common/AppErrorBoundary'
import { TEXTURE_ADJUSTMENTS_KEY } from '../utils/textureAdjustments'
import { windowManager } from '../utils/WindowManager'
import {
    type NodeEditorRpcState,
} from '../types/nodeEditorRpc'
import { historyCommandService, modelDocumentCommandHandler, nodeEditorCommandHandler } from '../application/commands'
import { useRpcServer } from '../hooks/useRpc'
import { markStandalonePerf } from '../utils/standalonePerf'
import { parseModelBuffer, mergeGeosets, mergeAnimations } from '../utils/modelMerge'
import { desktopGateway } from '../infrastructure/desktop'
import { windowGateway } from '../infrastructure/window'
import { saveCurrentModelWorkflow, type TextureAssetOperationResult, type SaveValidationContext } from '../application/model-save'
import { DEFAULT_IMPORT_FILE_DIALOG_OPTIONS, openModelWorkflow } from '../application/model-open'
import { useAppShellController } from '../application/shell/useAppShellController'
import { useModelToolsController } from '../application/model-tools/useModelToolsController'
import {
    cameraManagerCommandHandler,
    createCameraNodeFromOrbitView,
    geosetAnimationCommandHandler,
    geosetEditorCommandHandler,
    geosetVisibilityCommandHandler,
    globalColorAdjustCommandHandler,
    globalSequenceManagerCommandHandler,
    type GlobalColorAdjustRpcState,
    type GlobalSequenceManagerRpcState,
    getOrbitCameraViewFromModelCamera,
    materialManagerCommandHandler,
    type SequenceManagerRpcState,
    sequenceManagerCommandHandler,
    stripGeosetDataForToolWindow,
    textureAnimationCommandHandler,
    textureManagerCommandHandler,
    toolWindowOrchestrator,
    toGlobalSequenceDurations,
    ToolWindowBroadcastCoordinator,
    ToolWindowSnapshotCache,
    type MaterialManagerPatch,
    type MaterialManagerRpcState,
    type TextureManagerPatch,
    type TextureManagerRpcState,
} from '../application/window-bridge'
import { uiText } from '../constants/uiText'
import { useGlobalColorAdjustStore } from '../store/globalColorAdjustStore'
import { applyGlobalColorAdjustmentsToModel } from '../services/globalColorAdjustModelService'
import { commitSavedModelToStore } from '../services/commitSavedModelService'
import { getBasename, getDirname, joinPath, normalizeWindowsPath } from '../utils/windowsPath'
import { AboutDialog } from './shell/AboutDialog'

const toArrayBuffer = (value: ArrayBuffer | Uint8Array): ArrayBuffer => {
    if (value instanceof ArrayBuffer) return value
    const { buffer, byteOffset, byteLength } = value
    if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
        return buffer
    }
    return value.slice().buffer
}

const MainLayout: React.FC = () => {
    // Zustand stores
    const modelPath = useModelStore(state => state.modelPath)
    const activeTabId = useModelStore(state => state.activeTabId)
    const setZustandModelData = useModelStore(state => state.setModelData)
    const addTab = useModelStore(state => state.addTab)
    const setZustandLoading = useModelStore(state => state.setLoading)
    const {
        showAbout,
        setShowAbout,
        showDebugConsole,
        setShowDebugConsole,
        activationStatus,
        activationCode,
        setActivationCode,
        activationLoading,
        activationError,
        checkUpdate,
        showChangelog,
        activate,
    } = useAppShellController()
    const {
        recalculateNormals,
        recalculateExtents,
        repairModel,
        addDeathAnimation,
        removeLights,
        mergeSameMaterials,
        cleanUnusedMaterials,
        cleanUnusedTextures,
    } = useModelToolsController()
    const showCreateNodeDialog = useUIStore(state => state.showCreateNodeDialog);
    const setCreateNodeDialogVisible = useUIStore(state => state.setCreateNodeDialogVisible);
    const showTransformModelDialog = useUIStore(state => state.showTransformModelDialog);
    const setTransformModelDialogVisible = useUIStore(state => state.setTransformModelDialogVisible);
    const currentSequence = useModelStore(state => state.currentSequence)
    const sequences = useModelStore(state => state.sequences)
    const currentFrame = useModelStore(state => state.currentFrame)
    const isPlaying = useModelStore(state => state.isPlaying)
    const playbackSpeed = useModelStore(state => state.playbackSpeed)
    const isLooping = useModelStore(state => state.isLooping)
    const setPlaying = useModelStore(state => state.setPlaying)
    const setFrame = useModelStore(state => state.setFrame)
    const setLooping = useModelStore(state => state.setLooping)
    const renderer = useRendererStore(state => state.renderer)
    const { toggleNodeManager, toggleModelInfo } = useUIStore()
    const { mainMode, setMainMode } = useSelectionStore()



    const [activeEditor, setActiveEditor] = useState<string | null>(null)
    const [showGeosetAnimModal, setShowGeosetAnimModal] = useState<boolean>(false)
    const [showGeosetVisibilityToolModal, setShowGeosetVisibilityToolModal] = useState<boolean>(false)
    const [showTextureModal, setShowTextureModal] = useState<boolean>(false)
    const [showTextureAnimModal, setShowTextureAnimModal] = useState<boolean>(false)
    const [showSequenceModal, setShowSequenceModal] = useState<boolean>(false)
    const [showGlobalSeqModal, setShowGlobalSeqModal] = useState<boolean>(false)

    const getPlaybackInterval = useCallback((): [number, number] => {
        const rawInterval = renderer?.rendererData?.animationInfo?.Interval
        if (rawInterval && typeof (rawInterval as any).length === 'number' && (rawInterval as any).length >= 2) {
            const start = Number((rawInterval as any)[0] ?? 0)
            const end = Number((rawInterval as any)[1] ?? start)
            return [Number.isFinite(start) ? start : 0, Number.isFinite(end) ? end : 0]
        }

        const seq = currentSequence >= 0 ? sequences?.[currentSequence] as any : null
        const seqInterval = seq?.Interval
        if (seqInterval && typeof seqInterval.length === 'number' && seqInterval.length >= 2) {
            const start = Number(seqInterval[0] ?? 0)
            const end = Number(seqInterval[1] ?? start)
            return [Number.isFinite(start) ? start : 0, Number.isFinite(end) ? end : 0]
        }

        return [0, 0]
    }, [renderer, currentSequence, sequences])

    const handleTogglePlay = useCallback(() => {
        if (isPlaying) {
            setPlaying(false)
            return
        }

        const [start, end] = getPlaybackInterval()
        const ended = Number.isFinite(currentFrame) && currentFrame >= end - 0.1
        const nextFrame = ended ? start : Math.max(start, Math.min(currentFrame, end))

        if (ended) {
            setFrame(nextFrame)
            if (renderer?.rendererData) {
                renderer.rendererData.frame = nextFrame
            }
        }

        setPlaying(true)
    }, [isPlaying, getPlaybackInterval, currentFrame, setFrame, renderer, setPlaying])

    const handleToggleLooping = useCallback(() => {
        const nextLooping = !isLooping
        setLooping(nextLooping)

        if (!nextLooping || isPlaying) {
            return
        }

        const [start, end] = getPlaybackInterval()
        const ended = Number.isFinite(currentFrame) && currentFrame >= end - 0.1
        if (!ended) {
            return
        }

        setFrame(start)
        if (renderer?.rendererData) {
            renderer.rendererData.frame = start
        }
        setPlaying(true)
    }, [isLooping, setLooping, isPlaying, getPlaybackInterval, currentFrame, setFrame, renderer, setPlaying])
    const toRpcSafeNodeSnapshot = (value: any): any => {
        if (value == null) return value
        if (ArrayBuffer.isView(value)) {
            return Array.from(value as unknown as ArrayLike<number>)
        }
        if (Array.isArray(value)) {
            return value.map((entry) => toRpcSafeNodeSnapshot(entry))
        }
        if (typeof value === 'object') {
            const result: Record<string, any> = {}
            Object.entries(value).forEach(([key, entry]) => {
                result[key] = toRpcSafeNodeSnapshot(entry)
            })
            return result
        }
        return value
    }

    const [showGeosetModal, setShowGeosetModal] = useState<boolean>(false)
    const [showModelOptimizeModal, setShowModelOptimizeModal] = useState<boolean>(false)
    const [modelOptimizeRunning, setModelOptimizeRunning] = useState<boolean>(false)
    const [modelOptimizeLastResult, setModelOptimizeLastResult] = useState<string>('')
    const modelOptimizeRunningRef = useRef(false)


    // Use modelData directly from store to ensure updates from NodeManager are reflected
    const modelData = useModelStore(state => state.modelData)
    const materialManagerPreview = useModelStore(state => state.materialManagerPreview)
    const nodeEditorPreview = useModelStore(state => state.nodeEditorPreview)
    const globalColorAdjustSettings = useGlobalColorAdjustStore(state => state.settings)
    const viewerModelData = useMemo(
        () => applyGlobalColorAdjustmentsToModel(
            mergeNodeEditorPreview(mergeMaterialManagerPreview(modelData, materialManagerPreview), nodeEditorPreview),
            globalColorAdjustSettings
        ),
        [modelData, materialManagerPreview, nodeEditorPreview, globalColorAdjustSettings]
    )
    const standaloneWarmupStartedRef = useRef(false)
    const toolWindowSnapshotCacheRef = useRef(new ToolWindowSnapshotCache())
    const toolWindowBroadcastCoordinatorRef = useRef(new ToolWindowBroadcastCoordinator())
    const cameraManagerBroadcasterRef = useRef<(state: { cameras: unknown[]; globalSequences: number[] }) => void>(() => { })

    const nodeEditorSnapshotCacheRef = useRef({
        snapshotVersion: 0,
        sessionKey: '',
        lastNodeJson: '',
    })

    const ensureNodeEditorSnapshotState = useCallback((): NodeEditorRpcState => {
        const session = windowManager.getPendingNodeEditorSession()
        const cache = nodeEditorSnapshotCacheRef.current
        if (!session) {
            return {
                snapshotVersion: 0,
                sessionNonce: 0,
                kind: '',
                objectId: -1,
                node: null,
                textures: [],
                materials: [],
                globalSequences: [],
                sequences: [],
                modelPath: '',
                renameInitialName: '',
                allNodes: [],
                pivotPoints: [],
            }
        }
        const live = useModelStore.getState()
        const node = live.getNodeById(session.objectId)
        let nodeJson = ''
        try {
            nodeJson = node ? JSON.stringify(node) : 'null'
        } catch {
            nodeJson = String(Date.now())
        }
        const sessionKey = `${session.kind}:${session.objectId}:${session.sessionNonce}`
        if (cache.sessionKey !== sessionKey || cache.lastNodeJson !== nodeJson) {
            cache.snapshotVersion += 1
            cache.sessionKey = sessionKey
            cache.lastNodeJson = nodeJson
        }
        const md = live.modelData
        let cloned: any = null
        if (node) {
            try {
                cloned = toRpcSafeNodeSnapshot(structuredClone(node))
            } catch {
                cloned = toRpcSafeNodeSnapshot(node)
            }
        }
        return {
            snapshotVersion: cache.snapshotVersion,
            sessionNonce: session.sessionNonce,
            kind: session.kind,
            objectId: session.objectId,
            node: cloned,
            textures: md?.Textures ?? [],
            materials: md?.Materials ?? [],
            globalSequences: md?.GlobalSequences ?? [],
            sequences: md?.Sequences ?? [],
            modelPath: live.modelPath ?? '',
            renameInitialName: node?.Name ?? '',
            allNodes: live.nodes ?? [],
            pivotPoints: md?.PivotPoints ?? [],
        }
    }, [])


    const ensureTextureManagerSnapshotState = useCallback((): TextureManagerRpcState => {
        const liveModelState = useModelStore.getState()
        const selectionState = useSelectionStore.getState()
        return toolWindowSnapshotCacheRef.current.buildTextureManagerState({
            modelData: liveModelState.modelData,
            modelPath: liveModelState.modelPath,
            materialManagerPreview: liveModelState.materialManagerPreview,
            selection: selectionState,
            markPerf: markStandalonePerf,
        })
    }, [])

    const ensureMaterialManagerSnapshotState = useCallback((): MaterialManagerRpcState => {
        const liveModelState = useModelStore.getState()
        const selectionState = useSelectionStore.getState()
        return toolWindowSnapshotCacheRef.current.buildMaterialManagerState({
            modelData: liveModelState.modelData,
            modelPath: liveModelState.modelPath,
            materialManagerPreview: liveModelState.materialManagerPreview,
            selection: selectionState,
            markPerf: markStandalonePerf,
        })
    }, [])
    // RPC Server for modelOptimize standalone window
    const getModelOptimizeState = useCallback(() => {
        let total = 0;
        if (modelData?.Geosets && Array.isArray(modelData.Geosets)) {
            modelData.Geosets.forEach((g: any) => {
                if (g.Faces && typeof g.Faces.length === 'number') {
                    total += g.Faces.length / 3;
                }
            });
        }
        return {
            originalFaces: Math.floor(total),
            isOptimizing: modelOptimizeRunning,
            lastResult: modelOptimizeLastResult
        };
    }, [modelData, modelOptimizeRunning, modelOptimizeLastResult]);

    const handleModelOptimizeCommand = useCallback((command: string, payload: any) => {
        if (modelOptimizeRunningRef.current) {
            showMessage('warning', '模型优化', '已有优化任务正在执行，请等待完成。');
            return;
        }

        const currentModel = useModelStore.getState().modelData;
        const currentPath = useModelStore.getState().modelPath;
        if (!currentModel) {
            showMessage('warning', '模型优化', '当前没有可优化的模型。');
            return;
        }

        const run = async () => {
            modelOptimizeRunningRef.current = true;
            setModelOptimizeRunning(true);
            try {
                const snapshotBefore = structuredClone(currentModel);
                const workingCopy = structuredClone(currentModel);
                const startedAt = performance.now();

                if (command === 'EXECUTE_POLYGON_OPT') {
                    const { optimizeModelPolygons } = await import('../utils/modelOptimization')
                    const result = await optimizeModelPolygons(workingCopy, {
                        removeRedundantVertices: payload?.removeRedundantVertices !== false,
                        decimateModel: payload?.decimateModel !== false,
                        decimateRatio: Number(payload?.decimateRatio ?? 75)
                    });

                    if (!result.changed) {
                        setModelOptimizeLastResult('多边形优化完成');
                        showMessage('info', '模型优化', '多边形优化完成');
                        return;
                    }

                    const snapshotAfter = result.model;
                    modelDocumentCommandHandler.replaceModelData({
                        name: '模型多边形优化',
                        before: snapshotBefore,
                        after: snapshotAfter,
                        path: currentPath || null,
                    });

                    const elapsed = Math.round(performance.now() - startedAt);
                    const summary = `面数 ${result.stats.facesBefore} -> ${result.stats.facesAfter}，顶点 ${result.stats.verticesBefore} -> ${result.stats.verticesAfter}，耗时 ${elapsed}ms`;
                    setModelOptimizeLastResult(`多边形优化：${summary}`);
                    showMessage('success', '模型优化', `多边形优化完成：${summary}`);
                    return;
                }

                if (command === 'EXECUTE_KEYFRAME_OPT') {
                    const { optimizeModelKeyframes } = await import('../utils/modelOptimization')
                    const result = await optimizeModelKeyframes(workingCopy, {
                        removeRedundantFrames: payload?.removeRedundantFrames !== false,
                        optimizeKeyframes: payload?.optimizeKeyframes !== false
                    });

                    if (!result.changed) {
                        setModelOptimizeLastResult('关键帧优化完成：没有可安全优化的数据。');
                        showMessage('info', '模型优化', '关键帧优化完成，未检测到可优化项。');
                        return;
                    }

                    const snapshotAfter = result.model;
                    modelDocumentCommandHandler.replaceModelData({
                        name: '模型关键帧优化',
                        before: snapshotBefore,
                        after: snapshotAfter,
                        path: currentPath || null,
                        options: { skipAutoRecalculate: true },
                    });

                    const elapsed = Math.round(performance.now() - startedAt);
                    const summary = `关键帧 ${result.stats.keysBefore} -> ${result.stats.keysAfter}，轨道 ${result.stats.tracksProcessed}，耗时 ${elapsed}ms`;
                    setModelOptimizeLastResult(`关键帧优化：${summary}`);
                    showMessage('success', '模型优化', `关键帧优化完成：${summary}`);
                }
            } catch (error: any) {
                console.error('[ModelOptimize] Failed:', error);
                const message = error?.message || String(error);
                setModelOptimizeLastResult(`优化失败：${message}`);
                showMessage('error', '模型优化', `优化失败：${message}`);
            } finally {
                setModelOptimizeRunning(false);
                modelOptimizeRunningRef.current = false;
            }
        };

        void run();
    }, [setZustandModelData]);

    const { broadcastSync: broadcastModelOptimize } = useRpcServer(
        'modelOptimize',
        getModelOptimizeState,
        handleModelOptimizeCommand
    );

    useEffect(() => {
        let prevModelData = useModelStore.getState().modelData;
        let prevNodes = useModelStore.getState().nodes;

        const unsubscribe = useModelStore.subscribe((state) => {
            if (state.modelData !== prevModelData || state.nodes !== prevNodes) {
                prevModelData = state.modelData;
                prevNodes = state.nodes;
                broadcastModelOptimize(getModelOptimizeState());
            }
        });

        broadcastModelOptimize(getModelOptimizeState());

        return () => unsubscribe();
    }, [getModelOptimizeState, broadcastModelOptimize]);

    useEffect(() => {
        broadcastModelOptimize(getModelOptimizeState());
    }, [modelOptimizeRunning, modelOptimizeLastResult, getModelOptimizeState, broadcastModelOptimize]);

    // ---- Model Merge RPC Server ----
    const getModelMergeState = useCallback(() => {
        const store = useModelStore.getState();
        return {
            modelPath: store.modelPath || '',
            modelData: null, // Don't send full model data over RPC, too large
        };
    }, []);

    const handleModelMergeCommand = useCallback(async (command: string, payload: any) => {
        if (command === 'APPLY_MERGED_MODEL_PATH' && payload?.model2Path && payload?.mergeMode) {
            const currentModel = useModelStore.getState().modelData;
            const currentPath = useModelStore.getState().modelPath;
            const snapshotBefore = currentModel ? structuredClone(currentModel) : null;

            try {
                // Read model2 directly from disk in MainLayout to prevent RPC serialization from destroying TypedArrays
                const buffer = await desktopGateway.readFile(payload.model2Path);
                const arrayBuffer = toArrayBuffer(buffer as ArrayBuffer | Uint8Array);
                const model2Data = parseModelBuffer(arrayBuffer, payload.model2Path);

                let mergedModel: any = null;
                if (payload.mergeMode === 'geosets') {
                    mergedModel = mergeGeosets(currentModel, model2Data);

                    // Physical Texture Copy Logic for Geosets Mode
                    if (currentPath && payload.model2Path) {
                        const dir1 = currentPath.substring(0, Math.max(currentPath.lastIndexOf('\\'), currentPath.lastIndexOf('/')));
                        const dir2 = payload.model2Path.substring(0, Math.max(payload.model2Path.lastIndexOf('\\'), payload.model2Path.lastIndexOf('/')));
                        
                        if (dir1 !== dir2 && Array.isArray(model2Data.Textures)) {
                            for (const tex of model2Data.Textures) {
                                if (tex.Image) {
                                    try {
                                        const srcPath = dir2.endsWith('\\') || dir2.endsWith('/') ? `${dir2}${tex.Image}` : `${dir2}\\${tex.Image}`;
                                        const destPath = dir1.endsWith('\\') || dir1.endsWith('/') ? `${dir1}${tex.Image}` : `${dir1}\\${tex.Image}`;
                                        await desktopGateway.copyFile(srcPath, destPath);                                    } catch(e) {
                                        // Ignore, might be an MPQ texture or already exists
                                    }
                                }
                            }
                        }
                    }
                } else {
                    mergedModel = mergeAnimations(currentModel, model2Data);
                }

                modelDocumentCommandHandler.replaceModelData({
                    name: '模型合并',
                    before: snapshotBefore,
                    after: mergedModel,
                    path: currentPath || null,
                    forceRendererReload: true,
                });
                showMessage('success', '模型合并', '模型合并完成');
            } catch (err) {
                console.error('[ModelMerge] Failed to execute merge on main window:', err);
                showMessage('error', '模型合并失败', String(err));
            }
        }
    }, [setZustandModelData]);

    useRpcServer('modelMerge', getModelMergeState, handleModelMergeCommand);

    // ---- Dissolve Effect RPC Server ----
    const getDissolveEffectState = useCallback(() => {
        const store = useModelStore.getState();
        // Return stripped geosets to reduce payload size, similar to textureManager
        const stripGeosets = (geosets?: any[]) => {
            if (!geosets) return [];
            return geosets.map((g: any) => ({
                MaterialID: g.MaterialID,
                SelectionGroup: g.SelectionGroup,
                vertexCount: g.Vertices ? Math.floor(g.Vertices.length / 3) : 0
            }));
        };
        const stripSequences = (seqs?: any[]) => {
            if (!seqs) return [];
            return seqs.map((s: any) => ({
                Name: s.Name,
                Interval: s.Interval ? Array.from(s.Interval) : [0, 0]
            }));
        };
        return {
            geosets: stripGeosets(store.modelData?.Geosets),
            sequences: stripSequences(store.modelData?.Sequences),
            geosetCount: store.modelData?.Geosets?.length || 0,
        };
    }, []);

    const handleDissolveCommand = useCallback((command: string, payload: any) => {
        if (command === 'EXECUTE_DISSOLVE') {
            (async () => {
                const store = useModelStore.getState();
                if (!store.modelData || !store.modelPath) return;
                try {
                    const { executeDissolveEffect, refreshDissolveTexturesInRenderer } = await import('../utils/dissolveEffect');
                    const result = await executeDissolveEffect(store.modelData, store.modelPath, payload);
                    store.setVisualDataPatch({ Materials: result.materials, Textures: result.textures });
                    await refreshDissolveTexturesInRenderer(useRendererStore.getState().renderer, store.modelPath, result);
                } catch (e: any) {
                    console.error('[Dissolve] Failed:', e);
                }
            })();
        }
    }, []);

    const { broadcastSync: broadcastDissolveEffect } = useRpcServer('dissolveEffect', getDissolveEffectState, handleDissolveCommand);

    useEffect(() => {
        const unsubscribe = useModelStore.subscribe((state, prevState) => {
            if (state.modelData?.Geosets !== prevState.modelData?.Geosets || state.sequences !== prevState.sequences) {
                void windowManager.isToolWindowVisible('dissolveEffect').then((visible) => {
                    if (!visible) return
                    broadcastDissolveEffect(getDissolveEffectState());
                }).catch(() => { })
            }
        });
        return () => unsubscribe();
    }, [broadcastDissolveEffect, getDissolveEffectState]);


    useEffect(() => {
        return toolWindowOrchestrator.scheduleStandaloneWarmup(!!modelData, standaloneWarmupStartedRef)
    }, [modelData]);
    // Persistent settings
    // Persistent settings replaced by store
    const {
        showGridXY,
        showNodes, setShowNodes,
        showSkeleton, setShowSkeleton,
        showFPS, setShowFPS,
        showGeosetVisibility, setShowGeosetVisibility,
        showCollisionShapes, setShowCollisionShapes,
        showCameras, setShowCameras,
        showLights, setShowLights,
        showAttachments, setShowAttachments,
        renderMode, setRenderMode,
        backgroundColor, setBackgroundColor,
        teamColor, setTeamColor,
        mpqLoaded, setMpqLoaded
    } = useRendererStore();

    // Load initial settings into store (optional, or rely on store defaults)
    // Settings are now handled by rendererStore persistence
    const [viewPreset, setViewPreset] = useState<{ type: string, time: number } | null>(null)
    const handleSetViewPreset = useCallback((type: string) => {
        setViewPreset({ type, time: Date.now() });
    }, []);
    // removed local mpqLoaded


    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [isDragging, setIsDragging] = useState<boolean>(false) // For drag-drop visual feedback

    // Editor Panel Resizing
    const [editorWidth, setEditorWidth] = useState<number>(400)
    const [isResizingEditor, setIsResizingEditor] = useState<boolean>(false)
    const clampEditorWidth = useCallback((rawWidth: number) => {
        const minWidth = 220
        const maxWidth = Math.max(minWidth, window.innerWidth - 420)
        return Math.max(minWidth, Math.min(maxWidth, rawWidth))
    }, [])

    const viewerRef = useRef<ViewerRef>(null)
    const hasCheckedCli = useRef(false);
    const processedHotOpenPaths = useRef<Set<string>>(new Set())
    const isSavingRef = useRef(false); // Track if a save operation is in progress
    const isExternalModelDragRef = useRef(false);
    const bypassClosePromptRef = useRef(false);
    const lastGlobalColorModelPathRef = useRef<string | null | undefined>(undefined);
    const panelStateRef = useRef({
        activeEditor: null as string | null,
        showGeosetAnimModal: false,
        showTextureModal: false,
        showTextureAnimModal: false,
        showSequenceModal: false,
        showCameraModal: false,
        showMaterialModal: false,
        showGeosetModal: false,
        showGlobalSeqModal: false,
        showAbout: false
    })
    const handleImportRef = useRef<(() => void) | (() => Promise<void>)>(() => { })
    const handleSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
    const handleSaveAsRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
    const handleCopyModelRef = useRef<() => void>(() => { })
    const openModelAsTab = useCallback((filePath: string) => {        setIsLoading(true)
        setZustandLoading(true)
        const added = addTab(filePath)
        if (!added) {
            setIsLoading(false)
            setZustandLoading(false)
        }
        return added
    }, [addTab])

    const hasResetStore = useRef(false);

    useEffect(() => {
        panelStateRef.current = {
            activeEditor,
            showGeosetAnimModal,
            showTextureModal,
            showTextureAnimModal,
            showSequenceModal,
            showCameraModal: false,
            showMaterialModal: false, // Material manager is now a tool window
            showGeosetModal,
            showGlobalSeqModal,
            showAbout
        }
    }, [
        activeEditor,
        showGeosetAnimModal,
        showTextureModal,
        showTextureAnimModal,
        showSequenceModal,
        showGeosetModal,
        showGlobalSeqModal,
        showAbout
    ])

    useEffect(() => {
        const nextModelPath = modelPath || null;
        const previousModelPath = lastGlobalColorModelPathRef.current;
        lastGlobalColorModelPathRef.current = nextModelPath;
        if (previousModelPath === undefined || previousModelPath === nextModelPath) {
            return;
        }
        useGlobalColorAdjustStore.getState().resetSettings();
    }, [modelPath])

    // Intercept native window close during save operations and reset state on refresh
    useEffect(() => {
        if (hasResetStore.current) return;
        hasResetStore.current = true;

        // Full state reset on initialization (handles refresh/F5)
        // We do this BEFORE potentially loading CLI files
        const doReset = async () => {
            const { useModelStore } = await import('../store/modelStore');
            const { useSelectionStore } = await import('../store/selectionStore');
            const { useUIStore } = await import('../store/uiStore');
            const { useRendererStore } = await import('../store/rendererStore');
            const { useMessageStore } = await import('../store/messageStore');

            useModelStore.getState().reset();
            useSelectionStore.getState().reset();
            useUIStore.getState().reset();
            useRendererStore.getState().reset();
            historyCommandService.clear();
            useMessageStore.getState().clearAll();        };

        doReset();

        let unlisten: (() => void) | undefined;
        (async () => {
            unlisten = await windowGateway.onCurrentCloseRequested(async (event) => {
                if (bypassClosePromptRef.current) return;
                if (isSavingRef.current) {
                    event.preventDefault();
                    showMessage('warning', '提示', '正在保存模型，请稍候再关闭...');
                    return;
                }
                const { modelData, isAnyTabDirty } = useModelStore.getState();
                if (modelData && isAnyTabDirty()) {
                    event.preventDefault();
                    const shouldClose = await showConfirm('未保存的修改', '模型已修改，是否保存后再退出？');
                    if (!shouldClose) return;
                    bypassClosePromptRef.current = true;
                    void windowGateway.closeCurrentWindow();
                }
            });
        })();
        return () => {
            unlisten?.();
        };
    }, []);


    // Check for copy-model context menu
    useEffect(() => {
        const checkCliCopyPath = async () => {
            try {
                const copyPath = await desktopGateway.invoke<string | null>('get_cli_copy_path');
                if (copyPath) {
                    const result = await desktopGateway.invoke<string>('copy_model_with_textures', { modelPath: copyPath });
                    showMessage('success', '??', result);
                    return true;
                }
            } catch (e) {
                console.error('[MainLayout] Failed to handle copy CLI:', e);
            }
            return false;
        };

        // Check for file path from command line (Tauri - context menu launch)
        const checkCliFilePath = async () => {
            if (hasCheckedCli.current) return;
            hasCheckedCli.current = true;

            const copyHandled = await checkCliCopyPath();
            if (copyHandled) return;
            try {
                const cliPaths = await desktopGateway.invoke<string[]>('get_cli_file_paths');
                const pendingPaths = await desktopGateway.invoke<string[]>('get_pending_open_files');

                // Combine and unique
                const allPaths = Array.from(new Set([...cliPaths, ...pendingPaths]));

                if (allPaths.length > 0) {                    // ... (MPQ loading logic) ...
                    const savedPaths = localStorage.getItem('mpq_paths');
                    if (savedPaths && !mpqLoaded) {                        try {
                            const paths = JSON.parse(savedPaths);
                            try {
                                await desktopGateway.invoke('set_mpq_paths', { paths });
                            } catch (e) {
                                console.warn('[MainLayout] Failed to sync MPQ paths:', e);
                            }
                            const results = await Promise.allSettled(
                                paths.map((path: string) => desktopGateway.invoke('load_mpq', { path }))
                            );
                            const successCount = results.filter(r => r.status === 'fulfilled').length;
                            if (successCount > 0) {
                                setMpqLoaded(true);                            }
                        } catch (e) {
                            console.error('[MainLayout] MPQ pre-load failed:', e);
                        }
                    }

                    // Now load all models via tab system sequentially
                    await openModelWorkflow.openPathsSequentially({
                        paths: allPaths,
                        source: 'cli-hot-open',
                        addToRecent: false,
                        acceptPath: (path) => openModelWorkflow.isOpenableModelFile(path),
                        processedPaths: processedHotOpenPaths.current,
                        delayMs: 40,
                    }, {
                        openModelAsTab,
                        setRecentFiles,
                    })
                }
            } catch (e) {
                console.error('[MainLayout] Failed to get CLI file paths:', e);
            }
        };
        checkCliFilePath();
    }, [addTab, mpqLoaded, setZustandLoading]); // Dependency added for addTab and mpqLoaded

    // Listen for file open from Electron context menu (right-click "Open with")
    useEffect(() => {
        // Check if running in Electron and api is available
        const api = (window as any).api;
        if (api && api.onOpenFile) {            api.onOpenFile((filePath: string) => {
                openModelWorkflow.openPath({
                    path: filePath,
                    source: 'electron-open',
                    addToRecent: false,
                    acceptPath: (path) => openModelWorkflow.isOpenableModelFile(path),
                    processedPaths: processedHotOpenPaths.current,
                }, {
                    openModelAsTab,
                    setRecentFiles,
                })
            });
        }
    }, [openModelAsTab]);

    const createCameraFromCurrentView = useCallback(() => {
        const camera = viewerRef.current?.getCamera()
        if (!camera) {
            return null
        }
        const nextCameraNumber = useModelStore.getState().nodes.filter((node: any) => node.type === NodeType.CAMERA).length + 1
        return createCameraNodeFromOrbitView(camera, nextCameraNumber)
    }, [])

    const focusCameraInViewer = useCallback((cameraNode: Record<string, any>) => {
        const nextView = getOrbitCameraViewFromModelCamera(cameraNode)
        if (viewerRef.current && nextView) {
            viewerRef.current.setCamera(nextView)
        }
    }, [])

    // RPC Server for Camera Manager
    const nodes = useModelStore(state => state.nodes);
    const getCameraManagerState = useCallback(() => {
        const rawCameras = Array.isArray((modelData as any)?.Cameras) ? (modelData as any).Cameras : [];
        return {
            cameras: rawCameras.length > 0 ? rawCameras : nodes.filter(n => n.type === NodeType.CAMERA),
            globalSequences: toGlobalSequenceDurations(modelData?.GlobalSequences)
        };
    }, [nodes, modelData]);

    const createCameraManagerDependencies = useCallback(() => ({
        getCameras: () => {
            const latestStore = useModelStore.getState();
            return (Array.isArray((latestStore.modelData as any)?.Cameras)
                ? (latestStore.modelData as any).Cameras
                : latestStore.nodes.filter((node) => node.type === NodeType.CAMERA)) as any[];
        },
        syncCameraManager: () => {
            const latestStore = useModelStore.getState();
            const latestModelData = latestStore.modelData;
            const latestCameras = Array.isArray((latestModelData as any)?.Cameras)
                ? (latestModelData as any).Cameras
                : latestStore.nodes.filter((node) => node.type === NodeType.CAMERA);
            cameraManagerBroadcasterRef.current({
                cameras: latestCameras,
                globalSequences: toGlobalSequenceDurations(latestModelData?.GlobalSequences)
            });
        },
        viewportBridge: {
            createCameraFromCurrentView,
            focusCamera: focusCameraInViewer,
        },
    }), [createCameraFromCurrentView, focusCameraInViewer]);

    const handleAddCameraFromView = useCallback(() => {
        cameraManagerCommandHandler.handle('EXECUTE_CAMERA_ACTION', {
            action: 'ADD_FROM_VIEW',
        }, createCameraManagerDependencies())
    }, [createCameraManagerDependencies])

    const handleCameraCommand = useCallback((command: string, payload: any) => {
        cameraManagerCommandHandler.handle(command, payload, createCameraManagerDependencies())
    }, [createCameraManagerDependencies]);

    const { broadcastSync: broadcastCameraManager } = useRpcServer(
        'cameraManager',
        getCameraManagerState,
        handleCameraCommand
    );

    // RPC Server for Geoset Editor
    const getGeosetManagerState = useCallback(() => {
        const _modelData = useModelStore.getState().modelData;
        const _pickedGeosetIndex = useSelectionStore.getState().pickedGeosetIndex;
        const geosets = (_modelData?.Geosets || []).map((g: any, index: number) => ({
            index,
            MaterialID: g.MaterialID,
            SelectionGroup: g.SelectionGroup,
            vertexCount: g.Vertices ? g.Vertices.length / 3 : 0,
            faceCount: g.Faces ? g.Faces.length / 3 : 0
        }));

        return {
            geosets,
            materialsCount: _modelData?.Materials?.length || 0,
            selectedIndex: _pickedGeosetIndex ?? useModelStore.getState().selectedGeosetIndex ?? 0,
            pickedGeosetIndex: _pickedGeosetIndex,
        };
    }, []);

    const handleGeosetCommand = useCallback((command: string, payload: any) => {
        geosetEditorCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastGeosetEditor } = useRpcServer(
        'geosetEditor',
        getGeosetManagerState,
        handleGeosetCommand
    );

    // RPC Server for Texture Manager 
    // RPC Server for Texture Manager 
    const getTextureManagerState = useCallback((): TextureManagerRpcState => {
        return ensureTextureManagerSnapshotState()
    }, [ensureTextureManagerSnapshotState]);
    const handleTextureCommand = useCallback((command: string, payload: any) => {
        textureManagerCommandHandler.handle(command, payload, {
            onTexturesSaved: () => showMessage('success', '纹理已更新', '贴图修改已同步到模型'),
        })
    }, [showMessage]);

    const { broadcastSync: broadcastTextureManager, broadcastPatch: broadcastTextureManagerPatch } = useRpcServer<TextureManagerRpcState, TextureManagerPatch>(
        'textureManager',
        getTextureManagerState,
        handleTextureCommand
    );

    // RPC Server for Geoset Visibility Tool
    const getGeosetVisibilityState = useCallback(() => {
        const _modelData = useModelStore.getState().modelData;
        const geosets = (_modelData?.Geosets || []).map((g: any, index: number) => ({
            index,
            MaterialID: g.MaterialID,
            vertexCount: g.Vertices ? g.Vertices.length / 3 : 0,

            faceCount: g.Faces ? g.Faces.length / 3 : 0
        }));

        return {
            geosets,
            sequences: _modelData?.Sequences || [],
            geosetAnims: _modelData?.GeosetAnims || [],
            geosetsAnims: _modelData?.GeosetAnims || [],
            globalSequences: _modelData?.GlobalSequences || [],
        };
    }, []);

    const handleGeosetVisibilityCommand = useCallback((command: string, payload: any) => {
        geosetVisibilityCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastGeosetVisibilityTool } = useRpcServer(
        'geosetVisibilityTool',
        getGeosetVisibilityState,
        handleGeosetVisibilityCommand
    );

    // RPC Server for Geoset Anim Manager
    const getGeosetAnimManagerState = useCallback(() => {
        const _modelData = useModelStore.getState().modelData;
        const _pickedGeosetIndex = useSelectionStore.getState().pickedGeosetIndex;
        const geosets = (_modelData?.Geosets || []).map((_, index: number) => ({
            index
        }));

        return {
            geosets,
            geosetAnims: _modelData?.GeosetAnims || [],
            globalSequences: _modelData?.GlobalSequences || [],
            pickedGeosetIndex: _pickedGeosetIndex,
        };
    }, []);

    const handleGeosetAnimCommand = useCallback((command: string, payload: any) => {
        geosetAnimationCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastGeosetAnimManager } = useRpcServer(
        'geosetAnimManager',
        getGeosetAnimManagerState,
        handleGeosetAnimCommand
    );



    // RPC Server for Texture Anim Manager
    const getTextureAnimManagerState = useCallback(() => {
        const _modelData = useModelStore.getState().modelData;
        const _pickedGeosetIndex = useSelectionStore.getState().pickedGeosetIndex;

        return {
            textureAnims: _modelData?.TextureAnims || [],
            globalSequences: _modelData?.GlobalSequences || [],
            sequences: _modelData?.Sequences || [],
            materials: _modelData?.Materials || [],
            geosets: _modelData?.Geosets || [],
            pickedGeosetIndex: _pickedGeosetIndex
        };
    }, []);

    const handleTextureAnimCommand = useCallback((command: string, payload: any) => {
        textureAnimationCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastTextureAnimManager } = useRpcServer(
        'textureAnimManager',
        getTextureAnimManagerState,
        handleTextureAnimCommand
    );

    // RPC Server for Material Manager
    const getMaterialManagerState = useCallback(() => {
        return ensureMaterialManagerSnapshotState()
    }, [ensureMaterialManagerSnapshotState])
    const handleMaterialCommand = useCallback((command: string, payload: any) => {
        materialManagerCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastMaterialManager, broadcastPatch: broadcastMaterialManagerPatch } = useRpcServer<MaterialManagerRpcState, MaterialManagerPatch>(
        'materialManager',
        getMaterialManagerState,
        handleMaterialCommand
    );

    const handleNodeEditorCommand = useCallback((command: string, payload: unknown) => {
        nodeEditorCommandHandler.handle(command, payload)
    }, [])

    const getNodeEditorState = useCallback(() => {
        return ensureNodeEditorSnapshotState()
    }, [ensureNodeEditorSnapshotState])

    const { broadcastSync: broadcastNodeEditor } = useRpcServer<NodeEditorRpcState>(
        'nodeEditor',
        getNodeEditorState,
        handleNodeEditorCommand
    )

    const getSequenceManagerState = useCallback((): SequenceManagerRpcState => {
        const state = useModelStore.getState();
        return {
            sequences: state.modelData?.Sequences || []
        };
    }, []);

    const handleSequenceCommand = useCallback((command: string, payload: any) => {
        sequenceManagerCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastSequenceManager } = useRpcServer<SequenceManagerRpcState>(
        'sequenceManager',
        getSequenceManagerState,
        handleSequenceCommand
    );

    const getGlobalSeqManagerState = useCallback((): GlobalSequenceManagerRpcState => {
        const state = useModelStore.getState();
        return {
            globalSequences: toGlobalSequenceDurations(state.modelData?.GlobalSequences)
        };
    }, []);

    const handleGlobalSeqCommand = useCallback((command: string, payload: any) => {
        globalSequenceManagerCommandHandler.handle(command, payload)
    }, []);

    const { broadcastSync: broadcastGlobalSeqManager } = useRpcServer<GlobalSequenceManagerRpcState>(
        'globalSequenceManager',
        getGlobalSeqManagerState,
        handleGlobalSeqCommand
    );

    const getGlobalColorAdjustState = useCallback((): GlobalColorAdjustRpcState => ({
        settings: useGlobalColorAdjustStore.getState().settings
    }), [])

    const handleGlobalColorAdjustCommand = useCallback((command: string, payload: any) => {
        globalColorAdjustCommandHandler.handle(command, payload)
    }, [])

    const { broadcastSync: broadcastGlobalColorAdjust } = useRpcServer<GlobalColorAdjustRpcState>(
        'globalColorAdjust',
        getGlobalColorAdjustState,
        handleGlobalColorAdjustCommand
    )

    useEffect(() => {
        cameraManagerBroadcasterRef.current = broadcastCameraManager
        toolWindowBroadcastCoordinatorRef.current.setApi({
            broadcastCameraManager, getCameraManagerState,
            broadcastGeosetEditor, getGeosetManagerState,
            broadcastGeosetVisibilityTool, getGeosetVisibilityState,
            broadcastGeosetAnimManager, getGeosetAnimManagerState,
            broadcastTextureManager, broadcastTextureManagerPatch, getTextureManagerState,
            broadcastTextureAnimManager, getTextureAnimManagerState,
            broadcastMaterialManager, broadcastMaterialManagerPatch, getMaterialManagerState,
            broadcastNodeEditor, getNodeEditorState,
            broadcastSequenceManager, getSequenceManagerState,
            broadcastGlobalSeqManager, getGlobalSeqManagerState,
            broadcastGlobalColorAdjust,
        })
    }, [
        broadcastCameraManager, getCameraManagerState,
        broadcastGeosetEditor, getGeosetManagerState,
        broadcastGeosetVisibilityTool, getGeosetVisibilityState,
        broadcastGeosetAnimManager, getGeosetAnimManagerState,
        broadcastTextureManager, broadcastTextureManagerPatch, getTextureManagerState,
        broadcastTextureAnimManager, getTextureAnimManagerState,
        broadcastMaterialManager, broadcastMaterialManagerPatch, getMaterialManagerState,
        broadcastNodeEditor, getNodeEditorState,
        broadcastSequenceManager, getSequenceManagerState,
        broadcastGlobalSeqManager, getGlobalSeqManagerState,
        broadcastGlobalColorAdjust,
    ])

    useEffect(() => {
        toolWindowBroadcastCoordinatorRef.current.broadcastGlobalColorAdjust(getGlobalColorAdjustState())
    }, [globalColorAdjustSettings, getGlobalColorAdjustState])

    useEffect(() => {
        void desktopGateway.emit('active-model-changed', {
            activeTabId,
            modelPath: modelPath || '',
            hasModelData: !!modelData,
        }).catch(() => { })
    }, [activeTabId, modelPath, modelData])

    useEffect(() => {
        return toolWindowBroadcastCoordinatorRef.current.attach(windowManager)
    }, []); // Zero dependencies: stable throughout lifecycle

    const handleEditorResizeStart = (e: React.MouseEvent) => {
        setIsResizingEditor(true)
        e.preventDefault()
    }

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingEditor) return
            const newWidth = window.innerWidth - e.clientX
            setEditorWidth(clampEditorWidth(newWidth))
        }

        const handleMouseUp = () => {
            setIsResizingEditor(false)
        }

        if (isResizingEditor) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizingEditor, clampEditorWidth])

    useEffect(() => {
        const handleResize = () => {
            setEditorWidth((prev) => clampEditorWidth(prev))
        }
        handleResize()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [clampEditorWidth])

    // Save settings when they change
    useEffect(() => localStorage.setItem('teamColor', JSON.stringify(teamColor)), [teamColor])
    useEffect(() => localStorage.setItem('showGrid', JSON.stringify(showGridXY)), [showGridXY])
    useEffect(() => localStorage.setItem('showNodes', JSON.stringify(showNodes)), [showNodes])
    useEffect(() => localStorage.setItem('showSkeleton', JSON.stringify(showSkeleton)), [showSkeleton])
    useEffect(() => localStorage.setItem('showLights', JSON.stringify(showLights)), [showLights])
    useEffect(() => localStorage.setItem('renderMode', JSON.stringify(renderMode)), [renderMode])
    useEffect(() => localStorage.setItem('backgroundColor', JSON.stringify(backgroundColor)), [backgroundColor])
    useEffect(() => localStorage.setItem('showFPS', JSON.stringify(showFPS)), [showFPS])

    // Auto-load MPQs (DEFERRED for faster startup)
    useEffect(() => {
        const loadSavedMpqs = async () => {
            const savedPaths = localStorage.getItem('mpq_paths')

            if (savedPaths) {
                try {
                    const paths = JSON.parse(savedPaths)
                    try {
                        await desktopGateway.invoke('set_mpq_paths', { paths })
                    } catch (e) {
                        console.warn('[MainLayout] Failed to sync MPQ paths:', e)
                    }
                    // OPTIMIZATION: Load all MPQs in parallel
                    const results = await Promise.allSettled(
                        paths.map((path: string) => desktopGateway.invoke('load_mpq', { path }))
                    )
                    const successCount = results.filter(r => r.status === 'fulfilled').length
                    if (successCount > 0) {
                        setMpqLoaded(true)
                    }
                } catch (e) {
                    console.error('[MainLayout] Failed to auto-load saved MPQs:', e)
                    setMpqLoaded(false)
                }
            } else {
                // Try auto-detection from Registry
                try {                    const installPath = await desktopGateway.invoke<string>('detect_warcraft_path')
                    if (installPath) {                        const mpqs = ['war3.mpq', 'War3Patch.mpq', 'War3x.mpq', 'War3xLocal.mpq']
                        const basePath = installPath.endsWith('') ? installPath : `${installPath}`
                        const pathsToLoad = mpqs.map(mpq => `${basePath}${mpq}`)

                        // OPTIMIZATION: Load all MPQs in parallel
                        const results = await Promise.allSettled(
                            pathsToLoad.map(path => desktopGateway.invoke('load_mpq', { path }))
                        )

                        const validPaths = pathsToLoad.filter((_, i) => results[i].status === 'fulfilled')
                        const successCount = validPaths.length

                        if (successCount > 0) {                            localStorage.setItem('mpq_paths', JSON.stringify(validPaths))
                            try {
                                await desktopGateway.invoke('set_mpq_paths', { paths: validPaths })
                            } catch (e) {
                                console.warn('[MainLayout] Failed to sync MPQ paths:', e)
                            }
                            setMpqLoaded(true)
                        }
                    }
                } catch (e) {                    setMpqLoaded(false)
                }
            }
        }
        // OPTIMIZATION: Defer MPQ loading by 500ms to allow UI to render first
        const timer = setTimeout(() => {
            loadSavedMpqs()
        }, 500)
        return () => clearTimeout(timer)
    }, [])
    // Manager Shortcuts
    const handleCopyModel = useCallback(async () => {
        if (!modelPath) {
            showMessage('warning', '提示', '没有可复制的模型');
            return;
        }
        try {
            const result = await desktopGateway.invoke<string>('copy_model_with_textures', { modelPath });
            showMessage('success', '成功', result);
        } catch (err) {
            console.error('Copy failed:', err);
            showMessage('error', '错误', '复制失败');
        }
    }, [modelPath]);
    handleCopyModelRef.current = handleCopyModel;

    const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => getRecentFiles())

    const handleImport = useCallback(async () => {
        try {
            await openModelWorkflow.openFromDialog({
                openModelAsTab,
                setRecentFiles,
            }, DEFAULT_IMPORT_FILE_DIALOG_OPTIONS)
        } catch (error) {
            console.error('Failed to open file dialog:', error)
            setIsLoading(false)
            setZustandLoading(false)
        }
    }, [openModelAsTab])
    handleImportRef.current = handleImport;

    const handleModelLoaded = useCallback((data: any) => {
        openModelWorkflow.handleLoadedModel(data, {
            currentModelPath: modelPath,
            commitLoadedModel: setZustandModelData,
            completeLoading: () => {
                setIsLoading(false)
                setZustandLoading(false)
            },
            setMainMode,
            setPlaying,
        })
    }, [setZustandModelData, setZustandLoading, modelPath, setMainMode, setPlaying])


    const handleOpen = handleImport // Alias for MenuBar
    const handleOpenRecent = useCallback((path: string) => {
        openModelWorkflow.openPath({
            path,
            source: 'recent',
            addToRecent: true,
        }, {
            openModelAsTab,
            setRecentFiles,
        })
    }, [openModelAsTab])

    const handleClearRecentFiles = useCallback(() => {
        clearRecentFiles()
        setRecentFiles([])
    }, [])

    // Tauri file drag-drop listeners (works with dragDropEnabled: true and mouse-based node tree drag)
    useEffect(() => {
        let unlistenDrop: (() => void) | undefined
        let unlistenEnter: (() => void) | undefined
        let unlistenLeave: (() => void) | undefined
        const setupDragDropListeners = async () => {
            try {
                // Listen for file drop
                unlistenDrop = await desktopGateway.listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-drop', async (event) => {
                    setIsDragging(false)
                    isExternalModelDragRef.current = false
                    const sourceWindowLabel = (event as any)?.windowLabel
                    const currentWindowLabel = windowGateway.getCurrentWindowLabel()
                    if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return

                    const paths = Array.isArray(event.payload?.paths) ? event.payload.paths : []
                    if (!paths || paths.length === 0) return

                    const filePath = paths.find((path) => openModelWorkflow.isOpenableModelFile(path))
                    if (!filePath) {
                        // Forward non-model external drops to feature-specific handlers (e.g. texture drop zones)
                        window.dispatchEvent(new CustomEvent('war3-external-file-drop', {
                            detail: {
                                paths,
                                position: event.payload?.position ?? null
                            }
                        }))
                        return
                    }
                    openModelWorkflow.openPath({
                        path: filePath,
                        source: 'drag-drop',
                        addToRecent: true,
                    }, {
                        openModelAsTab,
                        setRecentFiles,
                    })
                })

                // Listen for drag enter
                unlistenEnter = await desktopGateway.listen<{ paths?: string[] }>('tauri://drag-enter', (event) => {
                    const sourceWindowLabel = (event as any)?.windowLabel
                    const currentWindowLabel = windowGateway.getCurrentWindowLabel()
                    if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return

                    const paths = Array.isArray(event.payload?.paths) ? event.payload.paths : []
                    const hasOpenableModel = paths.some((path) => openModelWorkflow.isOpenableModelFile(path))
                    isExternalModelDragRef.current = hasOpenableModel
                    if (hasOpenableModel) {
                        setIsDragging(true)
                    }
                })

                // Listen for drag leave
                unlistenLeave = await desktopGateway.listen('tauri://drag-leave', () => {
                    if (!isExternalModelDragRef.current) return
                    isExternalModelDragRef.current = false
                    setIsDragging(false)
                })

            } catch (error) {
                console.error('[MainLayout] Failed to setup drag-drop listeners:', error)
            }
        }

        setupDragDropListeners()

        return () => {
            isExternalModelDragRef.current = false
            unlistenDrop?.()
            unlistenEnter?.()
            unlistenLeave?.()
        }
    }, [openModelAsTab])



    const clearAdjustmentKeysInStoreTextures = () => {
        const state = useModelStore.getState();
        const textures = state.modelData?.Textures;
        if (!Array.isArray(textures)) return;
        textures.forEach((texture: any) => {
            if (texture && Object.prototype.hasOwnProperty.call(texture, TEXTURE_ADJUSTMENTS_KEY)) {
                delete texture[TEXTURE_ADJUSTMENTS_KEY];
            }
        });
    };

    const confirmSaveValidation = async (
        context: SaveValidationContext,
        validationErrors: string[]
    ): Promise<boolean> => {
        const questionByContext: Record<SaveValidationContext, string> = {
            save: '是否仍然保存?',
            saveAs: '是否仍然保存?',
            export: '是否仍然导出?',
            convert: '是否仍然继续互转?',
        }
        const errorMsg = validationErrors.slice(0, 3).map(e => <div key={e}>{e}</div>);
        const hasMore = validationErrors.length > 3;
        return showConfirm('模型验证警告', (
            <div>
                <div>发现以下问题:</div>
                <div style={{ color: '#ff4d4f', margin: '10px 0' }}>
                    {errorMsg}
                    {hasMore && <div>...还有 {validationErrors.length - 3} 个问题</div>}
                </div>
                <div>{questionByContext[context]}</div>
            </div>
        ));
    }

    const showTextureFailureWarnings = (
        textureEncodeResult: TextureAssetOperationResult,
        textureCopyResult?: TextureAssetOperationResult
    ) => {
        if (textureEncodeResult.failed.length > 0) {
            const lines = textureEncodeResult.failed.slice(0, 3).join('n');
            showMessage(
                'warning',
                '部分贴图写出失败',
                `${textureEncodeResult.failed.length} 个贴图写出失败：n${lines}${textureEncodeResult.failed.length > 3 ? 'n...' : ''}`
            );
        }
        if (textureCopyResult && textureCopyResult.failed.length > 0) {
            const lines = textureCopyResult.failed.slice(0, 3).join('n');
            showMessage(
                'warning',
                '部分贴图复制失败',
                `${textureCopyResult.failed.length} 个贴图复制失败：n${lines}${textureCopyResult.failed.length > 3 ? 'n...' : ''}`
            );
        }
    }

    const handleSave = async (): Promise<boolean> => {
        if (isSavingRef.current) {
            showMessage('warning', '提示', '正在保存模型，请稍候...')
            return false
        }
        if (!modelPath || !modelData) return false

        try {
            isSavingRef.current = true;
            const modelState = useModelStore.getState();
            const normalizedData = modelState.getModelDataForSave?.() ?? modelData;
            const globalColorSettings = useGlobalColorAdjustStore.getState().settings;
            const rendererState = useRendererStore.getState();
            const saveResult = await saveCurrentModelWorkflow.savePreparedModel({
                modelData: normalizedData,
                nodes: modelState.nodes,
                sourceModelPath: modelPath,
                targetPath: modelPath,
                globalColorSettings,
                textureOptions: {
                    textureSaveMode: rendererState.textureSaveMode,
                    textureSaveSuffix: rendererState.textureSaveSuffix,
                },
                encodeAdjustedTextures: true,
                validationContext: 'save',
                confirmValidation: ({ context, validationErrors }) => confirmSaveValidation(context, validationErrors),
            });
            if (!saveResult) {
                return false;
            }
            showTextureFailureWarnings(saveResult.textureEncodeResult);
            commitSavedModelToStore(saveResult.preparedData, saveResult.savedNodes ?? modelState.nodes);
            useGlobalColorAdjustStore.getState().resetSettings();
            historyCommandService.markSaved();
            useModelStore.getState().markTabSaved();
            showMessage('success', '保存成功', '模型已保存')
            return true;
        } catch (err) {
            console.error('Failed to save file:', err)
            showMessage('error', '保存失败', '详细信息: ' + err)
            return false;
        } finally {
            isSavingRef.current = false;
        }
    }
    handleSaveRef.current = handleSave;

    const handleSaveAs = async (): Promise<boolean> => {
        if (isSavingRef.current) {
            showMessage('warning', '提示', '正在保存模型，请稍候...')
            return false
        }
        if (!modelData) return false
        try {
            const selected = await desktopGateway.saveFileDialog({
                filters: [{
                    name: 'Warcraft 3 Models',
                    extensions: ['mdx', 'mdl']
                }]
            })

            if (selected) {
                isSavingRef.current = true;
                const modelState = useModelStore.getState();
                const normalizedData = modelState.getModelDataForSave?.() ?? modelData;
                const globalColorSettings = useGlobalColorAdjustStore.getState().settings;
                const rendererState = useRendererStore.getState();
                const saveResult = await saveCurrentModelWorkflow.savePreparedModel({
                    modelData: normalizedData,
                    nodes: modelState.nodes,
                    sourceModelPath: modelPath,
                    targetPath: selected,
                    globalColorSettings,
                    textureOptions: {
                        textureSaveMode: rendererState.textureSaveMode,
                        textureSaveSuffix: rendererState.textureSaveSuffix,
                    },
                    copyReferencedTextures: true,
                    encodeAdjustedTextures: true,
                    validationContext: 'saveAs',
                    confirmValidation: ({ context, validationErrors }) => confirmSaveValidation(context, validationErrors),
                });
                if (!saveResult) {
                    return false;
                }
                showTextureFailureWarnings(saveResult.textureEncodeResult, saveResult.textureCopyResult);
                commitSavedModelToStore(saveResult.preparedData, saveResult.savedNodes ?? modelState.nodes);
                useGlobalColorAdjustStore.getState().resetSettings();
                // Update store with new path if needed, but for now just alert
                historyCommandService.markSaved();
                useModelStore.getState().markTabSaved();
                showMessage('success', '另存为成功', '模型已另存为: ' + selected)
                return true;
            }
        } catch (err) {
            console.error('Failed to save file as:', err)
            showMessage('error', '另存为失败', '详细信息: ' + err)
            return false;
        } finally {
            isSavingRef.current = false;
        }
        return false;
    }
    handleSaveAsRef.current = handleSaveAs;

    useEffect(() => {
        const requestClose = () => {
            if (isSavingRef.current) {
                showMessage('warning', '提示', '正在保存模型，请稍候再关闭...');
                return true;
            }
            void windowGateway.closeCurrentWindow();
            return true;
        };

        const requestCloseIfNoPanels = () => {
            const uiState = useUIStore.getState();
            const rendererState = useRendererStore.getState();
            const panelState = panelStateRef.current;
            const hasPanels = !!panelState.activeEditor
                || panelState.showGeosetAnimModal
                || panelState.showTextureModal
                || panelState.showTextureAnimModal
                || panelState.showSequenceModal
                || panelState.showCameraModal
                || panelState.showMaterialModal
                || panelState.showGeosetModal
                || panelState.showGlobalSeqModal
                || panelState.showAbout
                || rendererState.showSettingsPanel
                || rendererState.showGeosetVisibility
                || uiState.showNodeManager
                || uiState.showModelInfo
                || uiState.showVertexEditor
                || uiState.showFaceEditor
                || uiState.showCreateNodeDialog
                || uiState.showTransformModelDialog;

            if (hasPanels) return false;
            return requestClose();
        };

        const unsubscribeHandlers = [
            registerShortcutHandler('file.open', () => {
                handleImportRef.current();
                return true;
            }),
            registerShortcutHandler('file.save', () => {
                const { modelPath: currentModelPath } = useModelStore.getState();
                if (!currentModelPath) {
                    handleSaveAsRef.current();
                } else {
                    handleSaveRef.current();
                }
                return true;
            }),
            registerShortcutHandler('file.saveAs', () => {
                handleSaveAsRef.current();
                return true;
            }),
            registerShortcutHandler('file.copyModel', () => {
                handleCopyModelRef.current();
                return true;
            }),
            registerShortcutHandler('window.closeTab', () => {
                const { activeTabId, closeTab } = useModelStore.getState();
                if (activeTabId) {
                    closeTab(activeTabId);
                }
                return true;
            }),
            registerShortcutHandler('window.closeApp', () => requestClose()),
            registerShortcutHandler('window.closeAppEsc', () => requestCloseIfNoPanels()),
            registerShortcutHandler('mode.view', () => {
                useSelectionStore.getState().setMainMode('view');
                return true;
            }),
            registerShortcutHandler('mode.geometry', () => {
                useSelectionStore.getState().setMainMode('geometry');
                return true;
            }),
            registerShortcutHandler('mode.uv', () => {
                useSelectionStore.getState().setMainMode('uv');
                return true;
            }),
            registerShortcutHandler('mode.animation', () => {
                useSelectionStore.getState().setMainMode('animation');
                return true;
            }),
            registerShortcutHandler('view.top', () => {
                setViewPreset({ type: 'top', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.bottom', () => {
                setViewPreset({ type: 'bottom', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.front', () => {
                setViewPreset({ type: 'front', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.back', () => {
                setViewPreset({ type: 'back', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.left', () => {
                setViewPreset({ type: 'left', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.right', () => {
                setViewPreset({ type: 'right', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.toggleVertices', () => {
                const { mainMode } = useSelectionStore.getState();
                const { animationSubMode } = useSelectionStore.getState();
                const {
                    showVerticesByMode,
                    setShowVerticesForMode,
                    showVerticesInAnimationBinding,
                    showVerticesInAnimationKeyframe,
                    setShowVerticesForAnimationSubMode
                } = useRendererStore.getState() as any;

                if (mainMode === 'animation') {
                    const current =
                        animationSubMode === 'binding'
                            ? (showVerticesInAnimationBinding ?? true)
                            : (showVerticesInAnimationKeyframe ?? false);
                    setShowVerticesForAnimationSubMode(animationSubMode, !current);
                } else {
                    const current = showVerticesByMode[mainMode] ?? true;
                    setShowVerticesForMode(mainMode, !current);
                }
                return true;
            }),
            registerShortcutHandler('edit.undo', () => {
                historyCommandService.undo();
                return true;
            }),
            registerShortcutHandler('edit.redo', () => {
                historyCommandService.redo();
                return true;
            }),
            ...toolWindowOrchestrator.registerEditorShortcuts({
                windowManager,
                toggleNodeManager,
                toggleModelInfo,
                toggleGeosetVisibility: () => { },
                toggleInlineEditor: () => { },
                reportOpenError: reportToolWindowOpenError,
            }),
        ];

        return () => {
            unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
        };
    }, []);

    // Helper function to get model name from path or default
    const getModelBaseName = (): string => {
        if (modelPath) {
            const filename = modelPath.split(/[/]/).pop() || 'model'
            // Remove extension
            return filename.replace(/.(mdx|mdl)$/i, '')
        }
        return 'model'
    }

    const handleExportMDL = async () => {
        if (!modelData) return
        try {
            const defaultName = getModelBaseName() + '.mdl'

            const selected = await desktopGateway.saveFileDialog({
                defaultPath: defaultName,
                filters: [{
                    name: 'MDL Models',
                    extensions: ['mdl']
                }]
            })

            if (selected) {
                // Ensure .mdl extension
                let filePath = selected
                if (!filePath.toLowerCase().endsWith('.mdl')) {
                    filePath += '.mdl'
                }

                const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData;
                const saveResult = await saveCurrentModelWorkflow.savePreparedModel({
                    modelData: normalizedData,
                    sourceModelPath: modelPath,
                    targetPath: filePath,
                    copyReferencedTextures: true,
                    format: 'mdl',
                    validationContext: 'export',
                    confirmValidation: ({ context, validationErrors }) => confirmSaveValidation(context, validationErrors),
                })
                if (!saveResult) {
                    return;
                }

                showTextureFailureWarnings(saveResult.textureEncodeResult, saveResult.textureCopyResult);
                showMessage('success', '导出成功', '已导出为 MDL: ' + filePath)
            }
        } catch (err) {
            console.error('Failed to export MDL:', err)
            showMessage('error', '导出 MDL 失败', '详细信息: ' + err)
        }
    }

    const handleExportMDX = async () => {
        if (!modelData) return
        try {
            const defaultName = getModelBaseName() + '.mdx'

            const selected = await desktopGateway.saveFileDialog({
                defaultPath: defaultName,
                filters: [{
                    name: 'MDX Models',
                    extensions: ['mdx']
                }]
            })

            if (selected) {
                // Ensure .mdx extension
                let filePath = selected
                if (!filePath.toLowerCase().endsWith('.mdx')) {
                    filePath += '.mdx'
                }

                const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData;
                const saveResult = await saveCurrentModelWorkflow.savePreparedModel({
                    modelData: normalizedData,
                    sourceModelPath: modelPath,
                    targetPath: filePath,
                    copyReferencedTextures: true,
                    format: 'mdx',
                    validationContext: 'export',
                    confirmValidation: ({ context, validationErrors }) => confirmSaveValidation(context, validationErrors),
                })
                if (!saveResult) {
                    return;
                }

                showTextureFailureWarnings(saveResult.textureEncodeResult, saveResult.textureCopyResult);
                showMessage('success', '导出成功', '已导出为 MDX: ' + filePath)
            }
        } catch (err) {
            console.error('Failed to export MDX:', err)
            showMessage('error', '导出 MDX 失败', '详细信息: ' + err)
        }
    }

    const handleSwapMdlMdx = async (): Promise<boolean> => {
        if (!modelData || !modelPath) {
            showMessage('warning', '提示', '请先打开一个 MDL 或 MDX 模型')
            return false
        }

        const sourcePath = normalizeWindowsPath(modelPath)
        const lowerPath = sourcePath.toLowerCase()
        const targetExt = lowerPath.endsWith('.mdl') ? '.mdx' : lowerPath.endsWith('.mdx') ? '.mdl' : ''
        if (!targetExt) {
            showMessage('warning', '提示', '当前文件不是 MDL 或 MDX，无法互转')
            return false
        }

        const sourceDir = getDirname(sourcePath)
        const sourceName = getBasename(sourcePath)
        const baseName = sourceName.replace(/\.(mdl|mdx)$/i, '')
        const targetPath = joinPath(sourceDir, `${baseName}${targetExt}`)

        try {
            if (normalizeWindowsPath(targetPath).toLowerCase() !== lowerPath && await desktopGateway.exists(targetPath)) {
                const proceed = await showConfirm(
                    '目标文件已存在',
                    <div>检测到目标文件已存在，是否覆盖？<div style={{ marginTop: 8, color: '#999' }}>{targetPath}</div></div>
                )
                if (!proceed) {
                    return false
                }
            }

            const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData
            const saveResult = await saveCurrentModelWorkflow.savePreparedModel({
                modelData: normalizedData,
                sourceModelPath: modelPath,
                targetPath,
                copyReferencedTextures: true,
                format: targetExt === '.mdl' ? 'mdl' : 'mdx',
                validationContext: 'convert',
                confirmValidation: ({ context, validationErrors }) => confirmSaveValidation(context, validationErrors),
            })
            if (!saveResult) {
                return false
            }

            showTextureFailureWarnings(saveResult.textureEncodeResult, saveResult.textureCopyResult);
            openModelAsTab(targetPath)
            setRecentFiles(replaceRecentModelPath(sourcePath, targetPath))
            showMessage('success', '互转成功', `已生成并打开: ${targetPath}`)
            return true
        } catch (err) {
            console.error('Failed to swap MDL/MDX:', err)
            showMessage('error', 'MDL/MDX 互转失败', '详细信息: ' + err)
            return false
        }
    }

    const reportToolWindowOpenError = useCallback((title: string, error: unknown) => {
        showMessage('error', title, `无法打开: ${error instanceof Error ? error.message : String(error)}`)
    }, [])

    const handleToggleEditor = useCallback((editor: string) => {
        toolWindowOrchestrator.openEditor(editor, {
            windowManager,
            toggleNodeManager,
            toggleModelInfo,
            toggleGeosetVisibility: () => setShowGeosetVisibility(!showGeosetVisibility),
            toggleInlineEditor: (nextEditor) => setActiveEditor(activeEditor === nextEditor ? null : nextEditor),
            reportOpenError: reportToolWindowOpenError,
        })
    }, [
        activeEditor,
        reportToolWindowOpenError,
        setShowGeosetVisibility,
        showGeosetVisibility,
        toggleModelInfo,
        toggleNodeManager,
    ])

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
                backgroundColor: '#1e1e1e',
                color: '#eee',
                fontFamily: 'Segoe UI, sans-serif',
                position: 'relative'
            }}
        >
            {/* Drag-and-drop overlay */}
            {isDragging && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 120, 215, 0.3)',
                    border: '3px dashed #0078d7',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none'
                }}>
                    <div style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: '20px 40px',
                        borderRadius: '8px',
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: '#fff'
                    }}>
                        拖放 MDX/MDL/BLP/TGA 文件以打开资源
                    </div>
                </div>
            )}
            <MenuBar
                onOpen={handleOpen}
                onSave={handleSave}
                onSaveAs={handleSaveAs}
                onSwapMdlMdx={handleSwapMdlMdx}
                onExportMDL={handleExportMDL}
                onExportMDX={handleExportMDX}
                onOpenRecent={handleOpenRecent}
                recentFiles={recentFiles}
                onClearRecentFiles={handleClearRecentFiles}
                // onLoadMPQ={handleLoadMPQ} // Removed
                // mpqLoaded={mpqLoaded} // Removed
                teamColor={teamColor}
                onSelectTeamColor={setTeamColor}
                showGrid={showGridXY}
                onToggleGrid={() => useRendererStore.getState().setShowGridXY(!showGridXY)}
                showNodes={showNodes}
                onToggleNodes={() => setShowNodes(!showNodes)}
                showSkeleton={showSkeleton}
                onToggleSkeleton={() => setShowSkeleton(!showSkeleton)}
                renderMode={renderMode}
                onChangeRenderMode={setRenderMode}
                backgroundColor={backgroundColor}
                onChangeBackgroundColor={setBackgroundColor}
                showFPS={showFPS}
                onToggleFPS={() => setShowFPS(!showFPS)}
                onCheckUpdate={checkUpdate}
                onShowChangelog={showChangelog}
                showGeosetVisibility={showGeosetVisibility}
                onToggleGeosetVisibility={() => {
                    const newValue = !showGeosetVisibility;
                    setShowGeosetVisibility(newValue);
                }}
                showCollisionShapes={showCollisionShapes}
                onToggleCollisionShapes={() => {
                    const newVal = !showCollisionShapes
                    setShowCollisionShapes(newVal)
                }}
                showCameras={showCameras}
                onToggleCameras={() => {
                    const newVal = !showCameras
                    setShowCameras(newVal)
                }}
                showLights={showLights}
                onToggleLights={() => {
                    const newVal = !showLights
                    setShowLights(newVal)
                }}
                showAttachments={showAttachments}
                onToggleAttachments={() => {
                    const newVal = !showAttachments
                    setShowAttachments(newVal)
                }}
                onToggleEditor={handleToggleEditor}
                mainMode={mainMode}
                onSetMainMode={setMainMode}
                showDebugConsole={showDebugConsole}
                onToggleDebugConsole={() => setShowDebugConsole(!showDebugConsole)}
                onShowAbout={() => setShowAbout(true)}
                onRecalculateNormals={recalculateNormals}
                onRecalculateExtents={recalculateExtents}
                onRepairModel={repairModel}
                onMergeSameMaterials={mergeSameMaterials}
                onCleanUnusedMaterials={cleanUnusedMaterials}
                onCleanUnusedTextures={cleanUnusedTextures}
                onTransformModel={() => setTransformModelDialogVisible(true)}
                onAddDeathAnimation={addDeathAnimation}
                onRemoveLights={removeLights}
                onCopyModel={handleCopyModel}
            />

            <AboutDialog
                open={showAbout}
                activationStatus={activationStatus}
                activationCode={activationCode}
                activationLoading={activationLoading}
                activationError={activationError}
                onClose={() => setShowAbout(false)}
                onActivationCodeChange={setActivationCode}
                onActivate={activate}
            />


            {showTextureAnimModal && (
                <Suspense fallback={null}>
                    <AppErrorBoundary scope="Texture Animation Manager" compact>
                        <TextureAnimationManagerModal
                            visible={showTextureAnimModal}
                            onClose={() => setShowTextureAnimModal(false)}
                        />
                    </AppErrorBoundary>
                </Suspense>
            )}
            {showSequenceModal && (
                <Suspense fallback={null}>
                    <AppErrorBoundary scope="Sequence Editor" compact>
                        <SequenceEditorModal
                            visible={showSequenceModal}
                            onClose={() => setShowSequenceModal(false)}
                        />
                    </AppErrorBoundary>
                </Suspense>
            )}
            {showTransformModelDialog && (
                <Suspense fallback={null}>
                    <AppErrorBoundary scope="Transform Model" compact>
                        <TransformModelDialog />
                    </AppErrorBoundary>
                </Suspense>
            )}


            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', minWidth: 0 }}>
                {/* Left Panel - Animation Panel (hidden in UV mode) */}
                {mainMode !== 'uv' && mainMode !== 'animation' && (
                    <div
                        data-left-animation-panel="true"
                        style={{ width: 'clamp(160px, 18vw, 230px)', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333', minWidth: 0 }}
                    >
                        <Suspense fallback={null}>
                            <AnimationPanel
                                onImport={handleImport}
                            />
                        </Suspense>
                    </div>
                )}

                {/* Center - 3D Viewer or Animation/UV Mode Layout */}
                <div id="main-viewer-host" style={{ flex: 1, position: 'relative', backgroundColor, minWidth: 0 }}>
                    <AppErrorBoundary scope="Main Viewer" compact>
                        <Suspense fallback={<div style={{ position: 'absolute', inset: 0, backgroundColor }} />}>
                            <AnimationModeLayout
                                isActive={mainMode === 'animation'}
                                rightPanelAddon={
                                    showGeosetVisibility ? (
                                        <GeosetVisibilityPanel
                                            visible={true}
                                            onClose={() => setShowGeosetVisibility(false)}
                                            docked
                                        />
                                    ) : null
                                }
                            >
                                <UVModeLayout

                                    modelPath={modelPath}
                                    isActive={mainMode === 'uv'}
                                >
                                    <Viewer
                                        ref={viewerRef as any}
                                        modelPath={modelPath}
                                        modelData={viewerModelData}
                                        teamColor={teamColor}
                                        showGrid={showGridXY}
                                        showNodes={mainMode !== 'uv' && showNodes}
                                        showSkeleton={mainMode !== 'uv' && showSkeleton}
                                        showCollisionShapes={mainMode !== 'uv' && showCollisionShapes}
                                        showCameras={mainMode !== 'uv' && showCameras}
                                        showLights={mainMode !== 'uv' && mainMode !== 'animation' && showLights}
                                        showAttachments={mainMode !== 'uv' && showAttachments}
                                        showWireframe={mainMode !== 'uv' && renderMode === 'wireframe'}
                                        onToggleWireframe={() => setRenderMode(renderMode === 'textured' ? 'wireframe' : 'textured')}
                                        backgroundColor={backgroundColor}
                                        animationIndex={currentSequence}
                                        isPlaying={mainMode !== 'uv' && isPlaying}
                                        onTogglePlay={handleTogglePlay}
                                        onToggleLooping={handleToggleLooping}
                                        onModelLoaded={handleModelLoaded}
                                        showFPS={mainMode !== 'uv' && showFPS}
                                        playbackSpeed={playbackSpeed}
                                        viewPreset={viewPreset}
                                        onSetViewPreset={handleSetViewPreset}
                                        onAddCameraFromView={handleAddCameraFromView}
                                    />
                                </UVModeLayout>
                            </AnimationModeLayout>
                        </Suspense>
                    </AppErrorBoundary>

                    {isLoading && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            zIndex: 10
                        }}>
                            {uiText.app.loading}
                        </div>
                    )}
                </div>

                {/* Right Panel - Editors */}
                {activeEditor && (
                    <div style={{
                        width: clampEditorWidth(editorWidth),
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: '1px solid #333',
                        backgroundColor: '#222',
                        position: 'relative', // Needed for resize handle
                        minWidth: 0
                    }}>
                        {/* Resize Handle */}
                        <div
                            onMouseDown={handleEditorResizeStart}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: '4px',
                                cursor: 'ew-resize',
                                zIndex: 100,
                                backgroundColor: isResizingEditor ? '#007acc' : 'transparent',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => { if (!isResizingEditor) e.currentTarget.style.backgroundColor = '#007acc40' }}
                            onMouseLeave={(e) => { if (!isResizingEditor) e.currentTarget.style.backgroundColor = 'transparent' }}
                        />
                        <Suspense fallback={null}>
                            <EditorPanel
                                activeTab={activeEditor}
                                onClose={() => setActiveEditor(null)}
                            />
                        </Suspense>
                    </div>
                )}
            </div>
            {/* ModelOptimizeModal relies on native OS window now, no local render needed unless reverting to wrapper mode */}
            {/* Global Message Layer */}
            <GlobalMessageLayer />
        </div>
    )
}

export default MainLayout

