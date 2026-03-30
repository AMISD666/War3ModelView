import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Empty, Layout, theme, Typography, Spin, message, Pagination, Tooltip, Space, Radio, Switch, Slider, Select } from 'antd';
import {
    FolderOpenOutlined,
    ReloadOutlined,
    ClearOutlined,
    ArrowLeftOutlined,
    AppstoreAddOutlined,
    BulbOutlined,
    EditOutlined,
    DownloadOutlined,
    ExpandOutlined,
    CompressOutlined
} from '@ant-design/icons';
import { BatchTexturePrefixModal, PrefixOptions } from './BatchTexturePrefixModal';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { parseMDX, parseMDL, generateMDX, generateMDL } from 'war3-model';
import { useSelectionStore } from '../../store/selectionStore';
import { ThumbnailGenerator } from './ThumbnailGenerator';
import { thumbnailService } from './ThumbnailService';
import { thumbnailEventBus } from './ThumbnailEventBus';
import { thumbnailAnimationCache } from './thumbnailAnimationCache';
import { ModelCard } from './ModelCard';
import { processDeathAnimation, processRemoveLights } from '../../utils/modelUtils';
import { useBatchStore } from '../../store/batchStore';
import { registerShortcutHandler } from '../../shortcuts/manager';

const { Content, Header } = Layout;
const { Text } = Typography;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 75, 100];
const BATCH_MODAL_Z_INDEX = 11000;

interface ModelFile {
    name: string;
    path: string;
    fullPath: string;
}

interface BatchManagerProps {
    onSelectModel?: (path: string, animationIndex: number) => void;
    selectedPath?: string | null;
    isFullBatchView?: boolean;
    onToggleFullBatchView?: () => void;
}

export const BatchManager: React.FC<BatchManagerProps> = ({
    onSelectModel,
    selectedPath,
    isFullBatchView = false,
    onToggleFullBatchView
}) => {
    const { token } = theme.useToken();
    const setMainMode = useSelectionStore(state => state.setMainMode);

    // Optimized store usage: select specific state and actions to avoid excessive re-renders
    const files = useBatchStore(state => state.files);
    const setFiles = useBatchStore(state => state.setFiles);
    const currentPath = useBatchStore(state => state.currentPath);
    const setCurrentPath = useBatchStore(state => state.setCurrentPath);
    const queue = useBatchStore(state => state.queue);
    const setQueue = useBatchStore(state => state.setQueue);
    const updateQueue = useBatchStore(state => state.updateQueue);
    const modelAnimations = useBatchStore(state => state.modelAnimations);
    const selectedAnimations = useBatchStore(state => state.selectedAnimations);
    const loading = useBatchStore(state => state.isLoading);
    const setLoading = useBatchStore(state => state.setLoading);
    const batchReset = useBatchStore(state => state.reset);

    // UI state
    const FIXED_CARD_SIZE = 220;
    const CARD_GAP = 15;
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(() => {
        if (typeof window === 'undefined') return 50;
        const raw = window.localStorage.getItem('batch.pageSize');
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && PAGE_SIZE_OPTIONS.includes(parsed)) {
            return parsed;
        }
        return 75;
    });
    const [visiblePaths, setVisiblePaths] = useState<Set<string>>(new Set());
    const [fastMode, setFastMode] = useState(false);
    const fastModeLocked = loading || files.length > 0;
    const [selfSpinEnabled, setSelfSpinEnabled] = useState(true);
    const [selfSpinSpeed, setSelfSpinSpeed] = useState(70);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [deathApplyLoading, setDeathApplyLoading] = useState(false);
    const [actionScope, setActionScope] = useState<'selected' | 'all'>('selected');
    const [isPrefixModalVisible, setIsPrefixModalVisible] = useState(false);
    const activeScanIdRef = useRef<string | null>(null);
    const firstPagePublishedRef = useRef(false);
    const scanCleanupRef = useRef<Array<() => void>>([]);
    const prefetchTokenRef = useRef(0);
    const deferredPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentPageFiles = files.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const scheduleCurrentPageWork = useCallback((pageFiles: ModelFile[]) => {
        prefetchTokenRef.current += 1;
        const currentPrefetchToken = prefetchTokenRef.current;
        if (deferredPrefetchTimerRef.current) {
            clearTimeout(deferredPrefetchTimerRef.current);
            deferredPrefetchTimerRef.current = null;
        }
        const originalPagePaths = pageFiles.map(f => f.fullPath);
        thumbnailService.pruneToActiveSet(originalPagePaths);

        void (async () => {
            const cacheFlags = await Promise.all(
                pageFiles.map(async (file) => ({
                    file,
                    hasCachedAnimation: await thumbnailAnimationCache.hasClip(file.fullPath)
                }))
            );
            if (prefetchTokenRef.current !== currentPrefetchToken) {
                return;
            }

            const orderedFiles = [
                ...cacheFlags.filter(item => !item.hasCachedAnimation).map(item => item.file),
                ...cacheFlags.filter(item => item.hasCachedAnimation).map(item => item.file)
            ];
            const orderedPaths = orderedFiles.map(f => f.fullPath);

            setQueue(orderedFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));

            const eagerCount = orderedPaths.length >= 50
                ? Math.min(12, orderedPaths.length)
                : orderedPaths.length >= 25
                    ? Math.min(16, orderedPaths.length)
                    : orderedPaths.length;
            const eagerPaths = orderedPaths.slice(0, eagerCount);
            const deferredPaths = orderedPaths.slice(eagerCount);

            if (eagerPaths.length > 0) {
                void thumbnailService.prefetch(eagerPaths, 8, { withTextures: true });
            }

            if (deferredPaths.length > 0) {
                deferredPrefetchTimerRef.current = setTimeout(() => {
                    if (prefetchTokenRef.current !== currentPrefetchToken) {
                        return;
                    }
                    void thumbnailService.prefetch(deferredPaths, 4, { withTextures: true });
                }, 120);
            }
        })();
    }, [setQueue]);

    // Shared states for animations moved to store

    const handleOpenFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: '选择包含模型文件的文件夹'
            });

            if (selected) {
                const path = Array.isArray(selected) ? selected[0] : selected;
                setCurrentPath(path);
                await scanFolder(path);
            }
        } catch (err) {
            console.error('Failed to open folder:', err);
            message.error('打开文件夹失败: ' + String(err));
        }
    };

    const scanFolder = async (path: string) => {
        setLoading(true);
        setCurrentPage(1);
        setFiles([]);
        setQueue([]);
        firstPagePublishedRef.current = false;
        try {
            scanCleanupRef.current.forEach((fn) => fn());
            scanCleanupRef.current = [];

            const scanId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            activeScanIdRef.current = scanId;

            const parseFirstPageBinaryPayload = (payload: Uint8Array | ArrayBuffer) => {
                const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
                if (bytes.byteLength < 4) {
                    return [] as Array<{ fullPath: string; buffer: ArrayBuffer; readMs: number }>;
                }
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                let offset = 0;
                const count = view.getUint32(offset, true);
                offset += 4;
                const rows: Array<{ fullPath: string; buffer: ArrayBuffer; readMs: number }> = [];
                for (let i = 0; i < count; i++) {
                    if (offset + 4 > bytes.byteLength) break;
                    const pathLen = view.getUint32(offset, true);
                    offset += 4;
                    if (offset + pathLen + 12 > bytes.byteLength) break;
                    const pathBytes = bytes.subarray(offset, offset + pathLen);
                    offset += pathLen;
                    const fullPath = new TextDecoder().decode(pathBytes);
                    const readMs = view.getFloat64(offset, true);
                    offset += 8;
                    const dataLen = view.getUint32(offset, true);
                    offset += 4;
                    if (offset + dataLen > bytes.byteLength) break;
                    const slice = bytes.subarray(offset, offset + dataLen);
                    const buffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
                    offset += dataLen;
                    rows.push({ fullPath, buffer, readMs });
                }
                return rows;
            };

            const toModelFiles = (paths: string[]): ModelFile[] => paths.map((fullPath) => ({
                fullPath,
                name: fullPath.split(/[/\\]/).pop() || fullPath,
                path: fullPath.split(/[/\\]/).pop() || fullPath
            }));

            const unlistenComplete = await listen<{ scan_id: string; files: string[] }>('batch-scan-complete', (event) => {
                const payload = event.payload;
                if (!payload || payload.scan_id !== activeScanIdRef.current) {
                    return;
                }

                const allFiles = toModelFiles(payload.files);
                setFiles(allFiles);
                if (allFiles.length > 0 && !firstPagePublishedRef.current) {
                    const firstPageFiles = allFiles.slice(0, pageSize);
                    scheduleCurrentPageWork(firstPageFiles);
                }
                setLoading(false);
                message.success(`找到 ${allFiles.length} 个模型文件`);
            });

            scanCleanupRef.current = [unlistenComplete];

            const firstPagePayload = await invoke<Uint8Array>('scan_model_files_streamed', {
                root: path,
                pageSize,
                scanId
            });
            const firstPageEntries = parseFirstPageBinaryPayload(firstPagePayload);
            if (firstPageEntries.length > 0) {
                firstPagePublishedRef.current = true;
                thumbnailService.primeModelBuffers(firstPageEntries);
                const firstPageFiles = toModelFiles(firstPageEntries.map((entry) => entry.fullPath));
                setFiles(firstPageFiles);
                scheduleCurrentPageWork(firstPageFiles);
                setLoading(false);
            }
        } catch (err) {
            console.error('Failed to read directory:', err);
            message.error('读取文件夹失败: ' + String(err));
            setLoading(false);
        }
    };

    const handleDelete = async (file: ModelFile) => {
        // Show confirmation modal (dark theme style)
        const confirmed = await new Promise<boolean>(resolve => {
            import('antd').then(({ Modal }) => {
                Modal.confirm({
                    title: '确定删除模型文件?',
                    content: '这也将尝试删除同名的预览图及专用贴图(如果有)',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    zIndex: BATCH_MODAL_Z_INDEX,
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false)
                });
            });
        });

        if (!confirmed) return;

        try {
            // 1. Parse the model to get its textures
            const modelData = await readFile(file.fullPath);
            const isMDX = file.fullPath.toLowerCase().endsWith('.mdx');
            // Note: readFile returns Uint8Array, parseMDX needs ArrayBuffer
            const model = isMDX ? parseMDX(modelData.buffer) : parseMDL(new TextDecoder().decode(modelData));

            const { getModelTexturePaths } = await import('../../utils/modelUtils');
            const modelTextures = getModelTexturePaths(file.fullPath, model);

            // 2. Build a set of all textures used by OTHER models in the list
            const otherFiles = files.filter(f => f.fullPath !== file.fullPath);
            const sharedTexturesSet = new Set<string>();

            for (const otherFile of otherFiles) {
                try {
                    const otherData = await readFile(otherFile.fullPath);
                    const isOtherMDX = otherFile.fullPath.toLowerCase().endsWith('.mdx');
                    const otherModel = isOtherMDX ? parseMDX(otherData.buffer) : parseMDL(new TextDecoder().decode(otherData));
                    const otherTextures = getModelTexturePaths(otherFile.fullPath, otherModel);
                    otherTextures.forEach(t => sharedTexturesSet.add(t.toLowerCase()));
                } catch (e) {
                    // Skip models that fail to parse
                }
            }

            // 3. Compute unique textures (only used by the model being deleted)
            const uniqueTextures = modelTextures.filter(t => !sharedTexturesSet.has(t.toLowerCase()));

            // 4. Delete model file and unique textures via Rust
            const { invoke } = await import('@tauri-apps/api/core');
            const pathsToDelete = [file.fullPath, ...uniqueTextures];
            const results = await invoke<[string, boolean, string][]>('delete_files', { paths: pathsToDelete });

            // 5. Report results
            const deleted = results.filter(([, ok]) => ok).length;
            const failed = results.filter(([, ok]) => !ok);

            if (failed.length > 0) {
                console.warn('Some files failed to delete:', failed);
            }

            message.success(`已删除 ${file.name}${uniqueTextures.length > 0 ? ` 及 ${uniqueTextures.length} 个贴图` : ''}`);

            // 6. Remove from UI
            setFiles(prev => prev.filter(f => f.fullPath !== file.fullPath));
            thumbnailEventBus.prune(new Set(files.filter(f => f.fullPath !== file.fullPath).map(f => f.fullPath)));

        } catch (err) {
            console.error('Delete failed:', err);
            message.error('删除失败: ' + String(err));
        }
    };

    const handleEditTexture = (file: ModelFile) => {
        message.info('批量贴图路径修改功能即将上线');
    };

    const handleCopyModel = async (file: ModelFile) => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<string>('copy_model_with_textures', { modelPath: file.fullPath });
            message.success(result);
        } catch (err) {
            console.error('Copy failed:', err);
            message.error('复制失败: ' + String(err));
        }
    };

    const handleThumbnailReady = useCallback((fullPath: string, bitmap: ImageBitmap, animations?: string[]) => {
        thumbnailEventBus.emitThumbnail(fullPath, bitmap);
        thumbnailEventBus.emitMissingTextures(fullPath, thumbnailService.getMissingTextureCount(fullPath));
        void thumbnailAnimationCache.captureFrame(fullPath, bitmap);

        if (animations && animations.length > 0) {
            thumbnailEventBus.emitAnimations(fullPath, animations);
        }
    }, []);

    const handleVisibilityChange = useCallback((fullPath: string, isVisible: boolean) => {
        setVisiblePaths(prev => {
            const next = new Set(prev);
            if (isVisible) next.add(fullPath);
            else next.delete(fullPath);
            return next;
        });
    }, []);

    const handlePageChange = (page: number, size: number) => {
        setCurrentPage(page);
        setPageSize(size);

        // When page changes, update the queue to process the new page's models
        const start = (page - 1) * size;
        const pageFiles = files.slice(start, start + size);
        scheduleCurrentPageWork(pageFiles);
    };

    const handlePageSizeChange = (size: number) => {
        setCurrentPage(1);
        setPageSize(size);

        const pageFiles = files.slice(0, size);
        scheduleCurrentPageWork(pageFiles);
    };

    const handleFastModeChange = (checked: boolean) => {
        if (fastModeLocked) return;
        setFastMode(checked);
    };

    const handleItemProcessed = useCallback((fullPath: string) => {
        updateQueue(prev => prev.filter(item => item.fullPath !== fullPath));
    }, [updateQueue]);

    const handleSelect = useCallback((file: ModelFile) => {
        setSelectedFile(file.fullPath);
    }, []);

    const handleDoubleClick = useCallback((file: ModelFile) => {
        setSelectedFile(file.fullPath);
        const selectedAnim = selectedAnimations[file.fullPath] || '';
        const animations = modelAnimations[file.fullPath]
            || thumbnailEventBus.getAnimations(file.fullPath)
            || thumbnailService.getCachedAnimations(file.fullPath)
            || [];
        const animationIndex = Math.max(0, animations.indexOf(selectedAnim));
        if (onSelectModel) {
            onSelectModel(file.fullPath, animationIndex);
        }
    }, [selectedAnimations, modelAnimations, onSelectModel]);

    useEffect(() => {
        const unsubscribe = registerShortcutHandler(
            'batch.copyModel',
            () => {
                const selectedFullPath = selectedPath ?? selectedFile
                if (!selectedFullPath) return false
                const file = files.find(f => f.fullPath === selectedFullPath)
                if (!file) return false
                handleCopyModel(file)
                return true
            },
            {
                isActive: () => useSelectionStore.getState().mainMode === 'batch',
                priority: 5
            }
        )
        return () => unsubscribe()
    }, [selectedPath, selectedFile, files, handleCopyModel])

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('batch.pageSize', String(pageSize));
    }, [pageSize]);

    useEffect(() => {
        return () => {
            scanCleanupRef.current.forEach((fn) => fn());
            scanCleanupRef.current = [];
            if (deferredPrefetchTimerRef.current) {
                clearTimeout(deferredPrefetchTimerRef.current);
                deferredPrefetchTimerRef.current = null;
            }
        };
    }, []);

    const applyDeathAnimationToPath = async (targetPath: string): Promise<'added' | 'updated'> => {
        const buffer = await readFile(targetPath);
        let model: any;
        if (targetPath.toLowerCase().endsWith('.mdl')) {
            const text = new TextDecoder().decode(buffer);
            model = parseMDL(text);
        } else {
            model = parseMDX(buffer.buffer);
        }
        if (!model) {
            throw new Error('模型解析失败');
        }

        const { status } = processDeathAnimation(model);

        const isMDL = targetPath.toLowerCase().endsWith('.mdl');
        if (isMDL) {
            const content = generateMDL(model);
            await writeFile(targetPath, new TextEncoder().encode(content));
        } else {
            const outBuffer = generateMDX(model);
            await writeFile(targetPath, new Uint8Array(outBuffer));
        }

        return status;
    };

    const applyRemoveLightsToPath = async (targetPath: string): Promise<number> => {
        const buffer = await readFile(targetPath);
        let model: any;
        if (targetPath.toLowerCase().endsWith('.mdl')) {
            const text = new TextDecoder().decode(buffer);
            model = parseMDL(text);
        } else {
            model = parseMDX(buffer.buffer);
        }
        if (!model) {
            throw new Error('模型解析失败');
        }

        const { count } = processRemoveLights(model);

        const isMDL = targetPath.toLowerCase().endsWith('.mdl');
        if (isMDL) {
            const content = generateMDL(model);
            await writeFile(targetPath, new TextEncoder().encode(content));
        } else {
            const outBuffer = generateMDX(model);
            await writeFile(targetPath, new Uint8Array(outBuffer));
        }

        return count;
    };

    const handleAddDeathAnimation = async () => {
        if (actionScope === 'all') {
            if (files.length === 0) {
                message.warning('请先导入模型文件');
                return;
            }
            setDeathApplyLoading(true);
            const queueItems: { name: string; fullPath: string }[] = [];
            let added = 0;
            let updated = 0;
            let failed = 0;
            try {
                thumbnailService.clearAll();
                for (const file of files) {
                    try {
                        const result = await applyDeathAnimationToPath(file.fullPath);
                        queueItems.push({ name: file.name, fullPath: file.fullPath });
                        if (result == 'added') added += 1;
                        else updated += 1;
                    } catch (err) {
                        failed += 1;
                        console.error('Failed to add death animation:', file.fullPath, err);
                    }
                }

                // Refresh current page thumbnails
                const start = (currentPage - 1) * pageSize;
                const pageFiles = files.slice(start, start + pageSize);
                setQueue(pageFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));

                const summary = `批量处理完成: 新增 ${added}，更新 ${updated}` + (failed > 0 ? `，失败 ${failed}` : '');
                message.success(summary);
            } finally {
                setDeathApplyLoading(false);
            }
        } else {
            const targetPath = selectedPath ?? selectedFile;
            if (!targetPath) {
                message.warning('请先选择模型文件');
                return;
            }
            setDeathApplyLoading(true);
            try {
                const result = await applyDeathAnimationToPath(targetPath);
                thumbnailService.clearAll();
                updateQueue(prev => [...prev, { name: targetPath.split(/[/\\]/).pop() || targetPath, fullPath: targetPath }]);
                if (result == 'added') {
                    message.success('已添加 Death 动作并更新可见度与发射速率');
                } else {
                    message.success('已更新 Death 动作关键帧与发射速率');
                }
            } catch (err) {
                console.error('Failed to add death animation:', err);
                message.error('添加失败: ' + String(err));
            } finally {
                setDeathApplyLoading(false);
            }
        }
    };

    const handleRemoveLights = async () => {
        if (actionScope === 'all') {
            if (files.length === 0) {
                message.warning('请先导入模型文件');
                return;
            }
            setDeathApplyLoading(true);
            let totalRemoved = 0;
            let failed = 0;
            try {
                thumbnailService.clearAll();
                for (const file of files) {
                    try {
                        const count = await applyRemoveLightsToPath(file.fullPath);
                        totalRemoved += count;
                    } catch (err) {
                        failed += 1;
                        console.error('Failed to remove lights:', file.fullPath, err);
                    }
                }

                // Refresh current page thumbnails
                const start = (currentPage - 1) * pageSize;
                const pageFiles = files.slice(start, start + pageSize);
                setQueue(pageFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));

                message.success(`批量删除完成: 共删除 ${totalRemoved} 个光照节点` + (failed > 0 ? `，失败 ${failed} 个文件` : ''));
            } finally {
                setDeathApplyLoading(false);
            }
        } else {
            const targetPath = selectedPath ?? selectedFile;
            if (!targetPath) {
                message.warning('请先选择模型文件');
                return;
            }
            setDeathApplyLoading(true);
            try {
                const count = await applyRemoveLightsToPath(targetPath);
                thumbnailService.clearAll();
                updateQueue(prev => [...prev, { name: targetPath.split(/[/\\]/).pop() || targetPath, fullPath: targetPath }]);
                message.success(`已删除 ${count} 个光照节点`);
            } catch (err) {
                console.error('Failed to remove lights:', err);
                message.error('删除失败: ' + String(err));
            } finally {
                setDeathApplyLoading(false);
            }
        }
    };

    const applyPrefixLogic = (path: string, options: PrefixOptions) => {
        const { prefix, mode, scope, whitelist } = options;
        const normalizedPath = path.replace(/\//g, '\\');
        const lowerPath = normalizedPath.toLowerCase();

        // 1. Whitelist check
        if (whitelist.some(w => w && lowerPath.startsWith(w.toLowerCase()))) {
            return normalizedPath;
        }

        // 2. Native check
        if (scope === 'excludeNative') {
            const nativeFolders = ['textures\\', 'replaceabletextures\\', 'units\\', 'buildings\\', 'doodads\\', 'skies\\', 'environment\\', 'terrainart\\', 'sharedtextures\\'];
            if (nativeFolders.some(f => lowerPath.startsWith(f))) {
                return normalizedPath;
            }
        }

        const fileName = normalizedPath.split('\\').pop() || '';
        const hasPrefix = normalizedPath.includes('\\');

        // 3. Transformation
        if (prefix === '') {
            return fileName;
        }

        if (mode === 'keep' && hasPrefix) {
            return normalizedPath;
        }

        const cleanPrefix = prefix.endsWith('\\') ? prefix : prefix + '\\';
        return cleanPrefix + fileName;
    };

    const handlePrefixProcess = async (options: PrefixOptions) => {
        const targets = actionScope === 'selected'
            ? files.filter(f => f.fullPath === selectedFile || f.fullPath === (selectedPath || ''))
            : files;

        if (targets.length === 0) {
            message.warning('没有可处理的目标模型');
            return;
        }

        setDeathApplyLoading(true);
        let successCount = 0;
        let failCount = 0;

        try {
            thumbnailService.clearAll();
            for (const file of targets) {
                try {
                    const data = await readFile(file.fullPath);
                    const isMDX = file.fullPath.toLowerCase().endsWith('.mdx');
                    let model = isMDX
                        ? parseMDX(data.buffer)
                        : parseMDL(new TextDecoder().decode(data));

                    if (model.Textures && Array.isArray(model.Textures)) {
                        model.Textures = model.Textures.map((tex: any) => {
                            const currentPath = tex.Image || tex.Path || '';
                            if (!currentPath) return tex;

                            const newPath = applyPrefixLogic(currentPath, options);
                            if (tex.Image !== undefined) tex.Image = newPath;
                            if (tex.Path !== undefined) tex.Path = newPath;
                            return tex;
                        });

                        const outData = isMDX ? generateMDX(model) : generateMDL(model);
                        const writeData = typeof outData === 'string' ? new TextEncoder().encode(outData) : new Uint8Array(outData);
                        await writeFile(file.fullPath, writeData);
                        successCount++;
                    }
                } catch (e) {
                    console.error(`Failed to process ${file.name}:`, e);
                    failCount++;
                }
            }

            // Refresh thumbnails
            const start = (currentPage - 1) * pageSize;
            const pageFiles = files.slice(start, start + pageSize);
            setQueue(pageFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));

            message.success(`贴图前缀修改完成: 成功 ${successCount} 个` + (failCount > 0 ? `，失败 ${failCount} 个` : ''));
        } finally {
            setDeathApplyLoading(false);
        }
    };

    const handleExportPerfLog = useCallback(async () => {
        if (currentPageFiles.length === 0) {
            message.warning('当前页没有模型可导出性能日志');
            return;
        }

        try {
            const baseDir = currentPath || (() => {
                const sample = currentPageFiles[0]?.fullPath || '';
                const lastSlash = Math.max(sample.lastIndexOf('\\'), sample.lastIndexOf('/'));
                return lastSlash >= 0 ? sample.slice(0, lastSlash) : sample;
            })();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sep = baseDir.endsWith('\\') || baseDir.endsWith('/') ? '' : '\\';
            const outPath = `${baseDir}${sep}batch_perf_${stamp}.json`;
            const payload = thumbnailService.exportPerfLog(currentPageFiles.map(file => file.fullPath));
            await writeFile(outPath, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
            message.success(`性能日志已导出: ${outPath}`);
        } catch (err) {
            console.error('Failed to export batch perf log:', err);
            message.error('导出性能日志失败: ' + String(err));
        }
    }, [currentPageFiles, currentPath]);


    return (
        <Layout style={{ height: '100%', background: '#141414' }}>
            <Header style={{
                display: 'flex',
                alignItems: 'center',
                background: '#1a1a1a',
                borderBottom: '1px solid #333',
                padding: '0 12px',
                gap: 8,
                height: 48
            }}>
                <Space size={8}>
                    <Tooltip title="返回模型视图">
                        <Button
                            type="text"
                            icon={<ArrowLeftOutlined style={{ color: '#fff' }} />}
                            onClick={() => setMainMode('view')}
                        />
                    </Tooltip>
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginRight: 8, whiteSpace: 'nowrap' }}>批量预览</Text>

                    <Space size={8} style={{ marginLeft: 16 }}>
                        <Tooltip title="导入包含多个模型的文件夹">
                            <Button
                                type="primary"
                                icon={<FolderOpenOutlined />}
                                onClick={handleOpenFolder}
                                loading={loading}
                                size="small"
                                style={{ minWidth: 40 }}
                            />
                        </Tooltip>

                        <Tooltip title="刷新当前目录">
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={() => currentPath && scanFolder(currentPath)}
                                loading={loading}
                                disabled={!currentPath}
                                size="small"
                                style={{ minWidth: 40 }}
                            />
                        </Tooltip>

                        <Tooltip title="清空列表">
                            <Button
                                icon={<ClearOutlined />}
                                danger
                                onClick={() => {
                                    batchReset();
                                    thumbnailEventBus.clear();
                                    thumbnailService.clearAll();
                                }}
                                disabled={files.length === 0}
                                size="small"
                                style={{ minWidth: 40 }}
                            />
                        </Tooltip>

                        <Tooltip title="导出当前页批量性能日志">
                            <Button
                                icon={<DownloadOutlined />}
                                onClick={handleExportPerfLog}
                                disabled={currentPageFiles.length === 0}
                                size="small"
                                style={{ minWidth: 40 }}
                            />
                        </Tooltip>

                        <Tooltip title={fastModeLocked ? '\u6e05\u7a7a\u5217\u8868\u540e\u53ef\u5207\u6362' : '\u9759\u6001\u6a21\u5f0f\uff1a\u53ea\u6e32\u67d3\u9759\u6001\u7f29\u7565\u56fe\uff0c\u4e0d\u64ad\u653e\u52a8\u4f5c'}>
                            <Button
                                size="small"
                                type={fastMode ? 'primary' : 'default'}
                                onClick={() => handleFastModeChange(!fastMode)}
                                disabled={fastModeLocked}
                                style={fastMode
                                    ? { fontWeight: 600 }
                                    : { background: '#2b2b2b', borderColor: '#3a3a3a', color: '#bfbfbf' }
                                }
                            >
                                {fastMode ? '\u9759\u6001\u6a21\u5f0f' : '\u52a8\u4f5c\u6a21\u5f0f'}
                            </Button>
                        </Tooltip>

                        <Tooltip title={isFullBatchView ? '\u9000\u51fa\u6279\u91cf\u5168\u5c4f' : '\u8fdb\u5165\u6279\u91cf\u5168\u5c4f'}>
                            <Button
                                size="small"
                                icon={isFullBatchView ? <CompressOutlined /> : <ExpandOutlined />}
                                onClick={() => onToggleFullBatchView?.()}
                                disabled={!onToggleFullBatchView}
                                style={{ minWidth: 40 }}
                            />
                        </Tooltip>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '0 8px',
                            height: 24,
                            border: '1px solid #333',
                            borderRadius: 4,
                            background: '#1a1a1a'
                        }}>
                            <Text style={{ color: '#aaa', fontSize: 11 }}>{'\u81ea\u65cb'}</Text>
                            <Switch size="small" checked={selfSpinEnabled} onChange={setSelfSpinEnabled} />
                            <Text style={{ color: '#888', fontSize: 11 }}>{'\u901f\u5ea6'}</Text>
                            <Slider
                                min={5}
                                max={120}
                                step={5}
                                value={selfSpinSpeed}
                                onChange={(value) => setSelfSpinSpeed(Array.isArray(value) ? value[0] : value)}
                                disabled={!selfSpinEnabled}
                                style={{ width: 70, margin: '0 4px' }}
                            />
                        </div>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '0 8px',
                            height: 24,
                            border: '1px solid #333',
                            borderRadius: 4,
                            background: '#1a1a1a'
                        }}>
                            <Text style={{ color: '#aaa', fontSize: 11 }}>{'\u6bcf\u9875\u6570\u91cf'}</Text>
                            <Select<number>
                                size="small"
                                value={pageSize}
                                onChange={handlePageSizeChange}
                                style={{ width: 74 }}
                                options={PAGE_SIZE_OPTIONS.map((value) => ({ label: String(value), value }))}
                            />
                        </div>
                    </Space>
                </Space>

                <div style={{ flex: 1 }} />

                {currentPath && (
                    <div style={{
                        flex: 1,
                        overflow: 'hidden',
                        fontSize: 12,
                        color: token.colorTextSecondary,
                        background: 'rgba(255,255,255,0.05)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        marginLeft: 8,
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis'
                    }}>
                        {currentPath}
                    </div>
                )}
            </Header>
            <Content style={{
                padding: '16px 24px',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 36,
                    marginBottom: 12,
                    padding: '8px 0',
                    borderBottom: '1px solid #2a2a2a'
                }}>
                    <Space size={16}>
                        <Radio.Group
                            size="small"
                            value={actionScope}
                            onChange={e => setActionScope(e.target.value)}
                            buttonStyle="solid"
                        >
                            <Radio.Button value="selected">当前选中</Radio.Button>
                            <Radio.Button value="all">整组文件夹</Radio.Button>
                        </Radio.Group>

                        <Space size={8}>
                            <Tooltip title={actionScope === 'selected' ? "为当前选中的模型添加 Death (死亡) 动作" : "为整个文件夹的所有模型添加 Death (死亡) 动作"}>
                                <Button
                                    icon={<AppstoreAddOutlined />}
                                    onClick={handleAddDeathAnimation}
                                    disabled={actionScope === 'selected' ? (!selectedPath && !selectedFile) : files.length === 0}
                                    loading={deathApplyLoading}
                                    size="small"
                                    type="primary"
                                    ghost
                                    style={{ minWidth: 40 }}
                                />
                            </Tooltip>
                            <Tooltip title={actionScope === 'selected' ? "删除当前选中模型的所有光照节点" : "删除整个文件夹模型的所有光照节点"}>
                                <Button
                                    icon={<BulbOutlined />}
                                    onClick={handleRemoveLights}
                                    disabled={actionScope === 'selected' ? (!selectedPath && !selectedFile) : files.length === 0}
                                    loading={deathApplyLoading}
                                    size="small"
                                    type="primary"
                                    danger
                                    ghost
                                    style={{ minWidth: 40 }}
                                />
                            </Tooltip>
                            <Tooltip title="批量修改贴图路径前缀">
                                <Button
                                    icon={<EditOutlined />}
                                    onClick={() => setIsPrefixModalVisible(true)}
                                    disabled={actionScope === 'selected' ? (!selectedPath && !selectedFile) : files.length === 0}
                                    size="small"
                                    type="primary"
                                    ghost
                                    style={{ minWidth: 40 }}
                                />
                            </Tooltip>
                        </Space>
                    </Space>

                    {deathApplyLoading && (
                        <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center' }}>
                            <Spin size="small" />
                            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>处理中...</Text>
                        </span>
                    )}
                </div>
                {files.length > 0 ? (
                    <>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(auto-fill, ${FIXED_CARD_SIZE}px)`,
                            gridAutoRows: `${FIXED_CARD_SIZE}px`,
                            gap: CARD_GAP,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            flex: 1,
                            minHeight: 0,
                            paddingRight: 8,
                            alignItems: 'start',
                            alignContent: 'start'
                        }}>
                            {currentPageFiles.map((file) => (
                                <ModelCard
                                    key={file.fullPath}
                                    file={file}
                                    fixedSize={FIXED_CARD_SIZE}
                                    isSelected={(selectedPath ?? selectedFile) === file.fullPath}
                                    onDelete={handleDelete}
                                    onEditTexture={handleEditTexture}
                                    onCopy={handleCopyModel}
                                    onSelect={handleSelect}
                                    onDoubleClick={handleDoubleClick}
                                    onVisibilityChange={handleVisibilityChange}
                                />
                            ))}
                        </div>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            padding: '8px 0',
                            borderTop: '1px solid #333',
                            background: '#1a1a1a',
                            margin: '0 -24px -16px -24px'
                        }}>
                            <Pagination
                                current={currentPage}
                                pageSize={pageSize}
                                total={files.length}
                                onChange={handlePageChange}
                                showSizeChanger={false}
                                showTotal={(total: number) => `共 ${total} 个模型`}
                                size="small"
                            />
                        </div>
                    </>
                ) : loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
                        <Spin size="large" />
                        <div style={{ marginTop: 16, color: '#999' }}>正在扫描文件...</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                <div style={{ color: '#666' }}>
                                    {currentPath ? "该文件夹下没有找到模型文件" : "请将文件夹拖放到此处或点击按钮导入"}
                                </div>
                            }
                        />
                    </div>
                )}

                <ThumbnailGenerator
                    queue={queue}
                    onThumbnailReady={handleThumbnailReady}
                    onItemProcessed={handleItemProcessed}
                    visiblePaths={visiblePaths}
                    isAnimating={!fastMode}
                    selfSpinEnabled={selfSpinEnabled}
                    selfSpinSpeed={selfSpinSpeed}
                    selectedAnimations={selectedAnimations}
                    modelAnimations={modelAnimations}
                    selectedPath={selectedPath ?? selectedFile}
                />

                <BatchTexturePrefixModal
                    visible={isPrefixModalVisible}
                    onClose={() => setIsPrefixModalVisible(false)}
                    onProcess={handlePrefixProcess}
                    zIndex={BATCH_MODAL_Z_INDEX}
                />
            </Content>

        </Layout>
    );
};
