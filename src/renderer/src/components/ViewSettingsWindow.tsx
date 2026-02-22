import React, { useState, useEffect } from 'react';
import { Select, Button, Slider, ColorPicker, Modal, Input, Tabs } from 'antd';
import { DraggableModal } from './DraggableModal';
import { useRendererStore } from '../store/rendererStore';
import { useSelectionStore } from '../store/selectionStore';
import { showMessage, useMessageStore } from '../store/messageStore';
import { DatabaseOutlined, CheckCircleFilled, CloseCircleFilled, FolderOpenOutlined, SunOutlined } from '@ant-design/icons';
import { DNC_PRESETS, getEnvironmentManager } from './viewer/EnvironmentManager';
import { ShortcutSettingsPanel } from './ShortcutSettingsPanel';

// Custom Toggle Button Component
// Modified to support full width and center text
const ToggleButton: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    children: React.ReactNode;
    style?: React.CSSProperties;
    disabled?: boolean;
    fullWidth?: boolean;
}> = ({ checked, onChange, children, style, disabled, fullWidth }) => {
    return (
        <div
            onClick={() => !disabled && onChange(!checked)}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 8px',
                height: '28px',         // Compact height
                width: fullWidth ? '100%' : 'auto',
                minWidth: fullWidth ? 'unset' : '88px',
                borderRadius: '4px',
                backgroundColor: checked ? '#1677ff' : '#2b2b2b',
                color: checked ? '#fff' : '#aaa',
                cursor: disabled ? 'not-allowed' : 'pointer',
                userSelect: 'none',
                transition: 'all 0.15s ease-in-out',
                opacity: disabled ? 0.4 : 1,
                fontSize: '12px',
                fontWeight: checked ? 500 : 400,
                border: checked ? '1px solid #1677ff' : '1px solid #3a3a3a',
                whiteSpace: 'nowrap',
                boxShadow: checked ? '0 2px 8px rgba(22, 119, 255, 0.3)' : 'none',
                ...style
            }}
            onMouseEnter={(e) => {
                if (!disabled && !checked) {
                    e.currentTarget.style.backgroundColor = '#3a3a3a';
                    e.currentTarget.style.borderColor = '#4a4a4a';
                    e.currentTarget.style.color = '#ccc';
                }
            }}
            onMouseLeave={(e) => {
                if (!disabled && !checked) {
                    e.currentTarget.style.backgroundColor = '#2b2b2b';
                    e.currentTarget.style.borderColor = '#3a3a3a';
                    e.currentTarget.style.color = '#aaa';
                }
            }}
        >
            {children}
        </div>
    );
};

export const ViewSettingsWindow: React.FC = () => {
    const {
        showSettingsPanel, setShowSettingsPanel,
        gridSettings, setGridSettings,
        showGridXY, setShowGridXY,
        showGridXZ, setShowGridXZ,
        showGridYZ, setShowGridYZ,
        showNodes, setShowNodes,
        showSkeleton, setShowSkeleton,
        showFPS, setShowFPS,
        showGeosetVisibility, setShowGeosetVisibility,
        showCollisionShapes, setShowCollisionShapes,
        showCameras, setShowCameras,
        showLights, setShowLights,
        showAttachments, setShowAttachments,
        showParticles, setShowParticles,
        showRibbons, setShowRibbons,
        enableLighting, setEnableLighting,
        renderMode, setRenderMode,
        backgroundColor, setBackgroundColor,
        vertexColor, setVertexColor,
        wireframeColor, setWireframeColor,
        selectionColor, setSelectionColor,
        hoverColor, setHoverColor,
        nodeColors, setNodeColors,
        teamColor, setTeamColor,
        gizmoSize, setGizmoSize,
        mpqLoaded, setMpqLoaded,
        missingTextures,
        showVerticesByMode, setShowVerticesForMode,
        showVerticesInAnimationBinding, showVerticesInAnimationKeyframe, setShowVerticesForAnimationSubMode,
        vertexSettings, setVertexSettings,
        autoRecalculateExtent, setAutoRecalculateExtent,
        autoRecalculateNormals, setAutoRecalculateNormals,
        keepCameraOnLoad, setKeepCameraOnLoad
    } = useRendererStore();
    const mainMode = useSelectionStore(state => state.mainMode);
    const animationSubMode = useSelectionStore(state => state.animationSubMode);
    const showVertices =
        mainMode === 'animation'
            ? (animationSubMode === 'binding' ? showVerticesInAnimationBinding : showVerticesInAnimationKeyframe)
            : (showVerticesByMode[mainMode] ?? true);

    // Context Menu Integration State
    const [contextMenuEnabled, setContextMenuEnabled] = useState<boolean>(false);
    const [contextMenuLoading, setContextMenuLoading] = useState<boolean>(false);
    const [copyContextMenuEnabled, setCopyContextMenuEnabled] = useState<boolean>(false);
    const [copyContextMenuLoading, setCopyContextMenuLoading] = useState<boolean>(false);
    const [deleteContextMenuEnabled, setDeleteContextMenuEnabled] = useState<boolean>(false);
    const [deleteContextMenuLoading, setDeleteContextMenuLoading] = useState<boolean>(false);
    const [copyMpqEnabled, setCopyMpqEnabled] = useState<boolean>(false);
    const [copyMpqLoading, setCopyMpqLoading] = useState<boolean>(false);

    // DNC Environment Lighting State - Default to Lordaeron Summer
    const [selectedDNCPreset, setSelectedDNCPreset] = useState<string | null>('lordaeron');
    const [dncLoading, setDncLoading] = useState<boolean>(false);
    const [allPresets, setAllPresets] = useState<Record<string, { name: string }>>(() => getEnvironmentManager().getAllPresets());

    // Light parameters - initialize from EnvironmentManager
    const [lightIntensity, setLightIntensity] = useState<number>(() => getEnvironmentManager().getLightIntensity());
    const [ambientIntensity, setAmbientIntensity] = useState<number>(() => getEnvironmentManager().getAmbientIntensity());
    const [lightColor, setLightColor] = useState<string>(() => {
        const lc = getEnvironmentManager().getLightColorRGB();
        return `rgb(${lc[0]}, ${lc[1]}, ${lc[2]})`;
    });
    const [ambientColor, setAmbientColor] = useState<string>(() => {
        const ac = getEnvironmentManager().getAmbientColorRGB();
        return `rgb(${ac[0]}, ${ac[1]}, ${ac[2]})`;
    });

    // Handle DNC preset change
    const handleDNCChange = async (value: string) => {
        if (!value) return;
        const envManager = getEnvironmentManager();
        setDncLoading(true);
        try {
            await envManager.loadPreset(value);
            setSelectedDNCPreset(value);
            setLightIntensity(envManager.getLightIntensity());
            setAmbientIntensity(envManager.getAmbientIntensity());
            // Sync colors
            const lc = envManager.getLightColorRGB();
            const ac = envManager.getAmbientColorRGB();
            setLightColor(`rgb(${lc[0]}, ${lc[1]}, ${lc[2]})`);
            setAmbientColor(`rgb(${ac[0]}, ${ac[1]}, ${ac[2]})`);
        } catch (e) {
            console.error('DNC load error:', e);
        } finally {
            setDncLoading(false);
        }
    };

    // Handle light intensity change
    const handleLightIntensityChange = (value: number) => {
        setLightIntensity(value);
        getEnvironmentManager().setLightIntensity(value);
    };

    // Handle ambient intensity change
    const handleAmbientIntensityChange = (value: number) => {
        setAmbientIntensity(value);
        getEnvironmentManager().setAmbientIntensity(value);
    };

    // Handle light color change
    const handleLightColorChange = (color: any) => {
        const rgb = color.toRgb();
        setLightColor(`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
        getEnvironmentManager().setLightColorRGB(rgb.r, rgb.g, rgb.b);
    };

    // Handle ambient color change
    const handleAmbientColorChange = (color: any) => {
        const rgb = color.toRgb();
        setAmbientColor(`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
        getEnvironmentManager().setAmbientColorRGB(rgb.r, rgb.g, rgb.b);
    };

    // Preset modal state
    const [presetModalOpen, setPresetModalOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');

    // New preset - opens modal
    const handleNewPreset = () => {
        setNewPresetName('');
        setPresetModalOpen(true);
    };

    // Confirm new preset creation
    const handleConfirmNewPreset = () => {
        if (newPresetName.trim()) {
            const key = getEnvironmentManager().saveAsPreset(newPresetName.trim());
            setAllPresets(getEnvironmentManager().getAllPresets());
            setSelectedDNCPreset(key);
            showMessage('success', '操作成功', `预设 "${newPresetName}" 已创建`);
            setPresetModalOpen(false);
        }
    };

    // Save current values to current preset
    const handleSaveCurrentPreset = () => {
        if (!selectedDNCPreset) return;
        // For built-in presets, just show info
        if (DNC_PRESETS[selectedDNCPreset]) {
            showMessage('info', '提示', '内置预设无法覆盖，请新建自定义预设');
            return;
        }
        // Save to current custom preset
        const envManager = getEnvironmentManager();
        const key = envManager.saveAsPreset(allPresets[selectedDNCPreset]?.name || '自定义');
        // Delete old and replace
        envManager.deletePreset(selectedDNCPreset);
        setAllPresets(envManager.getAllPresets());
        setSelectedDNCPreset(key);
        showMessage('success', '操作成功', '预设已保存');
    };

    // Delete current preset
    const handleDeletePreset = () => {
        if (!selectedDNCPreset) return;
        if (DNC_PRESETS[selectedDNCPreset]) {
            showMessage('warning', '警告', '无法删除内置预设');
            return;
        }
        getEnvironmentManager().deletePreset(selectedDNCPreset);
        setAllPresets(getEnvironmentManager().getAllPresets());
        handleDNCChange('lordaeron'); // Trigger full update including renderer and UI state
        showMessage('success', '操作成功', '预设已删除');
    };

    // Check context menu status on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const isRegistered = await invoke<boolean>('check_context_menu_status');
                const isCopyRegistered = await invoke<boolean>('check_copy_context_menu_status');
                const isDeleteRegistered = await invoke<boolean>('check_delete_context_menu_status');
                const copyMpqStatus = await invoke<boolean>('get_copy_mpq_textures_status');
                setContextMenuEnabled(isRegistered);
                setCopyContextMenuEnabled(isCopyRegistered);
                setDeleteContextMenuEnabled(isDeleteRegistered);
                setCopyMpqEnabled(copyMpqStatus);
            } catch (e) {
                console.error('Failed to check context menu status:', e);
            }
        };
        if (showSettingsPanel) {
            checkStatus();
        }
    }, [showSettingsPanel]);

    const handleCopyContextMenuToggle = async (enable: boolean) => {
        setCopyContextMenuLoading(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            if (enable) {
                await invoke('register_copy_context_menu');
                setCopyContextMenuEnabled(true);
                showMessage('success', '操作成功', '已添加复制模型右键菜单');
            } else {
                await invoke('unregister_copy_context_menu');
                setCopyContextMenuEnabled(false);
                showMessage('success', '操作成功', '已移除复制模型右键菜单');
            }
        } catch (e: any) {
            showMessage('error', '操作失败', e.toString());
        } finally {
            setCopyContextMenuLoading(false);
        }
    };

    const handleDeleteContextMenuToggle = async (enable: boolean) => {
        setDeleteContextMenuLoading(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            if (enable) {
                await invoke('register_delete_context_menu');
                setDeleteContextMenuEnabled(true);
                showMessage('success', '操作成功', '已添加删除模型右键菜单');
            } else {
                await invoke('unregister_delete_context_menu');
                setDeleteContextMenuEnabled(false);
                showMessage('success', '操作成功', '已移除删除模型右键菜单');
            }
        } catch (e: any) {
            showMessage('error', '操作失败', e.toString());
        } finally {
            setDeleteContextMenuLoading(false);
        }
    };

    const handleCopyMpqToggle = async (enable: boolean) => {
        setCopyMpqLoading(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('set_copy_mpq_textures', { enabled: enable });
            setCopyMpqEnabled(enable);
            showMessage(
                'success',
                '操作成功',
                enable
                    ? '已开启 MPQ 内置贴图复制'
                    : '已关闭 MPQ 内置贴图复制'
            );
        } catch (e: any) {
            showMessage('error', '操作失败', e.toString());
        } finally {
            setCopyMpqLoading(false);
        }
    };

    const handleContextMenuToggle = async (enable: boolean) => {
        setContextMenuLoading(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');

            if (enable) {
                await invoke('register_context_menu');
                setContextMenuEnabled(true);
                showMessage('success', '操作成功', '已添加右键菜单');
            } else {
                await invoke('unregister_context_menu');
                setContextMenuEnabled(false);
                showMessage('success', '操作成功', '已移除右键菜单');
            }
        } catch (e: any) {
            showMessage('error', '操作失败', e.toString());
        } finally {
            setContextMenuLoading(false);
        }
    };

    const GRID_SIZES = [512, 1024, 2048, 4096, 50000];
    const currentSizeIndex = (() => {
        const size = gridSettings.gridSize || 2048;
        const idx = GRID_SIZES.findIndex(s => s >= size);
        return idx !== -1 ? idx : 2;
    })();

    const sliderMarks: Record<number, { style: React.CSSProperties; label: React.ReactNode }> = {};
    GRID_SIZES.forEach((size, index) => {
        sliderMarks[index] = {
            style: { color: '#888', fontSize: '10px', marginTop: '4px' },
            label: size >= 50000 ? '无限' : size.toString()
        };
    });

    if (!showSettingsPanel) return null;

    const handleLoadMPQ = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const { invoke } = await import('@tauri-apps/api/core');

            const selected = await open({
                multiple: true,
                filters: [{
                    name: 'Warcraft 3 Archives',
                    extensions: ['mpq']
                }]
            });

            if (selected) {
                const paths = Array.isArray(selected) ? selected : [selected];
                localStorage.setItem('mpq_paths', JSON.stringify(paths));
                try {
                    await invoke('set_mpq_paths', { paths });
                } catch (e) {
                    console.warn('Failed to persist MPQ paths to backend:', e);
                }

                const msgId = useMessageStore.getState().addMessage({
                    type: 'loading',
                    title: '请稍候',
                    content: '正在加载 MPQ...'
                });

                let count = 0;
                for (const path of paths) {
                    if (path) {
                        try {
                            await invoke('load_mpq', { path });
                            count++;
                        } catch (e) {
                            console.error('Failed to load specific MPQ:', path, e);
                        }
                    }
                }

                useMessageStore.getState().removeMessage(msgId);
                if (count > 0) {
                    setMpqLoaded(true);
                    showMessage('success', '操作成功', `成功加载 ${count} 个 MPQ 文件`);
                }
            }
        } catch (err: any) {
            console.error('Failed to load MPQ:', err);
            showMessage('error', '加载 MPQ 失败', err.toString());
        }
    };

    const handleDebugMissingTexture = async () => {
        if (!missingTextures || missingTextures.length === 0) {
            showMessage('info', '提示', '没有缺失贴图可测试');
            return;
        }
        const target = missingTextures[0];
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<{
                input: string;
                normalized: string;
                candidates: string[];
                archive_count: number;
                archive_paths: string[];
                found: boolean;
                size: number | null;
            }>('debug_mpq_probe', { path: target });

            console.log('[MPQ Debug] Probe result:', result);
            showMessage(
                result.found ? 'success' : 'warning',
                'MPQ 调试',
                result.found
                    ? `已命中: ${result.normalized} (${result.size ?? 0} bytes)`
                    : `未命中: ${result.normalized} (已加载 ${result.archive_count} 个 MPQ)`
            );
        } catch (e: any) {
            console.error('[MPQ Debug] Probe failed:', e);
            showMessage('error', 'MPQ 调试失败', e.toString());
        }
    };

    return (
        <>
            <DraggableModal
                title="视图设置"
                open={showSettingsPanel}
                onCancel={() => setShowSettingsPanel(false)}
                onOk={() => setShowSettingsPanel(false)}
                width={1080}
                footer={null}
                maskClosable={false}
                mask={false}
                wrapClassName="dark-theme-modal"
                styles={{
                    content: { backgroundColor: '#141414', border: '1px solid #333', color: '#eee', borderRadius: '8px' },
                    header: { backgroundColor: '#1d1d1d', borderBottom: '1px solid #333', color: '#eee', padding: '10px 16px', borderRadius: '8px 8px 0 0' },
                    body: { backgroundColor: '#141414', padding: '12px 16px' },
                }}
            >
                <style>{`
                    .settings-card {
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 8px;
                        padding: 12px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                        height: 100%;
                    }
                    .settings-section-title {
                        font-size: 12px;
                        font-weight: 600;
                        color: #1677ff;
                        margin-bottom: 12px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .settings-row {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        margin-bottom: 8px;
                    }
                    .settings-label {
                        color: #aaa;
                        font-size: 12px;
                        width: 70px;
                        flex-shrink: 0;
                    }
                    .dark-theme-modal .ant-tabs-tab .ant-tabs-tab-btn {
                        color: #fff !important;
                    }
                    .dark-theme-modal .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
                        color: #1677ff !important;
                    }
                `}</style>
                <Tabs defaultActiveKey="general" size="small" tabBarStyle={{ marginBottom: 12 }}>
                    <Tabs.TabPane tab="常规设置" key="general">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                            {/* Column 1: Display & View */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div className="settings-card">
                                    <div className="settings-section-title">
                                        <DatabaseOutlined /> 显示控制
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                                        <ToggleButton checked={showGridXY} onChange={setShowGridXY} fullWidth>XY 网格</ToggleButton>
                                        <ToggleButton checked={showGridXZ} onChange={setShowGridXZ} fullWidth>XZ 网格</ToggleButton>
                                        <ToggleButton checked={showGridYZ} onChange={setShowGridYZ} fullWidth>YZ 网格</ToggleButton>
                                        <ToggleButton checked={showNodes} onChange={setShowNodes} fullWidth>骨骼节点</ToggleButton>
                                        <ToggleButton checked={showSkeleton} onChange={setShowSkeleton} fullWidth>渲染骨架</ToggleButton>
                                        <ToggleButton checked={showFPS} onChange={setShowFPS} fullWidth>显示 FPS</ToggleButton>
                                        <ToggleButton checked={showGeosetVisibility} onChange={setShowGeosetVisibility} fullWidth>多边形工具</ToggleButton>
                                        <ToggleButton checked={showCollisionShapes} onChange={setShowCollisionShapes} fullWidth>碰撞模型</ToggleButton>
                                        <ToggleButton checked={showCameras} onChange={setShowCameras} fullWidth>相机位置</ToggleButton>
                                        <ToggleButton checked={showLights} onChange={setShowLights} fullWidth>灯光对象</ToggleButton>
                                        <ToggleButton checked={showAttachments} onChange={setShowAttachments} fullWidth>模型附件</ToggleButton>
                                        <ToggleButton checked={showParticles} onChange={setShowParticles} fullWidth>粒子显示</ToggleButton>
                                        <ToggleButton checked={showRibbons} onChange={setShowRibbons} fullWidth>丝带显示</ToggleButton>
                                    </div>
                                </div>

                                <div className="settings-card">
                                    <div className="settings-section-title">
                                        <SunOutlined /> 细节与交互
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                                            <ToggleButton
                                                checked={showVertices}
                                                onChange={(v) => {
                                                    if (mainMode === 'animation') {
                                                        setShowVerticesForAnimationSubMode(animationSubMode as any, v)
                                                    } else {
                                                        setShowVerticesForMode(mainMode, v)
                                                    }
                                                }}
                                                fullWidth
                                            >
                                                显示顶点
                                            </ToggleButton>
                                            <ToggleButton checked={vertexSettings.enableDepth} onChange={v => setVertexSettings({ enableDepth: v })} fullWidth>顶点深度</ToggleButton>
                                        </div>

                                        <div style={{ padding: '0 4px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '11px', marginBottom: '4px' }}>
                                                <span>Gizmo 缩放</span>
                                                <span>{gizmoSize.toFixed(1)}x</span>
                                            </div>
                                            <Slider
                                                min={0.1} max={1} step={0.1} value={gizmoSize}
                                                onChange={(v) => setGizmoSize(v as number)}
                                                styles={{ track: { backgroundColor: '#1677ff' }, rail: { backgroundColor: '#333' } }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Column 2: Grid & System Config */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div className="settings-card">
                                    <div className="settings-section-title">
                                        <DatabaseOutlined /> 网格参数
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '16px' }}>
                                        <ToggleButton checked={gridSettings.show128} onChange={v => setGridSettings({ show128: v })} fullWidth>128 间距</ToggleButton>
                                        <ToggleButton checked={gridSettings.show512} onChange={v => setGridSettings({ show512: v })} fullWidth>512 间距</ToggleButton>
                                        <ToggleButton checked={gridSettings.show1024} onChange={v => setGridSettings({ show1024: v })} fullWidth>1024 间距</ToggleButton>
                                        <ToggleButton checked={gridSettings.enableDepth} onChange={v => setGridSettings({ enableDepth: v })} fullWidth>网格深度</ToggleButton>
                                    </div>
                                    <div style={{ padding: '0 4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '11px', marginBottom: '16px' }}>
                                            <span>网格范围: {(gridSettings.gridSize || 2048) >= 50000 ? '无限' : gridSettings.gridSize}</span>
                                        </div>
                                        <Slider
                                            min={0} max={GRID_SIZES.length - 1} step={null}
                                            marks={sliderMarks as any} value={currentSizeIndex}
                                            onChange={(v) => setGridSettings({ gridSize: GRID_SIZES[v] })}
                                            styles={{ track: { backgroundColor: '#1677ff' }, rail: { backgroundColor: '#333' } }}
                                        />
                                    </div>
                                </div>

                                <div className="settings-card">
                                    <div className="settings-section-title">
                                        <SunOutlined /> 程序自动化
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                                        <ToggleButton checked={autoRecalculateExtent} onChange={() => setAutoRecalculateExtent(!autoRecalculateExtent)} fullWidth>自动计算范围</ToggleButton>
                                        <ToggleButton checked={autoRecalculateNormals} onChange={() => setAutoRecalculateNormals(!autoRecalculateNormals)} fullWidth>自动重算法线</ToggleButton>
                                        <ToggleButton checked={keepCameraOnLoad} onChange={() => setKeepCameraOnLoad(!keepCameraOnLoad)} fullWidth>保持相机位置</ToggleButton>
                                        <ToggleButton checked={renderMode === 'wireframe'} onChange={() => setRenderMode(renderMode === 'textured' ? 'wireframe' : 'textured')} fullWidth>
                                            {renderMode === 'wireframe' ? '线框' : '纹理'}
                                        </ToggleButton>
                                        <ToggleButton checked={enableLighting} onChange={setEnableLighting} fullWidth>
                                            环境光照: {enableLighting ? '开' : '关'}
                                        </ToggleButton>
                                    </div>
                                    <div style={{ marginTop: '12px' }}>
                                        <Select
                                            value={teamColor} onChange={setTeamColor} size="small" style={{ width: '100%' }}
                                            options={Array.from({ length: 13 }).map((_, i) => ({
                                                value: i, label: `队伍颜色: 玩家 ${i + 1}`
                                            }))}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Column 3: Lighting & MPQ */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div className="settings-card" style={{ padding: '10px' }}>
                                    <div className="settings-section-title">
                                        <SunOutlined /> 环境照明
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <div className="settings-row">
                                            <Select
                                                value={selectedDNCPreset || 'lordaeron'}
                                                onChange={handleDNCChange}
                                                loading={dncLoading}
                                                size="small"
                                                style={{ flex: 1 }}
                                                options={Object.entries(allPresets).map(([key, preset]) => ({ value: key, label: preset.name }))}
                                            />
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <Button size="small" onClick={handleNewPreset} ghost style={{ fontSize: '11px' }}>新建</Button>
                                                <Button size="small" type="primary" onClick={handleSaveCurrentPreset} style={{ fontSize: '11px' }}>保存</Button>
                                            </div>
                                        </div>

                                        <div className="settings-row">
                                            <span className="settings-label">光照强度</span>
                                            <Slider min={0} max={3} step={0.1} value={lightIntensity} onChange={handleLightIntensityChange} style={{ flex: 1, margin: '0 8px' }} />
                                            <ColorPicker value={lightColor} onChange={handleLightColorChange} size="small" />
                                        </div>

                                        <div className="settings-row">
                                            <span className="settings-label">环境强度</span>
                                            <Slider min={0} max={3} step={0.1} value={ambientIntensity} onChange={handleAmbientIntensityChange} style={{ flex: 1, margin: '0 8px' }} />
                                            <ColorPicker value={ambientColor} onChange={handleAmbientColorChange} size="small" />
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <Button size="small" danger onClick={handleDeletePreset} style={{ fontSize: '11px' }}>删除预设</Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="settings-card">
                                    <div className="settings-section-title">
                                        <DatabaseOutlined /> 游戏资源与菜单
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: mpqLoaded ? '#52c41a' : '#888' }}>
                                                {mpqLoaded ? <CheckCircleFilled /> : <CloseCircleFilled />}
                                                <span>MPQ: {mpqLoaded ? '已准备' : '未加载'}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <Button size="small" onClick={handleDebugMissingTexture} disabled={!missingTextures?.length}>测试</Button>
                                                <Button size="small" type="primary" onClick={handleLoadMPQ}>加载</Button>
                                            </div>
                                        </div>
                                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                                            <ToggleButton checked={contextMenuEnabled} onChange={() => handleContextMenuToggle(!contextMenuEnabled)} disabled={contextMenuLoading} fullWidth>主右键菜单</ToggleButton>
                                            <ToggleButton checked={copyMpqEnabled} onChange={() => handleCopyMpqToggle(!copyMpqEnabled)} disabled={copyMpqLoading} fullWidth>复制 MPQ 贴图</ToggleButton>
                                            <ToggleButton checked={copyContextMenuEnabled} onChange={() => handleCopyContextMenuToggle(!copyContextMenuEnabled)} disabled={copyContextMenuLoading} fullWidth>复制模型右键</ToggleButton>
                                            <ToggleButton checked={deleteContextMenuEnabled} onChange={() => handleDeleteContextMenuToggle(!deleteContextMenuEnabled)} disabled={deleteContextMenuLoading} fullWidth>删除模型右键</ToggleButton>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Bottom Section: Colors */}
                        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '300px 1fr', gap: '16px' }}>
                            <div className="settings-card">
                                <div className="settings-section-title">基础颜色</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 12px' }}>
                                    {[
                                        { key: 'background', label: '背景', value: backgroundColor, setter: setBackgroundColor },
                                        { key: 'vertex', label: '顶点', value: vertexColor, setter: setVertexColor },
                                        { key: 'wireframe', label: '线框', value: wireframeColor, setter: setWireframeColor },
                                        { key: 'selection', label: '选中', value: selectionColor, setter: setSelectionColor },
                                        { key: 'hover', label: '悬停', value: hoverColor, setter: setHoverColor }
                                    ].map(item => (
                                        <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '11px', color: '#888' }}>{item.label}</span>
                                            <div style={{ width: '40px', height: '20px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444', position: 'relative' }}>
                                                <input
                                                    type="color" value={item.value} onChange={(e) => item.setter(e.target.value)}
                                                    style={{ position: 'absolute', top: -5, left: -5, width: '50px', height: '40px', border: 'none', cursor: 'pointer' }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="settings-card">
                                <div className="settings-section-title">节点分类颜色</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px 16px' }}>
                                    {[
                                        { key: 'Bone', label: '骨骼' }, { key: 'Helper', label: '辅助' }, { key: 'Attachment', label: '附件' },
                                        { key: 'ParticleEmitter', label: '粒子1' }, { key: 'ParticleEmitter2', label: '粒子2' },
                                        { key: 'RibbonEmitter', label: '飘带' }, { key: 'Light', label: '光源' }, { key: 'EventObject', label: '事件' },
                                        { key: 'CollisionShape', label: '碰撞' }
                                    ].map(item => (
                                        <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '11px', color: '#888' }}>{item.label}</span>
                                            <div style={{ width: '32px', height: '18px', borderRadius: '3px', overflow: 'hidden', border: '1px solid #444', position: 'relative' }}>
                                                <input
                                                    type="color" value={(nodeColors as any)?.[item.key] || '#ffffff'}
                                                    onChange={(e) => setNodeColors({ [item.key]: e.target.value } as any)}
                                                    style={{ position: 'absolute', top: -6, left: -6, width: '48px', height: '36px', border: 'none', cursor: 'pointer' }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Tabs.TabPane>
                    <Tabs.TabPane tab="快捷键映射" key="shortcuts">
                        <div style={{ height: '580px' }}>
                            <ShortcutSettingsPanel />
                        </div>
                    </Tabs.TabPane>
                </Tabs>
            </DraggableModal>

            {/* New Preset Modal */}
            <Modal
                title="新建光照预设"
                open={presetModalOpen}
                onOk={handleConfirmNewPreset}
                onCancel={() => setPresetModalOpen(false)}
                okText="确定"
                cancelText="取消"
                width={280}
                centered
                zIndex={2000}
                styles={{
                    mask: { backgroundColor: 'transparent' },
                    content: { backgroundColor: '#1f1f1f', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' },
                    header: { backgroundColor: '#1f1f1f', borderBottom: '1px solid #333' },
                    body: { backgroundColor: '#1f1f1f', padding: '16px' },
                    footer: { backgroundColor: '#1f1f1f', borderTop: '1px solid #333' }
                }}
                classNames={{
                    header: 'ant-modal-header-dark'
                }}
            >
                <style>{`
                    .ant-modal-header-dark .ant-modal-title { color: #fff !important; }
                    .ant-modal-close { color: #888 !important; }
                    .ant-modal-close:hover { color: #fff !important; }
                    .preset-input::placeholder { color: #666 !important; }
                `}</style>
                <Input
                    className="preset-input"
                    placeholder="输入预设名称"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    onPressEnter={handleConfirmNewPreset}
                    style={{
                        backgroundColor: '#333',
                        borderColor: '#555',
                        color: '#fff'
                    }}
                />
            </Modal>
        </>
    );
};
