import React, { useState, useEffect } from 'react';
import { Select, Button, message, Slider } from 'antd';
import { DraggableModal } from './DraggableModal';
import { useRendererStore } from '../store/rendererStore';
import { DatabaseOutlined, CheckCircleFilled, CloseCircleFilled, FolderOpenOutlined } from '@ant-design/icons';

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
        enableLighting, setEnableLighting,
        renderMode, setRenderMode,
        backgroundColor, setBackgroundColor,
        vertexColor, setVertexColor,
        wireframeColor, setWireframeColor,
        selectionColor, setSelectionColor,
        hoverColor, setHoverColor,
        teamColor, setTeamColor,
        mpqLoaded, setMpqLoaded,
        showVertices, setShowVertices,
        vertexSettings, setVertexSettings
    } = useRendererStore();

    // Context Menu Integration State
    const [contextMenuEnabled, setContextMenuEnabled] = useState<boolean>(false);
    const [contextMenuLoading, setContextMenuLoading] = useState<boolean>(false);

    // Check context menu status on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const isRegistered = await invoke<boolean>('check_context_menu_status');
                setContextMenuEnabled(isRegistered);
            } catch (e) {
                console.error('Failed to check context menu status:', e);
            }
        };
        if (showSettingsPanel) {
            checkStatus();
        }
    }, [showSettingsPanel]);

    const handleContextMenuToggle = async (enable: boolean) => {
        setContextMenuLoading(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');

            if (enable) {
                await invoke('register_context_menu');
                setContextMenuEnabled(true);
                message.success('已添加右键菜单');
            } else {
                await invoke('unregister_context_menu');
                setContextMenuEnabled(false);
                message.success('已移除右键菜单');
            }
        } catch (e: any) {
            message.error('操作失败: ' + e.toString());
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

                const hide = message.loading('正在加载 MPQ...', 0);
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

                hide();

                if (count > 0) {
                    setMpqLoaded(true);
                    message.success(`成功加载 ${count} 个 MPQ 文件`);
                }
            }
        } catch (err: any) {
            console.error('Failed to load MPQ:', err);
            message.error('加载 MPQ 失败: ' + err.toString());
        }
    };

    return (
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
                            <ToggleButton checked={showVertices} onChange={setShowVertices} style={{ width: '90px' }}>顶点</ToggleButton>
                            <ToggleButton checked={showNodes} onChange={setShowNodes} style={{ width: '90px' }}>节点</ToggleButton>
                            <ToggleButton checked={showSkeleton} onChange={setShowSkeleton} style={{ width: '90px' }}>骨架</ToggleButton>
                            <ToggleButton checked={showFPS} onChange={setShowFPS} style={{ width: '90px' }}>FPS</ToggleButton>
                            <ToggleButton checked={showGeosetVisibility} onChange={setShowGeosetVisibility} style={{ width: '90px' }}>多边形工具</ToggleButton>
                            <ToggleButton checked={showCollisionShapes} onChange={setShowCollisionShapes} style={{ width: '90px' }}>碰撞形状</ToggleButton>
                            <ToggleButton checked={showCameras} onChange={setShowCameras} style={{ width: '90px' }}>相机对象</ToggleButton>
                            <ToggleButton checked={showLights} onChange={setShowLights} style={{ width: '90px' }}>灯光对象</ToggleButton>
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

                {/* 程序配置 Section */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#888' }}>程序配置</span>
                    <ToggleButton
                        checked={contextMenuEnabled}
                        onChange={() => handleContextMenuToggle(!contextMenuEnabled)}
                        style={{ width: '90px' }}
                        disabled={contextMenuLoading}
                    >右键菜单</ToggleButton>
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
    );
};
