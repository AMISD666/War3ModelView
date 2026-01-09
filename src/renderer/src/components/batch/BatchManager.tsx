import React, { useState, useEffect, useCallback } from 'react';
import { Button, Empty, Layout, theme, Typography, Spin, message, Pagination } from 'antd';
import {
    FolderOpenOutlined,
    ReloadOutlined,
    ClearOutlined,
    ArrowLeftOutlined
} from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { parseMDX, parseMDL, generateMDX, generateMDL } from 'war3-model';
import { useSelectionStore } from '../../store/selectionStore';
import { ThumbnailGenerator } from './ThumbnailGenerator';
import { thumbnailService } from './ThumbnailService';
import { ModelCard } from './ModelCard';
import { thumbnailEventBus } from './ThumbnailEventBus';

const { Content, Header } = Layout;
const { Text } = Typography;

interface ModelFile {
    name: string;
    path: string;
    fullPath: string;
}

interface BatchManagerProps {
    onSelectModel?: (path: string, animationIndex: number) => void;
    onAnimationChange?: (animationIndex: number) => void;
    selectedPath?: string | null;
}

export const BatchManager: React.FC<BatchManagerProps> = ({
    onSelectModel,
    onAnimationChange,
    selectedPath
}) => {
    const { token } = theme.useToken();
    const setMainMode = useSelectionStore(state => state.setMainMode);

    const [loading, setLoading] = useState(false);
    const [files, setFiles] = useState<ModelFile[]>([]);
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [queue, setQueue] = useState<{ name: string; fullPath: string }[]>([]);

    // UI state
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(12);
    const [visiblePaths, setVisiblePaths] = useState<Set<string>>(new Set());
    const [isAnimating, setAnimating] = useState(true);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [deathApplyLoading, setDeathApplyLoading] = useState(false);


    // Shared states for animations
    const [modelAnimations, setModelAnimations] = useState<Record<string, string[]>>({});
    const [selectedAnimations, setSelectedAnimations] = useState<Record<string, string>>({});

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
        try {
            const modelFiles: ModelFile[] = [];

            // Recursive function to scan directories
            const scanDirV2 = async (dirPath: string) => {
                try {
                    const { readDir } = await import('@tauri-apps/plugin-fs');
                    const entries = await readDir(dirPath);
                    for (const entry of entries) {
                        const entryPath = dirPath + (dirPath.endsWith('\\') || dirPath.endsWith('/') ? '' : '\\') + entry.name;
                        if (entry.isDirectory) {
                            await scanDirV2(entryPath);
                        } else {
                            const name = entry.name.toLowerCase();
                            if (name.endsWith('.mdx') || name.endsWith('.mdl')) {
                                modelFiles.push({
                                    name: entry.name,
                                    path: entry.name,
                                    fullPath: entryPath
                                });
                            }
                        }
                    }
                } catch (readErr) {
                    console.warn(`Failed to read directory: ${dirPath}`, readErr);
                }
            };

            await scanDirV2(path);

            setFiles(modelFiles);

            // Only queue the current page
            const initialPageFiles = modelFiles.slice(0, pageSize);
            setQueue(initialPageFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));

            message.success(`找到 ${modelFiles.length} 个模型文件`);
        } catch (err) {
            console.error('Failed to read directory:', err);
            message.error('读取文件夹失败: ' + String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (file: ModelFile) => {
        // Mock delete for now, or implement via Rust
        message.info('删除功能暂未完全开放: ' + file.name);
        setFiles(prev => prev.filter(f => f.fullPath !== file.fullPath));
    };

    const handleEditTexture = (file: ModelFile) => {
        message.info('批量贴图路径修改功能即将上线');
    };

    const handleThumbnailReady = useCallback((fullPath: string, bitmap: ImageBitmap, animations?: string[]) => {
        thumbnailEventBus.emitThumbnail(fullPath, bitmap);

        if (animations && animations.length > 0) {
            setModelAnimations(prev => ({ ...prev, [fullPath]: animations }));
            thumbnailEventBus.emitAnimations(fullPath, animations);

            // Default to the first animation if not set
            setSelectedAnimations(prev => {
                if (prev[fullPath]) return prev;
                return { ...prev, [fullPath]: animations[0] };
            });
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
        setQueue(pageFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));
    };

    const handleItemProcessed = useCallback((fullPath: string) => {
        setQueue(prev => {
            if (prev.length > 0 && prev[0].fullPath === fullPath) {
                return prev.slice(1);
            }
            return prev;
        });
    }, []);

    const handleAnimationChange = useCallback((file: ModelFile, animation: string) => {
        setSelectedAnimations(prev => ({ ...prev, [file.fullPath]: animation }));
        const animations = modelAnimations[file.fullPath] || [];
        const animationIndex = animations.indexOf(animation);
        if (onAnimationChange && animationIndex >= 0) {
            onAnimationChange(animationIndex);
        }
    }, [modelAnimations, onAnimationChange]);

    const handleSelect = useCallback((file: ModelFile) => {
        setSelectedFile(file.fullPath);
        const selectedAnim = selectedAnimations[file.fullPath] || '';
        const animations = modelAnimations[file.fullPath] || [];
        const animationIndex = Math.max(0, animations.indexOf(selectedAnim));
        if (onSelectModel) {
            onSelectModel(file.fullPath, animationIndex);
        }
    }, [selectedAnimations, modelAnimations, onSelectModel]);


    const toFloat32Array = (value: any, size: number): Float32Array => {
        if (value instanceof Float32Array) return value;
        if (Array.isArray(value)) return new Float32Array(value);
        if (value && typeof value === 'object') {
            const arr = Object.values(value).map(Number);
            const padded = arr.length >= size ? arr : [...arr, ...new Array(size - arr.length).fill(0)];
            return new Float32Array(padded);
        }
        return new Float32Array(new Array(size).fill(0));
    };

    const isAnimVector = (value: any): boolean => {
        return value && typeof value === 'object' && Array.isArray(value.Keys);
    };

    const getAnimValueAtFrame = (anim: any, frame: number, fallback: number): number => {
        if (!anim?.Keys || anim.Keys.length === 0) return fallback;
        const keys = [...anim.Keys].sort((a: any, b: any) => a.Frame - b.Frame);
        let result = fallback;
        for (const key of keys) {
            if (typeof key.Frame !== 'number') continue;
            if (key.Frame <= frame) {
                if (Array.isArray(key.Vector)) result = Number(key.Vector[0] ?? result);
                else if (key.Vector?.length !== undefined) result = Number(key.Vector[0] ?? result);
                else result = Number(key.Vector ?? result);
            } else {
                break;
            }
        }
        return result;
    };

    const buildAnimVector = (frames: number[], value: number, endValue?: number, endFrame?: number) => {
        const map = new Map<number, number>();
        frames.forEach((frame) => map.set(frame, value));
        if (endFrame !== undefined && endValue !== undefined) {
            map.set(endFrame, endValue);
        }
        const keys = Array.from(map.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([frame, val]) => ({
                Frame: frame,
                Vector: new Float32Array([val])
            }));
        return {
            LineType: 1,
            Keys: keys
        };
    };

    const updateAnimVector = (anim: any, baseValue: number, deathStart: number, deathEnd: number) => {
        const map = new Map<number, number>();
        for (const key of anim.Keys || []) {
            if (typeof key.Frame !== 'number') continue;
            if (key.Frame > deathStart) continue;
            let val = baseValue;
            if (Array.isArray(key.Vector)) val = Number(key.Vector[0] ?? baseValue);
            else if (key.Vector?.length !== undefined) val = Number(key.Vector[0] ?? baseValue);
            else val = Number(key.Vector ?? baseValue);
            map.set(key.Frame, val);
        }
        map.set(deathStart, 0);
        map.set(deathEnd, 0);
        anim.LineType = 0;
        anim.GlobalSeqId = null;
        if ('GlobalSequenceId' in anim) delete anim.GlobalSequenceId;
        anim.Keys = Array.from(map.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([frame, val]) => ({
                Frame: frame,
                Vector: new Float32Array([val])
            }));
        return anim;
    };

    const collectBaseFrames = (sequences: any[]): number[] => {
        const frames = new Set<number>([0]);
        sequences.forEach((seq) => {
            const interval = Array.isArray(seq.Interval) ? seq.Interval : seq.Interval?.length ? Array.from(seq.Interval) : [];
            if (interval.length >= 2) {
                frames.add(Number(interval[0]));
                frames.add(Number(interval[1]));
            }
        });
        return Array.from(frames).sort((a, b) => a - b);
    };

    const applyScalarAnim = (animSource: any, baseFrames: number[], baseValue: number, deathStart: number, deathEnd: number) => {
        if (isAnimVector(animSource)) {
            return updateAnimVector(animSource, baseValue, deathStart, deathEnd);
        }
        const frames = Array.from(new Set([0, ...baseFrames, deathStart, deathEnd])).sort((a, b) => a - b);
        const anim = buildAnimVector(frames, baseValue);
        return updateAnimVector(anim, baseValue, deathStart, deathEnd);
    };

    const applyVisibility = (animSource: any, baseFrames: number[], baseValue: number, deathStart: number, deathEnd: number) => {
        return applyScalarAnim(animSource, baseFrames, baseValue, deathStart, deathEnd);
    };

    const getStaticEmissionRate = (node: any): number => {
        if (typeof node.EmissionRate === 'number') return node.EmissionRate;
        if (typeof node.EmissionRateAnim === 'number') return node.EmissionRateAnim;
        const animValue = isAnimVector(node.EmissionRate) ? node.EmissionRate : node.EmissionRateAnim;
        return isAnimVector(animValue) ? getAnimValueAtFrame(animValue, 0, 0) : 0;
    };
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

        const sequences = model.Sequences || [];
        const deathIndex = sequences.findIndex((seq: any) => String(seq.Name || '').toLowerCase() === 'death');
        const deathSequence = deathIndex >= 0 ? sequences[deathIndex] : null;
        const nonDeathSequences = sequences.filter((_: any, index: number) => index != deathIndex);

        const lastEnd = nonDeathSequences.reduce((max: number, seq: any) => {
            const interval = Array.isArray(seq.Interval) ? seq.Interval : seq.Interval?.length ? Array.from(seq.Interval) : [];
            const end = interval.length >= 2 ? Number(interval[1]) : 0;
            return Math.max(max, end);
        }, 0);

        let deathStart = lastEnd + 1000;
        let deathEnd = deathStart + 3000;

        if (deathSequence) {
            const interval = Array.isArray(deathSequence.Interval)
                ? deathSequence.Interval
                : deathSequence.Interval?.length
                    ? Array.from(deathSequence.Interval)
                    : [];
            if (interval.length >= 2) {
                deathStart = Number(interval[0]);
                deathEnd = Number(interval[1]);
            } else {
                deathSequence.Interval = new Uint32Array([deathStart, deathEnd]);
            }
        } else {
            const infoMin = model.Info?.MinimumExtent;
            const infoMax = model.Info?.MaximumExtent;
            const infoBounds = model.Info?.BoundsRadius;
            const refSequence = nonDeathSequences[nonDeathSequences.length - 1];
            const minimumExtent = toFloat32Array(refSequence?.MinimumExtent ?? infoMin ?? [0, 0, 0], 3);
            const maximumExtent = toFloat32Array(refSequence?.MaximumExtent ?? infoMax ?? [0, 0, 0], 3);
            const boundsRadius = typeof refSequence?.BoundsRadius == 'number'
                ? refSequence.BoundsRadius
                : (typeof infoBounds == 'number' ? infoBounds : 0);

            const newDeathSequence = {
                Name: 'Death',
                Interval: new Uint32Array([deathStart, deathEnd]),
                NonLooping: 1,
                MinimumExtent: minimumExtent,
                MaximumExtent: maximumExtent,
                BoundsRadius: boundsRadius,
                MoveSpeed: 0,
                Rarity: 0
            };

            model.Sequences = [...sequences, newDeathSequence];
        }

        const baseFrames = collectBaseFrames(model.Sequences || []);

        if (!model.GeosetAnims) model.GeosetAnims = [];
        const geosetAnimMap = new Map<number, any>();
        model.GeosetAnims.forEach((anim: any) => {
            if (typeof anim.GeosetId == 'number') geosetAnimMap.set(anim.GeosetId, anim);
        });

        (model.Geosets || []).forEach((geoset: any, index: number) => {
            let anim = geosetAnimMap.get(index);
            if (!anim) {
                anim = {
                    GeosetId: index,
                    Alpha: 1,
                    Color: new Float32Array([1, 1, 1]),
                    Flags: 0
                };
                model.GeosetAnims.push(anim);
                geosetAnimMap.set(index, anim);
            }

            const currentAlpha = anim.Alpha;
            let baseValue = 1;
            if (typeof currentAlpha == 'number') {
                baseValue = currentAlpha;
            } else if (isAnimVector(currentAlpha)) {
                baseValue = getAnimValueAtFrame(currentAlpha, lastEnd, 1);
            }

            anim.Alpha = applyVisibility(currentAlpha, baseFrames, baseValue, deathStart, deathEnd);
        });

        const updateNodeVisibility = (node: any) => {
            const animValue = isAnimVector(node.Visibility) ? node.Visibility : node.VisibilityAnim;
            let baseValue = 1;
            if (typeof node.Visibility == 'number') baseValue = node.Visibility;
            else if (typeof node.VisibilityAnim == 'number') baseValue = node.VisibilityAnim;
            else if (isAnimVector(animValue)) baseValue = getAnimValueAtFrame(animValue, lastEnd, 1);

            const anim = applyVisibility(animValue, baseFrames, baseValue, deathStart, deathEnd);
            node.Visibility = anim;
            node.VisibilityAnim = anim;
        };

        const updateEmissionRate = (node: any) => {
            const animValue = isAnimVector(node.EmissionRate) ? node.EmissionRate : node.EmissionRateAnim;
            const baseValue = getStaticEmissionRate(node);
            const anim = applyScalarAnim(animValue, baseFrames, baseValue, deathStart, deathEnd);
            node.EmissionRate = anim;
            node.EmissionRateAnim = anim;
        };

        (model.ParticleEmitters2 || []).forEach(updateNodeVisibility);
        (model.RibbonEmitters || []).forEach(updateNodeVisibility);
        (model.ParticleEmitters || []).forEach(updateNodeVisibility);
        (model.ParticleEmitters2 || []).forEach(updateEmissionRate);
        (model.ParticleEmitters || []).forEach(updateEmissionRate);

        const isMDL = targetPath.toLowerCase().endsWith('.mdl');
        if (isMDL) {
            const content = generateMDL(model);
            await writeFile(targetPath, new TextEncoder().encode(content));
        } else {
            const outBuffer = generateMDX(model);
            await writeFile(targetPath, new Uint8Array(outBuffer));
        }

        return deathSequence ? 'updated' : 'added';
    };

    const handleAddDeathAnimation = async () => {
        const targetPath = selectedPath ?? selectedFile;
        if (!targetPath) {
            message.warning('请先选择模型文件');
            return;
        }
        setDeathApplyLoading(true);
        try {
            const result = await applyDeathAnimationToPath(targetPath);
            thumbnailService.clearAll();
            setQueue(prev => [...prev, { name: targetPath.split(/[/\\]/).pop() || targetPath, fullPath: targetPath }]);
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
    };

    const handleAddDeathAnimationForAll = async () => {
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
            if (queueItems.length > 0) {
                setQueue(prev => [...prev, ...queueItems]);
            }
            const summary = `处理完成: 新增 ${added}，更新 ${updated}` + (failed > 0 ? `，失败 ${failed}` : '');
            message.success(summary);
        } finally {
            setDeathApplyLoading(false);
        }
    };


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
                <Button
                    type="text"
                    icon={<ArrowLeftOutlined style={{ color: '#fff' }} />}
                    onClick={() => setMainMode('view')}
                />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginRight: 16 }}>批量预览</Text>

                <Button
                    type="primary"
                    icon={<FolderOpenOutlined />}
                    onClick={handleOpenFolder}
                    loading={loading}
                    size="small"
                >
                    导入文件夹
                </Button>

                <Button
                    icon={<ReloadOutlined />}
                    onClick={() => currentPath && scanFolder(currentPath)}
                    loading={loading}
                    disabled={!currentPath}
                    size="small"
                >
                    刷新
                </Button>

                <Button
                    icon={<ClearOutlined />}
                    onClick={() => {
                        setFiles([]);
                        setQueue([]);
                        setCurrentPath(null);
                        setModelAnimations({});
                        setSelectedAnimations({});
                        thumbnailEventBus.clear();
                        thumbnailService.clearAll();
                    }}
                    disabled={files.length === 0}
                    size="small"
                >
                    清空
                </Button>

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
                    gap: 8,
                    minHeight: 36,
                    marginBottom: 12,
                    padding: '4px 0',
                    borderBottom: '1px solid #2a2a2a'
                }}>
                    <Button
                        onClick={handleAddDeathAnimation}
                        disabled={!selectedPath && !selectedFile}
                        loading={deathApplyLoading}
                        size="small"
                        type="default"
                    >
                        当前模型添加死亡动画
                    </Button>
                    <Button
                        onClick={handleAddDeathAnimationForAll}
                        disabled={files.length === 0}
                        loading={deathApplyLoading}
                        size="small"
                        type="default"
                    >
                        所有模型添加死亡动画
                    </Button>
                    <div style={{ flex: 1 }} />
                </div>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <Spin size="large" tip="正在扫描文件..." />
                    </div>
                ) : files.length > 0 ? (
                    <>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: 12,
                            overflowY: 'auto',
                            flex: 1,
                            paddingRight: 8,
                            alignItems: 'start',
                            alignContent: 'start',
                            marginBottom: 16
                        }}>
                            {files.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((file) => (
                                <ModelCard
                                    key={file.fullPath}
                                    file={file}
                                    initialAnimations={modelAnimations[file.fullPath]}
                                    initialSelectedAnimation={selectedAnimations[file.fullPath]}
                                    isSelected={(selectedPath ?? selectedFile) === file.fullPath}
                                    onDelete={handleDelete}
                                    onEditTexture={handleEditTexture}
                                    onAnimationChange={handleAnimationChange}
                                    onSelect={handleSelect}
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
                    isAnimating={isAnimating}
                    selectedAnimations={selectedAnimations}
                    modelAnimations={modelAnimations}
                />
            </Content>
            

        </Layout>
    );
};
