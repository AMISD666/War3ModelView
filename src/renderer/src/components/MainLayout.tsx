import React, { useState, useCallback, useEffect, useRef } from 'react'
import Viewer, { ViewerRef } from './Viewer'
import AnimationPanel from './AnimationPanel'
import MenuBar from './MenuBar'
import EditorPanel from './EditorPanel'
import GeosetAnimationModal from './modals/GeosetAnimationModal'
import TextureEditorModal from './modals/TextureEditorModal'
import TextureAnimationManagerModal from './modals/TextureAnimationManagerModal'
import SequenceEditorModal from './modals/SequenceEditorModal'
import CameraManagerModal from './modals/CameraManagerModal'

import MaterialEditorModal from './modals/MaterialEditorModal'
import GeosetEditorModal from './modals/GeosetEditorModal'
import GlobalSequenceModal from './modals/GlobalSequenceModal'
import { GeosetVisibilityPanel } from './GeosetVisibilityPanel'
import { open } from '@tauri-apps/plugin-dialog'
import { generateMDL, generateMDX } from 'war3-model'
import { useModelStore } from '../store/modelStore'
import { NodeType } from '../types/node'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'

/**
 * Normalize model data before saving to ensure typed arrays are correct.
 * The war3-model library expects Uint32Array for Intervals and Float32Array for extents,
 * but JSON.stringify/parse (used for cloning in editors) converts these to regular arrays.
 * 
 * Uses structuredClone to preserve existing typed arrays while only converting
 * regular arrays that need to be typed arrays.
 */
function prepareModelDataForSave(modelData: any): any {
    if (!modelData) return modelData;

    // Use structuredClone to preserve typed arrays (available in modern browsers)
    // Falls back to the original data if structuredClone isn't available
    let data: any;
    try {
        data = structuredClone(modelData);
    } catch {
        // Fallback: work with original data (will mutate it)
        console.warn('[MainLayout] structuredClone not available, modifying original data');
        data = modelData;
    }

    // Helper to convert array-like to typed array if needed
    const toUint32Array = (arr: any): Uint32Array => {
        if (arr instanceof Uint32Array) return arr;
        if (Array.isArray(arr)) return new Uint32Array(arr);
        // Handle object-like {"0": x, "1": y} from bad clones
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint32Array(values);
        }
        return new Uint32Array([0, 0]);
    };

    const toFloat32Array = (arr: any, size: number = 3): Float32Array => {
        if (arr instanceof Float32Array) return arr;
        if (Array.isArray(arr)) return new Float32Array(arr);
        // Handle object-like {"0": x, "1": y, "2": z} from bad clones
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Float32Array(values);
        }
        return new Float32Array(size);
    };

    const toUint16Array = (arr: any): Uint16Array => {
        if (arr instanceof Uint16Array) return arr;
        if (Array.isArray(arr)) return new Uint16Array(arr);
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint16Array(values);
        }
        return new Uint16Array(0);
    };

    const toUint8Array = (arr: any): Uint8Array => {
        if (arr instanceof Uint8Array) return arr;
        if (Array.isArray(arr)) return new Uint8Array(arr);
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint8Array(values);
        }
        return new Uint8Array(0);
    };

    // Fix Sequences - most critical for animation fix
    if (data.Sequences && Array.isArray(data.Sequences)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Sequences.length} sequences`);
        data.Sequences.forEach((seq: any, index: number) => {
            // Always log interval info for debugging
            const intervalType = seq.Interval ? (seq.Interval instanceof Uint32Array ? 'Uint32Array' : Array.isArray(seq.Interval) ? 'Array' : typeof seq.Interval) : 'undefined';
            const intervalValues = seq.Interval ? `[${seq.Interval[0]}, ${seq.Interval[1]}]` : 'N/A';
            console.log(`[MainLayout] Sequence ${index} "${seq.Name}" Interval (${intervalType}): ${intervalValues}`);

            if (seq.Interval && !(seq.Interval instanceof Uint32Array)) {
                seq.Interval = toUint32Array(seq.Interval);
                console.log(`[MainLayout] -> Converted to Uint32Array: [${seq.Interval[0]}, ${seq.Interval[1]}]`);
            }
            if (seq.MinimumExtent && !(seq.MinimumExtent instanceof Float32Array)) {
                seq.MinimumExtent = toFloat32Array(seq.MinimumExtent);
            }
            if (seq.MaximumExtent && !(seq.MaximumExtent instanceof Float32Array)) {
                seq.MaximumExtent = toFloat32Array(seq.MaximumExtent);
            }
        });
    }

    // Fix Model Info extents
    if (data.Info) {
        if (data.Info.MinimumExtent && !(data.Info.MinimumExtent instanceof Float32Array)) {
            data.Info.MinimumExtent = toFloat32Array(data.Info.MinimumExtent);
        }
        if (data.Info.MaximumExtent && !(data.Info.MaximumExtent instanceof Float32Array)) {
            data.Info.MaximumExtent = toFloat32Array(data.Info.MaximumExtent);
        }
    }

    // Fix Geoset data
    if (data.Geosets && Array.isArray(data.Geosets)) {
        data.Geosets.forEach((geoset: any) => {
            if (geoset.Vertices && !(geoset.Vertices instanceof Float32Array)) {
                geoset.Vertices = toFloat32Array(geoset.Vertices, geoset.Vertices.length || 0);
            }
            if (geoset.Normals && !(geoset.Normals instanceof Float32Array)) {
                geoset.Normals = toFloat32Array(geoset.Normals, geoset.Normals.length || 0);
            }
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
            if (geoset.VertexGroup && !(geoset.VertexGroup instanceof Uint8Array)) {
                geoset.VertexGroup = toUint8Array(geoset.VertexGroup);
            }
            if (geoset.MinimumExtent && !(geoset.MinimumExtent instanceof Float32Array)) {
                geoset.MinimumExtent = toFloat32Array(geoset.MinimumExtent);
            }
            if (geoset.MaximumExtent && !(geoset.MaximumExtent instanceof Float32Array)) {
                geoset.MaximumExtent = toFloat32Array(geoset.MaximumExtent);
            }
            if (geoset.TVertices && Array.isArray(geoset.TVertices)) {
                geoset.TVertices = geoset.TVertices.map((tv: any) =>
                    tv instanceof Float32Array ? tv : toFloat32Array(tv, tv?.length || 0)
                );
            }
            if (geoset.Anims && Array.isArray(geoset.Anims)) {
                geoset.Anims.forEach((anim: any) => {
                    if (anim.MinimumExtent && !(anim.MinimumExtent instanceof Float32Array)) {
                        anim.MinimumExtent = toFloat32Array(anim.MinimumExtent);
                    }
                    if (anim.MaximumExtent && !(anim.MaximumExtent instanceof Float32Array)) {
                        anim.MaximumExtent = toFloat32Array(anim.MaximumExtent);
                    }
                });
            }
        });
    }

    // Fix PivotPoints
    if (data.PivotPoints && Array.isArray(data.PivotPoints)) {
        data.PivotPoints = data.PivotPoints.map((pp: any) =>
            pp instanceof Float32Array ? pp : toFloat32Array(pp)
        );
    }

    // Fix Node PivotPoints
    const nodeArrays = ['Nodes', 'Bones', 'Helpers', 'Attachments', 'Lights',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes', 'Cameras'];
    nodeArrays.forEach(key => {
        if (data[key] && Array.isArray(data[key])) {
            data[key].forEach((node: any) => {
                if (node.PivotPoint && !(node.PivotPoint instanceof Float32Array)) {
                    node.PivotPoint = toFloat32Array(node.PivotPoint);
                }
            });
        }
    });
    // Fix ParticleEmitter2 Flags - convert boolean properties to bitmask
    // ParticleEmitter2Flags: Unshaded=32768, SortPrimsFarZ=65536, LineEmitter=131072,
    //                        Unfogged=262144, ModelSpace=524288, XYQuad=1048576
    // ParticleEmitter2FramesFlags: Head=1, Tail=2  
    if (data.ParticleEmitters2 && Array.isArray(data.ParticleEmitters2)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.ParticleEmitters2.length} particle emitters`);
        data.ParticleEmitters2.forEach((emitter: any) => {
            // Reconstruct Flags bitmask from individual boolean properties
            let flags = emitter.Flags || 0;
            if (emitter.Unshaded === true) flags |= 32768;
            if (emitter.SortPrimsFarZ === true) flags |= 65536;
            if (emitter.LineEmitter === true) flags |= 131072;
            if (emitter.Unfogged === true) flags |= 262144;
            if (emitter.ModelSpace === true) flags |= 524288;
            if (emitter.XYQuad === true) flags |= 1048576;
            emitter.Flags = flags;

            // Reconstruct FrameFlags from Head/Tail booleans
            let frameFlags = emitter.FrameFlags || 0;
            if (emitter.Head === true) frameFlags |= 1;
            if (emitter.Tail === true) frameFlags |= 2;
            // Default to Head if neither is set
            if (frameFlags === 0) frameFlags = 1;
            emitter.FrameFlags = frameFlags;

            console.log(`[MainLayout] ParticleEmitter2 "${emitter.Name}": Flags=${flags}, FrameFlags=${frameFlags}`);
        });
    }

    return data;
}

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
    const [showGeosetAnimModal, setShowGeosetAnimModal] = useState<boolean>(false)
    const [showTextureModal, setShowTextureModal] = useState<boolean>(false)
    const [showTextureAnimModal, setShowTextureAnimModal] = useState<boolean>(false)
    const [showSequenceModal, setShowSequenceModal] = useState<boolean>(false)
    const [showCameraModal, setShowCameraModal] = useState<boolean>(false)

    const [showMaterialModal, setShowMaterialModal] = useState<boolean>(false)
    const [showGeosetModal, setShowGeosetModal] = useState<boolean>(false)
    const [showGlobalSeqModal, setShowGlobalSeqModal] = useState<boolean>(false)
    const [showGeosetVisibility, setShowGeosetVisibility] = useState<boolean>(() => loadSetting('showGeosetVisibility', true))

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
    const [mpqLoaded, setMpqLoaded] = useState<boolean>(false)

    const [isLoading, setIsLoading] = useState<boolean>(false)

    // Editor Panel Resizing
    const [editorWidth, setEditorWidth] = useState<number>(400)
    const [isResizingEditor, setIsResizingEditor] = useState<boolean>(false)

    const viewerRef = useRef<ViewerRef>(null)

    // Check for pending model path after page refresh
    useEffect(() => {
        const pendingPath = localStorage.getItem('pending_model_path');
        if (pendingPath) {
            console.log('[MainLayout] Loading pending model from refresh:', pendingPath);
            // Clear the pending path
            localStorage.removeItem('pending_model_path');
            // Load the model
            setIsLoading(true);
            setZustandLoading(true);
            setZustandModelData(null, pendingPath);
            setIsLoading(false);
            setZustandLoading(false);
        }
    }, []); // Run once on mount

    const handleAddCameraFromView = () => {
        if (viewerRef.current) {
            const cam = viewerRef.current.getCamera()
            const { addNode, nodes } = useModelStore.getState()

            // Calculate Position and Target
            // In War3 MDX, Camera has Position and Target.
            // Viewer uses Orbit Camera: Target, Distance, Theta, Phi.
            // Position = Target + SphericalToCartesian(Distance, Theta, Phi)

            const { distance, theta, phi, target } = cam

            // Calculate Camera Position
            const cx = distance * Math.sin(phi) * Math.cos(theta)
            const cy = distance * Math.sin(phi) * Math.sin(theta)
            const cz = distance * Math.cos(phi)

            const cameraPos = [cx + target[0], cy + target[1], cz + target[2]]

            const newCamera = {
                Name: `Camera ${nodes.filter((n: any) => n.type === NodeType.CAMERA).length + 1}`,
                type: NodeType.CAMERA,
                FieldOfView: 0.7853, // 45 deg
                NearClip: 16,
                FarClip: 5000,
                Translation: {
                    InterpolationType: 0,
                    GlobalSeqId: null,
                    Keys: [{ Frame: 0, Vector: cameraPos }]
                },
                TargetTranslation: {
                    InterpolationType: 0,
                    GlobalSeqId: null,
                    Keys: [{ Frame: 0, Vector: target }]
                }
            }

            addNode(newCamera)
        }
    }

    const handleViewCamera = (cameraNode: any) => {
        if (viewerRef.current && cameraNode) {
            console.log('handleViewCamera', cameraNode)

            const getPos = (block: any) => {
                if (block && block.Keys && block.Keys.length > 0) {
                    return block.Keys[0].Vector || [0, 0, 0]
                }
                return [0, 0, 0]
            }

            const pos = getPos(cameraNode.Translation)
            const target = getPos(cameraNode.TargetTranslation)

            console.log('Camera Pos:', pos, 'Target:', target)

            const dx = pos[0] - target[0]
            const dy = pos[1] - target[1]
            const dz = pos[2] - target[2]

            let distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (distance < 0.1) distance = 100; // Default safety distance if pos == target

            // Spherical conversion
            // War3 Coordinate System: Z is up.
            // Viewer Orbit Camera: Standard spherical coordinates usually define phi from Y axis (or Z if Z-up).
            // Let's check Viewer.tsx orbit controls implementation implicitly via trial.
            // Assuming Z is up for War3.

            let phi = Math.acos(dz / distance)

            // Safety check for NaN
            if (isNaN(phi)) phi = 0.1;

            // Clamp phi to avoid gimble lock
            if (phi < 0.01) phi = 0.01
            if (phi > Math.PI - 0.01) phi = Math.PI - 0.01

            let theta = Math.atan2(dy, dx)
            if (isNaN(theta)) theta = 0;

            console.log(' Calculated:', { distance, theta, phi })

            viewerRef.current.setCamera({
                distance,
                theta,
                phi,
                target: [target[0], target[1], target[2]]
            })
        }
    }

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
                    if (count > 0) {
                        setMpqLoaded(true)
                    }
                } catch (e) {
                    console.error('[MainLayout] Failed to auto-load saved MPQs:', e)
                    setMpqLoaded(false)
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
                            setMpqLoaded(true)
                            // alert(`已自动检测并加载了 ${count} 个魔兽争霸 MPQ 文件！`)
                        }
                    }
                } catch (e) {
                    console.log('[MainLayout] Auto-detection failed (registry key not found or error):', e)
                    setMpqLoaded(false)
                }
            }
        }
        loadSavedMpqs()
    }, [])
    // Manager Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return
            const key = e.key.toLowerCase()

            if (key === 'g') toggleNodeManager() // Wait, G is Geoset Manager? Image says: G = Geoset Manager
            if (key === 'n') toggleNodeManager() // Image: Node Manager(N)

            // Wait, let's map correctly from image
            // Node Manager(N) -> toggleNodeManager()
            // Camera Manager(C) -> setShowCameraModal(true/toggle)
            // Geoset Manager(G) -> setShowGeosetModal(true/toggle)
            // Geoset Anim Manager(E) -> setShowGeosetAnimModal
            // Texture Manager(T) -> setShowTextureModal
            // Texture Anim Manager(X) -> setShowTextureAnimModal
            // Material Manager(M) -> setShowMaterialModal
            // Model Sequence Manager(S) -> setShowSequenceModal (Ignore per instructions? "Ignore model action manager")
            // Global Sequence Manager(L) -> setShowGlobalSeqModal

            switch (key) {
                case 'n': toggleNodeManager(); break;
                case 'c': setShowCameraModal(prev => !prev); break;
                case 'g': setShowGeosetModal(prev => !prev); break;
                case 'e': setShowGeosetAnimModal(prev => !prev); break;
                case 't': setShowTextureModal(prev => !prev); break;
                case 'x': setShowTextureAnimModal(prev => !prev); break;
                case 'm': setShowMaterialModal(prev => !prev); break;
                case 's': setShowSequenceModal(prev => !prev); break;
                case 'l': setShowGlobalSeqModal(prev => !prev); break;
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [toggleNodeManager])

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
                // Check if a model is already loaded - if so, save path and refresh page
                const currentModelPath = useModelStore.getState().modelPath;
                if (currentModelPath) {
                    console.log('[MainLayout] Model already loaded, refreshing page before importing new model');
                    // Save the new path to localStorage for auto-load after refresh
                    localStorage.setItem('pending_model_path', selected);
                    // Trigger page reload
                    window.location.reload();
                    return;
                }

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

        // Reset State on New Model Load FIRST (before auto-play)
        setMainMode('view')
        useSelectionStore.getState().clearAllSelections()

        // Auto-play first animation if available
        if (data && data.Sequences && data.Sequences.length > 0) {
            // Use a small timeout to ensure the renderer is ready
            setTimeout(() => {
                console.log('[MainLayout] Auto-playing first animation')
                useModelStore.getState().setSequence(0)
                useModelStore.getState().setPlaying(true)
            }, 300)
        } else {
            // No sequences available, reset to no animation
            useModelStore.getState().setSequence(-1)
            setPlaying(false)
        }

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

            // Prepare model data with correct typed arrays
            const preparedData = prepareModelDataForSave(modelData);

            // Fix FrameFlags for ParticleEmitter2 to prevent save corruption
            if (preparedData.ParticleEmitters2) {
                preparedData.ParticleEmitters2.forEach((emitter: any) => {
                    // Reconstruct FrameFlags from Head/Tail booleans if present
                    if (typeof emitter.Head === 'boolean' || typeof emitter.Tail === 'boolean') {
                        let flags = 0
                        if (emitter.Head) flags |= 1 // Head
                        if (emitter.Tail) flags |= 2 // Tail

                        // Prevent corruption: generator writes nothing if flags is 0, shifting bytes
                        if (flags === 0) flags = 1

                        emitter.FrameFlags = flags
                    } else if (emitter.FrameFlags === undefined) {
                        // Handle new nodes that might miss FrameFlags
                        emitter.FrameFlags = 1
                    }
                })
            }

            if (modelPath.toLowerCase().endsWith('.mdl')) {
                const content = generateMDL(preparedData)
                await writeFile(modelPath, new TextEncoder().encode(content))
            } else {
                const buffer = generateMDX(preparedData)
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
                // Prepare model data with correct typed arrays
                const preparedData = prepareModelDataForSave(modelData);

                // Fix FrameFlags for ParticleEmitter2 to prevent save corruption (Save As)
                if (preparedData.ParticleEmitters2) {
                    console.log('[MainLayout] Saving As - Checking ParticleEmitters2:', preparedData.ParticleEmitters2.length);
                    preparedData.ParticleEmitters2.forEach((emitter: any, index: number) => {
                        console.log(`[MainLayout] Emitter ${index} before: Head=${emitter.Head}, Tail=${emitter.Tail}, Flags=${emitter.FrameFlags}`);
                        if (typeof emitter.Head === 'boolean' || typeof emitter.Tail === 'boolean') {
                            let flags = 0
                            if (emitter.Head) flags |= 1
                            if (emitter.Tail) flags |= 2
                            if (flags === 0) flags = 1
                            emitter.FrameFlags = flags
                            console.log(`[MainLayout] Emitter ${index} fixed: Flags=${emitter.FrameFlags}`);
                        } else if (emitter.FrameFlags === undefined) {
                            emitter.FrameFlags = 1
                            console.log(`[MainLayout] Emitter ${index} fixed (undefined): Flags=${emitter.FrameFlags}`);
                        }
                    })
                }

                if (selected.toLowerCase().endsWith('.mdl')) {
                    const content = generateMDL(preparedData)
                    await writeFile(selected, new TextEncoder().encode(content))
                } else {
                    const buffer = generateMDX(preparedData)
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
        // Invoke Rust command to toggle console immediately (no delay)
        import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('toggle_console', { show: showDebugConsole }).catch(e => console.error('Failed to toggle console:', e))
        })
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
                mpqLoaded={mpqLoaded}
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
                showGeosetVisibility={showGeosetVisibility}
                onToggleGeosetVisibility={() => {
                    const newValue = !showGeosetVisibility;
                    setShowGeosetVisibility(newValue);
                    localStorage.setItem('showGeosetVisibility', JSON.stringify(newValue));
                }}
                onSetViewPreset={(preset) => setViewPreset({ type: preset, time: Date.now() })}
                onToggleEditor={(editor) => {
                    console.log('[MainLayout] onToggleEditor called with:', editor)
                    if (editor === 'nodeManager') {
                        toggleNodeManager()
                    } else if (editor === 'modelInfo') {
                        toggleModelInfo()
                    } else if (editor === 'geosetAnim') {
                        setShowGeosetAnimModal(true)
                    } else if (editor === 'texture') {
                        setShowTextureModal(true)
                    } else if (editor === 'textureAnim') {
                        setShowTextureAnimModal(true)
                    } else if (editor === 'sequence') {
                        setShowSequenceModal(true)
                    } else if (editor === 'camera') {
                        setShowCameraModal(true)
                    } else if (editor === 'material') {

                        setShowMaterialModal(true)
                    } else if (editor === 'geoset') {
                        setShowGeosetModal(true)
                    } else if (editor === 'globalSequence') {
                        setShowGlobalSeqModal(true)
                    } else if (editor === 'geosetVisibility') {
                        setShowGeosetVisibility(prev => !prev)
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

            <GeosetAnimationModal
                visible={showGeosetAnimModal}
                onClose={() => setShowGeosetAnimModal(false)}
            />
            <TextureEditorModal
                visible={showTextureModal}
                onClose={() => setShowTextureModal(false)}
                modelPath={modelPath || undefined}
            />
            <TextureAnimationManagerModal
                visible={showTextureAnimModal}
                onClose={() => setShowTextureAnimModal(false)}
            />
            <CameraManagerModal
                visible={showCameraModal}
                onClose={() => setShowCameraModal(false)}
                onAddFromView={handleAddCameraFromView}
                onViewCamera={handleViewCamera}
            />
            <SequenceEditorModal
                visible={showSequenceModal}
                onClose={() => setShowSequenceModal(false)}
            />
            <MaterialEditorModal
                visible={showMaterialModal}
                onClose={() => setShowMaterialModal(false)}
            />
            <GeosetEditorModal
                visible={showGeosetModal}
                onClose={() => setShowGeosetModal(false)}
            />
            <GlobalSequenceModal
                visible={showGlobalSeqModal}
                onClose={() => setShowGlobalSeqModal(false)}
            />

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
                        ref={viewerRef}
                        modelPath={modelPath} // Use path from store
                        modelData={modelData}
                        teamColor={teamColor}
                        showGrid={showGrid}
                        showNodes={showNodes}
                        showSkeleton={showSkeleton}
                        showWireframe={renderMode === 'wireframe'}
                        onToggleWireframe={() => setRenderMode(prev => prev === 'textured' ? 'wireframe' : 'textured')}
                        backgroundColor={backgroundColor}
                        animationIndex={currentSequence} // Use sequence from store
                        isPlaying={isPlaying} // Use playing state from store
                        onTogglePlay={() => setPlaying(!isPlaying)}
                        onModelLoaded={handleModelLoaded}
                        showFPS={showFPS}
                        viewPreset={viewPreset}
                    />

                    <GeosetVisibilityPanel
                        visible={showGeosetVisibility}
                        onClose={() => setShowGeosetVisibility(false)}
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
