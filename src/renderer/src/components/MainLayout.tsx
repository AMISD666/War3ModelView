import React, { useState, useCallback, useEffect } from 'react'
import Viewer from './Viewer'
import AnimationPanel from './AnimationPanel'
import MenuBar from './MenuBar'
import EditorPanel from './EditorPanel'
import { open } from '@tauri-apps/plugin-dialog'
import { generateMDL, generateMDX } from 'war3-model'
import { useModelStore } from '../store/modelStore'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'

const MainLayout: React.FC = () => {
    // Zustand stores
    const {
        modelPath,
        setModelData: setZustandModelData,
        setLoading: setZustandLoading,
        currentSequence,
        isPlaying,
        setPlaying
    } = useModelStore()
    const { toggleNodeManager, toggleModelInfo } = useUIStore()
    const { mainMode, setMainMode } = useSelectionStore()

    // Load settings from localStorage
    const loadSetting = <T,>(key: string, defaultValue: T): T => {
        const saved = localStorage.getItem(key)
        if (saved !== null) {
            try {
                return JSON.parse(saved)
            } catch (e) {
                console.warn(`Failed to parse setting ${key}:`, e)
            }
        }
        return defaultValue
    }

    const [activeEditor, setActiveEditor] = useState<string | null>(null)
    // Use modelData directly from store to ensure updates from NodeManager are reflected
    const modelData = useModelStore(state => state.modelData)


    // Persistent settings
    const [teamColor, setTeamColor] = useState<number>(() => loadSetting('teamColor', 0))
    const [showGrid, setShowGrid] = useState<boolean>(() => loadSetting('showGrid', true))
    const [showNodes, setShowNodes] = useState<boolean>(false)
    const [showSkeleton, setShowSkeleton] = useState<boolean>(false)
    const [renderMode, setRenderMode] = useState<'textured' | 'wireframe'>(() => loadSetting('renderMode', 'textured'))
    const [backgroundColor, setBackgroundColor] = useState<string>(() => loadSetting('backgroundColor', '#000000'))
    const [showFPS, setShowFPS] = useState<boolean>(() => loadSetting('showFPS', false))
    const [viewPreset, setViewPreset] = useState<{ type: string, time: number } | null>(null)

    const [isLoading, setIsLoading] = useState<boolean>(false)

    // Editor Panel Resizing
    const [editorWidth, setEditorWidth] = useState<number>(400)
    const [isResizingEditor, setIsResizingEditor] = useState<boolean>(false)

    const handleEditorResizeStart = (e: React.MouseEvent) => {
        setIsResizingEditor(true)
        e.preventDefault()
    }

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingEditor) return
            const newWidth = window.innerWidth - e.clientX
            if (newWidth >= 300 && newWidth <= 800) {
                setEditorWidth(newWidth)
            }
        }

        const handleMouseUp = () => {
            setIsResizingEditor(false)
        }

        if (isResizingEditor) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizingEditor])

    // Save settings when they change
    useEffect(() => localStorage.setItem('teamColor', JSON.stringify(teamColor)), [teamColor])
    useEffect(() => localStorage.setItem('showGrid', JSON.stringify(showGrid)), [showGrid])
    useEffect(() => localStorage.setItem('showNodes', JSON.stringify(showNodes)), [showNodes])
    useEffect(() => localStorage.setItem('showSkeleton', JSON.stringify(showSkeleton)), [showSkeleton])
    useEffect(() => localStorage.setItem('renderMode', JSON.stringify(renderMode)), [renderMode])
    useEffect(() => localStorage.setItem('backgroundColor', JSON.stringify(backgroundColor)), [backgroundColor])
    useEffect(() => localStorage.setItem('showFPS', JSON.stringify(showFPS)), [showFPS])

    // Auto-load MPQs
    useEffect(() => {
        const loadSavedMpqs = async () => {
            const { invoke } = await import('@tauri-apps/api/core')
            const savedPaths = localStorage.getItem('mpq_paths')

            if (savedPaths) {
                try {
                    const paths = JSON.parse(savedPaths)
                    let count = 0
                    for (const path of paths) {
                        await invoke('load_mpq', { path })
                        count++
                    }
                } catch (e) {
                    console.error('[MainLayout] Failed to auto-load saved MPQs:', e)
                }
            } else {
                // Try auto-detection from Registry
                try {
                    console.log('[MainLayout] Attempting to auto-detect Warcraft III path...')
                    const installPath = await invoke<string>('detect_warcraft_path')
                    if (installPath) {
                        console.log('[MainLayout] Detected Warcraft III path:', installPath)
                        const mpqs = ['war3.mpq', 'War3Patch.mpq', 'War3x.mpq', 'War3xLocal.mpq']
                        // Ensure path ends with backslash
                        const basePath = installPath.endsWith('\\') ? installPath : `${installPath}\\`

                        const pathsToLoad = mpqs.map(mpq => `${basePath}${mpq}`)
                        const validPaths: string[] = []

                        let count = 0
                        for (const path of pathsToLoad) {
                            try {
                                await invoke('load_mpq', { path })
                                validPaths.push(path)
                                count++
                                console.log(`[MainLayout] Loaded ${path}`)
                            } catch (e) {
                                console.warn(`[MainLayout] Failed to load ${path}:`, e)
                            }
                        }

                        if (count > 0) {
                            // Save found paths to localStorage so user can see/manage them later if we add a manager
                            localStorage.setItem('mpq_paths', JSON.stringify(validPaths))
                            // alert(`已自动检测并加载了 ${count} 个魔兽争霸 MPQ 文件！`)
                        }
                    }
                } catch (e) {
                    console.log('[MainLayout] Auto-detection failed (registry key not found or error):', e)
                }
            }
        }
        loadSavedMpqs()
    }, [])

    const handleImport = useCallback(async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: '魔兽争霸3模型',
                    extensions: ['mdx', 'mdl']
                }]
            })

            if (selected && typeof selected === 'string') {
                setIsLoading(true)
                setZustandLoading(true)
                // Clear modelData to ensure fresh load from file
                setZustandModelData(null, selected)

                setIsLoading(false)
                setZustandLoading(false)
            }
        } catch (error) {
            console.error('Failed to open file dialog:', error)
            setIsLoading(false)
            setZustandLoading(false)
        }
    }, [setZustandModelData, setZustandLoading])

    const handleModelLoaded = useCallback((data: any) => {
        console.log('Model loaded:', data)
        // setModelData(data) // No longer needed as we use store
        setZustandModelData(data, data.path || modelPath) // Ensure store is updated
        setIsLoading(false)
        setZustandLoading(false)

        // Auto-play first animation if available
        if (data && data.Sequences && data.Sequences.length > 0) {
            // Use a small timeout to ensure the renderer is ready
            setTimeout(() => {
                console.log('[MainLayout] Auto-playing first animation')
                useModelStore.getState().setSequence(0)
                useModelStore.getState().setPlaying(true)
            }, 300)
        }


        // Reset State on New Model Load
        setMainMode('view')
        useSelectionStore.getState().clearAllSelections()
        useModelStore.getState().setSequence(-1)
        setPlaying(false)
        // Reset Camera (using a custom event or store if possible, but for now we rely on Viewer's internal reset if path changes)
        // Actually Viewer handles camera reset on new model path if we implement it there, 
        // but we can also force it here if we had access. 
        // For now, the Viewer component will see the new modelPath and re-init.
    }, [setZustandModelData, setZustandLoading, modelPath, setMainMode, setPlaying])



    const handleOpen = handleImport // Alias for MenuBar

    const handleLoadMPQ = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog')
            const { invoke } = await import('@tauri-apps/api/core')

            const selected = await open({
                multiple: true,
                filters: [{
                    name: 'Warcraft 3 Archives',
                    extensions: ['mpq']
                }]
            })

            if (selected) {
                const paths = Array.isArray(selected) ? selected : [selected]

                // Save to localStorage
                localStorage.setItem('mpq_paths', JSON.stringify(paths))

                let count = 0
                for (const path of paths) {
                    if (path) {
                        await invoke('load_mpq', { path })
                        count++
                    }
                }
                if (count > 0) {
                    alert(`成功加载 ${count} 个 MPQ 文件！\n已保存路径，下次启动将自动加载。`)
                }
            }
        } catch (err) {
            console.error('Failed to load MPQ:', err)
            alert('加载 MPQ 失败: ' + err)
        }
    }

    const handleSave = async () => {
        if (!modelPath || !modelData) return
        try {
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            if (modelPath.toLowerCase().endsWith('.mdl')) {
                const content = generateMDL(modelData as any)
                await writeFile(modelPath, new TextEncoder().encode(content))
            } else {
                const buffer = generateMDX(modelData as any)
                await writeFile(modelPath, new Uint8Array(buffer))
            }

            alert('模型已保存')
        } catch (err) {
            console.error('Failed to save file:', err)
            alert('保存失败: ' + err)
        }
    }

    const handleSaveAs = async () => {
        if (!modelData) return
        try {
            const { save } = await import('@tauri-apps/plugin-dialog')
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            const selected = await save({
                filters: [{
                    name: 'Warcraft 3 Models',
                    extensions: ['mdx', 'mdl']
                }]
            })

            if (selected) {
                if (selected.toLowerCase().endsWith('.mdl')) {
                    const content = generateMDL(modelData as any)
                    await writeFile(selected, new TextEncoder().encode(content))
                } else {
                    const buffer = generateMDX(modelData as any)
                    await writeFile(selected, new Uint8Array(buffer))
                }
                // Update store with new path if needed, but for now just alert
                alert('模型已另存为: ' + selected)
            }
        } catch (err) {
            console.error('Failed to save file as:', err)
            alert('另存为失败: ' + err)
        }
    }

    const toggleEditor = (editor: string) => {
        setActiveEditor(activeEditor === editor ? null : editor)
    }

    // Debug Console State
    const [showDebugConsole, setShowDebugConsole] = useState<boolean>(() => loadSetting('showDebugConsole', false))
    const [showAbout, setShowAbout] = useState<boolean>(false)

    useEffect(() => {
        localStorage.setItem('showDebugConsole', JSON.stringify(showDebugConsole))
        // Invoke Rust command to toggle console with a slight delay to ensure window is ready
        const timer = setTimeout(() => {
            import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('toggle_console', { show: showDebugConsole }).catch(e => console.error('Failed to toggle console:', e))
            })
        }, 200)
        return () => clearTimeout(timer)
    }, [showDebugConsole])

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            width: '100%',
            overflow: 'hidden',
            backgroundColor: '#1e1e1e',
            color: '#eee',
            fontFamily: 'Segoe UI, sans-serif'
        }}>
            <MenuBar
                onOpen={handleOpen}
                onSave={handleSave}
                onSaveAs={handleSaveAs}
                onLoadMPQ={handleLoadMPQ}
                teamColor={teamColor}
                onSelectTeamColor={setTeamColor}
                showGrid={showGrid}
                onToggleGrid={() => setShowGrid(!showGrid)}
                showNodes={showNodes}
                onToggleNodes={() => setShowNodes(!showNodes)}
                showSkeleton={showSkeleton}
                onToggleSkeleton={() => setShowSkeleton(!showSkeleton)}
                renderMode={renderMode}
                onChangeRenderMode={setRenderMode}
                backgroundColor={backgroundColor}
                onChangeBackgroundColor={setBackgroundColor}
                showFPS={showFPS}
                onToggleFPS={() => setShowFPS(!showFPS)}
                onSetViewPreset={(preset) => setViewPreset({ type: preset, time: Date.now() })}
                onToggleEditor={(editor) => {
                    console.log('[MainLayout] onToggleEditor called with:', editor)
                    if (editor === 'nodeManager') {
                        toggleNodeManager()
                    } else if (editor === 'modelInfo') {
                        toggleModelInfo()
                    } else {
                        console.log('[MainLayout] Toggling editor:', editor)
                        toggleEditor(editor)
                    }
                }}
                mainMode={mainMode}
                onSetMainMode={setMainMode}
                showDebugConsole={showDebugConsole}
                onToggleDebugConsole={() => setShowDebugConsole(!showDebugConsole)}
                onShowAbout={() => setShowAbout(true)}
            />

            {/* About Dialog */}
            {showAbout && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2000
                }} onClick={() => setShowAbout(false)}>
                    <div style={{
                        backgroundColor: '#333',
                        padding: '20px',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        minWidth: '300px',
                        textAlign: 'center',
                        border: '1px solid #555'
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, marginBottom: '15px' }}>关于</h3>
                        <p style={{ fontSize: '18px', margin: '20px 0' }}>测试1.0</p>
                        <button
                            onClick={() => setShowAbout(false)}
                            style={{
                                padding: '6px 16px',
                                backgroundColor: '#007acc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            确定
                        </button>
                    </div>
                </div>
            )}

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {/* Left Panel - Animation & Browser */}
                <div style={{ width: '280px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
                    <AnimationPanel
                        onImport={handleImport}
                    />
                </div>

                {/* Center - 3D Viewer */}
                <div style={{ flex: 1, position: 'relative', backgroundColor }}>
                    <Viewer
                        modelPath={modelPath} // Use path from store
                        modelData={modelData}
                        teamColor={teamColor}
                        showGrid={showGrid}
                        showNodes={showNodes}
                        showSkeleton={showSkeleton}
                        showWireframe={renderMode === 'wireframe'}
                        backgroundColor={backgroundColor}
                        animationIndex={currentSequence} // Use sequence from store
                        isPlaying={isPlaying} // Use playing state from store
                        onTogglePlay={() => setPlaying(!isPlaying)}
                        onModelLoaded={handleModelLoaded}
                        showFPS={showFPS}
                        viewPreset={viewPreset}
                    />

                    {isLoading && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            zIndex: 10
                        }}>
                            加载中...
                        </div>
                    )}
                </div>

                {/* Right Panel - Editors */}
                {activeEditor && (
                    <div style={{
                        width: editorWidth,
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: '1px solid #333',
                        backgroundColor: '#222',
                        position: 'relative' // Needed for resize handle
                    }}>
                        {/* Resize Handle */}
                        <div
                            onMouseDown={handleEditorResizeStart}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: '4px',
                                cursor: 'ew-resize',
                                zIndex: 100,
                                backgroundColor: isResizingEditor ? '#007acc' : 'transparent',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => { if (!isResizingEditor) e.currentTarget.style.backgroundColor = '#007acc40' }}
                            onMouseLeave={(e) => { if (!isResizingEditor) e.currentTarget.style.backgroundColor = 'transparent' }}
                        />
                        <EditorPanel
                            activeTab={activeEditor}
                            onClose={() => setActiveEditor(null)}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

export default MainLayout
