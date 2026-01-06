import React, { useState, useEffect, useCallback } from 'react';
import { Button, Empty, Layout, theme, Typography, Spin, message, Breadcrumb } from 'antd';
import { FolderOpenOutlined, ArrowLeftOutlined, ReloadOutlined, ClearOutlined } from '@ant-design/icons';
import { useSelectionStore } from '../../store/selectionStore';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, DirEntry, remove } from '@tauri-apps/plugin-fs';
import { ThumbnailGenerator } from './ThumbnailGenerator';
import { ModelCard } from './ModelCard';

const { Content, Header } = Layout;
const { Title } = Typography;

interface ModelFile {
    name: string;
    path: string; // Relative path or name if flat
    fullPath: string; // We might need to construct this manually if readDir doesn't return it
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
    const { setMainMode } = useSelectionStore();
    const { token } = theme.useToken();
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [files, setFiles] = useState<ModelFile[]>([]);
    const [loading, setLoading] = useState(false);

    // Thumbnail system
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const [queue, setQueue] = useState<{ name: string, fullPath: string }[]>([]);

    // Animation data per model
    const [modelAnimations, setModelAnimations] = useState<Record<string, string[]>>({});
    const [selectedAnimations, setSelectedAnimations] = useState<Record<string, string>>({});

    // Selected model for playback (internal state synced with selectedPath prop)
    const [selectedFile, setSelectedFile] = useState<string | null>(null);

    const handleOpenFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                recursive: false,
                title: '选择模型文件夹'
            });

            if (selected && typeof selected === 'string') {
                setCurrentPath(selected);
                scanFolder(selected);
            }
        } catch (err) {
            console.error('Failed to open folder:', err);
            message.error('打开文件夹失败');
        }
    };

    const scanFolder = async (path: string) => {
        setLoading(true);
        setFiles([]);
        setThumbnails({});
        setQueue([]); // Clear old queue
        setModelAnimations({});
        setSelectedAnimations({});
        try {
            const modelFiles: ModelFile[] = [];

            // Recursive function to scan directories
            const scanDirV2 = async (dirPath: string) => {
                try {
                    const entries = await readDir(dirPath);
                    for (const entry of entries) {
                        const entryPath = `${dirPath}\\${entry.name}`;
                        if (entry.isDirectory) {
                            await scanDirV2(entryPath);
                        } else if (entry.isFile) {
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
                    console.warn(`Failed to read subdirectory: ${dirPath}`, readErr);
                }
            };

            await scanDirV2(path);

            setFiles(modelFiles);
            // Initialize queue with all files
            setQueue(modelFiles.map(f => ({ name: f.name, fullPath: f.fullPath })));
            message.success(`找到 ${modelFiles.length} 个模型文件`);
        } catch (err) {
            console.error('Failed to read directory:', err);
            message.error('读取文件夹失败: ' + String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (file: ModelFile) => {
        try {
            await remove(file.fullPath);
            message.success(`已删除 ${file.name}`);

            setFiles(prev => prev.filter(f => f.fullPath !== file.fullPath));
            setQueue(prev => prev.filter(q => q.fullPath !== file.fullPath));
            setThumbnails(prev => {
                const newThumbnails = { ...prev };
                delete newThumbnails[file.fullPath];
                return newThumbnails;
            });
        } catch (err) {
            console.error('Delete failed:', err);
            message.error('删除失败: ' + String(err));
        }
    };

    const handleEditTexture = (file: ModelFile) => {
        message.info('批量贴图路径修改功能即将上线');
    };

    const handleThumbnailReady = useCallback((fullPath: string, dataUrl: string, animations?: string[]) => {
        setThumbnails(prev => ({ ...prev, [fullPath]: dataUrl }));
        if (animations && animations.length > 0) {
            setModelAnimations(prev => ({ ...prev, [fullPath]: animations }));
            // Auto-select first animation
            setSelectedAnimations(prev => ({ ...prev, [fullPath]: animations[0] }));
        }
    }, []);

    const handleItemProcessed = useCallback((fullPath: string) => {
        setQueue(prev => {
            // Remove the processed item (assuming it's usually the first one)
            if (prev.length > 0 && prev[0].fullPath === fullPath) {
                return prev.slice(1);
            }
            return prev;
        });
    }, []);

    const handleAnimationChange = useCallback((file: ModelFile, animation: string) => {
        setSelectedAnimations(prev => ({ ...prev, [file.fullPath]: animation }));
        // Find animation index for the callback
        const animations = modelAnimations[file.fullPath] || [];
        const animationIndex = animations.indexOf(animation);
        if (onAnimationChange && animationIndex >= 0) {
            onAnimationChange(animationIndex);
        }
    }, [modelAnimations, onAnimationChange]);

    const handleSelect = useCallback((file: ModelFile) => {
        setSelectedFile(file.fullPath);
        // Find animation index for the selected animation
        const selectedAnim = selectedAnimations[file.fullPath] || '';
        const animations = modelAnimations[file.fullPath] || [];
        const animationIndex = Math.max(0, animations.indexOf(selectedAnim));
        // Notify parent of selection
        if (onSelectModel) {
            onSelectModel(file.fullPath, animationIndex);
        }
    }, [selectedAnimations, modelAnimations, onSelectModel]);

    return (
        <Layout style={{ height: '100%', background: '#141414' }}>
            <Header style={{
                display: 'flex',
                alignItems: 'center',
                background: '#1e1e1e',
                borderBottom: '1px solid #333',
                padding: '0 16px',
                gap: 16
            }}>
                <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => setMainMode('view')}
                    type="text"
                />
                <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {currentPath ? (
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>当前文件夹</span>
                            <span style={{ fontWeight: 'bold' }}>{currentPath}</span>
                        </div>
                    ) : (
                        <Title level={4} style={{ margin: 0 }}>批量模型预览</Title>
                    )}
                </div>

                {currentPath && (
                    <>
                        <Button icon={<ReloadOutlined />} onClick={() => scanFolder(currentPath)} loading={loading}>
                            刷新
                        </Button>
                        <Button
                            icon={<ClearOutlined />}
                            onClick={() => { setFiles([]); setThumbnails({}); setQueue([]); setCurrentPath(null); setModelAnimations({}); setSelectedAnimations({}); }}
                            disabled={files.length === 0}
                        >
                            清空
                        </Button>
                    </>
                )}

                <Button type="primary" icon={<FolderOpenOutlined />} onClick={handleOpenFolder}>
                    选择文件夹
                </Button>
            </Header>
            <Content style={{
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden'
            }}>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <Spin size="large" tip="正在扫描文件..." />
                    </div>
                ) : files.length > 0 ? (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: 16,
                        overflowY: 'auto',
                        height: '100%',
                        paddingRight: 8,
                        alignItems: 'start', // Prevent vertical stretching of cards
                        alignContent: 'start' // Reduce vertical spacing distribution
                    }}>
                        {files.map((file) => (
                            <ModelCard
                                key={file.fullPath}
                                file={file}
                                thumbnail={thumbnails[file.fullPath]}
                                animations={modelAnimations[file.fullPath]}
                                selectedAnimation={selectedAnimations[file.fullPath]}
                                isSelected={(selectedPath ?? selectedFile) === file.fullPath}
                                onDelete={handleDelete}
                                onEditTexture={handleEditTexture}
                                onAnimationChange={handleAnimationChange}
                                onSelect={handleSelect}
                            />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={currentPath ? "该文件夹下没有找到模型文件 (.mdx, .mdl)" : "请选择一个包含模型的文件夹开始"}
                        >
                            {!currentPath && (
                                <Button type="primary" icon={<FolderOpenOutlined />} onClick={handleOpenFolder}>
                                    打开文件夹
                                </Button>
                            )}
                        </Empty>
                    </div>
                )}

                {/* CRITICAL: Pause thumbnail generation when a model is selected for preview.
                    ThumbnailGenerator calls ModelRenderer.initGL() on its own canvas, which corrupts
                    war3-model's shared state when the main viewer is also active. 
                    
                    For now, completley DISABLE it to ensure stability.
                */}
                {/* <ThumbnailGenerator
                    queue={queue}
                    onThumbnailReady={handleThumbnailReady}
                    onItemProcessed={handleItemProcessed}
                    paused={!!(selectedPath)}
                /> */}
            </Content>
        </Layout>
    );
};
