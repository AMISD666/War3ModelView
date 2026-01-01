import React, { useState, useRef, useEffect } from 'react'


interface MenuBarProps {
    onOpen: () => void
    onSave: () => void
    onSaveAs: () => void
    onExportMDL: () => void
    onExportMDX: () => void
    // onLoadMPQ removed
    // mpqLoaded removed (accessed via store in ViewSettingsWindow)
    teamColor: number
    onSelectTeamColor: (color: number) => void
    showGrid: boolean
    onToggleGrid: () => void
    showNodes: boolean
    onToggleNodes: () => void
    showSkeleton: boolean
    onToggleSkeleton: () => void
    renderMode: 'textured' | 'wireframe'
    onChangeRenderMode: (mode: 'textured' | 'wireframe') => void
    backgroundColor: string
    onChangeBackgroundColor: (color: string) => void
    showFPS: boolean
    onToggleFPS: () => void
    showGeosetVisibility: boolean
    onToggleGeosetVisibility: () => void
    showCollisionShapes: boolean
    onToggleCollisionShapes: () => void
    showCameras: boolean
    onToggleCameras: () => void
    showLights: boolean
    onToggleLights: () => void
    onSetViewPreset: (preset: string) => void
    onToggleEditor: (editor: string) => void
    mainMode: 'view' | 'geometry' | 'uv' | 'animation'
    onSetMainMode: (mode: 'view' | 'geometry' | 'uv' | 'animation') => void
    showDebugConsole: boolean
    onToggleDebugConsole: () => void
    onShowAbout: () => void
    onShowChangelog: () => void
    onRecalculateNormals: () => void
    onRecalculateExtents: () => void
    onCheckUpdate: () => void
}

const MenuBar: React.FC<MenuBarProps> = ({
    onOpen,
    onSave,
    onSaveAs,
    onExportMDL,
    onExportMDX,
    // onLoadMPQ,
    // mpqLoaded,
    teamColor,
    onSelectTeamColor,
    showGrid,
    onToggleGrid,
    showNodes,
    onToggleNodes,
    showSkeleton,
    onToggleSkeleton,
    renderMode,
    onChangeRenderMode,
    backgroundColor,
    onChangeBackgroundColor,
    showFPS,
    onToggleFPS,
    showGeosetVisibility,
    onToggleGeosetVisibility,
    showCollisionShapes, // Add this
    onToggleCollisionShapes, // Add this
    showCameras,
    onToggleCameras,
    showLights,
    onToggleLights,
    onSetViewPreset,
    onToggleEditor,
    mainMode,
    onSetMainMode,
    showDebugConsole,
    onToggleDebugConsole,
    onShowAbout,
    onShowChangelog,
    onRecalculateNormals,
    onRecalculateExtents,
    onCheckUpdate
}) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null)
    const [settingsSubMenu, setSettingsSubMenu] = useState<string | null>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setActiveMenu(null)
                setSettingsSubMenu(null)
            }
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                if (event.code === 'KeyS') {
                    event.preventDefault()
                    if (event.shiftKey) {
                        onSaveAs()
                    } else {
                        onSave()
                    }
                }
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [onSave, onSaveAs])

    const toggleMenu = (menu: string) => {
        setActiveMenu(activeMenu === menu ? null : menu)
        setSettingsSubMenu(null)
    }

    const closeMenu = () => setActiveMenu(null)

    const menuStyle: React.CSSProperties = {
        position: 'relative',
        display: 'inline-block',
        padding: '5px 10px',
        cursor: 'pointer',
        userSelect: 'none',
        color: '#eee'
    }

    const dropdownStyle: React.CSSProperties = {
        position: 'absolute',
        top: '100%',
        left: 0,
        backgroundColor: '#333',
        boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
        zIndex: 1000,
        minWidth: '200px',
        padding: '5px 0',
        border: '1px solid #444'
    }

    const itemStyle: React.CSSProperties = {
        padding: '8px 15px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: '#eee'
    }

    const hoverStyle = (e: React.MouseEvent) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = '#444'
    }

    const unhoverStyle = (e: React.MouseEvent) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
    }

    return (
        <div ref={menuRef} style={{
            display: 'flex',
            backgroundColor: '#2b2b2b',
            borderBottom: '1px solid #444',
            height: '30px',
            alignItems: 'center',
            fontSize: '13px'
        }}>
            {/* File Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('file')}>
                文件
                {activeMenu === 'file' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onOpen(); closeMenu() }}
                        >
                            导入模型
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSave(); closeMenu() }}
                        >
                            保存模型
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onExportMDL(); closeMenu() }}
                        >
                            导出为 MDL
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onExportMDX(); closeMenu() }}
                        >
                            导出为 MDX
                        </div>
                    </div>
                )}
            </div>

            {/* Edit Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('edit')}>
                编辑
                {activeMenu === 'edit' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('nodeManager'); closeMenu() }}
                        >
                            <span>节点管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>N</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('camera'); closeMenu() }}
                        >
                            <span>镜头管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>C</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('geoset'); closeMenu() }}
                        >
                            <span>多边形管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>G</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('geosetAnim'); closeMenu() }}
                        >
                            <span>多边形动画管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>E</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('texture'); closeMenu() }}
                        >
                            <span>贴图管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>T</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('textureAnim'); closeMenu() }}
                        >
                            <span>贴图动画管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>X</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('material'); closeMenu() }}
                        >
                            <span>材质管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>M</span>
                        </div>
                        {/* Model Sequence Manager (Ignored / No Shortcut) */}
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('sequence'); closeMenu() }}
                        >
                            <span>模型动作管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>S</span>
                            {/* User asked to ignore "Model Action Manager", but the image shows (S). 
                                "Ignore" might mean "Don't change it" or "Don't implement it". 
                                But later they said "Add shortcuts according to image". 
                                I will add S shortcut for UI consistency but verify if logic exists. 
                                Actually, user said "Directly ignore model action manager". 
                                I will NOT trigger `toggleSequence` from MainLayout shortcut list, 
                                but I will display it in the menu if it matches the image.
                                Wait, the image shows "Model Action Manager (S)".
                                If I ignore it, maybe I shouldn't show it?
                                "And sort all managers... directly ignore that model action manager... then add shortcuts to THEM".
                                "THEM" implies the ones I sorted.
                                I'll keep it in the menu related to the image but maybe not enable the hotkey 
                                if the user wants no changes to it. 
                                But the image has (S), so I should probably render (S) for completeness. 
                            */}
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('globalSequence'); closeMenu() }}
                        >
                            <span>模型全局动作管理器</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>L</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleEditor('modelInfo'); closeMenu() }}
                        >
                            模型信息
                        </div>
                    </div>
                )}
            </div>

            {/* Mode Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('mode')}>
                模式
                {activeMenu === 'mode' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('view'); closeMenu() }}
                        >
                            <span>查看模式</span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ color: '#888', fontSize: '11px' }}>F1</span>
                                <span style={{ width: '12px' }}>{mainMode === 'view' ? '✓' : ''}</span>
                            </div>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('geometry'); closeMenu() }}
                        >
                            <span>顶点模式</span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ color: '#888', fontSize: '11px' }}>F2</span>
                                <span style={{ width: '12px' }}>{mainMode === 'geometry' ? '✓' : ''}</span>
                            </div>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('uv'); closeMenu() }}
                        >
                            <span>UV 模式</span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ color: '#888', fontSize: '11px' }}>F3</span>
                                <span style={{ width: '12px' }}>{mainMode === 'uv' ? '✓' : ''}</span>
                            </div>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('animation'); closeMenu() }}
                        >
                            <span>动画模式</span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ color: '#888', fontSize: '11px' }}>F4</span>
                                <span style={{ width: '12px' }}>{mainMode === 'animation' ? '✓' : ''}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* View Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('view')}>
                视图
                {activeMenu === 'view' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('perspective'); closeMenu() }}
                        >
                            <span>透视</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>0</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('top'); closeMenu() }}
                        >
                            <span>顶视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>1</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('bottom'); closeMenu() }}
                        >
                            <span>底视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>2</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('front'); closeMenu() }}
                        >
                            <span>前视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>3</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('back'); closeMenu() }}
                        >
                            <span>后视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>4</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('left'); closeMenu() }}
                        >
                            <span>左视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>5</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('right'); closeMenu() }}
                        >
                            <span>右视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>6</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Settings Menu Button - Direct Action */}
            <div
                style={{ ...menuStyle, backgroundColor: activeMenu === 'settings' ? '#444' : 'transparent' }}
                onClick={() => {
                    import('../store/rendererStore').then(({ useRendererStore }) => {
                        useRendererStore.getState().setShowSettingsPanel(true);
                    });
                }}
                onMouseEnter={hoverStyle}
                onMouseLeave={activeMenu !== 'settings' ? unhoverStyle : undefined}
            >
                设置
            </div>

            {/* Function Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('function')}>
                功能
                {activeMenu === 'function' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onRecalculateNormals(); closeMenu() }}
                        >
                            重新计算法线
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onRecalculateExtents(); closeMenu() }}
                        >
                            重新计算模型顶点范围
                        </div>
                    </div>
                )}
            </div>

            {/* Help Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('help')}>
                帮助
                {activeMenu === 'help' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleDebugConsole(); }}
                        >
                            <span>显示调试控制台</span>
                            <span>{showDebugConsole ? '✓' : ''}</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onCheckUpdate(); closeMenu() }}
                        >
                            检查更新
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onShowChangelog(); closeMenu() }}
                        >
                            更新日志
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onShowAbout(); closeMenu() }}
                        >
                            关于
                        </div>
                    </div>
                )}
            </div>
        </div >
    )
}

export default MenuBar
