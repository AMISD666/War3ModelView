import React, { useState, useRef, useEffect } from 'react'
import { Tooltip } from 'antd'
import {
    AimOutlined,
    AppstoreOutlined,
    GatewayOutlined,
    BgColorsOutlined,
    BorderOutlined,
    BulbOutlined,
    DeploymentUnitOutlined,
    FireOutlined,
    LinkOutlined,
    MinusOutlined,
    ToolOutlined
} from '@ant-design/icons'
import { getNextRenderMode, useRendererStore, type RenderMode } from '../store/rendererStore'
import { useSelectionStore } from '../store/selectionStore'
import { useUIStore } from '../store/uiStore'
import { uiText } from '../constants/uiText'

interface MenuBarProps {
    onOpen: () => void
    onSave: () => void | Promise<boolean>
    onSaveAs: () => void | Promise<boolean>
    onSwapMdlMdx: () => void | Promise<boolean>
    onExportMDL: () => void
    onExportMDX: () => void
    onOpenRecent: (path: string) => void
    recentFiles: { path: string; name: string; time: number }[]
    onClearRecentFiles: () => void
    teamColor: number
    onSelectTeamColor: (color: number) => void
    showGrid: boolean
    onToggleGrid: () => void
    showNodes: boolean
    onToggleNodes: () => void
    showSkeleton: boolean
    onToggleSkeleton: () => void
    renderMode: RenderMode
    onChangeRenderMode: (mode: RenderMode) => void
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
    showAttachments: boolean
    onToggleAttachments: () => void
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
    onMergeSameMaterials: () => void
    onCleanUnusedMaterials: () => void
    onCleanUnusedTextures: () => void
    onRepairModel: () => void
    onTransformModel: () => void
    onAddDeathAnimation: () => void
    onRemoveLights: () => void
    onCopyModel: () => void
}

const MenuBar: React.FC<MenuBarProps> = ({
    onOpen,
    onSave,
    onSaveAs,
    onSwapMdlMdx,
    onExportMDL,
    onExportMDX,
    onOpenRecent,
    recentFiles,
    onClearRecentFiles,
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
    showCollisionShapes,
    onToggleCollisionShapes,
    showCameras,
    onToggleCameras,
    showLights,
    onToggleLights,
    showAttachments,
    onToggleAttachments,
    onToggleEditor,
    mainMode,
    onSetMainMode,
    showDebugConsole,
    onToggleDebugConsole,
    onShowAbout,
    onShowChangelog,
    onRecalculateNormals,
    onRecalculateExtents,
    onCheckUpdate,
    onMergeSameMaterials,
    onCleanUnusedMaterials,
    onCleanUnusedTextures,
    onRepairModel,
    onTransformModel,
    onAddDeathAnimation,
    onRemoveLights,
    onCopyModel
}) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null)
    const [showRecentMenu, setShowRecentMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const showMpqBrowser = useUIStore(state => state.showMpqBrowser)
    const toggleMpqBrowser = useUIStore(state => state.toggleMpqBrowser)
    const showSettingsPanel = useRendererStore(state => state.showSettingsPanel)
    const setShowSettingsPanel = useRendererStore(state => state.setShowSettingsPanel)
    const {
        showGridXY: quickShowGridXY,
        setShowGridXY: setQuickShowGridXY,
        showGridXZ: quickShowGridXZ,
        setShowGridXZ: setQuickShowGridXZ,
        showGridYZ: quickShowGridYZ,
        setShowGridYZ: setQuickShowGridYZ,
        showVerticesByMode,
        setShowVerticesForMode,
        showVerticesInAnimationBinding,
        showVerticesInAnimationKeyframe,
        setShowVerticesForAnimationSubMode,
        showNodes: quickShowNodes,
        setShowNodes: setQuickShowNodes,
        nodeRenderMode,
        setNodeRenderMode,
        showSkeleton: quickShowSkeleton,
        setShowSkeleton: setQuickShowSkeleton,
        showGeosetVisibility: quickShowGeosetVisibility,
        setShowGeosetVisibility: setQuickShowGeosetVisibility,
        showCollisionShapes: quickShowCollisionShapes,
        setShowCollisionShapes: setQuickShowCollisionShapes,
        showLights: quickShowLights,
        setShowLights: setQuickShowLights,
        showParticles: quickShowParticles,
        setShowParticles: setQuickShowParticles,
        showRibbons: quickShowRibbons,
        setShowRibbons: setQuickShowRibbons,
        showHealthBar: quickShowHealthBar,
        setShowHealthBar: setQuickShowHealthBar
    } = useRendererStore((state) => ({
        showGridXY: state.showGridXY,
        setShowGridXY: state.setShowGridXY,
        showGridXZ: state.showGridXZ,
        setShowGridXZ: state.setShowGridXZ,
        showGridYZ: state.showGridYZ,
        setShowGridYZ: state.setShowGridYZ,
        showVerticesByMode: state.showVerticesByMode,
        setShowVerticesForMode: state.setShowVerticesForMode,
        showVerticesInAnimationBinding: state.showVerticesInAnimationBinding,
        showVerticesInAnimationKeyframe: state.showVerticesInAnimationKeyframe,
        setShowVerticesForAnimationSubMode: state.setShowVerticesForAnimationSubMode,
        showNodes: state.showNodes,
        setShowNodes: state.setShowNodes,
        nodeRenderMode: state.nodeRenderMode,
        setNodeRenderMode: state.setNodeRenderMode,
        showSkeleton: state.showSkeleton,
        setShowSkeleton: state.setShowSkeleton,
        showGeosetVisibility: state.showGeosetVisibility,
        setShowGeosetVisibility: state.setShowGeosetVisibility,
        showCollisionShapes: state.showCollisionShapes,
        setShowCollisionShapes: state.setShowCollisionShapes,
        showLights: state.showLights,
        setShowLights: state.setShowLights,
        showParticles: state.showParticles,
        setShowParticles: state.setShowParticles,
        showRibbons: state.showRibbons,
        setShowRibbons: state.setShowRibbons,
        showHealthBar: state.showHealthBar,
        setShowHealthBar: state.setShowHealthBar
    }))

    const { mainMode: currentMainMode, animationSubMode } = useSelectionStore((state) => ({
        mainMode: state.mainMode,
        animationSubMode: state.animationSubMode
    }))

    const quickShowVertices =
        currentMainMode === 'animation'
            ? (animationSubMode === 'binding' ? showVerticesInAnimationBinding : showVerticesInAnimationKeyframe)
            : (showVerticesByMode[currentMainMode] ?? true)

    const toggleQuickVertices = (next: boolean) => {
        if (currentMainMode === 'animation') {
            setShowVerticesForAnimationSubMode(animationSubMode, next)
            return
        }
        setShowVerticesForMode(currentMainMode, next)
    }

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
        color: '#eee',
        whiteSpace: 'nowrap'
    }

    const dropdownStyle: React.CSSProperties = {
        position: 'absolute',
        top: '100%',
        left: 0,
        backgroundColor: '#333',
        boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
        zIndex: 3200,
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
        ;(e.currentTarget as HTMLElement).style.backgroundColor = '#444'
    }

    const unhoverStyle = (e: React.MouseEvent) => {
        ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
    }

    const quickToggleItems: Array<{
        key: string
        label: string
        checked: boolean
        onToggle: () => void
        icon: React.ReactNode
        badge?: string
        statusLabel?: string
        tone?: 'default' | 'warning'
    }> = [
        { key: 'grid-xy', label: uiText.menu.quickToggle.xyGrid, checked: quickShowGridXY, onToggle: () => setQuickShowGridXY(!quickShowGridXY), icon: <AppstoreOutlined />, badge: 'XY' },
        { key: 'grid-xz', label: uiText.menu.quickToggle.xzGrid, checked: quickShowGridXZ, onToggle: () => setQuickShowGridXZ(!quickShowGridXZ), icon: <AppstoreOutlined />, badge: 'XZ' },
        { key: 'grid-yz', label: uiText.menu.quickToggle.yzGrid, checked: quickShowGridYZ, onToggle: () => setQuickShowGridYZ(!quickShowGridYZ), icon: <AppstoreOutlined />, badge: 'YZ' },
        { key: 'vertices', label: uiText.menu.quickToggle.vertices, checked: quickShowVertices, onToggle: () => toggleQuickVertices(!quickShowVertices), icon: <GatewayOutlined /> },
        {
            key: 'nodes',
            label: uiText.menu.quickToggle.nodes,
            checked: nodeRenderMode !== 'hidden',
            onToggle: () => setNodeRenderMode(nodeRenderMode === 'hidden' ? 'solid' : nodeRenderMode === 'solid' ? 'wireframe' : 'hidden'),
            icon: <AimOutlined />,
            statusLabel:
                nodeRenderMode === 'hidden'
                    ? uiText.menu.nodeRenderHidden
                    : nodeRenderMode === 'wireframe'
                        ? uiText.menu.nodeRenderWireframe
                        : uiText.menu.nodeRenderSolid,
            tone: nodeRenderMode === 'wireframe' ? 'warning' : 'default'
        },
        { key: 'skeleton', label: uiText.menu.quickToggle.skeleton, checked: quickShowSkeleton, onToggle: () => setQuickShowSkeleton(!quickShowSkeleton), icon: <DeploymentUnitOutlined /> },
        { key: 'geoset-tool', label: uiText.menu.quickToggle.geosetTool, checked: quickShowGeosetVisibility, onToggle: () => setQuickShowGeosetVisibility(!quickShowGeosetVisibility), icon: <ToolOutlined /> },
        { key: 'collision', label: uiText.menu.quickToggle.collision, checked: quickShowCollisionShapes, onToggle: () => setQuickShowCollisionShapes(!quickShowCollisionShapes), icon: <BorderOutlined /> },
        { key: 'lights', label: uiText.menu.quickToggle.lights, checked: quickShowLights, onToggle: () => setQuickShowLights(!quickShowLights), icon: <BulbOutlined /> },
        { key: 'particles', label: uiText.menu.quickToggle.particles, checked: quickShowParticles, onToggle: () => setQuickShowParticles(!quickShowParticles), icon: <FireOutlined /> },
        { key: 'ribbons', label: uiText.menu.quickToggle.ribbons, checked: quickShowRibbons, onToggle: () => setQuickShowRibbons(!quickShowRibbons), icon: <LinkOutlined /> },
        { key: 'health-bar', label: uiText.menu.quickToggle.healthBar, checked: quickShowHealthBar, onToggle: () => setQuickShowHealthBar(!quickShowHealthBar), icon: <MinusOutlined /> },
        {
            key: 'render-mode',
            label: uiText.menu.quickToggle.wireframe,
            checked: renderMode !== 'textured',
            onToggle: () => onChangeRenderMode(getNextRenderMode(renderMode)),
            icon: <BgColorsOutlined />
        }
    ]

    const quickBtnStyle = (checked: boolean, tone: 'default' | 'warning' = 'default'): React.CSSProperties => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        minWidth: 26,
        height: 22,
        padding: '0 6px',
        borderRadius: 4,
        border: checked ? (tone === 'warning' ? '1px solid #d4a106' : '1px solid #2f7dff') : '1px solid #555',
        backgroundColor: checked ? (tone === 'warning' ? '#6b5200' : '#1f4f9f') : '#303030',
        color: checked ? (tone === 'warning' ? '#ffe58f' : '#fff') : '#bfbfbf',
        cursor: 'pointer',
        fontSize: 11,
        lineHeight: 1
    })

    return (
        <div
            ref={menuRef}
            style={{
                display: 'flex',
                position: 'relative',
                zIndex: 3100,
                backgroundColor: '#2b2b2b',
                borderBottom: '1px solid #444',
                height: '30px',
                alignItems: 'center',
                fontSize: '13px'
            }}
        >
            <div style={menuStyle} onClick={() => toggleMenu('file')}>
                {uiText.menu.file}
                {activeMenu === 'file' && (
                    <div style={dropdownStyle}>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onOpen(); closeMenu() }}>
                            <span>{uiText.menu.importModel}</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+O</span>
                        </div>
                        <div
                            style={{ ...itemStyle, position: 'relative' }}
                            onMouseEnter={(e) => { hoverStyle(e); setShowRecentMenu(true) }}
                            onMouseLeave={(e) => { unhoverStyle(e); setShowRecentMenu(false) }}
                        >
                            <span>{uiText.menu.recentFiles}</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>▶</span>
                            {showRecentMenu && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: '100%',
                                        backgroundColor: '#333',
                                        boxShadow: '2px 2px 8px rgba(0,0,0,0.6)',
                                        zIndex: 3300,
                                        minWidth: '320px',
                                        maxWidth: '480px',
                                        padding: '5px 0',
                                        border: '1px solid #444'
                                    }}
                                >
                                    {recentFiles.length === 0 ? (
                                        <div style={{ padding: '8px 15px', color: '#666', fontSize: '12px' }}>{uiText.menu.noRecentFiles}</div>
                                    ) : (
                                        recentFiles.map((f, i) => (
                                            <div
                                                key={f.path}
                                                style={{
                                                    padding: '7px 15px',
                                                    cursor: 'pointer',
                                                    color: '#ddd',
                                                    fontSize: '12px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    display: 'flex',
                                                    gap: 8,
                                                    alignItems: 'center'
                                                }}
                                                title={f.path}
                                                onMouseEnter={hoverStyle}
                                                onMouseLeave={unhoverStyle}
                                                onClick={() => { onOpenRecent(f.path); closeMenu() }}
                                            >
                                                <span style={{ color: '#666', minWidth: 16, textAlign: 'right', fontSize: 11 }}>{i + 1}.</span>
                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                                <span style={{ color: '#555', fontSize: 10, flexShrink: 0 }}>
                                                    {f.path.length > 50 ? '...' + f.path.slice(-48) : f.path}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                    {recentFiles.length > 0 && (
                                        <>
                                            <div style={{ borderTop: '1px solid #444', margin: '4px 0' }} />
                                            <div
                                                style={{ padding: '7px 15px', cursor: 'pointer', color: '#888', fontSize: '12px' }}
                                                onMouseEnter={hoverStyle}
                                                onMouseLeave={unhoverStyle}
                                                onClick={() => { onClearRecentFiles(); closeMenu() }}
                                            >
                                                {uiText.menu.clearRecentFiles}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onSave(); closeMenu() }}>
                            <span>{uiText.menu.saveModel}</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+S</span>
                        </div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onCopyModel(); closeMenu() }}>
                            <span>{uiText.menu.copyModel}</span>
                            <span style={{ color: '#888', fontSize: '11px' }}>Shift+C</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }} />
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { void onSwapMdlMdx(); closeMenu() }}>
                            {uiText.menu.swapMdlMdx}
                        </div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onExportMDL(); closeMenu() }}>
                            {uiText.menu.exportMdl}
                        </div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onExportMDX(); closeMenu() }}>
                            {uiText.menu.exportMdx}
                        </div>
                    </div>
                )}
            </div>

            <div style={menuStyle} onClick={() => toggleMenu('edit')}>
                {uiText.menu.edit}
                {activeMenu === 'edit' && (
                    <div style={dropdownStyle}>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('nodeManager'); closeMenu() }}><span>{uiText.menu.nodeManager}</span><span style={{ color: '#888', fontSize: '11px' }}>N</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('camera'); closeMenu() }}><span>{uiText.menu.cameraManager}</span><span style={{ color: '#888', fontSize: '11px' }}>C</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('geoset'); closeMenu() }}><span>{uiText.menu.geosetManager}</span><span style={{ color: '#888', fontSize: '11px' }}>G</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('geosetAnim'); closeMenu() }}><span>{uiText.menu.geosetAnimationManager}</span><span style={{ color: '#888', fontSize: '11px' }}>E</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('texture'); closeMenu() }}><span>{uiText.menu.textureManager}</span><span style={{ color: '#888', fontSize: '11px' }}>T</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('textureAnim'); closeMenu() }}><span>{uiText.menu.textureAnimationManager}</span><span style={{ color: '#888', fontSize: '11px' }}>X</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('material'); closeMenu() }}><span>{uiText.menu.materialManager}</span><span style={{ color: '#888', fontSize: '11px' }}>M</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('sequence'); closeMenu() }}><span>{uiText.menu.sequenceManager}</span><span style={{ color: '#888', fontSize: '11px' }}>S</span></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('globalSequence'); closeMenu() }}><span>{uiText.menu.globalSequenceManager}</span><span style={{ color: '#888', fontSize: '11px' }}>L</span></div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }} />
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('modelInfo'); closeMenu() }}>{uiText.menu.modelInfo}</div>
                    </div>
                )}
            </div>

            <div style={menuStyle} onClick={() => toggleMenu('mode')}>
                {uiText.menu.mode}
                {activeMenu === 'mode' && (
                    <div style={dropdownStyle}>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onSetMainMode('view'); closeMenu() }}><span>{uiText.menu.viewMode}</span><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><span style={{ color: '#888', fontSize: '11px' }}>1</span><span style={{ width: '12px' }}>{mainMode === 'view' ? '✓' : ''}</span></div></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onSetMainMode('geometry'); closeMenu() }}><span>{uiText.menu.geometryMode}</span><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><span style={{ color: '#888', fontSize: '11px' }}>2</span><span style={{ width: '12px' }}>{mainMode === 'geometry' ? '✓' : ''}</span></div></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onSetMainMode('uv'); closeMenu() }}><span>{uiText.menu.uvMode}</span><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><span style={{ color: '#888', fontSize: '11px' }}>3</span><span style={{ width: '12px' }}>{mainMode === 'uv' ? '✓' : ''}</span></div></div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onSetMainMode('animation'); closeMenu() }}><span>{uiText.menu.animationMode}</span><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><span style={{ color: '#888', fontSize: '11px' }}>4</span><span style={{ width: '12px' }}>{mainMode === 'animation' ? '✓' : ''}</span></div></div>
                    </div>
                )}
            </div>

            <div style={menuStyle} onClick={() => toggleMenu('function')}>
                {uiText.menu.tools}
                {activeMenu === 'function' && (
                    <div style={dropdownStyle}>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onRecalculateNormals(); closeMenu() }}>{uiText.menu.recalculateNormals}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onRecalculateExtents(); closeMenu() }}>{uiText.menu.recalculateExtents}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onTransformModel(); closeMenu() }}>{uiText.menu.transformModel}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('modelOptimize'); closeMenu() }}>{uiText.menu.modelOptimize}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('modelMerge'); closeMenu() }}>{uiText.menu.modelMerge}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('globalColorAdjust'); closeMenu() }}>{uiText.menu.globalColorAdjust}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('geosetVisibilityTool'); closeMenu() }}>{uiText.menu.geosetVisibilityTool}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleEditor('dissolveEffect'); closeMenu() }}>{uiText.menu.dissolveEffect}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onAddDeathAnimation(); closeMenu() }}>{uiText.menu.addDeathAnimation}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onRemoveLights(); closeMenu() }}>{uiText.menu.removeLights}</div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }} />
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onRepairModel(); closeMenu() }}>{uiText.menu.repairModel}</div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }} />
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onMergeSameMaterials(); closeMenu() }}>{uiText.menu.mergeSameMaterials}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onCleanUnusedMaterials(); closeMenu() }}>{uiText.menu.cleanUnusedMaterials}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onCleanUnusedTextures(); closeMenu() }}>{uiText.menu.cleanUnusedTextures}</div>
                    </div>
                )}
            </div>

            <div
                style={{ ...menuStyle, backgroundColor: showMpqBrowser ? '#444' : 'transparent' }}
                onClick={toggleMpqBrowser}
                onMouseEnter={hoverStyle}
                onMouseLeave={!showMpqBrowser ? unhoverStyle : undefined}
            >
                {uiText.menu.mpqBrowser}
            </div>

            <div
                style={{ ...menuStyle, backgroundColor: showSettingsPanel ? '#444' : 'transparent' }}
                onClick={() => setShowSettingsPanel(!showSettingsPanel)}
                onMouseEnter={hoverStyle}
                onMouseLeave={!showSettingsPanel ? unhoverStyle : undefined}
            >
                {uiText.menu.settings}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8, flexShrink: 0 }}>
                {quickToggleItems.map((item) => (
                    <Tooltip
                        key={item.key}
                        title={`${item.label}：${item.statusLabel ?? (item.checked ? uiText.menu.statusOn : uiText.menu.statusOff)}`}
                        mouseEnterDelay={0.15}
                    >
                        <button
                            type="button"
                            onClick={item.onToggle}
                            style={quickBtnStyle(item.checked, item.tone)}
                        >
                            {item.icon}
                            {item.badge && <span style={{ fontSize: 9, fontWeight: 600 }}>{item.badge}</span>}
                        </button>
                    </Tooltip>
                ))}
            </div>

            <div style={{ flex: 1 }} />

            <div style={menuStyle} onClick={() => toggleMenu('help')}>
                {uiText.menu.help}
                {activeMenu === 'help' && (
                    <div style={{ ...dropdownStyle, left: 'auto', right: 0 }}>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onToggleDebugConsole() }}>
                            <span>{uiText.menu.debugConsole}</span>
                            <span>{showDebugConsole ? '✓' : ''}</span>
                        </div>
                        <div style={{ borderTop: '1px solid #444', margin: '5px 0' }} />
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onCheckUpdate(); closeMenu() }}>{uiText.menu.checkUpdate}</div>
                        <div style={itemStyle} onMouseEnter={hoverStyle} onMouseLeave={unhoverStyle} onClick={() => { onShowAbout(); closeMenu() }}>{uiText.menu.about}</div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default MenuBar
