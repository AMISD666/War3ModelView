import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Typography, Divider, Segmented, Spin, Progress } from 'antd';
import { parseMDX, parseMDL } from 'war3-model';
import { useRpcClient } from '../../hooks/useRpc';
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame';
import { useModelStore } from '../../store/modelStore';

const { Text } = Typography;

/* ------------------------------------------------------------------ */
/*  Tauri FS helpers (lazy-imported so component still renders in web) */
/* ------------------------------------------------------------------ */
let tauriDialog: any = null;
let tauriFs: any = null;
const ensureTauri = async () => {
    if (!tauriDialog) tauriDialog = await import('@tauri-apps/plugin-dialog');
    if (!tauriFs) tauriFs = await import('@tauri-apps/plugin-fs');
};

/* ------------------------------------------------------------------ */
import {
    BoneMatchResult,
    parseModelBuffer,
    computeBoneMatch,
    collectBoneNames
} from '../../utils/modelMerge';

interface ModelMergeModalProps {
    visible: boolean;
    onClose: () => void;
    isStandalone?: boolean;
}


/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
const ModelMergeModal: React.FC<ModelMergeModalProps> = ({ visible, onClose, isStandalone = false }) => {
    const [model1Path, setModel1Path] = useState<string>('');
    const [model2Path, setModel2Path] = useState<string>('');
    const [model1Data, setModel1Data] = useState<any>(null);
    const [model2Data, setModel2Data] = useState<any>(null);
    const [mergeMode, setMergeMode] = useState<MergeMode>('geosets');
    const [boneMatch, setBoneMatch] = useState<BoneMatchResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [merging, setMerging] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    // RPC for standalone window communication
    const { state: rpcState, emitCommand } = useRpcClient<{
        modelPath: string;
        modelData: any;
    }>('modelMerge', { modelPath: '', modelData: null });

    // Auto-set Model 1 from current model via RPC (standalone: read from disk)
    const autoLoadedPathRef = useRef<string>('');
    useEffect(() => {
        if (!isStandalone) return;
        if (!rpcState.modelPath) return;
        if (rpcState.modelPath === autoLoadedPathRef.current) return;

        autoLoadedPathRef.current = rpcState.modelPath;
        setModel1Path(rpcState.modelPath);

        // RPC doesn't send modelData (too large), so read from disk
        const loadFromDisk = async () => {
            try {
                await ensureTauri();
                const buffer = await tauriFs.readFile(rpcState.modelPath);
                const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : (buffer as Uint8Array).buffer;
                const parsed = parseModelBuffer(arrayBuffer, rpcState.modelPath);
                setModel1Data(parsed);
            } catch (err) {
                console.error('[ModelMerge] Auto-load model1 failed:', err);
            }
        };
        loadFromDisk();
    }, [rpcState.modelPath, isStandalone]);

    // Auto-set Model 1 from zustand store (non-standalone)
    useEffect(() => {
        if (!isStandalone) {
            const store = useModelStore.getState();
            if (store.modelPath) {
                setModel1Path(store.modelPath);
                setModel1Data(store.modelData);
            }
        }
    }, [isStandalone]);

    // Recalculate bone match whenever both models are loaded
    useEffect(() => {
        if (model1Data && model2Data) {
            const result = computeBoneMatch(model1Data, model2Data);
            setBoneMatch(result);
        } else {
            setBoneMatch(null);
        }
    }, [model1Data, model2Data]);

    /* ---- file picker ---- */
    const pickFile = useCallback(async (target: 'model1' | 'model2') => {
        try {
            await ensureTauri();
            const result = await tauriDialog.open({
                title: target === 'model1' ? '选择基准模型 (模型1)' : '选择合并来源 (模型2)',
                filters: [{ name: 'War3 Model', extensions: ['mdx', 'mdl'] }],
                multiple: false,
            });
            if (!result) return;
            const filePath = typeof result === 'string' ? result : (result as any).path || String(result);
            setLoading(true);
            setStatusMsg(`正在加载 ${filePath.split('\\').pop() || filePath.split('/').pop()}...`);

            const buffer = await tauriFs.readFile(filePath);
            const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : (buffer as Uint8Array).buffer;
            const parsed = parseModelBuffer(arrayBuffer, filePath);

            if (target === 'model1') {
                setModel1Path(filePath);
                setModel1Data(parsed);
            } else {
                setModel2Path(filePath);
                setModel2Data(parsed);
            }
            setStatusMsg('');
        } catch (err: any) {
            console.error('[ModelMerge] Load failed:', err);
            setStatusMsg(`加载失败: ${err.message || err}`);
        } finally {
            setLoading(false);
        }
    }, []);

    /* ---- execute merge ---- */
    const handleMerge = useCallback(async () => {
        if (!model1Data || !model2Data) return;
        setMerging(true);
        setStatusMsg('正在执行合并...');
        try {
            if (isStandalone && emitCommand) {
                // Send to MainLayout to perform the actual merge and bypass IPC serialization limits
                emitCommand('APPLY_MERGED_MODEL_PATH', { model2Path, mergeMode });
                setStatusMsg('✅ 合并指令已发送！');
            } else {
                // Non-standalone: merge locally
                const updatedModel = mergeMode === 'geosets'
                    ? window.War3ModelToolMerge?.mergeGeosets(model1Data, model2Data) || model1Data
                    : window.War3ModelToolMerge?.mergeAnimations(model1Data, model2Data) || model1Data;
                
                const store = useModelStore.getState();
                store.setModelData(updatedModel, model1Path);
                setModel1Data(updatedModel);
                setStatusMsg('✅ 合并完成！');
            }
        } catch (err: any) {
            console.error('[ModelMerge] Merge failed:', err);
            setStatusMsg(`❌ 合并失败: ${err.message || err}`);
        } finally {
            setMerging(false);
        }
    }, [model1Data, model2Data, mergeMode, isStandalone, model1Path, emitCommand]);

    /* ---- filename helper ---- */
    const getFileName = (path: string) => {
        if (!path) return '未选择';
        const parts = path.replace(/\//g, '\\').split('\\');
        return parts[parts.length - 1] || path;
    };

    /* ---- styles ---- */
    const cardStyle: React.CSSProperties = {
        backgroundColor: '#252525',
        borderRadius: 5,
        border: '1px solid #2f2f2f',
        padding: '8px 12px',
    };

    const fileRowStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
    };

    const labelStyle: React.CSSProperties = {
        color: '#aaa',
        fontSize: 12,
        minWidth: 48,
        flexShrink: 0,
    };

    const fileNameStyle: React.CSSProperties = {
        flex: 1,
        color: '#ddd',
        fontSize: 12,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        backgroundColor: '#1a1a1a',
        padding: '4px 8px',
        borderRadius: 4,
        border: '1px solid #333',
    };

    /* ================================================================ */
    /*  RENDER                                                           */
    /* ================================================================ */
    const innerContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Model 1 */}
            <div style={cardStyle}>
                <Text style={{ color: '#8bb4e0', fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                    模型 1（基准模型）
                </Text>
                <div style={fileRowStyle}>
                    <span style={labelStyle}>文件：</span>
                    <div style={fileNameStyle} title={model1Path}>{getFileName(model1Path)}</div>
                    <Button
                        size="small"
                        onClick={() => pickFile('model1')}
                        disabled={loading || merging}
                        style={{ backgroundColor: '#2a2a2a', borderColor: '#444', color: '#ccc', fontSize: 12 }}
                    >
                        浏览
                    </Button>
                </div>
                {model1Data && (
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#888' }}>
                        <span>多边形组: <span style={{ color: '#ccc' }}>{model1Data.Geosets?.length || 0}</span></span>
                        <span>骨骼: <span style={{ color: '#ccc' }}>{collectBoneNames(model1Data).length}</span></span>
                        <span>动作: <span style={{ color: '#ccc' }}>{model1Data.Sequences?.length || 0}</span></span>
                    </div>
                )}
            </div>

            {/* Model 2 */}
            <div style={cardStyle}>
                <Text style={{ color: '#e0b48b', fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                    模型 2（合并来源）
                </Text>
                <div style={fileRowStyle}>
                    <span style={labelStyle}>文件：</span>
                    <div style={fileNameStyle} title={model2Path}>{getFileName(model2Path)}</div>
                    <Button
                        size="small"
                        onClick={() => pickFile('model2')}
                        disabled={loading || merging}
                        style={{ backgroundColor: '#2a2a2a', borderColor: '#444', color: '#ccc', fontSize: 12 }}
                    >
                        浏览
                    </Button>
                </div>
                {model2Data && (
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#888' }}>
                        <span>多边形组: <span style={{ color: '#ccc' }}>{model2Data.Geosets?.length || 0}</span></span>
                        <span>骨骼: <span style={{ color: '#ccc' }}>{collectBoneNames(model2Data).length}</span></span>
                        <span>动作: <span style={{ color: '#ccc' }}>{model2Data.Sequences?.length || 0}</span></span>
                    </div>
                )}
            </div>

            <Divider style={{ margin: '2px 0', borderColor: '#333' }} />

            {/* Merge Mode */}
            <div>
                <Text style={{ color: '#aaa', fontSize: 11, marginBottom: 4, display: 'block' }}>合并模式</Text>
                <Segmented
                    block
                    value={mergeMode}
                    onChange={(v) => setMergeMode(v as MergeMode)}
                    options={[
                        { label: '合并多边形', value: 'geosets' },
                        { label: '合并动作', value: 'animations' },
                    ]}
                    style={{
                        backgroundColor: '#1a1a1a',
                        color: '#ccc',
                    }}
                />
                <div style={{ fontSize: 10, color: '#666', marginTop: 4, lineHeight: 1.5 }}>
                    {mergeMode === 'geosets'
                        ? '将模型2的多边形组、材质图层和贴图数据复制到模型1中。'
                        : '将模型2中与模型1同名节点的动画轨道（位移/旋转/缩放）复制到模型1中。'}
                </div>
            </div>

            <Divider style={{ margin: '2px 0', borderColor: '#333' }} />

            {/* Bone Match / Merge Rate */}
            {boneMatch && (
                <div style={{
                    ...cardStyle,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    visibility: mergeMode === 'animations' ? 'visible' : 'hidden',
                }}>
                    <Text style={{ color: '#aaa', fontSize: 12, fontWeight: 600 }}>骨骼匹配分析</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Progress
                            type="circle"
                            percent={boneMatch.mergeRate}
                            size={56}
                            strokeColor={boneMatch.mergeRate >= 80 ? '#52c41a' : boneMatch.mergeRate >= 50 ? '#faad14' : '#ff4d4f'}
                            trailColor="#333"
                            format={(pct) => <span style={{ color: '#eee', fontSize: 14, fontWeight: 700 }}>{pct}%</span>}
                        />
                        <div style={{ flex: 1, fontSize: 11, color: '#888', lineHeight: 1.8 }}>
                            <div>模型1 骨骼数: <span style={{ color: '#ccc' }}>{boneMatch.model1BoneCount}</span></div>
                            <div>模型2 骨骼数: <span style={{ color: '#ccc' }}>{boneMatch.model2BoneCount}</span></div>
                            <div>
                                匹配数量: <span style={{ color: '#52c41a' }}>{boneMatch.matchedCount}</span>
                                {boneMatch.unmatchedNames.length > 0 && (
                                    <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                                        未匹配: {boneMatch.unmatchedNames.length}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    {boneMatch.unmatchedNames.length > 0 && boneMatch.unmatchedNames.length <= 10 && (
                        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                            未匹配: {boneMatch.unmatchedNames.join(', ')}
                        </div>
                    )}
                </div>
            )}

            {/* Execute Button */}
            <Button
                type="primary"
                block
                onClick={handleMerge}
                disabled={!model1Data || !model2Data || merging || loading}
                loading={merging}
                style={{
                    marginTop: 2,
                    height: 32,
                    borderRadius: 5,
                    fontSize: 13,
                    fontWeight: 600,
                    backgroundColor: (!model1Data || !model2Data) ? '#333' : '#1890ff',
                    borderColor: (!model1Data || !model2Data) ? '#444' : '#1890ff',
                }}
            >
                {merging ? '合并中...' : '执行合并'}
            </Button>

            {/* Status */}
            {statusMsg && (
                <Text style={{
                    color: statusMsg.startsWith('✅') ? '#52c41a' : statusMsg.startsWith('❌') ? '#ff4d4f' : '#faad14',
                    fontSize: 12,
                    textAlign: 'center',
                }}>
                    {loading && <Spin size="small" style={{ marginRight: 6 }} />}
                    {statusMsg}
                </Text>
            )}
        </div>
    );

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="模型合并" onClose={onClose}>
                <div style={{ padding: '8px 12px', flex: 1, overflowY: 'auto' }}>
                    {innerContent}
                </div>
            </StandaloneWindowFrame>
        );
    }

    // Fallback non-standalone (unlikely to be used)
    if (!visible) return null;
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
        }}>
            <div style={{
                width: 680, maxHeight: '80vh', overflowY: 'auto',
                backgroundColor: '#1e1e1e', borderRadius: 8,
                border: '1px solid #333', padding: '16px 20px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text style={{ color: '#eee', fontSize: 16, fontWeight: 600 }}>模型合并</Text>
                    <span style={{ cursor: 'pointer', color: '#888', fontSize: 16 }} onClick={onClose}>✕</span>
                </div>
                {innerContent}
            </div>
        </div>
    );
};

export default ModelMergeModal;
