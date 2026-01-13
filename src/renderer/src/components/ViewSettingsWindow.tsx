import React, { useState, useEffect } from 'react';
import { Select, Button, Slider, ColorPicker, Modal, Input } from 'antd';
import { DraggableModal } from './DraggableModal';
import { useRendererStore } from '../store/rendererStore';
import { useSelectionStore } from '../store/selectionStore';
import { showMessage, useMessageStore } from '../store/messageStore';
import { DatabaseOutlined, CheckCircleFilled, CloseCircleFilled, FolderOpenOutlined, SunOutlined } from '@ant-design/icons';
import { DNC_PRESETS, getEnvironmentManager } from './viewer/EnvironmentManager';

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
                padding: '0 12px',      // Horizontal padding
                height: '32px',         // Fixed Height
                width: fullWidth ? '100%' : '110px', // Fixed Width (approx 5 chars) or full
                borderRadius: '6px',
                backgroundColor: checked ? '#1677ff' : '#3a3a3a',
                color: checked ? '#fff' : '#aaa',
                cursor: disabled ? 'not-allowed' : 'pointer',
                userSelect: 'none',
                transition: 'all 0.2s',
                opacity: disabled ? 0.5 : 1,
                fontSize: '13px',
                fontWeight: checked ? 500 : 400,
                border: checked ? '1px solid #1677ff' : '1px solid #4a4a4a',
                whiteSpace: 'nowrap',
                ...style
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
        enableLighting, setEnableLighting,
        renderMode, setRenderMode,
        backgroundColor, setBackgroundColor,
        vertexColor, setVertexColor,
        wireframeColor, setWireframeColor,
        selectionColor, setSelectionColor,
        hoverColor, setHoverColor,
        teamColor, setTeamColor,
        mpqLoaded, setMpqLoaded,
        showVerticesByMode, setShowVerticesForMode,
        vertexSettings, setVertexSettings,
        autoRecalculateExtent, setAutoRecalculateExtent,
        autoRecalculateNormals, setAutoRecalculateNormals,
        keepCameraOnLoad, setKeepCameraOnLoad
    } = useRendererStore();
    const mainMode = useSelectionStore(state => state.mainMode);
    const showVertices = showVerticesByMode[mainMode] ?? true;

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
                showMessage('success', '\u64cd\u4f5c\u6210\u529f', '\u5df2\u6dfb\u52a0\u590d\u5236\u6a21\u578b\u53f3\u952e\u83dc\u5355');
            } else {
                await invoke('unregister_copy_context_menu');
                setCopyContextMenuEnabled(false);
                showMessage('success', '\u64cd\u4f5c\u6210\u529f', '\u5df2\u79fb\u9664\u590d\u5236\u6a21\u578b\u53f3\u952e\u83dc\u5355');
            }
        } catch (e: any) {
            showMessage('error', '\u64cd\u4f5c\u5931\u8d25', e.toString());
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
                showMessage('success', '\u64cd\u4f5c\u6210\u529f', '\u5df2\u6dfb\u52a0\u5220\u9664\u6a21\u578b\u53f3\u952e\u83dc\u5355');
            } else {
                await invoke('unregister_delete_context_menu');
                setDeleteContextMenuEnabled(false);
                showMessage('success', '\u64cd\u4f5c\u6210\u529f', '\u5df2\u79fb\u9664\u5220\u9664\u6a21\u578b\u53f3\u952e\u83dc\u5355');
            }
        } catch (e: any) {
            showMessage('error', '\u64cd\u4f5c\u5931\u8d25', e.toString());
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
                '\u64cd\u4f5c\u6210\u529f',
                enable
                    ? '\u5df2\u5f00\u542f MPQ \u5185\u7f6e\u8d34\u56fe\u590d\u5236'
                    : '\u5df2\u5173\u95ed MPQ \u5185\u7f6e\u8d34\u56fe\u590d\u5236'
            );
        } catch (e: any) {
            showMessage('error', '\u64cd\u4f5c\u5931\u8d25', e.toString());
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
        // Find closest if exact match not found (resilience)
        const idx = GRID_SIZES.findIndex(s => s >= size);
        return idx !== -1 ? idx : 2; // Default to 2048 (index 2)
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

                // Save paths
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

    return (
        <>
            <DraggableModal
                title="视图设置"
                open={showSettingsPanel}
                onCancel={() => setShowSettingsPanel(false)}
                onOk={() => setShowSettingsPanel(false)}
                width={800}
                footer={null}
                maskClosable={false}
                mask={false}
                wrapClassName="dark-theme-modal"
                styles={{
                    content: { backgroundColor: '#1f1f1f', border: '1px solid #444', color: '#eee' },
                    header: { backgroundColor: '#2b2b2b', borderBottom: '1px solid #333', color: '#eee', padding: '12px 16px' },
                    body: { backgroundColor: '#1f1f1f', padding: '20px' },
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Top Section: Display & Grid */}
                    <div style={{ display: 'flex', gap: '32px' }}>

                        {/* Display Elements - 4 Columns x 5 Rows */}
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#888', marginBottom: '12px' }}>
                                显示元素
                            </div>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(4, 90px)',
                                gap: '10px'
                            }}>
                                <ToggleButton checked={showGridXY} onChange={setShowGridXY} style={{ width: '90px' }}>XY网格</ToggleButton>
                                <ToggleButton checked={showGridXZ} onChange={setShowGridXZ} style={{ width: '90px' }}>XZ网格</ToggleButton>
                                <ToggleButton checked={showGridYZ} onChange={setShowGridYZ} style={{ width: '90px' }}>YZ网格</ToggleButton>
                                <ToggleButton checked={showNodes} onChange={setShowNodes} style={{ width: '90px' }}>节点</ToggleButton>
                                <ToggleButton checked={showSkeleton} onChange={setShowSkeleton} style={{ width: '90px' }}>骨架</ToggleButton>
                                <ToggleButton checked={showFPS} onChange={setShowFPS} style={{ width: '90px' }}>FPS</ToggleButton>
                                <ToggleButton checked={showGeosetVisibility} onChange={setShowGeosetVisibility} style={{ width: '90px' }}>多边形工具</ToggleButton>
                                <ToggleButton checked={showCollisionShapes} onChange={setShowCollisionShapes} style={{ width: '90px' }}>碰撞形状</ToggleButton>
                                <ToggleButton checked={showCameras} onChange={setShowCameras} style={{ width: '90px' }}>相机对象</ToggleButton>
                                <ToggleButton checked={showLights} onChange={setShowLights} style={{ width: '90px' }}>灯光对象</ToggleButton>
                                <ToggleButton checked={showAttachments} onChange={setShowAttachments} style={{ width: '90px' }}>附件点</ToggleButton>
                            </div>
                        </div>

                        {/* Grid Details - Unified Colors */}
                        <div style={{ width: '260px', borderLeft: '1px solid #333', paddingLeft: '24px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#888', marginBottom: '12px' }}>
                                网格细节
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                                <ToggleButton
                                    checked={gridSettings.show128}
                                    onChange={v => setGridSettings({ show128: v })}
                                    disabled={!(showGridXY || showGridXZ || showGridYZ)}
                                    fullWidth
                                >
                                    128 (白)
                                </ToggleButton>
                                <ToggleButton
                                    checked={gridSettings.show512}
                                    onChange={v => setGridSettings({ show512: v })}
                                    disabled={!(showGridXY || showGridXZ || showGridYZ)}
                                    fullWidth
                                // Removed custom yellow colors
                                >
                                    512 (黄)
                                </ToggleButton>
                                <ToggleButton
                                    checked={gridSettings.show1024}
                                    onChange={v => setGridSettings({ show1024: v })}
                                    disabled={!(showGridXY || showGridXZ || showGridYZ)}
                                    fullWidth
                                // Removed custom red colors
                                >
                                    1024 (红)
                                </ToggleButton>
                                <ToggleButton
                                    checked={gridSettings.enableDepth}
                                    onChange={v => setGridSettings({ enableDepth: v })}
                                    disabled={!(showGridXY || showGridXZ || showGridYZ)}
                                    fullWidth
                                >
                                    网格深度
                                </ToggleButton>

                                {/* Compact Grid Size Slider */}
                                <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666', marginBottom: '0px' }}>
                                        <span>范围: {(gridSettings.gridSize || 2048) >= 50000 ? '无限' : gridSettings.gridSize}</span>
                                    </div>
                                    <Slider
                                        min={0}
                                        max={GRID_SIZES.length - 1}
                                        step={null}
                                        marks={sliderMarks as any}
                                        value={currentSizeIndex}
                                        onChange={(v) => setGridSettings({ gridSize: GRID_SIZES[v] })}
                                        disabled={!(showGridXY || showGridXZ || showGridYZ)}
                                        tooltip={{ formatter: (v) => (typeof v === 'number' && GRID_SIZES[v] >= 50000) ? '无限' : GRID_SIZES[v as number] }}
                                        styles={{
                                            track: { backgroundColor: '#1677ff' },
                                            rail: { backgroundColor: '#4a4a4a' }
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Vertex Details */}
                            <div style={{ marginTop: '20px', borderTop: '1px solid #333', paddingTop: '16px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#888', marginBottom: '12px' }}>
                                    顶点细节
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                                    <ToggleButton
                                        checked={showVertices}
                                        onChange={(v) => setShowVerticesForMode(mainMode, v)}
                                        fullWidth
                                    >
                                        显示顶点
                                    </ToggleButton>
                                    <ToggleButton
                                        checked={vertexSettings.enableDepth}
                                        onChange={v => setVertexSettings({ enableDepth: v })}
                                        fullWidth
                                    >
                                        顶点深度
                                    </ToggleButton>
                                </div>
                            </div>
                        </div>
                    </div>



                    <div style={{ borderTop: '1px solid #333' }} />

                    {/* Color Settings Section */}
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#888', marginBottom: '12px' }}>
                            颜色配置
                        </div>
                        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px', width: '70px' }}>背景颜色</span>
                                <div style={{ position: 'relative', width: '36px', height: '22px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444' }}>
                                    <input
                                        type="color"
                                        value={backgroundColor}
                                        onChange={(e) => setBackgroundColor(e.target.value)}
                                        style={{
                                            position: 'absolute', top: -5, left: -5, width: '50px', height: '40px',
                                            padding: 0, margin: 0, border: 'none', cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px', width: '70px' }}>顶点颜色</span>
                                <div style={{ position: 'relative', width: '36px', height: '22px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444' }}>
                                    <input
                                        type="color"
                                        value={vertexColor}
                                        onChange={(e) => setVertexColor(e.target.value)}
                                        style={{
                                            position: 'absolute', top: -5, left: -5, width: '50px', height: '40px',
                                            padding: 0, margin: 0, border: 'none', cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px', width: '70px' }}>线框颜色</span>
                                <div style={{ position: 'relative', width: '36px', height: '22px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444' }}>
                                    <input
                                        type="color"
                                        value={wireframeColor}
                                        onChange={(e) => setWireframeColor(e.target.value)}
                                        style={{
                                            position: 'absolute', top: -5, left: -5, width: '50px', height: '40px',
                                            padding: 0, margin: 0, border: 'none', cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px', width: '70px' }}>选中高亮</span>
                                <div style={{ position: 'relative', width: '36px', height: '22px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444' }}>
                                    <input
                                        type="color"
                                        value={selectionColor}
                                        onChange={(e) => setSelectionColor(e.target.value)}
                                        style={{
                                            position: 'absolute', top: -5, left: -5, width: '50px', height: '40px',
                                            padding: 0, margin: 0, border: 'none', cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px', width: '70px' }}>悬停高亮</span>
                                <div style={{ position: 'relative', width: '36px', height: '22px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444' }}>
                                    <input
                                        type="color"
                                        value={hoverColor}
                                        onChange={(e) => setHoverColor(e.target.value)}
                                        style={{
                                            position: 'absolute', top: -5, left: -5, width: '50px', height: '40px',
                                            padding: 0, margin: 0, border: 'none', cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid #333' }} />

                    {/* Render Settings */}
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#888', marginBottom: '12px' }}>
                            渲染配置
                        </div>
                        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px' }}>渲染模式</span>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <ToggleButton
                                        checked={renderMode === 'textured'}
                                        onChange={() => setRenderMode('textured')}
                                        style={{ width: '80px' }}
                                    >
                                        纹理
                                    </ToggleButton>
                                    <ToggleButton
                                        checked={renderMode === 'wireframe'}
                                        onChange={() => setRenderMode('wireframe')}
                                        style={{ width: '80px' }}
                                    >
                                        线框
                                    </ToggleButton>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px' }}>光照</span>
                                <ToggleButton
                                    checked={enableLighting}
                                    onChange={setEnableLighting}
                                    style={{ width: '80px' }}
                                >
                                    {enableLighting ? '开启' : '关闭'}
                                </ToggleButton>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ color: '#aaa', fontSize: '13px' }}>队伍颜色</span>
                                <Select
                                    value={teamColor}
                                    onChange={setTeamColor}
                                    size="middle"
                                    style={{ width: '140px' }}
                                    popupMatchSelectWidth={false}
                                    options={Array.from({ length: 13 }).map((_, i) => ({
                                        value: i,
                                        label: `玩家 ${i + 1} (${['红', '蓝', '青', '紫', '黄', '橙', '绿', '粉', '灰', '浅蓝', '暗绿', '棕', '栗'][i] || '未知'})`
                                    }))}
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid #333' }} />

                    {/* ???? Section */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#888' }}>
                            {"\u7a0b\u5e8f\u914d\u7f6e"}
                        </span>
                        <ToggleButton
                            checked={contextMenuEnabled}
                            onChange={() => handleContextMenuToggle(!contextMenuEnabled)}
                            style={{ width: '90px' }}
                            disabled={contextMenuLoading}
                        >
                            {"\u53f3\u952e\u83dc\u5355"}
                        </ToggleButton>
                        <ToggleButton
                            checked={copyContextMenuEnabled}
                            onChange={() => handleCopyContextMenuToggle(!copyContextMenuEnabled)}
                            style={{ width: '140px' }}
                            disabled={copyContextMenuLoading}
                        >
                            {"\u590d\u5236\u6a21\u578b\u53f3\u952e\u83dc\u5355"}
                        </ToggleButton>
                        <ToggleButton
                            checked={deleteContextMenuEnabled}
                            onChange={() => handleDeleteContextMenuToggle(!deleteContextMenuEnabled)}
                            style={{ width: '140px' }}
                            disabled={deleteContextMenuLoading}
                        >
                            {"\u5220\u9664\u6a21\u578b\u53f3\u952e\u83dc\u5355"}
                        </ToggleButton>
                        <ToggleButton
                            checked={copyMpqEnabled}
                            onChange={() => handleCopyMpqToggle(!copyMpqEnabled)}
                            style={{ width: '140px' }}
                            disabled={copyMpqLoading}
                        >
                            {"\u590d\u5236MPQ\u5185\u7f6e\u8d34\u56fe"}
                        </ToggleButton>
                        <ToggleButton
                            checked={autoRecalculateExtent}
                            onChange={() => setAutoRecalculateExtent(!autoRecalculateExtent)}
                            style={{ width: '110px' }}
                        >
                            {"\u81ea\u52a8\u70b9\u8303\u56f4"}
                        </ToggleButton>
                        <ToggleButton
                            checked={autoRecalculateNormals}
                            onChange={() => setAutoRecalculateNormals(!autoRecalculateNormals)}
                            style={{ width: '90px' }}
                        >
                            {"\u81ea\u52a8\u6cd5\u7ebf"}
                        </ToggleButton>
                        <ToggleButton
                            checked={keepCameraOnLoad}
                            onChange={() => setKeepCameraOnLoad(!keepCameraOnLoad)}
                            style={{ width: '90px' }}
                        >
                            {"\u4fdd\u6301\u76f8\u673a"}
                        </ToggleButton>
                    </div>

                    {/* DNC Environment Lighting Section */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', backgroundColor: '#262626', borderRadius: '8px', border: '1px solid #333' }}>
                        {/* Title Row */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <SunOutlined style={{ color: '#faad14' }} />
                                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#ccc' }}>环境光照</span>
                            </div>
                        </div>

                        {/* Controls Container */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* Row 1: Preset Selection & Actions */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#888', width: '60px' }}>方案预设</span>
                                <Select
                                    value={selectedDNCPreset || 'lordaeron'}
                                    onChange={handleDNCChange}
                                    loading={dncLoading}
                                    style={{ flex: 1 }}
                                    size="small"
                                    options={
                                        Object.entries(allPresets).map(([key, preset]) => ({
                                            value: key,
                                            label: preset.name
                                        }))
                                    }
                                />
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <Button size="small" onClick={handleNewPreset} style={{ fontSize: '11px', padding: '0 8px' }}>新建</Button>
                                    <Button size="small" onClick={handleDeletePreset} style={{ fontSize: '11px', padding: '0 8px' }}>删除</Button>
                                    <Button size="small" type="primary" onClick={handleSaveCurrentPreset} style={{ fontSize: '11px', padding: '0 8px' }}>保存</Button>
                                </div>
                            </div>

                            {/* Row 2: Light Intensity & Color */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#888', width: '60px' }}>光照强度</span>
                                <Slider
                                    min={0}
                                    max={3}
                                    step={0.1}
                                    value={lightIntensity}
                                    onChange={handleLightIntensityChange}
                                    style={{ flex: 1 }}
                                />
                                <span style={{ fontSize: '11px', color: '#666', width: '24px', textAlign: 'right' }}>{lightIntensity.toFixed(1)}</span>
                                <div style={{ width: '1px', height: '16px', backgroundColor: '#444', margin: '0 8px' }} />
                                <ColorPicker
                                    value={lightColor}
                                    onChange={handleLightColorChange}
                                    size="small"
                                    showText={false}
                                />
                            </div>

                            {/* Row 3: Ambient Intensity & Color */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#888', width: '60px' }}>环境强度</span>
                                <Slider
                                    min={0}
                                    max={3}
                                    step={0.1}
                                    value={ambientIntensity}
                                    onChange={handleAmbientIntensityChange}
                                    style={{ flex: 1 }}
                                />
                                <span style={{ fontSize: '11px', color: '#666', width: '24px', textAlign: 'right' }}>{ambientIntensity.toFixed(1)}</span>
                                <div style={{ width: '1px', height: '16px', backgroundColor: '#444', margin: '0 8px' }} />
                                <ColorPicker
                                    value={ambientColor}
                                    onChange={handleAmbientColorChange}
                                    size="small"
                                    showText={false}
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid #333' }} />

                    {/* System / MPQ Section */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: '#262626',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        border: '1px solid #333'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <DatabaseOutlined style={{ fontSize: '18px', color: '#1677ff' }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ color: '#eee', fontWeight: 500 }}>游戏资源 (MPQ)</span>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    backgroundColor: mpqLoaded ? '#1e3a1e' : '#3a3a3a',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    color: mpqLoaded ? '#73d13d' : '#888'
                                }}>
                                    {mpqLoaded ? <CheckCircleFilled /> : <CloseCircleFilled />}
                                    {mpqLoaded ? '已加载' : '未加载'}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#555' }}>
                                * 加载 MPQ 以显示正确贴图与粒子
                            </span>
                            <Button
                                onClick={handleLoadMPQ}
                                type="primary"
                                size="middle"
                                style={{ borderRadius: '6px' }}
                            >
                                加载
                            </Button>
                        </div>
                    </div>

                </div>
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
