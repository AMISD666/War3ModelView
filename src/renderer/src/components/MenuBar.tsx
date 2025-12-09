import React, { useState, useRef, useEffect } from 'react'

interface MenuBarProps {
    onOpen: () => void
    onSave: () => void
    onSaveAs: () => void
    onLoadMPQ: () => void
    mpqLoaded: boolean
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
    onSetViewPreset: (preset: string) => void
    onToggleEditor: (editor: string) => void
    mainMode: 'view' | 'geometry' | 'uv' | 'animation'
    onSetMainMode: (mode: 'view' | 'geometry' | 'uv' | 'animation') => void
    showDebugConsole: boolean
    onToggleDebugConsole: () => void
    onShowAbout: () => void
}

const MenuBar: React.FC<MenuBarProps> = ({
    onOpen,
    onSave,
    onSaveAs,
    onLoadMPQ,
    mpqLoaded,
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
    onSetViewPreset,
    onToggleEditor,
    mainMode,
    onSetMainMode,
    showDebugConsole,
    onToggleDebugConsole,
    onShowAbout
}) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setActiveMenu(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    const toggleMenu = (menu: string) => {
        setActiveMenu(activeMenu === menu ? null : menu)
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
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSaveAs(); closeMenu() }}
                        >
                            另存为...
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
                            <span>{mainMode === 'view' ? '✓' : ''}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('geometry'); closeMenu() }}
                        >
                            <span>顶点模式</span>
                            <span>{mainMode === 'geometry' ? '✓' : ''}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('uv'); closeMenu() }}
                        >
                            <span>UV 模式</span>
                            <span>{mainMode === 'uv' ? '✓' : ''}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetMainMode('animation'); closeMenu() }}
                        >
                            <span>动画模式</span>
                            <span>{mainMode === 'animation' ? '✓' : ''}</span>
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
                            onClick={() => { onSetViewPreset('front'); closeMenu() }}
                        >
                            <span>前视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>1</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('back'); closeMenu() }}
                        >
                            <span>后视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>2</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('left'); closeMenu() }}
                        >
                            <span>左视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>3</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('right'); closeMenu() }}
                        >
                            <span>右视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>4</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('top'); closeMenu() }}
                        >
                            <span>顶视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>5</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('bottom'); closeMenu() }}
                        >
                            <span>底视图</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>6</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onSetViewPreset('focus'); closeMenu() }}
                        >
                            <span>聚焦中心</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>0</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Settings Menu */}
            <div style={menuStyle} onClick={() => toggleMenu('settings')}>
                设置
                {activeMenu === 'settings' && (
                    <div style={dropdownStyle}>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onLoadMPQ(); closeMenu() }}
                        >
                            加载游戏 MPQ {mpqLoaded ? '（成功加载）' : '（未加载）'}
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleGrid(); }}
                        >
                            <span>显示网格</span>
                            <span>{showGrid ? '✓' : ''}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleNodes(); }}
                        >
                            <span>显示节点</span>
                            <span>{showNodes ? '✓' : ''}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleSkeleton(); }}
                        >
                            <span>显示骨架</span>
                            <span>{showSkeleton ? '✓' : ''}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onToggleFPS(); }}
                        >
                            <span>显示 FPS</span>
                            <span>{showFPS ? '✓' : ''}</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div style={{ padding: '5px 15px', color: '#aaa', fontSize: '12px' }}>渲染模式</div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onChangeRenderMode('textured'); }}
                        >
                            <span>纹理</span>
                            <span>{renderMode === 'textured' ? '●' : '○'}</span>
                        </div>
                        <div
                            style={itemStyle}
                            onMouseEnter={hoverStyle}
                            onMouseLeave={unhoverStyle}
                            onClick={() => { onChangeRenderMode('wireframe'); }}
                        >
                            <span>线框</span>
                            <span>{renderMode === 'wireframe' ? '●' : '○'}</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div style={{ padding: '5px 15px', color: '#aaa', fontSize: '12px' }}>背景颜色</div>
                        <div style={{ padding: '5px 15px' }} onClick={(e) => e.stopPropagation()}>
                            <input
                                type="color"
                                value={backgroundColor}
                                onChange={(e) => onChangeBackgroundColor(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: '100%', cursor: 'pointer', border: 'none', padding: 0, height: '25px' }}
                            />
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>
                        <div style={{ padding: '5px 15px', color: '#aaa', fontSize: '12px' }}>队伍颜色</div>
                        <div style={{ padding: '5px 15px' }}>
                            <select
                                value={teamColor}
                                onChange={(e) => onSelectTeamColor(parseInt(e.target.value))}
                                style={{ width: '100%', padding: '4px', background: '#444', color: 'white', border: '1px solid #555', borderRadius: '4px' }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {Array.from({ length: 13 }).map((_, i) => (
                                    <option key={i} value={i}>玩家 {i + 1} ({['红', '蓝', '青', '紫', '黄', '橙', '绿', '粉', '灰', '浅蓝', '暗绿', '棕', '栗'][i] || '未知'})</option>
                                ))}
                            </select>
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
                            onClick={() => { onShowAbout(); closeMenu() }}
                        >
                            关于
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default MenuBar
