import React, { useState, useEffect, useCallback } from 'react'
import { Button, List, Card, Checkbox, Select, Typography, message } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { DraggableModal } from '../DraggableModal'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { windowManager } from '../../utils/windowManager'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { getDraggedTextureIndex } from '../../utils/textureDragDrop'
import { useRpcClient } from '../../hooks/useRpc'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import { markStandalonePerf, markStandalonePerfOnce } from '../../utils/standalonePerf'

const { Text } = Typography

const createEditorId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cloneDeep<T>(value: T): T {
    try {
        return structuredClone(value)
    } catch {
        return JSON.parse(JSON.stringify(value))
    }
}

/**
 * Convert Shading bitmask to individual boolean properties for UI display
 * LayerShading: Unshaded=1, SphereEnvMap=2, TwoSided=16, Unfogged=32, NoDepthTest=64, NoDepthSet=128
 */
function normalizeMaterialsForUI(materials: any[]): any[] {
    return materials.map(material => {
        const renderMode = material.RenderMode || 0;
        return {
            ...material,
            __editorMaterialId: typeof material?.__editorMaterialId === 'string' ? material.__editorMaterialId : createEditorId('mat'),
            ConstantColor: material.ConstantColor !== undefined ? material.ConstantColor : (renderMode & 1) !== 0,
            SortPrimsFarZ: material.SortPrimsFarZ !== undefined ? material.SortPrimsFarZ : (renderMode & 16) !== 0,
            FullResolution: material.FullResolution !== undefined ? material.FullResolution : (renderMode & 32) !== 0,
            Layers: (material.Layers || []).map((layer: any) => {
                const shading = layer.Shading || 0;
                return {
                    ...layer,
                    __editorLayerId: typeof layer?.__editorLayerId === 'string' ? layer.__editorLayerId : createEditorId('layer'),
                    // Set boolean properties from Shading bitmask (if not already set)
                    Unshaded: layer.Unshaded !== undefined ? layer.Unshaded : (shading & 1) !== 0,
                    SphereEnvMap: layer.SphereEnvMap !== undefined ? layer.SphereEnvMap : (shading & 2) !== 0,
                    TwoSided: layer.TwoSided !== undefined ? layer.TwoSided : (shading & 16) !== 0,
                    Unfogged: layer.Unfogged !== undefined ? layer.Unfogged : (shading & 32) !== 0,
                    NoDepthTest: layer.NoDepthTest !== undefined ? layer.NoDepthTest : (shading & 64) !== 0,
                    NoDepthSet: layer.NoDepthSet !== undefined ? layer.NoDepthSet : (shading & 128) !== 0,
                };
            })
        };
    });
}

/**
 * Convert boolean properties back to Shading bitmask for saving
 */
function denormalizeMaterialsForSave(materials: any[]): any[] {
    return materials.map(material => {
        let renderMode = material.RenderMode ?? 0;
        if (material.ConstantColor) renderMode |= 1;
        if (material.SortPrimsFarZ) renderMode |= 16;
        if (material.FullResolution) renderMode |= 32;

        const { ConstantColor, SortPrimsFarZ, FullResolution, __editorMaterialId, ...materialRest } = material;

        return {
            ...materialRest,
            // Ensure material has required properties
            PriorityPlane: material.PriorityPlane ?? 0,
            RenderMode: renderMode,
            Layers: (material.Layers || []).map((layer: any) => {
                // Rebuild Shading bitmask from boolean flags
                let shading = 0;
                if (layer.Unshaded) shading |= 1;
                if (layer.SphereEnvMap) shading |= 2;
                if (layer.TwoSided) shading |= 16;
                if (layer.Unfogged) shading |= 32;
                if (layer.NoDepthTest) shading |= 64;
                if (layer.NoDepthSet) shading |= 128;

                // Create clean layer without UI-only boolean properties
                const { Unshaded, SphereEnvMap, TwoSided, Unfogged, NoDepthTest, NoDepthSet, __editorLayerId, ...cleanLayer } = layer;

                return {
                    ...cleanLayer,
                    // Core required properties with defaults
                    FilterMode: layer.FilterMode ?? 0,
                    Shading: shading,
                    CoordId: layer.CoordId ?? 0,
                    Alpha: layer.Alpha ?? 1,
                    // TextureID - can be number or AnimVector
                    TextureID: layer.TextureID ?? 0,
                    // TVertexAnimId - null or a valid index (not undefined)
                    TVertexAnimId: layer.TVertexAnimId === undefined ? null : layer.TVertexAnimId,
                };
            })
        };
    });
}

interface MaterialEditorModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

interface MaterialManagerSnapshot {
    materials: any[]
    textures: any[]
    geosets: any[]
    globalSequences: number[]
    sequences: any[]
    textureAnims: any[]
    modelPath: string
}

interface MaterialManagerRpcState {
    snapshotVersion: number
    snapshot: MaterialManagerSnapshot
    pickedGeosetIndex: number | null
    selectedMaterialIndex: number | null
}

interface MaterialManagerPatch {
    pickedGeosetIndex?: number | null
    selectedMaterialIndex?: number | null
}

const MaterialEditorModal: React.FC<MaterialEditorModalProps> = ({ visible, onClose, isStandalone }) => {
    const initialRpcState: MaterialManagerRpcState = {
        snapshotVersion: 0,
        snapshot: {
            materials: [],
            textures: [],
            geosets: [],
            globalSequences: [],
            sequences: [],
            textureAnims: [],
            modelPath: '',
        },
        pickedGeosetIndex: null,
        selectedMaterialIndex: null,
    }

    const { state: rpcState, emitCommand } = useRpcClient<MaterialManagerRpcState, MaterialManagerPatch>(
        'materialManager',
        initialRpcState,
        {
            applyPatch: (previousState, patch) => {
                let nextState = { ...previousState }
                let changed = false

                if (patch?.pickedGeosetIndex !== undefined && previousState.pickedGeosetIndex !== patch.pickedGeosetIndex) {
                    nextState.pickedGeosetIndex = patch.pickedGeosetIndex
                    changed = true
                }

                if (patch?.selectedMaterialIndex !== undefined && previousState.selectedMaterialIndex !== patch.selectedMaterialIndex) {
                    nextState.selectedMaterialIndex = patch.selectedMaterialIndex
                    changed = true
                }

                return changed ? nextState : previousState
            }
        }
    )

    const rpcSnapshot = rpcState.snapshot
    const directModelData = useModelStore((state) => state.modelData)
    const directModelPath = useModelStore((state) => state.modelPath)
    const directSetMaterials = useModelStore((state) => state.setMaterials)
    const directSetTextures = useModelStore((state) => state.setTextures)
    const directSetVisualDataPatch = useModelStore((state) => state.setVisualDataPatch)

    const modelData = isStandalone ? {
        Materials: rpcSnapshot.materials,
        Textures: rpcSnapshot.textures,
        Geosets: rpcSnapshot.geosets,
        GlobalSequences: rpcSnapshot.globalSequences,
        Sequences: rpcSnapshot.sequences,
        TextureAnims: rpcSnapshot.textureAnims
    } : directModelData

    const modelPath = isStandalone ? rpcSnapshot.modelPath : directModelPath

    const setMaterials = (materials: any[]) => {
        if (isStandalone) {
            emitCommand('EXECUTE_MATERIAL_ACTION', { action: 'SAVE_MATERIALS', payload: { materials, textures: modelTexturesRef.current } })
        } else {
            directSetMaterials(materials)
        }
    }

    const setTextures = (textures: any[]) => {
        modelTexturesRef.current = textures
        setLocalTextures(textures)
        if (isStandalone) {
            const materialsForSave = denormalizeMaterialsForSave(localMaterialsRef.current)
            emitCommand('EXECUTE_MATERIAL_ACTION', { action: 'SAVE_MATERIALS', payload: { materials: materialsForSave, textures } })
        } else {
            directSetTextures(textures)
        }
    }

    const applyVisualPatch = React.useCallback((patch: { Textures?: any[]; Materials?: any[]; Geosets?: any[] }) => {
        if (patch.Textures) {
            modelTexturesRef.current = patch.Textures
            setLocalTextures(patch.Textures)
        }
        if (isStandalone) {
            emitCommand('EXECUTE_MATERIAL_ACTION', {
                action: 'SAVE_MATERIALS',
                payload: {
                    materials: patch.Materials ?? denormalizeMaterialsForSave(localMaterialsRef.current),
                    textures: patch.Textures ?? modelTexturesRef.current,
                    geosets: patch.Geosets
                }
            })
        } else {
            directSetVisualDataPatch(patch)
        }
    }, [directSetVisualDataPatch, emitCommand, isStandalone])
    const [localMaterials, setLocalMaterials] = useState<any[]>([])
    const [localTextures, setLocalTextures] = useState<any[]>([])
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1)
    const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(-1)
    const [dragLayerIndex, setDragLayerIndex] = useState<number | null>(null)
    const [dragOverLayerIndex, setDragOverLayerIndex] = useState<number | null>(null)
    const [isTextureDropActive, setIsTextureDropActive] = useState(false)

    // Keyframe Editor State
    const [editingField, setEditingField] = useState<string | null>(null)
    const [editingVectorSize, setEditingVectorSize] = useState(1)

    const focusMaterialForGeoset = useCallback((geosetIndex: number | null | undefined) => {
        if (!Number.isInteger(geosetIndex) || geosetIndex === null || geosetIndex === undefined) {
            return
        }
        const geoset = modelGeosetsRef.current?.[geosetIndex]
        const materialId = Number(geoset?.MaterialID)
        if (!Number.isFinite(materialId) || materialId < 0) {
            return
        }
        setSelectedMaterialIndex(materialId)
        setSelectedLayerIndex(0)
        setTimeout(() => {
            if (materialListRef.current) {
                materialListRef.current.scrollTo({ top: materialId * 50, behavior: 'smooth' })
            }
            if (layerListRef.current) {
                layerListRef.current.scrollTo({ top: 0, behavior: 'smooth' })
            }
        }, 0)
    }, [])

    const isInitialized = React.useRef(false)
    const materialListRef = React.useRef<HTMLDivElement>(null)
    const layerListRef = React.useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!visible) return
        if (isStandalone) {
            if (Number.isInteger(rpcState.selectedMaterialIndex) && rpcState.selectedMaterialIndex !== null) {
                // Ignore picking if the user explicitly picked a material
                setSelectedMaterialIndex(rpcState.selectedMaterialIndex)
                setSelectedLayerIndex(0)
                setTimeout(() => {
                    scrollMaterialToItem(rpcState.selectedMaterialIndex!)
                    scrollLayerToItem(0)
                }, 0)
            } else {
                focusMaterialForGeoset(rpcState.pickedGeosetIndex)
            }
        } else {
            const standaloneState = useSelectionStore.getState()
            if (Number.isInteger(standaloneState.selectedMaterialIndex) && standaloneState.selectedMaterialIndex !== null) {
                setSelectedMaterialIndex(standaloneState.selectedMaterialIndex)
                setSelectedLayerIndex(0)
                setTimeout(() => {
                    scrollMaterialToItem(standaloneState.selectedMaterialIndex!)
                    scrollLayerToItem(0)
                }, 0)
            } else {
                focusMaterialForGeoset(standaloneState.pickedGeosetIndex)
            }
        }
    }, [visible, isStandalone, rpcState.pickedGeosetIndex, rpcState.selectedMaterialIndex, focusMaterialForGeoset])
    const textureDropZoneRef = React.useRef<HTMLDivElement>(null)
    const layerTextureDropSurfaceRef = React.useRef<HTMLDivElement>(null)
    const detailsDropSurfaceRef = React.useRef<HTMLDivElement>(null)
    const dragOverLayerIndexRef = React.useRef<number | null>(null)
    const originalMaterialsRef = React.useRef<any[] | null>(null)
    const originalTexturesRef = React.useRef<any[] | null>(null)
    const isCommittingRef = React.useRef(false)
    const didRealtimePreviewRef = React.useRef(false)
    const didRealtimeTexturePreviewRef = React.useRef(false)
    const localMaterialsRef = React.useRef<any[]>([])
    const localTexturesRef = React.useRef<any[]>([])
    const modelTexturesRef = React.useRef<any[]>([])
    const modelGeosetsRef = React.useRef<any[]>([])
    const selectedMaterialIndexRef = React.useRef(-1)
    const selectedLayerIndexRef = React.useRef(-1)

    const syncStandaloneMaterials = React.useCallback((nextMaterialsUi: any[], nextTextures?: any[], nextGeosets?: any[]) => {
        if (!isStandalone) return
        const materialsForSave = denormalizeMaterialsForSave(cloneDeep(nextMaterialsUi))
        emitCommand('EXECUTE_MATERIAL_ACTION', {
            action: 'SAVE_MATERIALS',
            payload: {
                materials: materialsForSave,
                textures: cloneDeep(nextTextures ?? modelTexturesRef.current),
                geosets: nextGeosets ? cloneDeep(nextGeosets) : undefined
            }
        })
    }, [emitCommand, isStandalone])

    useEffect(() => {
        dragOverLayerIndexRef.current = dragOverLayerIndex
    }, [dragOverLayerIndex])

    useEffect(() => {
        localMaterialsRef.current = localMaterials
    }, [localMaterials])

    useEffect(() => {
        localTexturesRef.current = Array.isArray(localTextures) ? localTextures : []
    }, [localTextures])

    useEffect(() => {
        modelTexturesRef.current = Array.isArray(modelData?.Textures) ? modelData.Textures : []
        modelGeosetsRef.current = Array.isArray(modelData?.Geosets) ? modelData.Geosets : []
        selectedMaterialIndexRef.current = selectedMaterialIndex
        selectedLayerIndexRef.current = selectedLayerIndex
    }, [modelData, selectedMaterialIndex, selectedLayerIndex])

    const applyMaterialsChange = React.useCallback((updater: (previous: any[]) => any[]) => {
        const previousMaterials = cloneDeep(localMaterialsRef.current || [])
        const nextMaterials = updater(previousMaterials)
        localMaterialsRef.current = nextMaterials
        setLocalMaterials(nextMaterials)
        return nextMaterials
    }, [])

    const lastRpcMaterialsRef = React.useRef<any>(null)
    const lastHandledPickedGeosetRef = React.useRef<number | null | undefined>(undefined)

    useEffect(() => {
        if (!isStandalone) return
        markStandalonePerf('child_runtime_mounted', { windowId: 'materialManager' })
    }, [isStandalone])

    useEffect(() => {
        if (!isStandalone || !visible || localMaterials.length === 0) return
        markStandalonePerfOnce('materialManager:first_content_rendered', 'first_content_rendered', {
            windowId: 'materialManager',
            materialCount: localMaterials.length,
            selectedMaterialIndex,
        })
    }, [isStandalone, visible, localMaterials.length, selectedMaterialIndex])
    const scrollMaterialToItem = (index: number) => {
        if (!materialListRef.current || index < 0) return
        const item = materialListRef.current.querySelector(`[data-material-index="${index}"]`) as HTMLElement | null
        item?.scrollIntoView({ block: 'nearest' })
    }

    const scrollLayerToItem = (index: number) => {
        if (!layerListRef.current || index < 0) return
        const item = layerListRef.current.querySelector(`[data-layer-index="${index}"]`) as HTMLElement | null
        item?.scrollIntoView({ block: 'nearest' })
    }

    // Initialize local state
    useEffect(() => {
        if (visible) {
            const hasMaterials = modelData && modelData.Materials && modelData.Materials.length > 0
            const currentTextures = modelData?.Textures || []
            const texturesChanged = JSON.stringify(currentTextures) !== JSON.stringify(localTexturesRef.current)
            // In standalone mode, rpcState.materials starts empty and arrives asynchronously.
            // We must re-initialize when a fresh, non-empty array arrives.
            const rpcDataChanged = isStandalone && rpcState.snapshotVersion !== lastRpcMaterialsRef.current

            if (hasMaterials && (!isInitialized.current || rpcDataChanged)) {
                console.log('[MaterialEditorModal] Initializing local materials from store. Count:', modelData.Materials.length)
                lastRpcMaterialsRef.current = isStandalone ? rpcState.snapshotVersion : modelData.Materials
                originalMaterialsRef.current = JSON.parse(JSON.stringify(modelData.Materials))
                originalTexturesRef.current = JSON.parse(JSON.stringify(modelData.Textures || []))
                setLocalTextures(JSON.parse(JSON.stringify(modelData.Textures || [])))
                isCommittingRef.current = false
                didRealtimePreviewRef.current = false
                didRealtimeTexturePreviewRef.current = false
                // Convert Shading bitmask to boolean properties for UI display
                const normalized = normalizeMaterialsForUI(JSON.parse(JSON.stringify(modelData.Materials)));
                setLocalMaterials(normalized)
                if (!isInitialized.current) {
                    const firstMat = normalized[0]
                    setSelectedMaterialIndex(normalized.length > 0 ? 0 : -1)
                    setSelectedLayerIndex(firstMat && firstMat.Layers && firstMat.Layers.length > 0 ? 0 : -1)
                } else {
                    const nextMaterialIndex =
                        selectedMaterialIndex >= 0 && selectedMaterialIndex < normalized.length
                            ? selectedMaterialIndex
                            : (normalized.length > 0 ? 0 : -1)
                    const nextMaterial =
                        nextMaterialIndex >= 0 && nextMaterialIndex < normalized.length
                            ? normalized[nextMaterialIndex]
                            : null
                    const nextLayerIndex =
                        nextMaterial && nextMaterial.Layers && nextMaterial.Layers.length > 0
                            ? (selectedLayerIndex >= 0 && selectedLayerIndex < nextMaterial.Layers.length ? selectedLayerIndex : 0)
                            : -1
                    setSelectedMaterialIndex(nextMaterialIndex)
                    setSelectedLayerIndex(nextLayerIndex)
                }
                isInitialized.current = true
            } else if (hasMaterials && texturesChanged && !isStandalone) {
                setLocalTextures(JSON.parse(JSON.stringify(currentTextures)))
            } else if (!hasMaterials) {
                setLocalMaterials([])
                setSelectedMaterialIndex(-1)
                setSelectedLayerIndex(-1)
                setLocalTextures([])
                setIsTextureDropActive(false)
                isInitialized.current = false
                lastRpcMaterialsRef.current = isStandalone ? rpcState.snapshotVersion : null
                if (isCommittingRef.current) {
                    isCommittingRef.current = false
                }
                originalMaterialsRef.current = null
                originalTexturesRef.current = null
                didRealtimePreviewRef.current = false
                didRealtimeTexturePreviewRef.current = false
            }
        } else {
            setLocalMaterials([])
            setSelectedMaterialIndex(-1)
            setSelectedLayerIndex(-1)
            setLocalTextures([])
            setIsTextureDropActive(false)
            isInitialized.current = false
            lastRpcMaterialsRef.current = null
            if (isCommittingRef.current) {
                isCommittingRef.current = false
            }
            originalMaterialsRef.current = null
            originalTexturesRef.current = null
            didRealtimePreviewRef.current = false
            didRealtimeTexturePreviewRef.current = false
        }
    }, [visible, modelData, isStandalone, selectedMaterialIndex, selectedLayerIndex, rpcState.snapshotVersion])

    // Subscribe to Ctrl+Click geoset picking - auto-select material
    useEffect(() => {
        if (!visible || !modelData) return

        let unsubscribe: (() => void) | null = null;

        const handlePickedGeoset = (pickedGeosetIndex: number | null) => {
            if (pickedGeosetIndex === lastHandledPickedGeosetRef.current) {
                return;
            }

            lastHandledPickedGeosetRef.current = pickedGeosetIndex;

            if (pickedGeosetIndex !== null && modelData.Geosets && modelData.Geosets[pickedGeosetIndex]) {
                const materialId = modelData.Geosets[pickedGeosetIndex].MaterialID;
                if (materialId !== undefined && materialId >= 0 && materialId < localMaterials.length) {
                    const pickedMaterial = localMaterials[materialId];
                    const nextLayerIndex =
                        pickedMaterial && pickedMaterial.Layers && pickedMaterial.Layers.length > 0
                            ? ((materialId === selectedMaterialIndex && selectedLayerIndex >= 0 && selectedLayerIndex < pickedMaterial.Layers.length)
                                ? selectedLayerIndex
                                : 0)
                            : -1;
                    setSelectedMaterialIndex(materialId);
                    setSelectedLayerIndex(nextLayerIndex);
                    setTimeout(() => {
                        scrollMaterialToItem(materialId)
                        if (nextLayerIndex >= 0) scrollLayerToItem(nextLayerIndex)
                    }, 0);
                }
            }
        };

        if (isStandalone) {
            handlePickedGeoset(rpcState.pickedGeosetIndex);
        } else {
            handlePickedGeoset(useSelectionStore.getState().pickedGeosetIndex);
            unsubscribe = useSelectionStore.subscribe((state) => {
                handlePickedGeoset(state.pickedGeosetIndex);
            });
        }

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [visible, modelData, localMaterials, selectedMaterialIndex, selectedLayerIndex, isStandalone ? rpcState.pickedGeosetIndex : null, isStandalone ? rpcState.snapshotVersion : null])

    const handleOk = () => {
        // Convert boolean flags back to Shading bitmask before saving
        const materialsForSave = denormalizeMaterialsForSave(localMaterials)
        const texturesForSave = JSON.parse(JSON.stringify(localTextures || []))
        const oldMaterials = originalMaterialsRef.current || modelData?.Materials || []
        const oldTextures = originalTexturesRef.current || modelData?.Textures || []

        useHistoryStore.getState().push({
            name: 'Edit Materials',
            undo: () => {
                if (isStandalone) {
                    emitCommand('EXECUTE_MATERIAL_ACTION', { action: 'SAVE_MATERIALS', payload: { materials: oldMaterials, textures: oldTextures } })
                } else {
                    applyVisualPatch({ Textures: oldTextures, Materials: oldMaterials })
                }
            },
            redo: () => {
                if (isStandalone) {
                    emitCommand('EXECUTE_MATERIAL_ACTION', { action: 'SAVE_MATERIALS', payload: { materials: materialsForSave, textures: texturesForSave } })
                } else {
                    applyVisualPatch({ Textures: texturesForSave, Materials: materialsForSave })
                }
            }
        })

        isCommittingRef.current = true
        if (isStandalone) {
            emitCommand('EXECUTE_MATERIAL_ACTION', { action: 'SAVE_MATERIALS', payload: { materials: materialsForSave, textures: texturesForSave } })
        } else {
            applyVisualPatch({ Textures: texturesForSave, Materials: materialsForSave })
        }
        message.success('材质已保存')
        onClose()
    }

    const handleCancel = () => {
        if (isStandalone) {
            onClose()
            return
        }
        if (!isCommittingRef.current && (didRealtimeTexturePreviewRef.current || didRealtimePreviewRef.current)) {
            if (didRealtimeTexturePreviewRef.current && originalTexturesRef.current && didRealtimePreviewRef.current && originalMaterialsRef.current) {
                applyVisualPatch({ Textures: originalTexturesRef.current, Materials: originalMaterialsRef.current })
            } else {
                if (didRealtimeTexturePreviewRef.current && originalTexturesRef.current) setTextures(originalTexturesRef.current)
                if (didRealtimePreviewRef.current && originalMaterialsRef.current) setMaterials(originalMaterialsRef.current)
            }
        }
        onClose()
    }

    const updateLocalMaterial = (index: number, updates: any, applyRealtime: boolean = false) => {
        const newMaterials = applyMaterialsChange((previous) => {
            if (index < 0 || index >= previous.length) return previous
            previous[index] = { ...previous[index], ...updates }
            return previous
        })

        if (isStandalone || applyRealtime) {
            didRealtimePreviewRef.current = true
            const materialsForSave = denormalizeMaterialsForSave(newMaterials)
            if (isStandalone) {
                emitCommand('EXECUTE_MATERIAL_ACTION', {
                    action: 'SAVE_MATERIALS',
                    payload: {
                        materials: materialsForSave,
                        textures: modelTexturesRef.current
                    }
                })
            } else {
                setMaterials(materialsForSave)
            }
        }
    }

    const updateLocalLayer = (matIndex: number, layerIndex: number, updates: any, applyRealtime: boolean = false) => {
        const newMaterials = applyMaterialsChange((previous) => {
            if (matIndex < 0 || matIndex >= previous.length) return previous
            const material = previous[matIndex]
            const layers = Array.isArray(material?.Layers) ? [...material.Layers] : []
            if (layerIndex < 0 || layerIndex >= layers.length) return previous
            layers[layerIndex] = { ...layers[layerIndex], ...updates }
            previous[matIndex] = { ...material, Layers: layers }
            return previous
        })

        if (isStandalone || applyRealtime) {
            didRealtimePreviewRef.current = true
            const materialsForSave = denormalizeMaterialsForSave(newMaterials)
            if (isStandalone) {
                emitCommand('EXECUTE_MATERIAL_ACTION', {
                    action: 'SAVE_MATERIALS',
                    payload: {
                        materials: materialsForSave,
                        textures: modelTexturesRef.current
                    }
                })
            } else {
                setMaterials(materialsForSave)
            }
        }

        return newMaterials
    }

    const commitStandaloneTextureDrivenChange = (nextMaterials?: any[] | null, nextTextures?: any[] | null) => {
        if (!isStandalone) return
        if (nextMaterials) {
            originalMaterialsRef.current = JSON.parse(JSON.stringify(denormalizeMaterialsForSave(nextMaterials)))
        }
        if (nextTextures) {
            originalTexturesRef.current = JSON.parse(JSON.stringify(nextTextures))
        }
        didRealtimePreviewRef.current = false
        didRealtimeTexturePreviewRef.current = false
        isCommittingRef.current = false
    }

    const stageImportedTextures = (nextTextures: any[]) => {
        modelTexturesRef.current = nextTextures
        localTexturesRef.current = nextTextures
        setLocalTextures(nextTextures)
    }

    const applyImportedTextureToLayer = (matIndex: number, layerIndex: number, textureId: number, nextTextures?: any[] | null) => {
        const hasTexturePatch = Array.isArray(nextTextures)
        if (hasTexturePatch) {
            didRealtimeTexturePreviewRef.current = true
            stageImportedTextures(nextTextures)
        }

        const nextMaterials = applyMaterialsChange((previous) => {
            if (matIndex < 0 || matIndex >= previous.length) return previous
            const material = previous[matIndex]
            const layers = Array.isArray(material?.Layers) ? [...material.Layers] : []
            if (layerIndex < 0 || layerIndex >= layers.length) return previous
            layers[layerIndex] = { ...layers[layerIndex], TextureID: textureId }
            previous[matIndex] = { ...material, Layers: layers }
            return previous
        })
        didRealtimePreviewRef.current = true

        if (isStandalone) {
            syncStandaloneMaterials(nextMaterials, hasTexturePatch ? nextTextures ?? undefined : undefined)
            commitStandaloneTextureDrivenChange(nextMaterials, hasTexturePatch ? nextTextures ?? undefined : null)
        } else {
            applyVisualPatch({
                Textures: hasTexturePatch ? nextTextures ?? undefined : undefined,
                Materials: denormalizeMaterialsForSave(nextMaterials)
            })
        }

        return nextMaterials
    }

    const moveLayer = (fromIndex: number, toIndex: number) => {
        if (selectedMaterialIndex < 0) return
        const material = localMaterialsRef.current[selectedMaterialIndex]
        const layers = [...(material?.Layers || [])]
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= layers.length || toIndex >= layers.length) return
        if (fromIndex === toIndex) return

        const [moved] = layers.splice(fromIndex, 1)
        layers.splice(toIndex, 0, moved)

        const newMaterials = applyMaterialsChange((previous) => {
            if (selectedMaterialIndex < 0 || selectedMaterialIndex >= previous.length) return previous
            previous[selectedMaterialIndex] = { ...previous[selectedMaterialIndex], Layers: layers }
            return previous
        })
        if (isStandalone) {
            syncStandaloneMaterials(newMaterials)
        } else {
            didRealtimePreviewRef.current = true
            setMaterials(denormalizeMaterialsForSave(newMaterials))
        }

        if (selectedLayerIndex === fromIndex) {
            setSelectedLayerIndex(toIndex)
        } else if (selectedLayerIndex > fromIndex && selectedLayerIndex <= toIndex) {
            setSelectedLayerIndex(selectedLayerIndex - 1)
        } else if (selectedLayerIndex < fromIndex && selectedLayerIndex >= toIndex) {
            setSelectedLayerIndex(selectedLayerIndex + 1)
        }
    }

    const handleLayerMouseDown = (e: React.MouseEvent, index: number) => {
        if (e.button !== 0) return
        if (selectedMaterialIndex < 0) return
        e.preventDefault()

        const startX = e.clientX
        const startY = e.clientY
        let dragStarted = false

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = Math.abs(moveEvent.clientX - startX)
            const deltaY = Math.abs(moveEvent.clientY - startY)

            if (!dragStarted && (deltaX > 4 || deltaY > 4)) {
                dragStarted = true
                setDragLayerIndex(index)
                setDragOverLayerIndex(index)
            }

            if (dragStarted) {
                const elementUnderMouse = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null
                const layerItem = elementUnderMouse?.closest('[data-layer-index]') as HTMLElement | null
                if (layerItem) {
                    const targetIndex = parseInt(layerItem.dataset.layerIndex || '', 10)
                    if (!isNaN(targetIndex)) {
                        setDragOverLayerIndex(targetIndex)
                    }
                } else {
                    setDragOverLayerIndex(null)
                }
            }
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (dragStarted) {
                const targetIndex = dragOverLayerIndexRef.current
                if (targetIndex !== null) {
                    moveLayer(index, targetIndex)
                }
            }
            setDragLayerIndex(null)
            setDragOverLayerIndex(null)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Material Actions
    const handleAddMaterial = () => {
        // Include a default layer with TextureID 0 so the geoset renders correctly
        const defaultLayer = {
            __editorLayerId: createEditorId('layer'),
            FilterMode: 0,
            TextureID: 0,
            Alpha: 1,
            Unshaded: true, // Prevent lighting issues hiding the model
            Unfogged: false,
            TwoSided: true, // Prevent backface culling hiding the model
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newMaterial = { __editorMaterialId: createEditorId('mat'), PriorityPlane: 0, RenderMode: 0, Layers: [defaultLayer] }
        const nextMaterials = applyMaterialsChange((previous) => [...previous, newMaterial])
        if (isStandalone) {
            syncStandaloneMaterials(nextMaterials)
        } else {
            didRealtimePreviewRef.current = true
            setMaterials(denormalizeMaterialsForSave(nextMaterials))
        }
        setSelectedMaterialIndex(nextMaterials.length - 1)
        setSelectedLayerIndex(0) // Auto-select the first layer of the new material

        // Auto-scroll to the new material after state update
        setTimeout(() => {
            if (materialListRef.current) {
                materialListRef.current.scrollTop = materialListRef.current.scrollHeight
            }
        }, 0)
    }

    const handleDeleteMaterial = (index: number) => {
        const newMaterials = applyMaterialsChange((previous) => previous.filter((_, i) => i !== index))

        // Update geoset MaterialID references - only for geosets that referenced the deleted material
        // Set them to use material 0 (the first remaining material)
        if (modelData?.Geosets) {
            const updatedGeosets = modelData.Geosets.map((geoset: any) => {
                const matId = geoset.MaterialID;
                if (matId === index) {
                    // Geoset was referencing the deleted material, set to 0
                    return { ...geoset, MaterialID: 0 };
                } else if (matId > index) {
                    // Geoset was referencing a material after the deleted one
                    // We need to decrement to keep the reference valid
                    return { ...geoset, MaterialID: matId - 1 };
                }
                return geoset;
            });
            // Sync BOTH materials and geosets to the store together to prevent mismatch
            // This ensures the renderer sees consistent data
            if (isStandalone) {
                syncStandaloneMaterials(newMaterials, modelTexturesRef.current, updatedGeosets)
            } else {
                didRealtimePreviewRef.current = true
                applyVisualPatch({ Materials: denormalizeMaterialsForSave(newMaterials), Geosets: updatedGeosets });
            }
        } else if (isStandalone) {
            syncStandaloneMaterials(newMaterials)
        } else {
            didRealtimePreviewRef.current = true
            setMaterials(denormalizeMaterialsForSave(newMaterials))
        }

        if (selectedMaterialIndex === index) {
            setSelectedMaterialIndex(-1)
            setSelectedLayerIndex(-1)
        } else if (selectedMaterialIndex > index) {
            setSelectedMaterialIndex(selectedMaterialIndex - 1)
        }
    }

    // Layer Actions
    const handleAddLayer = () => {
        if (selectedMaterialIndex < 0) return
        const newLayer = {
            __editorLayerId: createEditorId('layer'),
            FilterMode: 0,
            TextureID: 0,  // Default to first texture (index 0) instead of -1 (invalid)
            Alpha: 1,
            Unshaded: true,
            Unfogged: false,
            TwoSided: true,
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newMaterials = applyMaterialsChange((previous) => {
            if (selectedMaterialIndex < 0 || selectedMaterialIndex >= previous.length) return previous
            const material = previous[selectedMaterialIndex]
            previous[selectedMaterialIndex] = {
                ...material,
                Layers: [...(material?.Layers || []), newLayer]
            }
            return previous
        })
        if (isStandalone) {
            syncStandaloneMaterials(newMaterials)
        } else {
            didRealtimePreviewRef.current = true
            setMaterials(denormalizeMaterialsForSave(newMaterials))
        }
        setSelectedLayerIndex(newMaterials[selectedMaterialIndex].Layers.length - 1)
    }

    const handleDeleteLayer = (index: number) => {
        if (selectedMaterialIndex < 0) return
        const newMaterials = applyMaterialsChange((previous) => {
            if (selectedMaterialIndex < 0 || selectedMaterialIndex >= previous.length) return previous
            const material = previous[selectedMaterialIndex]
            previous[selectedMaterialIndex] = {
                ...material,
                Layers: (material?.Layers || []).filter((_: any, i: number) => i !== index)
            }
            return previous
        })
        if (isStandalone) {
            syncStandaloneMaterials(newMaterials)
        } else {
            didRealtimePreviewRef.current = true
            setMaterials(denormalizeMaterialsForSave(newMaterials))
        }
        const remainingLayers = newMaterials[selectedMaterialIndex]?.Layers || []
        if (remainingLayers.length === 0) {
            setSelectedLayerIndex(-1)
            return
        }
        if (selectedLayerIndex === index) {
            setSelectedLayerIndex(Math.min(index, remainingLayers.length - 1))
        } else if (selectedLayerIndex > index) {
            setSelectedLayerIndex(selectedLayerIndex - 1)
        }
    }

    // Keyframe Logic
    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'MaterialEditorModal') {
                if (editingField && selectedMaterialIndex >= 0 && selectedLayerIndex >= 0) {
                    updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [editingField]: payload.data })
                }
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [editingField, selectedMaterialIndex, selectedLayerIndex]);

    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)

        const payload = {
            callerId: 'MaterialEditorModal',
            initialData: selectedLayer ? selectedLayer[field] : null,
            title: `编辑 ${field}`,
            vectorSize,
            fieldName: field,
            globalSequences: (modelData?.GlobalSequences || [])
                .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
                .filter((v: any) => typeof v === 'number'),
            sequences: modelData?.Sequences || []
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
    }

    const handleAnimToggle = (field: string, checked: boolean, vectorSize: number = 1) => {
        const activeMaterialIndex = selectedMaterialIndexRef.current
        const activeLayerIndex = selectedLayerIndexRef.current
        if (activeMaterialIndex < 0 || activeLayerIndex < 0) return
        const layer = localMaterials[activeMaterialIndex].Layers[activeLayerIndex]

        if (checked) {
            const currentVal = layer[field]
            // For TextureID, default to 0 (first texture); for Alpha, default to 1
            const defaultVal = field === 'TextureID' ? 0 : 1
            const initialVal = typeof currentVal === 'number' ? currentVal : defaultVal
            const animVector = {
                Keys: [{ Frame: 0, Vector: vectorSize === 1 ? [initialVal] : new Array(vectorSize).fill(0) }],
                LineType: 0,
                GlobalSeqId: null
            }
            updateLocalLayer(activeMaterialIndex, activeLayerIndex, { [field]: animVector })
        } else {
            const currentVal = layer[field]
            // For TextureID, default to 0; for Alpha, default to 1
            let staticVal = field === 'TextureID' ? 0 : 1
            if (currentVal && currentVal.Keys && currentVal.Keys.length > 0) {
                staticVal = currentVal.Keys[0].Vector[0]
            }
            updateLocalLayer(activeMaterialIndex, activeLayerIndex, { [field]: staticVal })
        }
    }

    const selectedMaterial = selectedMaterialIndex >= 0 ? localMaterials[selectedMaterialIndex] : null
    const selectedLayer = selectedMaterial && selectedLayerIndex >= 0 && selectedMaterial.Layers ? selectedMaterial.Layers[selectedLayerIndex] : null

    const filterModeOptions = [
        { value: 0, label: 'None' },
        { value: 1, label: 'Transparent' },
        { value: 2, label: 'Blend' },
        { value: 3, label: 'Additive' },
        { value: 4, label: 'Add Alpha' },
        { value: 5, label: 'Modulate' },
        { value: 6, label: 'Modulate 2X' },
    ]

    const SUPPORTED_TEXTURE_EXTENSIONS = new Set(['.blp', '.tga'])

    const isSupportedTextureFile = (path: string): boolean => {
        const lower = path.toLowerCase()
        for (const ext of SUPPORTED_TEXTURE_EXTENSIONS) {
            if (lower.endsWith(ext)) return true
        }
        return false
    }

    const normalizeTexturePathKey = (path: string): string => path.replace(/\//g, '\\').toLowerCase()

    const isAbsoluteWindowsPath = (path: string): boolean => /^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\')

    const getModelDirectory = (): string | null => {
        if (!modelPath) return null
        const normalizedModelPath = modelPath.replace(/\//g, '\\')
        const modelDir = normalizedModelPath.split('\\').slice(0, -1).join('\\')
        return modelDir || null
    }

    const getFileName = (path: string): string => path.replace(/\//g, '\\').split('\\').pop() || path

    const splitFileName = (fileName: string): { stem: string; ext: string } => {
        const dot = fileName.lastIndexOf('.')
        if (dot <= 0) return { stem: fileName, ext: '' }
        return { stem: fileName.slice(0, dot), ext: fileName.slice(dot) }
    }

    const tryParseFileUriToPath = (uri: string): string | null => {
        if (!uri || !uri.toLowerCase().startsWith('file://')) return null
        try {
            const decoded = decodeURIComponent(uri.replace(/^file:\/\//i, ''))
            if (/^\/[a-zA-Z]:\//.test(decoded)) {
                return decoded.slice(1).replace(/\//g, '\\')
            }
            return decoded.replace(/\//g, '\\')
        } catch {
            return null
        }
    }

    const getExternalTexturePathsFromDrop = (dataTransfer: DataTransfer): string[] => {
        const result: string[] = []
        const seen = new Set<string>()

        const pushIfSupported = (raw: string | null | undefined) => {
            if (!raw) return
            const trimmed = raw.trim()
            if (!trimmed) return
            const parsedUriPath = tryParseFileUriToPath(trimmed)
            const finalPath = parsedUriPath || trimmed
            if (!isSupportedTextureFile(finalPath)) return

            const key = normalizeTexturePathKey(finalPath)
            if (seen.has(key)) return
            seen.add(key)
            result.push(finalPath)
        }

        const files = Array.from(dataTransfer.files || [])
        for (const file of files) {
            const filePath = (file as any).path as string | undefined
            if (filePath) {
                pushIfSupported(filePath)
            } else {
                pushIfSupported(file.name)
            }
        }

        const uriList = dataTransfer.getData('text/uri-list')
        if (uriList) {
            uriList
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'))
                .forEach((line) => pushIfSupported(line))
        }

        const textPlain = dataTransfer.getData('text/plain')
        if (textPlain) {
            textPlain
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .forEach((line) => pushIfSupported(line))
        }

        return result
    }

    const ensureTextureInModelDir = async (rawPath: string): Promise<{ relativePath: string; copied: boolean } | null> => {
        const modelDir = getModelDirectory()
        if (!modelDir) {
            message.warning('当前模型路径无效，无法导入外部贴图')
            return null
        }

        const sourcePath = rawPath.replace(/\//g, '\\')
        if (!isAbsoluteWindowsPath(sourcePath)) {
            return null
        }

        const sourceLower = sourcePath.toLowerCase()
        const modelDirLower = modelDir.toLowerCase()
        const modelDirPrefix = `${modelDirLower}\\`

        // Already under model directory: keep a relative path.
        if (sourceLower.startsWith(modelDirPrefix)) {
            return {
                relativePath: sourcePath.slice(modelDir.length + 1),
                copied: false
            }
        }
        const { readFile, writeFile, exists, size } = await import('@tauri-apps/plugin-fs')
        const originalFileName = getFileName(sourcePath)
        let targetFileName = originalFileName
        let targetAbsPath = `${modelDir}\\${targetFileName}`
        const sourceSize = await size(sourcePath).catch(() => null)

        // Same-name file exists: reuse it when file size matches.
        if (await exists(targetAbsPath)) {
            const targetSize = await size(targetAbsPath).catch(() => null)
            if (sourceSize !== null && targetSize !== null && sourceSize === targetSize) {
                return {
                    relativePath: targetFileName,
                    copied: false
                }
            }

            // Name collision with different size: search suffixed names.
            const { stem, ext } = splitFileName(originalFileName)
            let index = 1
            while (await exists(`${modelDir}\\${stem}_${index}${ext}`)) {
                const candidateFileName = `${stem}_${index}${ext}`
                const candidateAbsPath = `${modelDir}\\${candidateFileName}`
                const candidateSize = await size(candidateAbsPath).catch(() => null)
                if (sourceSize !== null && candidateSize !== null && sourceSize === candidateSize) {
                    return {
                        relativePath: candidateFileName,
                        copied: false
                    }
                }
                index++
            }
            targetFileName = `${stem}_${index}${ext}`
            targetAbsPath = `${modelDir}\\${targetFileName}`
        }
        const bytes = await readFile(sourcePath)
        await writeFile(targetAbsPath, bytes)
        return {
            relativePath: targetFileName,
            copied: true
        }
    }

    const importExternalTextures = async (externalPaths: string[]): Promise<{ firstTextureId: number; nextTextures?: any[] } | null> => {
        if (externalPaths.length === 0) return null

        const currentTextures = Array.isArray(modelTexturesRef.current) ? [...modelTexturesRef.current] : []
        const pathToIndex = new Map<string, number>()
        currentTextures.forEach((tex: any, index: number) => {
            const path = tex?.Image
            if (typeof path === 'string' && path.length > 0) {
                pathToIndex.set(normalizeTexturePathKey(path), index)
            }
        })

        let firstTextureId: number | null = null
        let addedCount = 0
        let copiedCount = 0

        for (const rawPath of externalPaths) {
            let imported: { relativePath: string; copied: boolean } | null = null
            try {
                imported = await ensureTextureInModelDir(rawPath)
            } catch (error) {
                console.error('[MaterialEditorModal] Failed to import external texture:', rawPath, error)
                continue
            }
            if (!imported) continue

            const modelTexturePath = imported.relativePath
            const key = normalizeTexturePathKey(modelTexturePath)
            let textureId = pathToIndex.get(key)
            if (textureId === undefined) {
                textureId = currentTextures.length
                currentTextures.push({
                    Image: modelTexturePath,
                    ReplaceableId: 0,
                    Flags: 0
                })
                pathToIndex.set(key, textureId)
                addedCount++
            }
            if (imported.copied) copiedCount++

            if (firstTextureId === null) {
                firstTextureId = textureId
            }
        }

        if (firstTextureId === null) return null

        if (addedCount > 0) {
            if (copiedCount > 0) {
                message.success(`已复制 ${copiedCount} 个贴图到模型目录并应用`)
            } else {
                message.success(`已导入 ${addedCount} 个贴图并应用到当前图层`)
            }
        } else {
            message.success('已应用已存在的贴图到当前图层')
        }

        return {
            firstTextureId,
            nextTextures: addedCount > 0 ? currentTextures : undefined
        }
    }

    const isPointInsideElement = (x: number, y: number, element: HTMLElement | null): boolean => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    const handleExternalTexturePaths = async (paths: string[]) => {
        const activeMaterialIndex = selectedMaterialIndexRef.current
        const activeLayerIndex = selectedLayerIndexRef.current
        if (activeMaterialIndex < 0 || activeLayerIndex < 0) return
        if (paths.length === 0) return

        try {
            const importedResult = await importExternalTextures(paths)
            if (!importedResult) return
            applyImportedTextureToLayer(
                activeMaterialIndex,
                activeLayerIndex,
                importedResult.firstTextureId,
                importedResult.nextTextures
            )
        } catch (error) {
            console.error('[MaterialEditorModal] External file drop handling failed:', error)
            message.error('贴图导入失败')
        }
    }

    useEffect(() => {
        if (!visible) return
        const onExternalFileDrop = async (evt: Event) => {
            const activeMaterialIndex = selectedMaterialIndexRef.current
        const activeLayerIndex = selectedLayerIndexRef.current
        if (activeMaterialIndex < 0 || activeLayerIndex < 0) return
            const customEvent = evt as CustomEvent<{ paths?: string[]; position?: { x: number; y: number } | null }>
            const paths = Array.isArray(customEvent.detail?.paths) ? customEvent.detail.paths : []
            if (paths.length === 0) return
            const supportedPaths = paths.filter(isSupportedTextureFile)
            if (supportedPaths.length === 0) return
            const position = customEvent.detail?.position
            if (position && ![detailsDropSurfaceRef.current, layerTextureDropSurfaceRef.current, textureDropZoneRef.current].some((element) => isPointInsideElement(position.x, position.y, element))) {
                return
            }
            await handleExternalTexturePaths(supportedPaths)
        }
        window.addEventListener('war3-external-file-drop', onExternalFileDrop as EventListener)
        return () => window.removeEventListener('war3-external-file-drop', onExternalFileDrop as EventListener)
    }, [visible, selectedMaterialIndex, selectedLayerIndex, modelData, modelPath, localMaterials])
    useEffect(() => {
        if (!isStandalone || !visible) return
        let disposed = false
        let unlistenDrop: (() => void) | undefined
        let unlistenDragEnter: (() => void) | undefined
        let unlistenDragLeave: (() => void) | undefined
        const setupStandaloneDragDrop = async () => {
            const currentWindowLabel = getCurrentWindow().label
            const isHitTarget = (position?: { x: number; y: number } | null) => {
                const dropTargets = [detailsDropSurfaceRef.current, layerTextureDropSurfaceRef.current, textureDropZoneRef.current].filter(Boolean) as HTMLElement[]
                if (dropTargets.length === 0) return false
                if (!position) return true
                return dropTargets.some((element) => isPointInsideElement(position.x, position.y, element))
            }

            unlistenDragEnter = await listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-enter', (event) => {
                if (disposed) return
                const sourceWindowLabel = (event as any)?.windowLabel
                if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return
                const supportedPaths = (event.payload?.paths || []).filter(isSupportedTextureFile)
                if (supportedPaths.length === 0) return
                if (!isHitTarget(event.payload?.position)) return
                setIsTextureDropActive(true)
            })

            unlistenDragLeave = await listen('tauri://drag-leave', () => {
                if (disposed) return
                setIsTextureDropActive(false)
            })

            unlistenDrop = await listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-drop', async (event) => {
                if (disposed) return
                const sourceWindowLabel = (event as any)?.windowLabel
                if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return
                const supportedPaths = (event.payload?.paths || []).filter(isSupportedTextureFile)
                if (supportedPaths.length === 0) return
                const position = event.payload?.position
                if (position && ![detailsDropSurfaceRef.current, layerTextureDropSurfaceRef.current, textureDropZoneRef.current].some((element) => isPointInsideElement(position.x, position.y, element))) {
                    return
                }
                await handleExternalTexturePaths(supportedPaths)
            })
        }
        setupStandaloneDragDrop().catch((error) => {
            console.error('[MaterialEditorModal] Failed to setup standalone drag-drop:', error)
        })
        return () => {
            disposed = true
            unlistenDrop?.()
            unlistenDragEnter?.()
            unlistenDragLeave?.()
            setIsTextureDropActive(false)
        }
    }, [isStandalone, visible, selectedMaterialIndex, selectedLayerIndex, modelData, modelPath, localMaterials])

    const effectiveTextures = localTextures.length > 0 ? localTextures : ((modelData as any)?.Textures || [])
    const textureCount = effectiveTextures.length || 0
    const textureOptions = Array.from({ length: textureCount }, (_, i) => {
        const path = effectiveTextures?.[i]?.Image || '';
        const filename = path.replace(/\\/g, '/').split('/').pop() || path;

        return {
            value: String(i),
            plainLabel: filename || `Texture ${i}`,
            label: `${filename || `Texture ${i}`}  (#${i})`
        };
    })
    if (textureOptions.length === 0) {
    }

    const handleTextureDropOver = (e: React.DragEvent<HTMLDivElement>) => {
        const draggedIndex = getDraggedTextureIndex(e.dataTransfer)
        const externalTexturePaths = getExternalTexturePathsFromDrop(e.dataTransfer)
        const hasFilePayload = Array.from(e.dataTransfer.types || []).includes('Files')
        if (draggedIndex === null && externalTexturePaths.length === 0 && !hasFilePayload) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setIsTextureDropActive(true)
    }

    const handleTextureDropLeave = () => {
        setIsTextureDropActive(false)
    }

    const handleTextureDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        setIsTextureDropActive(false)
        const activeMaterialIndex = selectedMaterialIndexRef.current
        const activeLayerIndex = selectedLayerIndexRef.current
        if (activeMaterialIndex < 0 || activeLayerIndex < 0) return
        e.preventDefault()
        e.stopPropagation()

        const draggedIndex = getDraggedTextureIndex(e.dataTransfer)
        if (draggedIndex !== null) {
            if (draggedIndex >= textureCount) {
                message.warning(`拖放的贴图索引 ${draggedIndex} 超出范围`)
                return
            }
            const nextMaterials = updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: draggedIndex }, true)
            commitStandaloneTextureDrivenChange(nextMaterials, modelTexturesRef.current)
            return
        }

        const externalTexturePaths = getExternalTexturePathsFromDrop(e.dataTransfer)
        if (externalTexturePaths.length === 0) return

        try {
            const importedResult = await importExternalTextures(externalTexturePaths)
            if (!importedResult) return
            applyImportedTextureToLayer(
                activeMaterialIndex,
                activeLayerIndex,
                importedResult.firstTextureId,
                importedResult.nextTextures
            )
        } catch (error) {
            console.error('[MaterialEditorModal] Texture drop import failed:', error)
            message.error('贴图导入失败')
        }
    }

    const innerContent = (
        <div style={{ display: 'flex', height: '100%', border: isStandalone ? 'none' : '1px solid #4a4a4a', backgroundColor: '#252525', overflow: 'hidden' }}>
            {/* Lists (Left) - Two Columns */}
            <div style={{ width: '240px', minWidth: '240px', display: 'flex', flexDirection: 'row', borderRight: '1px solid #4a4a4a' }}>
                {/* Top: Materials (Left Half of Left Pane) */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#333333', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #4a4a4a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#e8e8e8', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="材质 (Materials)">材质 (Materials)</Text>
                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAddMaterial} style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff', padding: '0 4px', height: '20px', fontSize: '10px' }} />
                    </div>
                    <div ref={materialListRef} style={{ overflowY: 'auto', flex: 1 }}>
                        <List
                            dataSource={localMaterials}
                            rowKey={(item: any, index?: number) => item?.__editorMaterialId || `material-${index ?? 0}`}
                            renderItem={(_item: any, index: number) => (
                                <List.Item
                                    data-material-index={index}
                                    onClick={() => {
                                        setSelectedMaterialIndex(index)
                                        const mats = localMaterials[index]
                                        if (mats && mats.Layers && mats.Layers.length > 0) {
                                            setSelectedLayerIndex(0) // Auto select first layer
                                        } else {
                                            setSelectedLayerIndex(-1)
                                        }
                                    }}
                                    style={{
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        backgroundColor: selectedMaterialIndex === index ? '#5a9cff' : 'transparent',
                                        color: selectedMaterialIndex === index ? '#fff' : '#b0b0b0',
                                        borderBottom: '1px solid #3a3a3a',
                                        fontSize: '12px'
                                    }}
                                    className="hover:bg-[#454545]"
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Material {index}</span>
                                        {selectedMaterialIndex === index && (
                                            <DeleteOutlined onClick={(e) => { e.stopPropagation(); handleDeleteMaterial(index) }} style={{ color: '#fff' }} />
                                        )}
                                    </div>
                                </List.Item>
                            )}
                        />
                    </div>
                </div>

                {/* Bottom/Right: Layers (Right Half of Left Pane) */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#2d2d2d', overflow: 'hidden', borderLeft: '1px solid #4a4a4a' }}>
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #4a4a4a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#e8e8e8', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="图层 (Layers)">图层 (Layers)</Text>
                        <Button
                            type="primary"
                            size="small"
                            icon={<PlusOutlined />}
                            onClick={handleAddLayer}
                            disabled={selectedMaterialIndex < 0}
                            style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff', padding: '0 4px', height: '20px', fontSize: '10px' }}
                        />
                    </div>
                    <div ref={layerListRef} style={{ overflowY: 'auto', flex: 1 }}>
                        {selectedMaterial ? (
                            <List
                                dataSource={selectedMaterial.Layers || []}
                                rowKey={(item: any, index?: number) => item?.__editorLayerId || `layer-${index ?? 0}`}
                                renderItem={(_item: any, index: number) => (
                                    <List.Item
                                        onClick={() => setSelectedLayerIndex(index)}
                                        data-layer-index={index}
                                        onMouseDown={(e) => handleLayerMouseDown(e, index)}
                                        style={{
                                            padding: '4px 8px',
                                            backgroundColor: selectedLayerIndex === index ? '#5a9cff' : 'transparent',
                                            color: selectedLayerIndex === index ? '#fff' : '#b0b0b0',
                                            borderBottom: '1px solid #3a3a3a',
                                            opacity: dragLayerIndex === index ? 0.6 : 1,
                                            outline: dragOverLayerIndex === index && dragLayerIndex !== null && dragLayerIndex !== index ? '1px dashed #5a9cff' : 'none',
                                            cursor: dragLayerIndex === index ? 'grabbing' : 'grab',
                                            userSelect: 'none',
                                            fontSize: '12px'
                                        }}
                                        className="hover:bg-[#454545]"
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Layer {index}</span>
                                            {selectedLayerIndex === index && (
                                                <DeleteOutlined onClick={(e) => { e.stopPropagation(); handleDeleteLayer(index) }} style={{ color: '#fff' }} />
                                            )}
                                        </div>
                                    </List.Item>
                                )}
                            />
                        ) : (
                            <div style={{ padding: '16px', color: '#666', textAlign: 'center' }}>
                                请先选择材质
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Details (Right) */}
            <div ref={detailsDropSurfaceRef} style={{ flex: 1, padding: '8px 12px', overflowY: 'hidden', backgroundColor: isTextureDropActive ? 'rgba(90,156,255,0.05)' : '#252525', display: 'flex', flexDirection: 'column', gap: '8px', border: isTextureDropActive ? '1px dashed #5a9cff' : '1px dashed transparent', borderRadius: 8, boxShadow: isTextureDropActive ? '0 0 0 1px rgba(90,156,255,0.22) inset' : 'none', transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease' }}>
                {selectedMaterialIndex >= 0 ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            {isTextureDropActive ? (<div style={{ padding: '6px 10px', borderRadius: '6px', border: '1px dashed #5a9cff', background: 'rgba(90,156,255,0.10)', color: '#9fc1ff', fontSize: '12px' }}>将 .blp 或 .tga 贴图拖到右侧即可复制到模型目录并替换当前图层贴图</div>) : null}
                            <Text style={{ color: '#b0b0b0', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                正在编辑: Material {selectedMaterialIndex} {selectedLayerIndex >= 0 ? `/ Layer ${selectedLayerIndex}` : ''}
                            </Text>
                        </div>

                        {/* Always show Material attributes when a Material is selected */}
                        {selectedMaterial && (
                            <Card title={<span style={{ color: '#b0b0b0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>材质设置 (Material)</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a' }} headStyle={{ borderBottom: '1px solid #4a4a4a', minHeight: 'auto', padding: '0 8px' }} bodyStyle={{ padding: '8px' }}>
                                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <Text style={{ marginRight: '4px', color: '#b0b0b0', fontSize: '12px' }}>优先(Plane):</Text>
                                        <InputNumber
                                            size="small"
                                            value={selectedMaterial.PriorityPlane || 0}
                                            onChange={(v) => updateLocalMaterial(selectedMaterialIndex, { PriorityPlane: v }, true)}
                                            style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', width: '60px' }}
                                        />
                                    </div>
                                    <Checkbox checked={selectedMaterial.ConstantColor} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { ConstantColor: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>固定颜色</Checkbox>
                                    <Checkbox checked={selectedMaterial.SortPrimsFarZ} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { SortPrimsFarZ: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>沿Z排列</Checkbox>
                                    <Checkbox checked={selectedMaterial.FullResolution} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { FullResolution: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>最大分辨率</Checkbox>
                                </div>
                            </Card>
                        )}

                        {/* Show Layer attributes immediately below if a layer is selected */}
                        {selectedLayer ? (
                            <React.Fragment key={`${selectedMaterial?.__editorMaterialId || selectedMaterialIndex}-${selectedLayer?.__editorLayerId || selectedLayerIndex}`}>
                                <div ref={layerTextureDropSurfaceRef} style={{ border: isTextureDropActive ? '1px dashed #5a9cff' : '1px dashed transparent', borderRadius: 6, transition: 'border-color 0.15s ease, box-shadow 0.15s ease', boxShadow: isTextureDropActive ? '0 0 0 1px rgba(90,156,255,0.25) inset' : 'none' }}>
                                    <Card title={<span style={{ color: '#b0b0b0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>图层贴图与动画 (Layer Textures & Anims)</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a', marginTop: selectedMaterial ? '0px' : '0px' }} headStyle={{ borderBottom: '1px solid #4a4a4a', minHeight: 'auto', padding: '0 8px' }} bodyStyle={{ padding: '8px' }}>
                                        {/* Row 1: Texture ID (Full Width) */}
                                        <div style={{ marginBottom: 8 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2px' }}>
                                                <Text style={{ color: '#b0b0b0', fontSize: '12px' }}>贴图 ID:</Text>
                                                <Text style={{ color: '#7f7f7f', fontSize: '10px' }}>可拖动替换贴图</Text>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                <Checkbox
                                                    checked={selectedLayer.TextureID && typeof selectedLayer.TextureID !== 'number'}
                                                    onChange={(e) => handleAnimToggle('TextureID', e.target.checked)}
                                                    style={{ color: '#e8e8e8', fontSize: '12px' }}
                                                >
                                                    动态
                                                </Checkbox>
                                                {selectedLayer.TextureID && typeof selectedLayer.TextureID !== 'number' ? (
                                                    <Button size="small" onClick={() => openKeyframeEditor('TextureID', 1)}>编辑动画</Button>
                                                ) : (
                                                    <div
                                                        ref={textureDropZoneRef}
                                                        style={{
                                                            flex: 1,
                                                            border: isTextureDropActive ? '1px dashed #5a9cff' : '1px dashed transparent',
                                                            borderRadius: 4,
                                                            padding: 0,
                                                            transition: 'border-color 0.15s ease'
                                                        }}
                                                        onDragOver={handleTextureDropOver}
                                                        onDragEnter={handleTextureDropOver}
                                                        onDragLeave={handleTextureDropLeave}
                                                        onDrop={handleTextureDrop}
                                                    >
                                                        <Select
                                                            size="small"
                                                            style={{ width: '100%', fontSize: '12px' }}
                                                            value={String(typeof selectedLayer.TextureID === 'number' ? selectedLayer.TextureID : Number(selectedLayer.TextureID || 0))}
                                                            onChange={(v) => {
                                                                const nextMaterials = updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: Number(v) }, true)
                                                                commitStandaloneTextureDrivenChange(nextMaterials, modelTexturesRef.current)
                                                            }}
                                                            options={textureOptions}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {/* Row 2: Alpha, Filter Mode, TVertexAnim */}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            <div style={{ flex: '1 1 auto', minWidth: '130px' }}>
                                                <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '12px', whiteSpace: 'nowrap' }}>透明度 (Alpha):</Text>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <Checkbox
                                                        checked={selectedLayer.Alpha && typeof selectedLayer.Alpha !== 'number'}
                                                        onChange={(e) => handleAnimToggle('Alpha', e.target.checked)}
                                                        style={{ color: '#e8e8e8', fontSize: '12px', whiteSpace: 'nowrap' }}
                                                    >
                                                        动态
                                                    </Checkbox>
                                                    {selectedLayer.Alpha && typeof selectedLayer.Alpha !== 'number' ? (
                                                        <Button size="small" onClick={() => openKeyframeEditor('Alpha', 1)}>编辑动画</Button>
                                                    ) : (
                                                        <InputNumber
                                                            size="small"
                                                            value={selectedLayer.Alpha ?? 1}
                                                            onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Alpha: v }, true)}
                                                            step={0.01} min={0} max={1}
                                                            precision={2}
                                                            style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', width: '60px' }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                                                <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '12px' }}>过滤模式:</Text>
                                                <Select
                                                    size="small"
                                                    style={{ width: '100%', fontSize: '12px' }}
                                                    value={selectedLayer.FilterMode}
                                                    onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { FilterMode: v }, true)}
                                                    options={filterModeOptions}
                                                    popupClassName="dark-theme-select-dropdown"
                                                />
                                            </div>
                                            <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                                                <Text style={{ display: 'block', marginBottom: '2px', color: '#b0b0b0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>纹理动画:</Text>
                                                <Select
                                                    size="small"
                                                    style={{ width: '100%', fontSize: '12px' }}
                                                    value={selectedLayer.TVertexAnimId === null || selectedLayer.TVertexAnimId === undefined ? -1 : selectedLayer.TVertexAnimId}
                                                    onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TVertexAnimId: v === -1 ? null : v }, true)}
                                                    options={[
                                                        { value: -1, label: 'None' },
                                                        ...((modelData as any)?.TextureAnims?.map((_: any, i: number) => ({
                                                            value: i,
                                                            label: `Anim ${i}`
                                                        })) || [])
                                                    ]}
                                                    popupClassName="dark-theme-select-dropdown"
                                                />
                                            </div>
                                        </div>
                                    </Card>
                                </div>
                                <Card title={<span style={{ color: '#b0b0b0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>图层标记 (Layer Flags)</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a' }} headStyle={{ borderBottom: '1px solid #4a4a4a', minHeight: 'auto', padding: '0 8px' }} bodyStyle={{ padding: '8px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '8px' }}>
                                        <Checkbox checked={selectedLayer.Unshaded} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Unshaded: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>无阴影</Checkbox>
                                        <Checkbox checked={selectedLayer.Unfogged} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Unfogged: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>无迷雾</Checkbox>
                                        <Checkbox checked={selectedLayer.TwoSided} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TwoSided: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>双面</Checkbox>
                                        <Checkbox checked={selectedLayer.SphereEnvMap} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { SphereEnvMap: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>球面环境</Checkbox>
                                        <Checkbox checked={selectedLayer.NoDepthTest} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { NoDepthTest: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>无深度测试</Checkbox>
                                        <Checkbox checked={selectedLayer.NoDepthSet} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { NoDepthSet: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '12px' }}>无深度设置</Checkbox>
                                    </div>
                                </Card>
                            </React.Fragment>
                        ) : (
                            <div style={{ marginTop: '20px', color: '#808080', textAlign: 'center', fontSize: '12px' }}>
                                请在左侧选择一个图层以编辑详细图层属性
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{ marginTop: '20px', color: '#808080', textAlign: 'center', alignSelf: 'center', flex: 1, display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                        请在左侧选择一个材质
                    </div>
                )}
            </div>
        </div>
    )

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="材质管理器" onClose={handleCancel}>
                <div style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                    {innerContent}
                </div>
            </StandaloneWindowFrame>
        )
    }

    return (
        <DraggableModal
            title="材质管理器 (Material Editor)"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            okText="保存"
            cancelText="取消"
            width={650}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: 0, backgroundColor: '#252525', height: '380px' } }}
        >
            {innerContent}
        </DraggableModal>
    )
}

export default MaterialEditorModal
