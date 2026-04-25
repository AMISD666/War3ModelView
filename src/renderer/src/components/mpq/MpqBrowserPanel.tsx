import { appMessage } from '../../store/messageStore'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Select, Spin, Tree, Typography } from 'antd'
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { parseMDL, parseMDX } from 'war3-model';
import { useModelStore } from '../../store/modelStore';
import { useSelectionStore } from '../../store/selectionStore';
import { invokeReadMpqFile } from '../../utils/mpqPerf';

const { Text } = Typography;

interface MpqBrowserPanelProps {
    onClose: () => void;
}

interface FileTreeNode {
    key: string;
    title: string;
    isLeaf?: boolean;
    fullPath?: string;
    children?: FileTreeNode[];
}

interface DirectoryChild {
    key: string;
    title: string;
    isLeaf: boolean;
    fullPath?: string;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
}

type DirectoryIndex = Map<string, DirectoryChild[]>;

const MODEL_EXTENSIONS = new Set(['mdx', 'mdl']);
const PREVIEW_TEXTURE_EXTENSIONS = new Set(['blp', 'tga']);
const TEXTURE_EXTENSIONS = new Set(['blp', 'dds', 'tga', 'png', 'jpg', 'jpeg', 'bmp']);
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac']);
const TEXT_EXTENSIONS = new Set(['txt', 'slk', 'ini', 'j', 'fdf', 'lua']);
const FORMAT_OPTIONS = [
    { value: 'mdx', label: 'mdx' },
    { value: 'mdl', label: 'mdl' },
    { value: 'blp', label: 'blp' },
    { value: 'tga', label: 'tga' },
    { value: 'dds', label: 'dds' },
    { value: 'png', label: 'png' },
    { value: 'jpg', label: 'jpg' },
    { value: 'jpeg', label: 'jpeg' },
    { value: 'bmp', label: 'bmp' },
    { value: 'wav', label: 'wav' },
    { value: 'mp3', label: 'mp3' },
    { value: 'ogg', label: 'ogg' },
    { value: 'flac', label: 'flac' },
    { value: 'txt', label: 'txt' },
    { value: 'slk', label: 'slk' },
    { value: 'ini', label: 'ini' },
    { value: 'lua', label: 'lua' },
    { value: 'j', label: 'j' },
    { value: 'fdf', label: 'fdf' }
];

const getFileName = (path: string): string => {
    const normalized = path.replace(/\//g, '\\');
    return normalized.split('\\').pop() || path;
};

const getExtension = (path: string): string => {
    const file = getFileName(path).toLowerCase();
    const index = file.lastIndexOf('.');
    return index >= 0 ? file.substring(index + 1) : '';
};

const isModelFile = (path: string): boolean => MODEL_EXTENSIONS.has(getExtension(path));
const isPreviewTextureFile = (path: string): boolean => PREVIEW_TEXTURE_EXTENSIONS.has(getExtension(path));

const normalizeMpqPath = (path: string): string => path.replace(/\//g, '\\').replace(/\\\\+/g, '\\').replace(/^\.\//, '').replace(/^\\+/, '');

const normalizeMpqPathLower = (path: string): string => normalizeMpqPath(path).toLowerCase();

const toUint8Array = (payload: any): Uint8Array | null => {
    if (!payload) return null;
    if (payload instanceof Uint8Array) return payload;
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    if (Array.isArray(payload)) return new Uint8Array(payload);
    if (typeof payload === 'string') {
        try {
            const binary = atob(payload);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        } catch {
            return null;
        }
    }
    if (typeof payload === 'object') {
        const candidate = payload.data ?? payload.bytes ?? payload.payload;
        if (candidate !== undefined) {
            return toUint8Array(candidate);
        }
        const numericKeys = Object.keys(payload).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
        if (numericKeys.length > 0) {
            const bytes = new Uint8Array(numericKeys.length);
            for (let i = 0; i < numericKeys.length; i++) {
                bytes[i] = Number(payload[numericKeys[i]]) & 0xff;
            }
            return bytes;
        }
    }
    return null;
};

const toTightArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer;
    }
    if (bytes.buffer instanceof ArrayBuffer) {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return bytes.slice().buffer;
};

const sanitizeRelativeExportPath = (path: string): string | null => {
    const normalized = normalizeMpqPath(path);
    const parts = normalized.split('\\').filter(Boolean);
    const safeParts: string[] = [];

    for (const part of parts) {
        if (!part || part === '.' || part === '..') continue;
        const safe = part.replace(/[<>:"|?*]/g, '_');
        if (safe) {
            safeParts.push(safe);
        }
    }

    if (safeParts.length === 0) return null;
    return safeParts.join('\\');
};

const getTextureRefs = (model: any): string[] => {
    if (!model || !Array.isArray(model.Textures)) return [];
    const refs: string[] = [];
    for (const texture of model.Textures) {
        const raw = texture?.Image ?? texture?.image ?? texture?.Path ?? texture?.path;
        if (typeof raw === 'string' && raw.trim()) {
            refs.push(normalizeMpqPath(raw.trim()));
        }
    }
    return refs;
};

const resolveTexturePathInMpq = (textureRef: string, allFilesByLower: Map<string, string>): string | null => {
    const normalized = normalizeMpqPath(textureRef);
    const direct = allFilesByLower.get(normalizeMpqPathLower(normalized));
    if (direct) return direct;

    if (!/\.[^\\/.]+$/.test(normalized)) {
        const extensions = ['blp', 'tga', 'dds', 'png', 'jpg', 'jpeg', 'bmp'];
        for (const ext of extensions) {
            const withExt = `${normalized}.${ext}`;
            const hit = allFilesByLower.get(normalizeMpqPathLower(withExt));
            if (hit) return hit;
        }
    }

    return null;
};

const matchesFormat = (path: string, selectedFormats: string[]): boolean => {
    if (selectedFormats.length === 0) return true;
    return selectedFormats.includes(getExtension(path));
};

const buildDirectoryIndex = (paths: string[]): DirectoryIndex => {
    const temp = new Map<string, Map<string, DirectoryChild>>();
    const ensureBucket = (parentKey: string) => {
        if (!temp.has(parentKey)) {
            temp.set(parentKey, new Map<string, DirectoryChild>());
        }
    };

    for (const rawPath of paths) {
        const normalized = rawPath.replace(/\//g, '\\').replace(/\\\\+/g, '\\');
        const segments = normalized.split('\\').filter(Boolean);
        if (segments.length === 0) continue;

        let parentKey = '';
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const currentKey = parentKey ? `${parentKey}\\${segment}` : segment;
            const isLeaf = i === segments.length - 1;

            ensureBucket(parentKey);
            const parentChildren = temp.get(parentKey)!;
            const existing = parentChildren.get(currentKey);
            if (!existing) {
                parentChildren.set(currentKey, {
                    key: currentKey,
                    title: segment,
                    isLeaf,
                    fullPath: isLeaf ? normalized : undefined
                });
            } else if (isLeaf) {
                existing.isLeaf = true;
                existing.fullPath = normalized;
            }

            if (!isLeaf) {
                ensureBucket(currentKey);
            }
            parentKey = currentKey;
        }
    }

    const directoryIndex: DirectoryIndex = new Map();
    temp.forEach((childMap, parentKey) => {
        const children = Array.from(childMap.values()).sort((a, b) => {
            const aIsFolder = !a.isLeaf;
            const bIsFolder = !b.isLeaf;
            if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
            return a.title.localeCompare(b.title, 'zh-CN', { sensitivity: 'base' });
        });
        directoryIndex.set(parentKey, children);
    });
    return directoryIndex;
};

const toTreeNode = (child: DirectoryChild): FileTreeNode => ({
    key: child.key,
    title: child.title,
    isLeaf: child.isLeaf,
    fullPath: child.fullPath
});

const setNodeChildren = (nodes: FileTreeNode[], targetKey: string, children: FileTreeNode[]): FileTreeNode[] => {
    let changed = false;
    const next = nodes.map((node) => {
        if (node.key === targetKey) {
            changed = true;
            return { ...node, children };
        }
        if (!node.children || node.children.length === 0) {
            return node;
        }
        const nextChildren = setNodeChildren(node.children, targetKey, children);
        if (nextChildren !== node.children) {
            changed = true;
            return { ...node, children: nextChildren };
        }
        return node;
    });

    return changed ? next : nodes;
};

export const MpqBrowserPanel: React.FC<MpqBrowserPanelProps> = ({ onClose }) => {
    const [mpqPaths, setMpqPaths] = useState<string[]>([]);
    const [selectedMpq, setSelectedMpq] = useState<string>('');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [searchText, setSearchText] = useState<string>('');
    const [formatFilter, setFormatFilter] = useState<string[]>([]);
    const [loadingMpqList, setLoadingMpqList] = useState<boolean>(false);
    const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
    const [treeHeight, setTreeHeight] = useState<number>(320);
    const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
    const [menuBusy, setMenuBusy] = useState<boolean>(false);
    const treeContainerRef = useRef<HTMLDivElement | null>(null);
    const loadedFolderKeysRef = useRef<Set<string>>(new Set());

    const addTab = useModelStore(state => state.addTab);
    const tabs = useModelStore(state => state.tabs);
    const activeTabId = useModelStore(state => state.activeTabId);
    const modelData = useModelStore(state => state.modelData);
    const setTextures = useModelStore(state => state.setTextures);
    const setMainMode = useSelectionStore(state => state.setMainMode);
    const compactTreeCss = `
        .mpq-browser-panel .ant-tree .ant-tree-treenode {
            min-height: 18px;
            padding: 0 !important;
        }
        .mpq-browser-panel .ant-tree .ant-tree-switcher {
            width: 16px;
            height: 18px;
            line-height: 18px;
        }
        .mpq-browser-panel .ant-tree .ant-tree-node-content-wrapper {
            min-height: 18px;
            line-height: 18px;
            padding: 0 2px;
        }
        .mpq-browser-panel .ant-tree .ant-tree-title {
            line-height: 18px;
        }
    `;

    const loadMpqPaths = useCallback(async () => {
        setLoadingMpqList(true);
        try {
            const paths = await invoke<string[]>('get_loaded_mpq_paths');
            setMpqPaths(paths);
            if (paths.length === 0) {
                setSelectedMpq('');
                setAllFiles([]);
                return;
            }
            setSelectedMpq((prev) => {
                if (prev && paths.includes(prev)) {
                    return prev;
                }
                const war3Mpq = paths.find((path) => getFileName(path).toLowerCase() === 'war3.mpq');
                return war3Mpq || paths[0];
            });
        } catch (error) {
            console.error('[MpqBrowser] Failed to load MPQ list:', error);
            appMessage.error('读取 MPQ 列表失败');
        } finally {
            setLoadingMpqList(false);
        }
    }, []);

    const loadFilesForMpq = useCallback(async (mpqPath: string) => {
        if (!mpqPath) {
            setAllFiles([]);
            return;
        }

        setLoadingFiles(true);
        try {
            const files = await invoke<string[]>('list_mpq_files', { mpqPath });
            setAllFiles(files);
        } catch (error) {
            console.error('[MpqBrowser] Failed to list MPQ files:', error);
            appMessage.error('读取 MPQ 文件列表失败');
            setAllFiles([]);
        } finally {
            setLoadingFiles(false);
        }
    }, []);

    useEffect(() => {
        void loadMpqPaths();
    }, [loadMpqPaths]);

    useEffect(() => {
        if (selectedMpq) {
            void loadFilesForMpq(selectedMpq);
        }
    }, [selectedMpq, loadFilesForMpq]);

    const filteredFiles = useMemo(() => {
        const query = searchText.trim().toLowerCase();
        return allFiles.filter((path) => {
            if (!matchesFormat(path, formatFilter)) return false;
            if (!query) return true;
            return path.toLowerCase().includes(query);
        });
    }, [allFiles, formatFilter, searchText]);

    const directoryIndex = useMemo(() => buildDirectoryIndex(filteredFiles), [filteredFiles]);

    useEffect(() => {
        const rootNodes = (directoryIndex.get('') || []).map(toTreeNode);
        setTreeData(rootNodes);
        loadedFolderKeysRef.current = new Set(['']);
    }, [directoryIndex, selectedMpq]);

    const handleExpand = useCallback((_: React.Key[], info: any) => {
        if (!info?.expanded) return;
        const nodeKey = String(info?.node?.key ?? '');
        if (!nodeKey || info?.node?.isLeaf) return;
        if (loadedFolderKeysRef.current.has(nodeKey)) return;

        const children = (directoryIndex.get(nodeKey) || []).map(toTreeNode);
        setTreeData((prev) => setNodeChildren(prev, nodeKey, children));
        loadedFolderKeysRef.current.add(nodeKey);
    }, [directoryIndex]);

    useLayoutEffect(() => {
        const container = treeContainerRef.current;
        if (!container) return;

        const updateHeight = () => {
            const next = Math.max(120, Math.floor(container.clientHeight));
            setTreeHeight((prev) => (prev === next ? prev : next));
        };

        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(container);
        return () => observer.disconnect();
    }, [selectedMpq, loadingFiles, filteredFiles.length]);

    const keyMetaMap = useMemo(() => {
        const map = new Map<string, DirectoryChild>();
        directoryIndex.forEach((children) => {
            for (const child of children) {
                map.set(child.key, child);
            }
        });
        return map;
    }, [directoryIndex]);

    const allFilesByLower = useMemo(() => {
        const map = new Map<string, string>();
        for (const file of allFiles) {
            map.set(normalizeMpqPathLower(file), file);
        }
        return map;
    }, [allFiles]);

    const selectedFilePaths = useMemo(() => {
        if (selectedKeys.length === 0) return [];
        const resolved = new Set<string>();

        for (const key of selectedKeys) {
            const meta = keyMetaMap.get(key);
            if (meta?.isLeaf && meta.fullPath) {
                resolved.add(meta.fullPath);
                continue;
            }

            const exact = allFilesByLower.get(normalizeMpqPathLower(key));
            if (exact) {
                resolved.add(exact);
                continue;
            }

            const folderKey = normalizeMpqPath(key);
            const folderPrefix = folderKey.endsWith('\\') ? folderKey : `${folderKey}\\`;
            for (const file of allFiles) {
                const normalizedFile = normalizeMpqPath(file);
                if (normalizedFile === folderKey || normalizedFile.startsWith(folderPrefix)) {
                    resolved.add(file);
                }
            }
        }

        return Array.from(resolved);
    }, [allFiles, allFilesByLower, keyMetaMap, selectedKeys]);

    const selectedTexturePaths = useMemo(
        () => selectedFilePaths.filter((path) => isPreviewTextureFile(path)),
        [selectedFilePaths]
    );

    const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) || null, [tabs, activeTabId]);

    useEffect(() => {
        setSelectedKeys([]);
        setContextMenu({ visible: false, x: 0, y: 0 });
    }, [selectedMpq, searchText, formatFilter]);

    useEffect(() => {
        if (!contextMenu.visible) return;
        const hideMenu = () => setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        window.addEventListener('click', hideMenu);
        window.addEventListener('resize', hideMenu);
        window.addEventListener('scroll', hideMenu, true);
        return () => {
            window.removeEventListener('click', hideMenu);
            window.removeEventListener('resize', hideMenu);
            window.removeEventListener('scroll', hideMenu, true);
        };
    }, [contextMenu.visible]);

    const readMpqBytes = useCallback(async (path: string): Promise<Uint8Array | null> => {
        const payload = await invokeReadMpqFile<any>(path, 'MpqBrowserPanel.preview').catch(() => null);
        const bytes = toUint8Array(payload);
        if (!bytes || bytes.byteLength === 0) return null;
        return bytes;
    }, []);

    const handleApplyTextures = useCallback(async () => {
        if (selectedTexturePaths.length === 0) {
            appMessage.warning('请先在 MPQ 树中选择 blp/tga 贴图');
            return;
        }
        if (!activeTab || !isModelFile(activeTab.path)) {
            appMessage.warning('当前标签页不是模型文件，无法应用贴图');
            return;
        }
        if (!modelData) {
            appMessage.warning('当前模型尚未加载完成');
            return;
        }

        const existingTextures = Array.isArray((modelData as any).Textures) ? [...(modelData as any).Textures] : [];
        const existingSet = new Set<string>();
        for (const tex of existingTextures) {
            const image = tex?.Image ?? tex?.image ?? tex?.Path ?? tex?.path;
            if (typeof image === 'string' && image.trim()) {
                existingSet.add(normalizeMpqPathLower(image));
            }
        }

        let added = 0;
        for (const texturePath of selectedTexturePaths) {
            const normalized = normalizeMpqPath(texturePath);
            const key = normalizeMpqPathLower(normalized);
            if (existingSet.has(key)) continue;
            existingTextures.push({
                Image: normalized,
                ReplaceableId: 0,
                WrapWidth: false,
                WrapHeight: false
            });
            existingSet.add(key);
            added += 1;
        }

        if (added === 0) {
            appMessage.info('选中的贴图已存在于当前模型');
            return;
        }

        setTextures(existingTextures);
        appMessage.success(`已添加 ${added} 张贴图到当前模型`);
    }, [activeTab, modelData, selectedTexturePaths, setTextures]);

    const handleExportFiles = useCallback(async () => {
        if (selectedFilePaths.length === 0) {
            appMessage.warning('请先选择要导出的文件');
            return;
        }

        const selected = await open({
            directory: true,
            multiple: false,
            title: '选择导出目录'
        });
        if (!selected) return;

        const exportRoot = Array.isArray(selected) ? selected[0] : selected;
        if (!exportRoot) return;

        if (selectedMpq) {
            await invoke('set_mpq_priority', { mpqPath: selectedMpq }).catch(() => null);
        }

        const exportSet = new Set<string>(selectedFilePaths.map((path) => normalizeMpqPath(path)));

        for (const filePath of selectedFilePaths) {
            if (!isModelFile(filePath)) continue;

            try {
                const bytes = await readMpqBytes(filePath);
                if (!bytes) continue;

                let model: any;
                if (getExtension(filePath) === 'mdx') {
                    model = parseMDX(toTightArrayBuffer(bytes));
                } else {
                    model = parseMDL(new TextDecoder().decode(bytes));
                }

                const textureRefs = getTextureRefs(model);
                for (const textureRef of textureRefs) {
                    const resolved = resolveTexturePathInMpq(textureRef, allFilesByLower);
                    if (resolved) {
                        exportSet.add(normalizeMpqPath(resolved));
                    }
                }
            } catch (error) {
                console.warn('[MpqBrowser] Failed to parse model for export dependencies:', filePath, error);
            }
        }

        let successCount = 0;
        let failedCount = 0;

        for (const mpqPath of exportSet) {
            try {
                const bytes = await readMpqBytes(mpqPath);
                if (!bytes) {
                    failedCount += 1;
                    continue;
                }

                const relativePath = sanitizeRelativeExportPath(mpqPath);
                if (!relativePath) {
                    failedCount += 1;
                    continue;
                }

                const outputPath = `${exportRoot.replace(/[\\/]+$/, '')}\\${relativePath}`;
                const outputDir = outputPath.includes('\\') ? outputPath.slice(0, outputPath.lastIndexOf('\\')) : exportRoot;
                await mkdir(outputDir, { recursive: true });
                await writeFile(outputPath, bytes);
                successCount += 1;
            } catch (error) {
                console.error('[MpqBrowser] Failed to export file:', mpqPath, error);
                failedCount += 1;
            }
        }

        if (failedCount === 0) {
            appMessage.success(`导出完成，共 ${successCount} 个文件`);
        } else {
            appMessage.warning(`导出完成：成功 ${successCount}，失败 ${failedCount}`);
        }
    }, [allFilesByLower, readMpqBytes, selectedFilePaths, selectedMpq]);

    const handleContextAction = useCallback(async (action: 'applyTextures' | 'export') => {
        setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        if (menuBusy) return;
        setMenuBusy(true);
        try {
            if (action === 'applyTextures') {
                await handleApplyTextures();
            } else {
                await handleExportFiles();
            }
        } finally {
            setMenuBusy(false);
        }
    }, [handleApplyTextures, handleExportFiles, menuBusy]);

    const canApplyTextures = selectedTexturePaths.length > 0;
    const canExportSelected = selectedFilePaths.length > 0;
    const contextMenuWidth = 120;
    const contextMenuHeight = 84;
    const contextMenuLeft = typeof window !== 'undefined' ? Math.min(contextMenu.x, window.innerWidth - contextMenuWidth - 8) : contextMenu.x;
    const contextMenuTop = typeof window !== 'undefined' ? Math.min(contextMenu.y, window.innerHeight - contextMenuHeight - 8) : contextMenu.y;

    return (
        <div className="mpq-browser-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
            <style>{compactTreeCss}</style>
            <div style={{
                padding: '4px 6px 4px 10px',
                borderBottom: '1px solid #303030',
                fontWeight: 'bold',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6
            }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    MPQ 资源浏览
                </span>
                <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={onClose}
                    title="关闭 MPQ 面板"
                    style={{ color: '#bbb', marginRight: 2 }}
                />
            </div>

            <div style={{ padding: 6, borderBottom: '1px solid #303030', display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                    <Select
                        style={{ flex: 1.1, minWidth: 0 }}
                        size="small"
                        loading={loadingMpqList}
                        value={selectedMpq || undefined}
                        placeholder="选择 MPQ 文件"
                        onChange={setSelectedMpq}
                        options={mpqPaths.map((path) => ({ value: path, label: getFileName(path) }))}
                    />
                    <Select<string[]>
                        mode="multiple"
                        allowClear
                        maxTagCount="responsive"
                        style={{ flex: 1, minWidth: 0 }}
                        size="small"
                        value={formatFilter}
                        onChange={setFormatFilter}
                        placeholder="格式筛选（可多选）"
                        options={FORMAT_OPTIONS}
                    />
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => void loadMpqPaths()}
                        title="刷新 MPQ 列表"
                    />
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Input
                        size="small"
                        allowClear
                        placeholder="搜索路径或文件名"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                    />
                    <Text style={{ color: '#999', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {filteredFiles.length}
                    </Text>
                </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, padding: 8 }}>
                {loadingFiles ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <Spin />
                    </div>
                ) : !selectedMpq ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<span style={{ color: '#888' }}>未加载 MPQ 文件</span>}
                    />
                ) : filteredFiles.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<span style={{ color: '#888' }}>没有匹配结果</span>}
                    />
                ) : (
                    <div ref={treeContainerRef} style={{ height: '100%', minHeight: 0 }}>
                        <Tree<FileTreeNode>
                            key={selectedMpq}
                            showIcon={false}
                            blockNode
                            multiple
                            virtual
                            height={treeHeight}
                            treeData={treeData}
                            selectedKeys={selectedKeys}
                            onSelect={(keys) => {
                                setSelectedKeys(keys.map((key) => String(key)));
                            }}
                            onExpand={handleExpand}
                            onRightClick={({ event, node }) => {
                                event.preventDefault();
                                const key = String(node.key);
                                setSelectedKeys((prev) => (prev.includes(key) ? prev : [key]));
                                setContextMenu({ visible: true, x: event.clientX, y: event.clientY });
                            }}
                            onDoubleClick={(_, node) => {
                                const fullPath = node.fullPath;
                                if (!fullPath) return;
                                const canOpenInView = isModelFile(fullPath) || isPreviewTextureFile(fullPath);
                                if (!canOpenInView) return;
                                void (async () => {
                                    if (selectedMpq) {
                                        await invoke('set_mpq_priority', { mpqPath: selectedMpq }).catch(() => null);
                                    }
                                    setMainMode('view');
                                    addTab(fullPath);
                                })();
                            }}
                            titleRender={(nodeData) => {
                                const isModel = !!nodeData.fullPath && isModelFile(nodeData.fullPath);
                                const isTexturePreview = !!nodeData.fullPath && isPreviewTextureFile(nodeData.fullPath);
                                const color = isModel ? '#8cc8ff' : isTexturePreview ? '#8ddeb5' : '#ddd';
                                return (
                                    <span style={{ color, fontSize: 12 }}>
                                        {nodeData.title}
                                    </span>
                                );
                            }}
                        />
                    </div>
                )}
            </div>

            {contextMenu.visible && (
                <div
                    style={{
                        position: 'fixed',
                        left: contextMenuLeft,
                        top: contextMenuTop,
                        zIndex: 2000,
                        minWidth: contextMenuWidth,
                        background: '#2a2a2a',
                        border: '1px solid #444',
                        borderRadius: 4,
                        boxShadow: '0 6px 14px rgba(0, 0, 0, 0.35)',
                        padding: 4,
                        display: 'grid',
                        gap: 2
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <button
                        type="button"
                        disabled={!canApplyTextures || menuBusy}
                        onClick={() => void handleContextAction('applyTextures')}
                        style={{
                            textAlign: 'left',
                            border: 'none',
                            background: canApplyTextures && !menuBusy ? '#2a2a2a' : '#2a2a2a',
                            color: canApplyTextures && !menuBusy ? '#f0f0f0' : '#777',
                            fontSize: 11,
                            padding: '4px 5px',
                            borderRadius: 3,
                            cursor: canApplyTextures && !menuBusy ? 'pointer' : 'not-allowed'
                        }}
                    >
                        应用贴图到当前模型
                    </button>
                    <button
                        type="button"
                        disabled={!canExportSelected || menuBusy}
                        onClick={() => void handleContextAction('export')}
                        style={{
                            textAlign: 'left',
                            border: 'none',
                            background: canExportSelected && !menuBusy ? '#2a2a2a' : '#2a2a2a',
                            color: canExportSelected && !menuBusy ? '#f0f0f0' : '#777',
                            fontSize: 11,
                            padding: '4px 5px',
                            borderRadius: 3,
                            cursor: canExportSelected && !menuBusy ? 'pointer' : 'not-allowed'
                        }}
                    >
                        导出选中文件
                    </button>
                </div>
            )}
        </div>
    );
};

export default MpqBrowserPanel;
